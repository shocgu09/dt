// DT 모의투자 — 체결 엔진
// 원칙: "주문 뒤에 실제로 일어난 거래"만 따라간다.
//   - 접수 이후 KRX 누적거래량이 늘었으면 실제 체결이 있었던 것 → 그때의 체결가로 체결
//   - 지정가가 폴링 사이에 스쳐 지나간 경우는 분봉 고가·저가로 잡는다 (1분 크론)
//   - 09:00 전에 받은 주문은 첫 분봉의 시가(= 시가 단일가)로 체결
//   - 15:20~15:30 에 받은 주문은 종가 단일가가 찍히며 거래량이 늘 때 체결 → 자연히 종가
// 금지 규칙 없이도 멈춘 가격(동시호가·VI·거래정지)으로는 체결되지 않는다.
//
// db 는 D1 인터페이스(prepare/bind/first/all/run/batch)만 쓴다 — 테스트에서는 sqlite 로 대체한다.

// 시간외 (실전과 같이 지정가만): NXT 프리마켓 08:00~08:50, 애프터마켓 NXT 15:40~ · KRX 16:00~ → 20:00
export const PRE_FROM    = 8 * 60;        // 08:00 프리마켓 주문 접수 시작 (08:30 부터는 정규장 장전 주문)
export const PRE_TO      = 8 * 60 + 50;   // 08:50 프리마켓 종료
export const AFTER_FROM  = 15 * 60 + 40;  // 15:40 애프터마켓 시작
export const AFTER_TO    = 20 * 60;       // 20:00 애프터마켓 종료
export const ACCEPT_FROM = 8 * 60 + 30;   // 08:30 주문 접수 시작
export const OPEN_AT     = 9 * 60;        // 09:00
export const ACCEPT_TO   = 15 * 60 + 30;  // 15:30 접수 마감
export const FILL_TO     = 15 * 60 + 36;  // 종가 단일가 체결을 받아 줄 여유 (15:40 시간외 종가 전)

export function kstNow(now = Date.now()) {
  const k = new Date(now + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    ymd: `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}`,
    iso: `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`,
    hm: k.getUTCHours() * 60 + k.getUTCMinutes(),
    dow: k.getUTCDay()
  };
}

/** KRX 호가단위 (2023-01-25~). ETF·ETN 은 2,000원 미만 1원, 그 이상 5원 */
export function tickSize(price, taxFree) {
  if (taxFree) return price < 2000 ? 1 : 5;
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

export class OrderError extends Error {
  constructor(message, code) { super(message); this.code = code || 'rejected'; }
}

const uuid = () => crypto.randomUUID();
// 원 미만 절사. 27,000,000 × 0.00015 가 부동소수점에서 4049.999… 가 되므로 아주 작은 값을 더해 내린다
const fee = (amount, rate) => Math.floor(amount * rate + 1e-6);

// ── 조회 헬퍼 ─────────────────────────────────────────────────
export async function activeSeason(db, now = Date.now()) {
  const today = kstNow(now).iso;
  // 시작일이 된 upcoming 시즌은 첫 조회 때 연다 (크론이 못 돌았어도 열리도록)
  await db.prepare(`UPDATE seasons SET status='active' WHERE status='upcoming' AND start_date <= ?`).bind(today).run();
  return db.prepare(`SELECT * FROM seasons WHERE status='active' ORDER BY start_date DESC LIMIT 1`).first();
}

export async function getAccount(db, seasonId, uid) {
  return db.prepare(`SELECT * FROM accounts WHERE season_id=? AND uid=?`).bind(seasonId, uid).first();
}

/** 주문 가능 현금 = 현금 − 미체결 매수 주문이 묶어 둔 금액 */
export async function availableCash(db, seasonId, uid, cash, exceptOrderId) {
  const r = await db.prepare(
    `SELECT COALESCE(SUM(reserved),0) AS r FROM orders
     WHERE season_id=? AND uid=? AND side='buy' AND status IN ('open','partial') AND id<>?`
  ).bind(seasonId, uid, exceptOrderId || '').first();
  return cash - (r ? r.r : 0);
}

// ── 참가 ──────────────────────────────────────────────────────
export async function join(db, season, uid, nickname, now = Date.now()) {
  await db.prepare(
    `INSERT INTO accounts (season_id, uid, nickname, cash, joined_at) VALUES (?,?,?,?,?)
     ON CONFLICT (season_id, uid) DO NOTHING`
  ).bind(season.id, uid, nickname, season.seed, now).run();
  return getAccount(db, season.id, uid);
}

// ── 주문 접수 ─────────────────────────────────────────────────
/**
 * @param input { clientOrderId, code, side, type, qty, limitPrice }
 * @param quote  방금 받은(캐시 아닌) 시세 — providers/naver 의 공통 형태
 * @param taxFree ETF·ETN 여부
 */
export async function acceptOrder(db, season, account, input, quote, taxFree, now = Date.now()) {
  const t = kstNow(now);
  const side = input.side, type = input.type;
  const qty = Number(input.qty);
  if (side !== 'buy' && side !== 'sell') throw new OrderError('매수·매도 구분이 올바르지 않습니다');
  if (type !== 'market' && type !== 'limit') throw new OrderError('주문 종류가 올바르지 않습니다');
  if (!Number.isInteger(qty) || qty <= 0) throw new OrderError('수량은 1주 이상의 정수여야 합니다');
  if (!input.clientOrderId || String(input.clientOrderId).length > 64) throw new OrderError('주문 식별값이 없습니다');

  // 같은 주문이 재전송되면 새로 받지 않고 기존 주문을 돌려준다 (네트워크 재시도로 두 번 사지 않게)
  const dup = await db.prepare(`SELECT * FROM orders WHERE uid=? AND client_order_id=?`)
    .bind(account.uid, String(input.clientOrderId)).first();
  if (dup) return dup;

const weekday = t.dow >= 1 && t.dow <= 5;
  let session = null;
  if (weekday && t.hm >= PRE_FROM && t.hm < ACCEPT_FROM) session = 'pre';
  else if (weekday && t.hm >= ACCEPT_FROM && t.hm < ACCEPT_TO) session = 'regular';
  else if (weekday && t.hm >= AFTER_FROM && t.hm < AFTER_TO) session = 'after';
  if (!session) throw new OrderError('주문 가능 시간이 아닙니다 (평일 08:00~20:00, 15:30~15:40 제외)', 'closed');
  if (!quote || quote.krx == null || quote.krx.price == null) throw new OrderError('시세를 확인할 수 없는 종목입니다');
  if (session !== 'regular') {
    // 시간외는 실전에서도 지정가만 받는다 (거래가 얇아 시장가는 위험하다)
    if (type !== 'limit') throw new OrderError('시간외 거래는 지정가 주문만 가능합니다', 'limit_only');
    const nxtOk = !!(quote.nxt && quote.nxt.price != null);
    if (session === 'pre' && !nxtOk) throw new OrderError('프리마켓(NXT) 거래 대상 종목이 아닙니다. 08:30 부터 정규장 주문이 가능합니다', 'venue');
    // 애프터마켓: NXT 대상이거나 KRX 애프터마켓 대상(ETF·ETN 제외)이어야 한다
    if (session === 'after' && !nxtOk && taxFree) throw new OrderError('ETF·ETN 은 시간외 거래 대상 종목이 아닙니다', 'venue');
  }
  if (quote.halted) throw new OrderError('거래정지 종목입니다', 'halted');
  const blocked = await db.prepare(`SELECT 1 AS x FROM blocked_codes WHERE code=?`).bind(quote.code).first();
  if (blocked) throw new OrderError('현재 주문이 제한된 종목입니다', 'blocked');

  // 기준가 — 시간외에는 지금 거래가 도는 시장의 가격
  const cur = (session !== 'regular' && quote.nxt && quote.nxt.open && quote.nxt.price != null) ? quote.nxt.price : quote.krx.price;
  let limit = null;
  if (type === 'limit') {
    limit = Number(input.limitPrice);
    if (!Number.isInteger(limit) || limit <= 0) throw new OrderError('주문 가격을 입력하세요');
    if (limit % tickSize(limit, taxFree) !== 0) {
      throw new OrderError(`호가단위(${tickSize(limit, taxFree)}원)에 맞지 않는 가격입니다`, 'tick');
    }
    const prev = quote.krx.prevClose;
    if (prev && (limit > prev * 1.3 || limit < prev * 0.7)) throw new OrderError('가격제한폭(±30%)을 벗어난 가격입니다', 'range');
  }

  // 미체결 주문 수 제한은 매매 제약이 아니라 서버 보호용
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE uid=? AND accepted_at > ?`)
    .bind(account.uid, now - 60000).first();
  if (recent && recent.n >= 30) throw new OrderError('주문 요청이 너무 많습니다. 잠시 후 다시 시도하세요', 'rate');

  let reserved = 0;
  if (side === 'buy') {
    // 시장가는 현재가 기준으로 묶는다 (실전은 상한가 기준이지만 그러면 전액 매수가 안 된다 — 기획안 12-1).
    // 체결가가 올라 모자라면 살 수 있는 수량까지만 체결된다.
    const est = (limit || cur) * qty;
    reserved = est + fee(est, season.fee_rate);
    const avail = await availableCash(db, season.id, account.uid, account.cash);
    if (reserved > avail) throw new OrderError('주문 가능 금액이 부족합니다', 'cash');
  } else {
    const pos = await db.prepare(`SELECT qty FROM positions WHERE season_id=? AND uid=? AND code=?`)
      .bind(season.id, account.uid, quote.code).first();
    const pending = await db.prepare(
      `SELECT COALESCE(SUM(qty - filled_qty),0) AS q FROM orders
       WHERE season_id=? AND uid=? AND code=? AND side='sell' AND status IN ('open','partial')`
    ).bind(season.id, account.uid, quote.code).first();
    const sellable = (pos ? pos.qty : 0) - (pending ? pending.q : 0);
    if (qty > sellable) throw new OrderError('매도 가능 수량이 부족합니다', 'qty');
  }

  const preOpen = (session === 'regular' && t.hm < OPEN_AT) ? 1 : 0;
  const marketable = type === 'limit' && !preOpen
    ? ((side === 'buy' ? cur <= limit : cur >= limit) ? 1 : 0) : 0;
  const id = uuid();
  await db.prepare(
    `INSERT INTO orders (id, client_order_id, season_id, uid, code, name, side, type, qty, limit_price,
       reserved, vol_at_accept, pre_open, marketable, tax_free, trade_date, accepted_at, updated_at, session, nxt_vol_at_accept)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, String(input.clientOrderId), season.id, account.uid, quote.code, quote.name || quote.code,
    side, type, qty, limit, reserved, preOpen ? 0 : (quote.krx.volume || 0), preOpen, marketable,
    taxFree ? 1 : 0, t.ymd, now, now, session, (quote.nxt && quote.nxt.volume) || 0).run();
  return db.prepare(`SELECT * FROM orders WHERE id=?`).bind(id).first();
}

export async function cancelOrder(db, uid, orderId, now = Date.now()) {
  const r = await db.prepare(
    `UPDATE orders SET status='cancelled', reserved=0, updated_at=? WHERE id=? AND uid=? AND status IN ('open','partial')`
  ).bind(now, orderId, uid).run();
  return r.meta.changes > 0;
}

/** 거래일이 지났거나 장이 끝난 미체결 주문을 만료시킨다 */
export async function expireStale(db, now = Date.now()) {
  const t = kstNow(now);
  const r = await db.prepare(
    `UPDATE orders SET status='expired', reserved=0, updated_at=?, reason='장 마감'
     WHERE status IN ('open','partial') AND (trade_date < ? OR (trade_date = ? AND (
       (session = 'regular' AND ? >= ${FILL_TO}) OR (session = 'pre' AND ? >= ${PRE_TO}) OR (session = 'after' AND ? >= ${AFTER_TO}))))`
  ).bind(now, t.ymd, t.ymd, t.hm, t.hm, t.hm).run();
  return r.meta.changes;
}

// ── 체결 ──────────────────────────────────────────────────────
/**
 * 주문 1건의 체결을 시도한다.
 * @param ctx { quote, bars }  quote: 최신 시세 / bars: 오늘 1분봉(있으면) — 지정가 스침·시가 판정용
 * @returns 체결 내역 | null
 */
export async function tryFill(db, season, order, ctx, now = Date.now()) {
  if (order.status !== 'open' && order.status !== 'partial') return null;
  const t = kstNow(now);
  const ext = order.session === 'pre' || order.session === 'after';
  if (order.trade_date !== t.ymd) return null;
  if (order.session === 'pre' && (t.hm < PRE_FROM || t.hm >= PRE_TO)) return null;
  if (order.session === 'after' && (t.hm < AFTER_FROM || t.hm >= AFTER_TO)) return null;
  if (!ext && (t.hm < OPEN_AT || t.hm >= FILL_TO)) return null;

  const q = ctx.quote;
  if (!q || !q.krx || q.krx.price == null || q.halted) return null;
  const remaining = order.qty - order.filled_qty;
  const isBuy = order.side === 'buy';
  // 상한가에서의 매수·하한가에서의 매도는 잔량 뒤에 서게 돼 실전에서도 체결되지 않는다 — 풀릴 때까지 대기
  const stuck = (ls) => (isBuy && ls === 'upper') || (!isBuy && ls === 'lower');
  if (!ext && stuck(q.limitState)) return null;

  // 정규장 주문은 09:00~15:30 봉만, 애프터마켓 주문은 15:40 이후 봉만 본다
  const todayBars = (ctx.bars || []).filter((b) => {
    const hm = String(b.t).slice(8, 12);
    return String(b.t).slice(0, 8) === t.ymd && (order.session === 'after' ? hm >= '1540' : (hm >= '0900' && hm <= '1530'));
  });
  // 접수한 분의 봉은 접수 전 거래가 섞여 있어 판정에서 뺀다
  const barsAfterAccept = () => {
    const acc = kstNow(order.accepted_at);
    const accKey = acc.ymd + String(Math.floor(acc.hm / 60)).padStart(2, '0') + String(acc.hm % 60).padStart(2, '0');
    return todayBars.filter((b) => String(b.t).slice(0, 12) > accKey);
  };
  const hits = (p) => (order.type === 'market' ? true : (isBuy ? p <= order.limit_price : p >= order.limit_price));

  let price = null, volCap = Infinity;

  if (ext) {
    // 시간외 — 거래가 도는 시장(NXT, 16:00 이후에는 KRX 애프터마켓도)마다 "접수 이후 실제 거래가 있었고
    // 그 가격이 지정가에 닿았는지"를 본다. 둘 다 되면 실전의 최선집행처럼 회원에게 유리한 쪽으로 체결한다.
    const venues = [];
    if (q.nxt && q.nxt.open && q.nxt.price != null
        && q.nxt.session === (order.session === 'pre' ? 'PRE_MARKET' : 'AFTER_MARKET') && !stuck(q.nxt.limitState)) {
      venues.push({ price: q.nxt.price, traded: (q.nxt.volume || 0) - order.nxt_vol_at_accept });
    }
    if (order.session === 'after' && !stuck(q.limitState)) {
      // 15:40~16:00 의 KRX 거래량 증가는 시간외 종가 매매(종가로 체결)라 그대로 받아 준다
      venues.push({ price: q.krx.price, traded: (q.krx.volume || 0) - order.vol_at_accept });
    }
    const ok = venues.filter((v) => v.traded > 0 && hits(v.price))
      .sort((a, b) => (isBuy ? a.price - b.price : b.price - a.price));
    if (ok.length) {
      price = order.marketable ? ok[0].price : order.limit_price;
      volCap = ok[0].traded - order.filled_qty;
    } else if (order.session === 'after' && todayBars.length) {
      // 폴링 사이에 스친 경우 — KRX 분봉(애프터마켓 포함)으로 판정. NXT 는 분봉이 없어 폴링에 맡긴다
      const touched = barsAfterAccept().filter((b) => (isBuy ? b.l <= order.limit_price : b.h >= order.limit_price));
      if (touched.length) { price = order.limit_price; volCap = touched.reduce((s, b) => s + (b.v || 0), 0) - order.filled_qty; }
    }
  } else if (order.pre_open && order.filled_qty === 0 && !order.vol_at_accept) {
    // 09:00 전에 받은 주문 — 시가 단일가. 오늘 날짜의 첫 분봉이 생겨야 "장이 열렸다"고 본다
    // (시세 필드만 보면 개장 직후 몇 초간 전일 값이 남아 있을 수 있다)
    if (!todayBars.length) return null;
    const open = todayBars[0].o;
    if (hits(open)) { price = open; volCap = todayBars[0].v || 0; }
    else {
      // 시가에 안 닿은 지정가는 이제부터 일반 대기 주문이 된다
      await db.prepare(`UPDATE orders SET vol_at_accept=?, updated_at=? WHERE id=? AND vol_at_accept=0`)
        .bind(Math.max(1, q.krx.volume || 1), now, order.id).run();
      return null;
    }
  } else {
    const traded = (q.krx.volume || 0) - order.vol_at_accept;    // 접수 이후 실제 거래량
    if (traded <= 0) return null;                                 // 접수 뒤로 실제 체결이 없었다 (VI·단일가·거래 없음)
    if (hits(q.krx.price)) {
      // 접수 때부터 닿아 있던 주문은 시장가처럼 실제 체결가에, 기다리다 닿은 지정가는 지정가에 체결
      price = (order.type === 'market' || order.marketable) ? q.krx.price : order.limit_price;
      volCap = traded - order.filled_qty;
    } else if (order.type === 'limit' && todayBars.length) {
      // 폴링 사이에 지정가를 스치고 지나간 경우 — 접수한 분 이후의 분봉으로 판정
      const touched = barsAfterAccept().filter((b) => (isBuy ? b.l <= order.limit_price : b.h >= order.limit_price));
      if (touched.length) {
        price = order.limit_price;
        volCap = touched.reduce((s, b) => s + (b.v || 0), 0) - order.filled_qty;
      }
    }
  }
  if (price == null) return null;

  let qty = Math.min(remaining, season.volume_fill ? Math.max(0, Math.floor(volCap)) : remaining);
  if (qty <= 0) return null;

  const account = await getAccount(db, season.id, order.uid);
  if (!account) return null;
  let cancelRest = false;
  if (isBuy) {
    // 이 주문 몫으로 쓸 수 있는 현금 = 현금 − 다른 주문이 묶어 둔 금액
    const budget = await availableCash(db, season.id, order.uid, account.cash, order.id);
    const affordable = Math.floor(budget / (price * (1 + season.fee_rate)));
    if (affordable < qty) { qty = Math.max(0, affordable); cancelRest = true; }
    while (qty > 0 && price * qty + fee(price * qty, season.fee_rate) > budget) qty--;   // 절사 오차 보정
    if (qty <= 0) {
      await db.prepare(`UPDATE orders SET status='cancelled', reserved=0, reason='주문 가능 금액 부족', updated_at=?
                        WHERE id=? AND status IN ('open','partial')`).bind(now, order.id).run();
      return null;
    }
  }

  const amount = price * qty;
  const f = fee(amount, season.fee_rate);
  const tax = (!isBuy && !order.tax_free) ? fee(amount, season.tax_rate) : 0;
  const newFilled = order.filled_qty + qty;
  const done = newFilled >= order.qty;
  const status = done ? 'filled' : (cancelRest ? 'cancelled' : 'partial');
  const newReserved = (isBuy && !done && !cancelRest) ? Math.max(0, order.reserved - (amount + f)) : 0;

  // 1) 주문 행을 먼저 잡는다 — filled_qty 가 읽은 값 그대로일 때만. 같은 주문을 두 경로(화면 폴링·크론)가
  //    동시에 체결하려 해도 한쪽만 통과한다.
  const lock = await db.prepare(
    `UPDATE orders SET filled_qty=?, reserved=?, status=?, reason=?, updated_at=?
     WHERE id=? AND status IN ('open','partial') AND filled_qty=?`
  ).bind(newFilled, newReserved, status, cancelRest ? '주문 가능 금액 초과로 일부 체결' : null, now, order.id, order.filled_qty).run();
  if (!lock.meta.changes) return null;

  // 2) 잔고·보유·체결 기록은 한 트랜잭션. CHECK(cash>=0, qty>=0) 위반이면 통째로 롤백된다.
  const fillId = uuid();
  const key = [season.id, order.uid, order.code];
  const stmts = isBuy ? [
    db.prepare(`UPDATE accounts SET cash = cash - ?, fills = fills + 1 WHERE season_id=? AND uid=?`)
      .bind(amount + f, season.id, order.uid),
    db.prepare(`INSERT INTO positions (season_id, uid, code, name, qty, cost) VALUES (?,?,?,?,?,?)
                ON CONFLICT (season_id, uid, code) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost, name = excluded.name`)
      .bind(...key, order.name, qty, amount)
  ] : [
    // 실현손익 = 순매도대금 − 매도분 매입금액(이동평균). 보유 행을 고치기 전에 읽어야 한다
    db.prepare(`UPDATE accounts SET cash = cash + ?, fills = fills + 1,
                  realized_pnl = realized_pnl + ? - COALESCE((SELECT CAST(ROUND(cost * 1.0 * ? / qty) AS INTEGER)
                                                            FROM positions WHERE season_id=? AND uid=? AND code=?), 0)
                WHERE season_id=? AND uid=?`)
      .bind(amount - f - tax, amount - f - tax, qty, ...key, season.id, order.uid),
    db.prepare(`UPDATE positions SET cost = cost - CAST(ROUND(cost * 1.0 * ? / qty) AS INTEGER), qty = qty - ?
                WHERE season_id=? AND uid=? AND code=?`).bind(qty, qty, ...key),
    db.prepare(`DELETE FROM positions WHERE season_id=? AND uid=? AND code=? AND qty=0`).bind(...key)
  ];
  stmts.push(db.prepare(
    `INSERT INTO fills (id, order_id, season_id, uid, code, name, side, qty, price, fee, tax, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(fillId, order.id, season.id, order.uid, order.code, order.name, order.side, qty, price, f, tax, now));

  try {
    await db.batch(stmts);
  } catch (e) {
    // 장부 반영에 실패하면 주문 행을 되돌린다 (체결은 없던 일)
    await db.prepare(`UPDATE orders SET filled_qty=?, reserved=?, status=?, reason=NULL, updated_at=? WHERE id=?`)
      .bind(order.filled_qty, order.reserved, order.status, now, order.id).run();
    throw e;
  }
  return { id: fillId, orderId: order.id, code: order.code, side: order.side, qty, price, fee: f, tax, status };
}

// ── 평가 ──────────────────────────────────────────────────────
/** 계정들의 총자산 = 현금 + Σ 보유수량 × 평가가. priceOf(code) 가 없으면 매입가로 평가한다 */
export function valuate(accounts, positions, priceOf) {
  const byUid = {};
  for (const a of accounts) byUid[a.uid] = { uid: a.uid, nickname: a.nickname, cash: a.cash, stock: 0, fills: a.fills, joined_at: a.joined_at };
  for (const p of positions) {
    const row = byUid[p.uid];
    if (!row) continue;
    const px = priceOf(p.code);
    row.stock += px != null ? px * p.qty : p.cost;
  }
  return Object.values(byUid)
    .map((r) => ({ ...r, equity: r.cash + r.stock }))
    .sort((a, b) => (b.equity - a.equity) || (a.joined_at - b.joined_at))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
