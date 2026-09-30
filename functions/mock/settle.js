// DT 모의투자 — 결제일 정산·미수·담보부족·만기·반대매매·이자 정기징수 (크론)
//
// 일정 (키움 기준, 규칙 값은 credit.js)
//   거래일 23:30 (nightly)
//     ① 미수 판정: 결제일(오늘) 기준 예수금이 음수면 미수금. 처음 생긴 미수가 10만 원을 넘으면 결제일 다음날부터 30일 동결.
//        이미 있던 미수는 하루치 연체이자(연 9.7%, 달력일)를 매긴다. 매도로 충당될 미수(결제 전 매도대금 포함)면 반대매매를 잡지 않는다.
//     ② 담보비율 판정: 오늘 종가로 (잔고 평가 + 현금 보유 × 대용 70% + 예수금) ÷ 융자·대출 원금. 140% 미만이면
//        첫날은 '추가담보 요구'(open), 다음 거래일 밤에도 미만이면 '반대매매 예정'(due) → 그다음 거래일 아침 동시호가.
//     ③ 만기: 만기일이 지난 잔고는 다음 거래일 아침에 현금으로 자동상환하고, 모자라면 반대매매.
//   거래일 08:00~08:29 (morning) — 매월 첫 영업일이면 전월분 이자 정기징수
//   거래일 08:30~08:59 (morning) — 반대매매 주문 접수 (시장가, 09:00 시가 단일가에 체결, 수수료 0.3%)
//
// 무료 요금제 D1 쿼리 한도(호출당 50) 때문에 한 번에 다 못 하면 다음 분 크론이 이어서 한다.
// 모든 단계는 다시 돌아도 같은 결과가 되게 만든다 (처리 표시: misu_accrued_ymd, margin_calls 의 (종류, 날짜) 유일키, 주문 client_order_id 유일키).

import * as E from './engine.js';
import * as K from './credit.js';

const uuid = () => crypto.randomUUID();
const BUDGET = 40;                    // 이 모듈이 한 번에 쓰는 D1 문장 수 상한 (크론의 다른 일과 합쳐 50 미만)

function yd(ymd) { const y = +ymd.slice(0, 4); return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365; }
const overdueFee = (amount, days, ymd) => Math.floor(amount * K.RULES.misuOverdueRate * days / yd(ymd) + 1e-6);

// ── 밤 정산 ───────────────────────────────────────────────────
export async function nightly(db, season, now, stats = { q: 0 }) {
  const t = E.kstNow(now);
  if (!E.isTradingDay(t)) return;
  const S = t.ymd;
  const next = K.addTradingDays(S, 1);
  const stmts = [];
  const push = (st) => { stmts.push(st); };

  // ① 미수 — 결제일 기준 예수금 E = 예수금(D+2) − 결제 전 체결 증감 전부, 충당 X = E + 결제 전 매도대금
  stats.q += 1;
  const rows = (await db.prepare(
    `SELECT a.uid, a.cash, a.cash_short, a.misu_since, a.misu_accrued_ymd, a.frozen_until,
       COALESCE((SELECT SUM(cash_delta) FROM fills f WHERE f.season_id=a.season_id AND f.uid=a.uid AND f.settle_ymd > ? AND f.cash_delta IS NOT NULL), 0) AS pend_all,
       COALESCE((SELECT SUM(cash_delta) FROM fills f WHERE f.season_id=a.season_id AND f.uid=a.uid AND f.settle_ymd > ? AND f.cash_delta IS NOT NULL AND f.side='buy'), 0) AS pend_buy,
       -- 이번 미수 기간에 이미 매긴 연체이자 — 연체이자는 미수 원금에만 붙는다 (연체이자에 다시 붙지 않게 뺀다)
       COALESCE((SELECT -SUM(amount) FROM cash_events e WHERE e.season_id=a.season_id AND e.uid=a.uid AND e.kind='overdue_fee'
                   AND a.misu_since IS NOT NULL AND json_extract(e.detail, '$.since') = a.misu_since), 0) AS fees
     FROM accounts a
     WHERE a.season_id=? AND (a.cash_short > 0 OR a.misu_since IS NOT NULL
       OR EXISTS (SELECT 1 FROM fills f WHERE f.season_id=a.season_id AND f.uid=a.uid AND f.settle_ymd > ? AND f.cash_delta IS NOT NULL))`
  ).bind(S, S, season.id, S).all()).results || [];
  for (const a of rows) {
    if (stmts.length >= BUDGET - 6) break;
    const net = a.cash - a.cash_short;
    const settled = net - a.pend_all;            // 오늘 결제까지 끝난 예수금
    const cover = net - a.pend_buy;              // + 결제 전 매도대금 (매도로 미수가 충당되는지)
    if (settled < 0) {
      const misu = Math.max(0, -settled - a.fees);      // 미수 원금 (이번 기간 연체이자 제외)
      if (!a.misu_since) {
        // 새 미수 — 동결(10만 원 초과, 결제일 다음날부터 30일), 반대매매 일정
        const freeze = misu > K.RULES.misuFreezeMin ? K.addCalendarDays(S, K.RULES.misuFreezeDays) : null;
        push(db.prepare(`UPDATE accounts SET misu_since=?, misu_accrued_ymd=?, frozen_until = COALESCE(MAX(frozen_until, ?), ?, frozen_until)
                         WHERE season_id=? AND uid=? AND misu_since IS NULL`).bind(S, S, freeze, freeze, season.id, a.uid));
        push(callUpsert(db, season, a.uid, 'misu', S, misu, null, cover < 0 ? next : null, cover < 0 ? 'due' : 'covered',
          { settled, cover, frozenUntil: freeze }, now));
      } else if (a.misu_accrued_ymd !== S) {
        // 이어지는 미수 — 지난 정산 이후 달력일만큼 연체이자
        const days = K.daysBetween(a.misu_accrued_ymd || a.misu_since, S);
        const fee = overdueFee(misu, days, S);
        if (fee > 0) {
          const cs = K.cashSet(-fee);
          push(db.prepare(`UPDATE accounts SET ${cs.sql}, interest_paid = interest_paid + ?, misu_accrued_ymd=? WHERE season_id=? AND uid=? AND misu_accrued_ymd IS NOT ?`)
            .bind(...cs.args, fee, S, season.id, a.uid, S));
          push(db.prepare(`INSERT INTO cash_events (id, season_id, uid, kind, amount, lot_id, detail, at) VALUES (?,?,?,'overdue_fee',?,NULL,?,?)`)
            .bind(uuid(), season.id, a.uid, -fee, JSON.stringify({ misu, days, since: a.misu_since }), now));
        } else {
          push(db.prepare(`UPDATE accounts SET misu_accrued_ymd=? WHERE season_id=? AND uid=?`).bind(S, season.id, a.uid));
        }
        // 반대매매로도 충당되지 않았으면 다시 잡는다 (거래정지로 못 팔았거나 체결가가 낮았던 경우 — 추가 반대매매)
        push(callUpsert(db, season, a.uid, 'misu', S, misu, null, cover < 0 ? next : null, cover < 0 ? 'due' : 'covered', { settled, cover }, now));
      }
    } else if (a.misu_since) {
      // 미수 해소 — 마지막 정산일부터 오늘까지의 연체이자를 매기고 닫는다
      stats.q += 1;
      // 해소일까지의 연체이자는 마지막으로 확인한 미수 원금에 매긴다 (그 뒤 결제로 갚아졌다)
      const last = await db.prepare(`SELECT amount FROM margin_calls WHERE season_id=? AND uid=? AND kind='misu' ORDER BY ymd DESC LIMIT 1`).bind(season.id, a.uid).first();
      const days = K.daysBetween(a.misu_accrued_ymd || a.misu_since, S);
      const fee = last && days > 0 ? overdueFee(last.amount, days, S) : 0;
      if (fee > 0) {
        const cs = K.cashSet(-fee);
        push(db.prepare(`UPDATE accounts SET ${cs.sql}, interest_paid = interest_paid + ? WHERE season_id=? AND uid=?`).bind(...cs.args, fee, season.id, a.uid));
        push(db.prepare(`INSERT INTO cash_events (id, season_id, uid, kind, amount, lot_id, detail, at) VALUES (?,?,?,'overdue_fee',?,NULL,?,?)`)
          .bind(uuid(), season.id, a.uid, -fee, JSON.stringify({ misu: last.amount, days, since: a.misu_since, resolved: S }), now));
      }
      push(db.prepare(`UPDATE accounts SET misu_since=NULL, misu_accrued_ymd=NULL WHERE season_id=? AND uid=?`).bind(season.id, a.uid));
      push(db.prepare(`UPDATE margin_calls SET status='resolved', updated_at=? WHERE season_id=? AND uid=? AND kind='misu' AND status<>'resolved'`).bind(now, season.id, a.uid));
    }
  }

  // ② 담보비율 · ③ 만기 — 원금이 남은 잔고가 있는 계좌
  if (stmts.length < BUDGET - 6) {
    stats.q += 4;
    const [lotRes, posRes, accRes, callRes] = await db.batch([
      db.prepare(`SELECT l.*, (SELECT close FROM closes c WHERE c.code=l.code AND c.date <= ? ORDER BY c.date DESC LIMIT 1) AS close
                  FROM lots l WHERE l.season_id=? AND l.principal > 0`).bind(S, season.id),
      db.prepare(`SELECT p.uid, p.code, p.qty, p.cost, (SELECT close FROM closes c WHERE c.code=p.code AND c.date <= ? ORDER BY c.date DESC LIMIT 1) AS close
                  FROM positions p WHERE p.season_id=? AND p.uid IN (SELECT uid FROM lots WHERE season_id=? AND principal > 0)`).bind(S, season.id, season.id),
      db.prepare(`SELECT uid, cash, cash_short FROM accounts WHERE season_id=? AND uid IN (SELECT uid FROM lots WHERE season_id=? AND principal > 0)`).bind(season.id, season.id),
      db.prepare(`SELECT * FROM margin_calls WHERE season_id=? AND kind IN ('collateral','expiry') AND status IN ('open','due','ordered')`).bind(season.id)
    ]);
    const byUid = {};
    const acct = (uid) => byUid[uid] || (byUid[uid] = { lots: [], pos: [], net: 0, calls: [] });
    for (const l of lotRes.results || []) acct(l.uid).lots.push(l);
    for (const p of posRes.results || []) acct(p.uid).pos.push(p);
    for (const a of accRes.results || []) acct(a.uid).net = a.cash - a.cash_short;
    for (const c of callRes.results || []) if (byUid[c.uid]) byUid[c.uid].calls.push(c);
    for (const uid of Object.keys(byUid)) {
      if (stmts.length >= BUDGET - 3) break;
      const u = byUid[uid];
      const r = collateralOf(u.lots, u.pos, u.net);
      const open = u.calls.filter((c) => c.kind === 'collateral');
      if (r.debt > 0 && r.ratio < K.RULES.maintRatio) {
        const deficit = Math.ceil(r.debt * K.RULES.maintRatio - r.value);
        const earlier = open.find((c) => c.ymd < S && (c.status === 'open' || c.status === 'ordered'));
        if (earlier) {
          // 추가담보 기한(다음 거래일)이 지났는데 여전히 부족 — 다음 거래일 아침 반대매매
          push(db.prepare(`UPDATE margin_calls SET status='due', due_ymd=?, amount=?, ratio=?, updated_at=? WHERE id=?`)
            .bind(next, deficit, r.ratio, now, earlier.id));
        } else if (!open.some((c) => c.ymd < S)) {
          push(callUpsert(db, season, uid, 'collateral', S, deficit, r.ratio, K.addTradingDays(S, 2), 'open', { value: r.value, debt: r.debt }, now));
        }
      } else if (open.length) {
        push(db.prepare(`UPDATE margin_calls SET status='resolved', ratio=?, updated_at=? WHERE season_id=? AND uid=? AND kind='collateral' AND status IN ('open','due','ordered')`)
          .bind(r.ratio == null ? null : r.ratio, now, season.id, uid));
      }
      // 만기 — 만기일이 오늘 이전·오늘인 잔고: 다음 거래일 아침 자동상환·반대매매
      for (const l of u.lots) {
        if (l.due_ymd > S) continue;
        if (u.calls.some((c) => c.kind === 'expiry' && c.status !== 'resolved' && JSON.parse(c.detail || '{}').lotId === l.id)) continue;
        push(callUpsert(db, season, uid, 'expiry', l.due_ymd + ':' + l.code, l.principal, null, next, 'due', { lotId: l.id, code: l.code }, now));
      }
    }
  }
  if (stmts.length) { stats.q += stmts.length; await db.batch(stmts); }
}

/** 담보비율 = (잔고 평가 + 현금 보유 × 대용비율 + 예수금) ÷ 원금 합계. 종가가 없으면 매입가로 본다 */
export function collateralOf(lots, positions, net) {
  let value = net, debt = 0;
  for (const l of lots) {
    const px = l.close != null ? l.close : (l.qty ? l.cost / l.qty : 0);
    value += px * l.qty;
    debt += l.principal;
  }
  for (const p of positions) {
    const px = p.close != null ? p.close : (p.qty ? p.cost / p.qty : 0);
    value += Math.floor(px * p.qty * K.RULES.substituteRate);
  }
  return { value, debt, ratio: debt > 0 ? value / debt : null };
}

function callUpsert(db, season, uid, kind, ymd, amount, ratio, dueYmd, status, detail, now) {
  return db.prepare(
    `INSERT INTO margin_calls (id, season_id, uid, kind, ymd, amount, ratio, due_ymd, status, detail, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (season_id, uid, kind, ymd) DO UPDATE SET amount=excluded.amount, ratio=excluded.ratio,
       due_ymd = CASE WHEN margin_calls.status IN ('ordered','resolved') THEN margin_calls.due_ymd ELSE excluded.due_ymd END,
       status = CASE WHEN margin_calls.status IN ('ordered','resolved') THEN margin_calls.status ELSE excluded.status END,
       detail=excluded.detail, updated_at=excluded.updated_at`
  ).bind(uuid(), season.id, uid, kind, ymd, amount, ratio, dueYmd, status, JSON.stringify(detail || {}), now, now);
}

// ── 아침 처리 ─────────────────────────────────────────────────
/**
 * @param helpers { quotesFor(codes) → {code: quote}, kindOf(code, name) → 'stock'|'etf'|'etn' }
 */
export async function morning(db, season, now, stats = { q: 0 }, helpers) {
  const t = E.kstNow(now);
  if (!E.isTradingDay(t)) return;
  if (t.hm >= E.PRE_FROM && t.hm < E.ACCEPT_FROM) await monthlyInterest(db, season, now, stats);
  if (t.hm >= E.ACCEPT_FROM && t.hm < E.OPEN_AT) await forcedOrders(db, season, now, stats, helpers);
}

/** 매월 첫 영업일 — 전월 말일까지의 이자를 징수한다 (소급법: 그때까지의 총이자 − 이미 낸 이자). 예수금이 모자라면 낼 수 있는 만큼만 */
async function monthlyInterest(db, season, now, stats) {
  const t = E.kstNow(now);
  const prev = K.prevTradingDay(t.ymd);
  if (prev.slice(0, 6) === t.ymd.slice(0, 6)) return;                 // 이달 첫 영업일이 아니다
  const end = K.prevMonthEnd(t.ymd);
  stats.q += 1;
  const lots = (await db.prepare(
    `SELECT l.*, a.cash - a.cash_short AS net FROM lots l JOIN accounts a ON a.season_id=l.season_id AND a.uid=l.uid
     WHERE l.season_id=? AND l.principal > 0 AND l.start_ymd < ? AND (l.paid_through IS NULL OR l.paid_through < ?) LIMIT 10`
  ).bind(season.id, end, end).all()).results || [];
  if (!lots.length) return;
  const cash = {};
  const stmts = [];
  for (const l of lots) {
    const due = Math.max(0, K.interestTotal(l, l.principal, end) - (l.interest_paid || 0));
    if (cash[l.uid] == null) cash[l.uid] = Math.max(0, l.net);
    const take = Math.min(due, cash[l.uid]);
    cash[l.uid] -= take;
    stmts.push(db.prepare(`UPDATE lots SET interest_paid = interest_paid + ?, paid_through=? WHERE id=? AND (paid_through IS NULL OR paid_through < ?)`)
      .bind(take, end, l.id, end));
    if (take > 0) {
      stmts.push(
        db.prepare(`UPDATE accounts SET ${K.SQL_DEBIT}, interest_paid = interest_paid + ? WHERE season_id=? AND uid=?`).bind(take, take, take, season.id, l.uid),
        db.prepare(`INSERT INTO cash_events (id, season_id, uid, kind, amount, lot_id, detail, at) VALUES (?,?,?,'interest',?,?,?,?)`)
          .bind(uuid(), season.id, l.uid, -take, l.id, JSON.stringify({ code: l.code, name: l.name, kind: l.kind, through: end, due, unpaid: due - take }), now)
      );
    }
  }
  stats.q += stmts.length;
  await db.batch(stmts);
}

/** 반대매매 주문 — '반대매매 예정' 건을 시장가 장전 주문으로 넣는다 (09:00 시가 단일가 체결) */
async function forcedOrders(db, season, now, stats, helpers) {
  const t = E.kstNow(now);
  stats.q += 1;
  const calls = (await db.prepare(
    `SELECT * FROM margin_calls WHERE season_id=? AND status='due' AND due_ymd <= ? ORDER BY created_at LIMIT 5`
  ).bind(season.id, t.ymd).all()).results || [];
  for (const c of calls) {
    if (stats.q > 30) return;                                           // 나머지는 다음 분에
    try {
      if (c.kind === 'misu') await forcedMisu(db, season, c, now, stats, helpers);
      else if (c.kind === 'collateral') await forcedCollateral(db, season, c, now, stats, helpers);
      else if (c.kind === 'expiry') await forcedExpiry(db, season, c, now, stats, helpers);
    } catch (e) { console.error('forced order failed', c.id, e && e.message); }
  }
}

function forcedInsert(db, season, c, uid, code, name, qty, taxFree, lotId, now) {
  const t = E.kstNow(now);
  return db.prepare(
    `INSERT OR IGNORE INTO orders (id, client_order_id, season_id, uid, code, name, side, type, qty, limit_price,
       reserved, vol_at_accept, pre_open, marketable, tax_free, trade_date, accepted_at, updated_at, session, nxt_vol_at_accept,
       credit, lot_id, margin_rate, forced, reason)
     VALUES (?,?,?,?,?,?,'sell','market',?,NULL,0,0,1,0,?,?,?,?,'regular',0,NULL,?,NULL,?,?)`
  ).bind(uuid(), `forced:${c.id}:${code}:${lotId || ''}`.slice(0, 64), season.id, uid, code, name, qty, taxFree ? 1 : 0, t.ymd, now, now,
    lotId, c.kind, c.kind === 'misu' ? '미수 반대매매' : c.kind === 'collateral' ? '담보부족 반대매매' : '만기 미상환 반대매매');
}

async function forcedMisu(db, season, c, now, stats, helpers) {
  const t = E.kstNow(now);
  stats.q += 5;
  const [accRes, pendRes, posRes, recentRes, sellRes] = await db.batch([
    db.prepare(`SELECT cash, cash_short FROM accounts WHERE season_id=? AND uid=?`).bind(season.id, c.uid),
    // 결제 전 매수 중 미수 발생일 뒤에 결제되는 것 (아직 갚을 날이 오지 않은 몫)
    db.prepare(`SELECT COALESCE(SUM(cash_delta),0) AS d FROM fills WHERE season_id=? AND uid=? AND side='buy' AND settle_ymd > ? AND cash_delta IS NOT NULL`).bind(season.id, c.uid, c.ymd),
    db.prepare(`SELECT code, name, qty FROM positions WHERE season_id=? AND uid=?`).bind(season.id, c.uid),
    // 종목 선정: ① 미수가 난 결제일의 매수 종목 ② 최근 매수 순 (키움)
    db.prepare(`SELECT code, MAX(at) AS last, MAX(CASE WHEN settle_ymd=? THEN 1 ELSE 0 END) AS cause FROM fills WHERE season_id=? AND uid=? AND side='buy' AND lot_id IS NULL GROUP BY code`).bind(c.ymd, season.id, c.uid),
    db.prepare(`SELECT code, COALESCE(SUM(qty - filled_qty),0) AS q FROM orders WHERE season_id=? AND uid=? AND side='sell' AND lot_id IS NULL AND status IN ('open','partial') GROUP BY code`).bind(season.id, c.uid)
  ]);
  const a = accRes.results[0];
  const cover = (a.cash - a.cash_short) - pendRes.results[0].d;          // 결제 전 매도대금·입금까지 합친 충당액
  if (cover >= 0) {
    stats.q += 1;
    await db.prepare(`UPDATE margin_calls SET status='covered', updated_at=? WHERE id=?`).bind(now, c.id).run();
    return;
  }
  let need = -cover + overdueFee(-cover, 2, t.ymd);                     // 결제(D+2)까지 붙을 연체이자 여유
  const recent = {};
  for (const r of recentRes.results || []) recent[r.code] = r;
  const pendSell = {};
  for (const r of sellRes.results || []) pendSell[r.code] = r.q;
  const pos = (posRes.results || []).map((p) => ({ ...p, free: p.qty - (pendSell[p.code] || 0) })).filter((p) => p.free > 0);
  const quotes = pos.length ? await helpers.quotesFor(pos.map((p) => p.code)) : {};
  const mk = (code) => { const m = quotes[code] && quotes[code].market; return m === '코스피' ? 0 : m === '코스닥' ? 1 : 2; };
  pos.sort((x, y) => ((recent[y.code] || {}).cause || 0) - ((recent[x.code] || {}).cause || 0)
    || mk(x.code) - mk(y.code) || ((recent[y.code] || {}).last || 0) - ((recent[x.code] || {}).last || 0) || x.code.localeCompare(y.code));
  const stmts = [];
  for (const p of pos) {
    if (need <= 0) break;
    const q = quotes[p.code];
    const base = q && q.krx && q.krx.prevClose;
    if (!base) continue;
    const taxFree = (await helpers.kindOf(p.code, p.name)) !== 'stock';
    // 하한가 기준 수량 — 실제 체결가는 대개 더 높아 미수보다 조금 더 팔린다 (키움과 같다)
    const lower = K.lowerLimit(base, taxFree);
    const per = lower * (1 - K.RULES.forcedCostRate);
    const qty = Math.min(p.free, Math.ceil(need / per));
    stmts.push(forcedInsert(db, season, c, c.uid, p.code, p.name, qty, taxFree, null, now));
    need -= qty * per;
  }
  stmts.push(db.prepare(`UPDATE margin_calls SET status='ordered', updated_at=?, detail=? WHERE id=?`)
    .bind(now, JSON.stringify({ cover, orders: stmts.length }), c.id));
  stats.q += stmts.length;
  await db.batch(stmts);
}

async function forcedCollateral(db, season, c, now, stats, helpers) {
  stats.q += 4;
  const [lotRes, posRes, accRes, sellRes] = await db.batch([
    db.prepare(`SELECT * FROM lots WHERE season_id=? AND uid=? AND principal > 0 ORDER BY start_ymd DESC, code`).bind(season.id, c.uid),
    db.prepare(`SELECT code, qty, cost FROM positions WHERE season_id=? AND uid=?`).bind(season.id, c.uid),
    db.prepare(`SELECT cash, cash_short FROM accounts WHERE season_id=? AND uid=?`).bind(season.id, c.uid),
    db.prepare(`SELECT lot_id, COALESCE(SUM(qty - filled_qty),0) AS q FROM orders WHERE season_id=? AND uid=? AND side='sell' AND lot_id IS NOT NULL AND status IN ('open','partial') GROUP BY lot_id`).bind(season.id, c.uid)
  ]);
  const lots = lotRes.results || [], positions = posRes.results || [];
  const codes = Array.from(new Set(lots.map((l) => l.code).concat(positions.map((p) => p.code))));
  const quotes = codes.length ? await helpers.quotesFor(codes) : {};
  const prev = (code) => { const q = quotes[code]; return q && q.krx && q.krx.prevClose; };
  const net = accRes.results[0].cash - accRes.results[0].cash_short;
  // 전일종가(기준가)로 다시 평가 — 밤 정산 뒤 매도·상환·입금이 있었으면 그만큼 줄어든다
  const withClose = (arr) => arr.map((x) => ({ ...x, close: prev(x.code) }));
  let { value, debt } = collateralOf(withClose(lots), withClose(positions), net);
  const pend = {};
  for (const r of sellRes.results || []) pend[r.lot_id] = r.q;
  const stmts = [];
  for (const l of lots) {
    if (debt <= 0 || value >= debt * K.RULES.maintRatio) break;
    const p0 = prev(l.code);
    const free = l.qty - (pend[l.id] || 0);
    if (!p0 || free <= 0) continue;
    const taxFree = (await helpers.kindOf(l.code, l.name)) !== 'stock';
    const x = Math.min(free, K.collateralSellQty(value, debt, p0, taxFree));
    if (!x || !isFinite(x)) continue;
    stmts.push(forcedInsert(db, season, c, c.uid, l.code, l.name, x, taxFree, l.id, now));
    // 판 만큼 담보 평가는 전일종가로 줄고, 원금은 반대매매 기준가(−15%)로 갚는다고 본다 (키움 산식의 전제)
    value -= x * p0;
    debt -= x * K.tickCeil(p0 * K.RULES.forcedBaseRate, taxFree);
  }
  stmts.push(db.prepare(`UPDATE margin_calls SET status='ordered', updated_at=? WHERE id=?`).bind(now, c.id));
  stats.q += stmts.length;
  await db.batch(stmts);
}

async function forcedExpiry(db, season, c, now, stats, helpers) {
  const t = E.kstNow(now);
  const d = JSON.parse(c.detail || '{}');
  stats.q += 2;
  const lot = await db.prepare(`SELECT * FROM lots WHERE id=?`).bind(d.lotId).first();
  if (!lot || lot.principal <= 0) {
    await db.prepare(`UPDATE margin_calls SET status='resolved', updated_at=? WHERE id=?`).bind(now, c.id).run();
    return;
  }
  // 먼저 현금으로 자동상환 (주문가능현금이 원금 + 이자 이상일 때)
  const acc = await E.getAccount(db, season.id, lot.uid);
  const avail = await E.orderableCash(db, season, acc, null, now);
  const part = lot.qty > 0 ? K.repayPortion(lot, lot.qty, t.ymd)
    : { principal: lot.principal, interest: K.interestAccrued(lot, t.ymd), paidPart: lot.interest_paid, cost: 0 };
  const total = part.principal + part.interest;
  stats.q += 1;
  if (avail >= total) {
    const cs = K.cashSet(-total);
    const stmts = [
      db.prepare(`UPDATE lots SET qty=0, cost=0, principal=0, interest_paid=0, closed_at=? WHERE id=? AND qty=? AND principal=?`).bind(now, lot.id, lot.qty, lot.principal),
      db.prepare(`UPDATE accounts SET cash = -1 WHERE season_id=? AND uid=? AND NOT EXISTS (SELECT 1 FROM lots WHERE id=? AND principal=0)`).bind(season.id, lot.uid, lot.id),
      db.prepare(`UPDATE accounts SET ${cs.sql}, interest_paid = interest_paid + ? WHERE season_id=? AND uid=?`).bind(...cs.args, part.interest, season.id, lot.uid),
      db.prepare(`INSERT INTO cash_events (id, season_id, uid, kind, amount, lot_id, detail, at) VALUES (?,?,?,'repay',?,?,?,?)`)
        .bind(uuid(), season.id, lot.uid, -total, lot.id, JSON.stringify({ code: lot.code, name: lot.name, kind: lot.kind, qty: lot.qty, principal: part.principal, interest: part.interest, expiry: true }), now),
      db.prepare(`UPDATE margin_calls SET status='resolved', updated_at=? WHERE id=?`).bind(now, c.id)
    ];
    if (lot.qty > 0) stmts.push(
      db.prepare(`INSERT INTO positions (season_id, uid, code, name, qty, cost) VALUES (?,?,?,?,?,?)
                  ON CONFLICT (season_id, uid, code) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost`)
        .bind(season.id, lot.uid, lot.code, lot.name, lot.qty, lot.cost),
      db.prepare(`INSERT INTO lot_moves (id, season_id, uid, lot_id, code, dir, qty, cost, at) VALUES (?,?,?,?,?,'out',?,?,?)`)
        .bind(uuid(), season.id, lot.uid, lot.id, lot.code, lot.qty, lot.cost, now)
    );
    stats.q += stmts.length;
    await db.batch(stmts);
    return;
  }
  // 부족하면 잔고 전량 반대매매 — 매도대금으로 갚고 모자라면 미수
  const pend = await db.prepare(`SELECT COALESCE(SUM(qty - filled_qty),0) AS q FROM orders WHERE lot_id=? AND side='sell' AND status IN ('open','partial')`).bind(lot.id).first();
  const free = lot.qty - (pend ? pend.q : 0);
  const stmts = [];
  if (free > 0) {
    const taxFree = (await helpers.kindOf(lot.code, lot.name)) !== 'stock';
    stmts.push(forcedInsert(db, season, c, lot.uid, lot.code, lot.name, free, taxFree, lot.id, now));
  }
  stmts.push(db.prepare(`UPDATE margin_calls SET status='ordered', updated_at=? WHERE id=?`).bind(now, c.id));
  stats.q += stmts.length + 1;
  await db.batch(stmts);
}
