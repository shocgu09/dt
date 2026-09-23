// DT 모의투자 — 감시주문 (손절·익절·돌파매수)
// 실전 증권사의 서버 감시주문과 같은 방식:
//   - 등록할 때 수량·현금을 묶지 않는다 (손절을 걸어 둔 주식도 직접 팔 수 있다)
//   - 정규장(09:00~15:20) 동안 1분마다 현재가를 보고, 조건이 되면 그 순간 일반 주문으로 접수한다
//   - 접수 때 매도가능수량·주문가능금액을 평소처럼 확인하고, 모자라면 failed + 사유로 남긴다
//   - 같은 묶음(group_id)의 익절·손절은 하나가 발동하면 나머지를 취소한다
import * as E from './engine.js';
import { sellBlocked } from './corp.js';

export const WATCH_FROM = 9 * 60;          // 09:00
export const WATCH_TO = 15 * 60 + 20;      // 15:20 (종가 단일가 전 — 증권사 감시주문과 같음)
const MAX_ARMED_PER_USER = 50;             // 서버 보호용

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(s || '');

export const publicStop = (s) => s && ({
  id: s.id, code: s.code, name: s.name, side: s.side, cond: s.cond, triggerPrice: s.trigger_price,
  orderType: s.order_type, limitPrice: s.limit_price, qty: s.qty, groupId: s.group_id,
  validUntil: s.valid_until, status: s.status, orderId: s.order_id, reason: s.reason,
  createdAt: s.created_at, triggeredAt: s.triggered_at
});

/** 조건 충족 여부 — 정규장 KRX 현재가 기준 */
export function hit(stop, price) {
  if (price == null) return false;
  return stop.cond === 'gte' ? price >= stop.trigger_price : price <= stop.trigger_price;
}

/**
 * 감시주문 등록
 * @param input { clientOrderId, code, side, cond, triggerPrice, orderType, limitPrice?, qty?, validUntil, groupId? }
 */
export async function createStop(db, season, account, input, quote, taxFree, now = Date.now()) {
  const t = E.kstNow(now);
  const { side, cond } = input;
  const orderType = input.orderType;
  if (side !== 'buy' && side !== 'sell') throw new E.OrderError('매수·매도 구분이 올바르지 않습니다');
  if (cond !== 'gte' && cond !== 'lte') throw new E.OrderError('감시 조건이 올바르지 않습니다');
  if (orderType !== 'market' && orderType !== 'limit') throw new E.OrderError('주문 종류가 올바르지 않습니다');
  if (!input.clientOrderId || String(input.clientOrderId).length > 64) throw new E.OrderError('주문 식별값이 없습니다');
  if (input.groupId != null && !isUuid(input.groupId)) throw new E.OrderError('묶음 값이 올바르지 않습니다');

  const dup = await db.prepare(`SELECT * FROM stop_orders WHERE uid=? AND client_order_id=?`)
    .bind(account.uid, String(input.clientOrderId)).first();
  if (dup) return dup;

  if (!quote || !quote.krx || quote.krx.price == null) throw new E.OrderError('시세를 확인할 수 없는 종목입니다');
  const trigger = Number(input.triggerPrice);
  if (!Number.isInteger(trigger) || trigger <= 0) throw new E.OrderError('감시 가격을 입력하세요');
  let limit = null;
  if (orderType === 'limit') {
    limit = Number(input.limitPrice);
    if (!Number.isInteger(limit) || limit <= 0) throw new E.OrderError('주문 가격을 입력하세요');
    if (limit % E.tickSize(limit, taxFree) !== 0) throw new E.OrderError(`호가단위(${E.tickSize(limit, taxFree)}원)에 맞지 않는 주문 가격입니다`, 'tick');
  }
  let qty = input.qty == null || input.qty === '' ? null : Number(input.qty);
  if (qty != null && (!Number.isInteger(qty) || qty <= 0)) throw new E.OrderError('수량은 1주 이상의 정수여야 합니다');
  if (side === 'buy' && qty == null) throw new E.OrderError('매수 수량을 입력하세요');

  const valid = String(input.validUntil || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valid)) throw new E.OrderError('유효기간이 올바르지 않습니다');
  if (valid < t.iso) throw new E.OrderError('유효기간이 지난 날짜입니다');
  // 오늘 감시 시간(15:20)이 지났는데 '오늘까지'면 한 번도 감시되지 않고 만료된다
  if (valid === t.iso && t.hm >= WATCH_TO) throw new E.OrderError('오늘 감시 시간(09:00~15:20)이 끝났습니다. 유효기간을 다음 거래일 이후로 골라 주세요', 'valid');
  const validUntil = season.end_date && valid > season.end_date ? season.end_date : valid;

  // 이미 조건에 닿아 있으면 바로 발동한다 — 실전에서도 "감시"가 아니라 일반 주문이 맞다
  if (hit({ cond, trigger_price: trigger }, quote.krx.price)) {
    throw new E.OrderError('현재가가 이미 조건에 닿아 있습니다. 일반 주문을 이용해 주세요', 'already');
  }
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM stop_orders WHERE season_id=? AND uid=? AND status='armed'`)
    .bind(season.id, account.uid).first();
  if (n && n.n >= MAX_ARMED_PER_USER) throw new E.OrderError(`감시주문은 ${MAX_ARMED_PER_USER}건까지 걸어 둘 수 있습니다`, 'limit');

  const id = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO stop_orders (id, client_order_id, season_id, uid, code, name, side, cond, trigger_price, order_type,
         limit_price, qty, tax_free, group_id, valid_until, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'armed',?,?)`
    ).bind(id, String(input.clientOrderId), season.id, account.uid, quote.code, quote.name || quote.code, side, cond, trigger,
      orderType, limit, qty, taxFree ? 1 : 0, input.groupId || null, validUntil, now, now).run();
  } catch (e) {
    const again = await db.prepare(`SELECT * FROM stop_orders WHERE uid=? AND client_order_id=?`)
      .bind(account.uid, String(input.clientOrderId)).first();
    if (again) return again;
    throw e;
  }
  return db.prepare(`SELECT * FROM stop_orders WHERE id=?`).bind(id).first();
}

export async function cancelStop(db, uid, id, now = Date.now()) {
  const r = await db.prepare(
    `UPDATE stop_orders SET status='cancelled', reason='직접 취소', updated_at=? WHERE id=? AND uid=? AND status='armed'`
  ).bind(now, id, uid).run();
  return r.meta.changes > 0;
}

/** 유효기간이 지난 감시주문 만료 */
export async function expireStops(db, now = Date.now()) {
  const t = E.kstNow(now);
  await db.prepare(`UPDATE stop_orders SET status='expired', reason='유효기간 만료', updated_at=? WHERE status='armed' AND valid_until < ?`)
    .bind(now, t.iso).run();
}

/**
 * 크론 — 조건이 된 감시주문을 일반 주문으로 접수한다.
 * @param quotesFor  (codes) => { code: quote }  (크론의 3초 캐시를 함께 쓴다)
 * @param stats      { q } D1 문장 수 — 호출당 한도 안에서 멈춘다
 * @returns 발동 건수
 */
export async function runStops(db, season, now, quotesFor, stats, maxTriggers = 2) {
  const t = E.kstNow(now);
  if (!E.isTradingDay(t) || t.hm < WATCH_FROM || t.hm >= WATCH_TO) return 0;
  stats.q += 1;
  const armed = (await db.prepare(`SELECT * FROM stop_orders WHERE season_id=? AND status='armed' AND valid_until >= ? ORDER BY created_at LIMIT 300`)
    .bind(season.id, t.iso).all()).results || [];
  if (!armed.length) return 0;
  const quotes = await quotesFor(Array.from(new Set(armed.map((s) => s.code))).slice(0, 100));
  let fired = 0;
  for (const s of armed) {
    if (fired >= maxTriggers) break;
    const q = quotes[s.code];
    if (!q || !q.krx || q.halted || !hit(s, q.krx.price)) continue;
    // 권리 변동이 반영되기 전의 매도는 발동을 미룬다 (반영 뒤 감시가는 자동 해제된다)
    if (s.side === 'sell') { stats.q += 3; if (await sellBlocked(db, season, s.uid, q, now)) continue; }
    fired++;
    await trigger(db, season, s, q, now, stats);
  }
  return fired;
}

async function trigger(db, season, s, quote, now, stats) {
  // 먼저 잠근다 — 같은 감시주문이 두 번 발동하지 않게
  stats.q += 1;
  const lock = await db.prepare(`UPDATE stop_orders SET status='triggered', triggered_at=?, updated_at=? WHERE id=? AND status='armed'`)
    .bind(now, now, s.id).run();
  if (!lock.meta.changes) return;
  const done = async (status, reason, orderId) => {
    stats.q += s.group_id ? 2 : 1;
    const stmts = [db.prepare(`UPDATE stop_orders SET status=?, reason=?, order_id=?, updated_at=? WHERE id=?`)
      .bind(status, reason, orderId || null, now, s.id)];
    // 묶음(익절+손절)의 나머지는 취소 — 발동에 실패해도 조건은 이미 지나갔으므로 같이 정리한다
    if (s.group_id) stmts.push(db.prepare(
      `UPDATE stop_orders SET status='cancelled', reason='같은 묶음의 다른 감시주문이 발동', updated_at=? WHERE group_id=? AND uid=? AND id<>? AND status='armed'`
    ).bind(now, s.group_id, s.uid, s.id));
    await db.batch(stmts);
  };
  try {
    stats.q += 1;
    const account = await E.getAccount(db, season.id, s.uid);
    if (!account || account.status !== 'active') return done('failed', '계좌를 사용할 수 없습니다');
    let qty = s.qty;
    if (s.side === 'sell' && qty == null) {
      // 전량 — 발동 시점의 매도가능수량 (보유 − 미체결 매도)
      stats.q += 2;
      const pos = await db.prepare(`SELECT qty FROM positions WHERE season_id=? AND uid=? AND code=?`).bind(season.id, s.uid, s.code).first();
      const pend = await db.prepare(`SELECT COALESCE(SUM(qty - filled_qty),0) AS q FROM orders WHERE season_id=? AND uid=? AND code=? AND side='sell' AND status IN ('open','partial')`)
        .bind(season.id, s.uid, s.code).first();
      qty = (pos ? pos.qty : 0) - (pend ? pend.q : 0);
      if (qty <= 0) return done('failed', '매도 가능 수량이 없습니다');
    }
    stats.q += 6;
    const order = await E.acceptOrder(db, season, account, {
      clientOrderId: 'stop:' + s.id, code: s.code, side: s.side, type: s.order_type, qty, limitPrice: s.limit_price
    }, quote, !!s.tax_free, now);
    await done('triggered', null, order.id);
  } catch (e) {
    if (e instanceof E.OrderError) return done('failed', e.message);
    console.error('stop trigger failed', s.id, e && e.message);
    await done('failed', '주문 접수 중 오류가 발생했습니다');
  }
}
