// DT 모의투자 — 권리 변동 자동 반영 (액면분할·병합, 무상증자, 유상증자 권리락, 상장폐지)
//
// 감지: 권리락·분할 당일 거래소는 기준가를 조정한다. 네이버 시세의 전일종가(= 현재가 − 전일대비)가 그 기준가다.
//       이 값을 우리가 저장한 "전 거래일 15:30 종가"(closes)와 비교해 다르면 사건이 있었던 것이다.
//       (네이버 일봉 종가는 20:00 애프터마켓 가격을 따라가고 과거 봉도 소급 수정되므로 비교 대상으로 못 쓴다)
//       2026 실제 사례 9건(알테오젠 무상 1.3, 동일기연 분할 5, 병합 0.2 ×5, 한화솔루션 유상)에서 확인.
// 분류: 비율이 정수(분할)·1/정수(병합)로 딱 떨어지면 바로 반영. 아니면 종목 공시 제목으로 무상·유상을 가른다.
//       못 가리면 반영하지 않고 관리 화면에 '확인 필요'로 올린다.
// 반영: 어느 방식이든 반영 순간 총자산은 변하지 않는다 (수량 ×r × 기준가 = 수량 × 전날 종가, 현금 보전도 같은 값).
//       계좌마다 ca_applications 에 남겨 두 번 반영되지 않게 하고, AI 평가의 실현손익 재생이 이걸 읽는다.
// 현금배당은 기준가가 바뀌지 않아 가격으로 알 수 없고, 분기 시즌 안에 기준일과 지급일이 함께 드는 경우가 드물어 반영하지 않는다.
import * as E from './engine.js';
import { naver } from '../providers/naver.js';

const MISSING_DAYS_TO_DELIST = 3;   // 시세에서 사라진 거래일이 이만큼 쌓이면 상장폐지로 처리한다
const ACCOUNTS_PER_RUN = 6;         // 계좌 1곳 = D1 4문장 — 호출당 한도(50) 보호

const TITLE = {
  split: /(주식|액면)\s*분할/,
  merge: /(주식|액면)\s*병합|감자/,
  bonus: /무상\s*증자/,
  rights: /유상\s*증자|유무상/        // '유무상증자결정' 은 '유상증자' 글자가 이어져 있지 않다
};

export const KIND_LABEL = { split: '액면분할', merge: '액면병합', bonus: '무상증자', rights: '유상증자 권리락', delist: '상장폐지' };

function todayStartMs(t) {
  return Date.UTC(+t.ymd.slice(0, 4), +t.ymd.slice(4, 6) - 1, +t.ymd.slice(6, 8)) - 9 * 3600e3;
}

/**
 * 전날 종가와 기준가로 사건 종류·비율을 정한다.
 * @param titles 최근 공시 제목들 (null 이면 아직 안 받음 — 공시가 필요하면 { needTitles: true })
 */
export function classify(prev, base, taxFree, titles) {
  const r = prev / base;
  if (Math.abs(r - 1) < 0.005) return { none: true };                // 호가단위 반올림 수준 — 사건 아님
  const tick = E.tickSize(base, taxFree);
  const near = (rr) => Math.abs(prev / rr - base) <= tick;
  const has = (k) => !!titles && titles.some((x) => TITLE[k].test(x));
  // 정수 배 — 분할(무상 100% 포함). 수량 ×n 이라 둘 다 같은 반영이다
  if (r > 1.5) for (let n = 2; n <= 100; n++) if (near(n)) return { kind: has('bonus') && !has('split') ? 'bonus' : 'split', ratio: n };
  // 1/정수 — 병합·감자
  if (r < 0.9) for (let n = 2; n <= 100; n++) if (near(1 / n)) return { kind: 'merge', ratio: 1 / n };
  if (titles == null) return { needTitles: true };
  if (Math.abs(r - 1) < 0.01) return { kind: null, ratio: r, review: '변동 폭이 1% 미만' };
  const bonus = has('bonus'), rights = has('rights');
  if (bonus && !rights) {
    const n = Math.round((r - 1) * 100) / 100;                      // 주당 배정 주식 수 (0.3 → ×1.3)
    if (n > 0 && near(1 + n)) return { kind: 'bonus', ratio: 1 + n };
    return { kind: 'bonus', ratio: r, review: '무상증자 비율이 딱 떨어지지 않음' };
  }
  if (rights && !bonus && r > 1) return { kind: 'rights', ratio: r };
  if (rights && bonus) return { kind: null, ratio: r, review: '유무상증자 — 비율 확인 필요' };
  return { kind: null, ratio: r, review: '공시에서 사건 종류를 찾지 못함' };
}

/** 전 거래일 (YYYYMMDD) — 주말·휴장일을 건너뛴다 */
function prevTradingYmd(t) {
  let d = Date.UTC(+t.ymd.slice(0, 4), +t.ymd.slice(4, 6) - 1, +t.ymd.slice(6, 8));
  for (let i = 0; i < 20; i++) {
    d -= 86400e3;
    const k = E.kstNow(d - 9 * 3600e3);
    if (E.isTradingDay(k)) return k.ymd;
  }
  return null;
}

/** 전 거래일 15:30 종가 — 그날 저장된 값이 있을 때만 (몇 주 전 값과 비교하면 사건이 없는데 있다고 오판한다) */
async function prevCloses(db, codes, t) {
  const py = prevTradingYmd(t);
  if (!py || !codes.length) return {};
  const rows = (await db.prepare(`SELECT code, close FROM closes WHERE date=? AND code IN (${codes.map(() => '?').join(',')})`)
    .bind(py, ...codes).all()).results || [];
  const out = {};
  for (const r of rows) out[r.code] = r.close;
  return out;
}

/**
 * 크론 — 보유 종목의 권리 변동을 감지하고 반영한다.
 * @returns 이번에 D1 에 쓴 계좌 수 (0 이 아니면 크론은 이번 분의 체결 판정을 건너뛴다 — 쿼리 한도)
 */
export async function runCorpActions(db, season, now, quotesFor, stats) {
  const t = E.kstNow(now);
  if (!E.isTradingDay(t)) return 0;

  // 1) 반영 중인 사건 이어서
  stats.q += 1;
  const pending = (await db.prepare(`SELECT * FROM corp_actions WHERE status='applying' ORDER BY created_at LIMIT 3`).all()).results || [];
  let applied = 0;
  for (const a of pending) applied += await applyAction(db, season, a, now, stats);
  if (applied) return applied;

  // 2) 오늘 아직 점검하지 않은 보유 종목
  stats.q += 1;
  const held = (await db.prepare(
    `SELECT code, MAX(name) AS name FROM positions WHERE season_id=? AND code NOT IN (SELECT code FROM ca_checks WHERE ymd=?)
     GROUP BY code LIMIT 150`
  ).bind(season.id, t.ymd).all()).results || [];
  if (!held.length) return 0;
  const codes = held.map((h) => h.code);
  let quotes;
  try { quotes = await quotesFor(codes); } catch (e) { return 0; }     // 시세 장애 — 다음 분에
  stats.q += 1;
  const prev = await prevCloses(db, codes, t);
  // 09:00 전(프리마켓)에는 기준가가 아직 어제 값일 수 있어 '이상 없음'으로 확정하지 않는다 — 사건만 잡는다
  const settle = t.hm >= E.OPEN_AT;
  const checks = [];
  const events = [];
  for (const h of held) {
    const q = quotes[h.code];
    if (!q) { if (settle) checks.push({ code: h.code, result: 'missing' }); continue; }
    const base = q.krx && q.krx.prevClose;
    const p = prev[h.code];
    if (q.halted || base == null || p == null) { if (settle) checks.push({ code: h.code, result: 'ok' }); continue; }
    const c = classify(p, base, false, null);
    if (c.none || (!c.kind && !c.needTitles && !c.review)) { if (settle) checks.push({ code: h.code, result: 'ok' }); continue; }
    if (Math.abs(p - base) < E.tickSize(base, false)) { if (settle) checks.push({ code: h.code, result: 'ok' }); continue; }
    events.push({ code: h.code, name: q.name || h.name, prev: p, base, c });
  }

  // 3) 사건 — 필요하면 공시 제목으로 분류해 기록한다 (한 번에 3종목까지, 공시 호출 1건씩)
  for (const ev of events.slice(0, 3)) {
    let c = ev.c, src = 'price';
    if (c.needTitles) {
      let titles;
      try { titles = (await naver.getDisclosures(ev.code, 30)).map((d) => d.title); }
      catch (e) { continue; }                                          // 공시 장애 — 다음 분에 다시
      c = classify(ev.prev, ev.base, false, titles);
      const hitTitle = titles.find((x) => Object.values(TITLE).some((re) => re.test(x)));
      src = 'price+disclosure' + (hitTitle ? ':' + hitTitle.slice(0, 40) : '');
    }
    stats.q += 1;
    await db.prepare(
      `INSERT OR IGNORE INTO corp_actions (id, code, name, kind, ex_date, ratio, prev_close, base_price, source, note, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(crypto.randomUUID(), ev.code, ev.name, c.kind || null, t.ymd, c.ratio, ev.prev, ev.base, src,
      c.review || null, c.review ? 'needs_review' : 'applying', now).run();
    checks.push({ code: ev.code, result: 'event' });
    console.log('corp action detected', ev.code, c.kind, c.ratio, c.review || '');
  }

  // 4) 상장폐지 — 시세에서 사라진 날이 쌓인 종목
  const missing = checks.filter((x) => x.result === 'missing').map((x) => x.code);
  if (checks.length) {
    stats.q += 1;
    await db.prepare(`INSERT OR IGNORE INTO ca_checks (code, ymd, result)
                      SELECT json_extract(value,'$.code'), ?, json_extract(value,'$.result') FROM json_each(?)`)
      .bind(t.ymd, JSON.stringify(checks)).run();
  }
  if (missing.length) {
    stats.q += 1;
    const gone = (await db.prepare(
      // 최근 2주 안에서만 센다 — 몇 달에 걸쳐 드문드문 빠진 날이 쌓여 멀쩡한 종목이 폐지 처리되지 않게
      `SELECT code, COUNT(*) AS n FROM ca_checks WHERE result='missing' AND ymd >= ? AND code IN (${missing.map(() => '?').join(',')}) GROUP BY code`
    ).bind(E.kstNow(now - 14 * 86400e3).ymd, ...missing).all()).results || [];
    for (const g of gone.filter((x) => x.n >= MISSING_DAYS_TO_DELIST)) {
      stats.q += 1;
      await db.prepare(
        `INSERT OR IGNORE INTO corp_actions (id, code, name, kind, ex_date, ratio, prev_close, base_price, source, note, status, created_at)
         VALUES (?,?,(SELECT MAX(name) FROM positions WHERE code=?),'delist',?,0,NULL,NULL,'price',?, 'applying', ?)`
      ).bind(crypto.randomUUID(), g.code, g.code, t.ymd, `시세 없음 ${g.n}거래일`, now).run();
      console.log('delist detected', g.code, g.n);
    }
  }
  return 0;
}

/**
 * 한 사건을 시즌 계좌들에 반영한다 (한 번에 ACCOUNTS_PER_RUN 곳, 남으면 다음 분에).
 * 오늘 산 주식은 이미 조정된 가격으로 산 것이라 비율을 곱하지 않는다.
 * @returns 반영한 계좌 수
 */
export async function applyAction(db, season, a, now, stats) {
  const t = E.kstNow(now);
  const start = todayStartMs(t);
  stats.q += 1;
  const rows = (await db.prepare(
    `SELECT p.uid, p.qty, p.cost,
            (SELECT COALESCE(SUM(f.qty),0) FROM fills f WHERE f.season_id=p.season_id AND f.uid=p.uid AND f.code=p.code
               AND f.side='buy' AND f.at >= ?) AS bought_today
     FROM positions p
     WHERE p.season_id=? AND p.code=?
       AND p.uid NOT IN (SELECT uid FROM ca_applications WHERE action_id=? AND season_id=?)
     LIMIT ?`
  ).bind(start, season.id, a.code, a.id, season.id, ACCOUNTS_PER_RUN).all()).results || [];

  let n = 0;
  for (const p of rows) {
    const plan = planFor(a, p);
    const key = [season.id, p.uid, a.code];
    const stmts = [
      // 가드 — 읽은 뒤 그 사이 체결로 보유가 바뀌었으면 통째로 되돌리고 다음 분에 다시 읽는다
      db.prepare(`UPDATE accounts SET cash = -1 WHERE season_id=? AND uid=?
                  AND NOT EXISTS (SELECT 1 FROM positions WHERE season_id=? AND uid=? AND code=? AND qty=? AND cost=?)`)
        .bind(season.id, p.uid, ...key, p.qty, p.cost),
      plan.qty > 0
        ? db.prepare(`UPDATE positions SET qty=?, cost=? WHERE season_id=? AND uid=? AND code=?`).bind(plan.qty, plan.cost, ...key)
        : db.prepare(`DELETE FROM positions WHERE season_id=? AND uid=? AND code=?`).bind(...key),
      db.prepare(`UPDATE accounts SET cash = cash + ?, realized_pnl = realized_pnl + ? WHERE season_id=? AND uid=?`)
        .bind(plan.cash, plan.realized, season.id, p.uid),
      db.prepare(`INSERT INTO ca_applications (action_id, season_id, uid, code, qty_before, qty_after, cost_before, cost_after, cash_delta, realized_delta, at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(a.id, season.id, p.uid, a.code, p.qty, plan.qty, p.cost, plan.cost, plan.cash, plan.realized, now)
    ];
    stats.q += stmts.length;
    try { await db.batch(stmts); n++; }
    catch (e) { console.warn('corp apply skipped', a.code, p.uid, e && e.message); }
  }

  if (rows.length < ACCOUNTS_PER_RUN) {
    // 다 반영했다
    stats.q += 1;
    await db.prepare(`UPDATE corp_actions SET status='applied', applied_at=? WHERE id=? AND status='applying'`).bind(now, a.id).run();
  }
  return n;
}

/** 계좌 하나의 반영 내용 */
export function planFor(a, p) {
  const bought = Math.min(p.qty, Math.max(0, p.bought_today || 0));
  const baseQty = p.qty - bought;                       // 어제 장 마감 때부터 들고 있던 수량
  if (a.kind === 'delist') {
    // 거래할 수 없는 주식 — 평가 0 으로 정리하고 매입금액만큼 손실을 확정한다
    return { qty: 0, cost: 0, cash: 0, realized: -p.cost };
  }
  if (a.kind === 'rights') {
    // 신주인수권을 이론가에 넘긴 것으로 본다 — 보유 수량 × (전날 종가 − 기준가)를 현금으로.
    // 받은 돈은 매입금액에서 먼저 덜어낸다(원금 회수). 매입금액보다 크면 넘는 만큼은 실현이익.
    const cash = Math.max(0, baseQty * (a.prev_close - a.base_price));
    const cost = Math.max(0, p.cost - cash);
    return { qty: p.qty, cost, cash, realized: cash - (p.cost - cost) };
  }
  // 분할·병합·무상 — 수량 ×r, 단주(1주 미만)는 기준가로 현금
  const exact = baseQty * a.ratio;
  const whole = Math.floor(exact + 1e-9);
  const frac = Math.max(0, exact - whole);
  const cash = Math.floor(frac * a.base_price + 1e-9);
  const newUnits = exact + bought;                      // 단주 포함 전체 (새 주식 단위)
  const fracCost = frac > 0 && newUnits > 0 ? Math.round(p.cost * frac / newUnits) : 0;
  const qty = whole + bought;
  const cost = qty > 0 ? p.cost - fracCost : 0;
  return { qty, cost, cash, realized: cash - (p.cost - cost) };
}

/**
 * 매도 주문 전 확인 — 오늘 권리 변동이 감지됐는데 이 계좌에 아직 반영되지 않았으면 막는다
 * (분할 전 수량을 분할 뒤 가격에 파는 사고를 막는다). 크론이 아직 못 봤어도 시세로 바로 확인한다.
 */
export async function sellBlocked(db, season, uid, quote, now) {
  const t = E.kstNow(now);
  const a = await db.prepare(`SELECT id, status FROM corp_actions WHERE code=? AND ex_date=? AND status IN ('applying','needs_review')`)
    .bind(quote.code, t.ymd).first();
  if (a) {
    const done = await db.prepare(`SELECT 1 AS x FROM ca_applications WHERE action_id=? AND season_id=? AND uid=?`).bind(a.id, season.id, uid).first();
    return !done;
  }
  const checked = await db.prepare(`SELECT result FROM ca_checks WHERE code=? AND ymd=?`).bind(quote.code, t.ymd).first();
  if (checked) return false;
  const base = quote.krx && quote.krx.prevClose;
  if (base == null || quote.halted) return false;
  const p = (await prevCloses(db, [quote.code], t))[quote.code];
  if (p == null) return false;
  return Math.abs(p - base) >= E.tickSize(base, false) && Math.abs(p / base - 1) >= 0.005;
}

// ── 관리자 ───────────────────────────────────────────────
export async function listActions(db, season) {
  return ((await db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM positions p WHERE p.season_id=? AND p.code=c.code) AS holders
     FROM corp_actions c ORDER BY c.created_at DESC LIMIT 50`
  ).bind(season ? season.id : '').all()).results || []).map((c) => ({
    id: c.id, code: c.code, name: c.name, kind: c.kind, exDate: c.ex_date, ratio: c.ratio,
    prevClose: c.prev_close, basePrice: c.base_price, status: c.status === 'applying' ? 'applied' : c.status,
    applying: c.status === 'applying', source: c.source, note: c.note, createdAt: c.created_at, appliedAt: c.applied_at, holders: c.holders
  }));
}

/** '확인 필요' 건을 관리자가 고른 방식으로 반영 대기에 올린다 (실제 반영은 다음 크론) */
export async function resolveAction(db, id, kind, now) {
  const a = await db.prepare(`SELECT * FROM corp_actions WHERE id=?`).bind(id).first();
  if (!a) return { error: '없는 항목입니다' };
  if (a.status !== 'needs_review') return { error: '이미 처리된 항목입니다' };
  let k = kind, ratio = a.ratio;
  if (kind === 'split') {
    if (!a.prev_close || !a.base_price) return { error: '가격 정보가 없습니다' };
    const r = a.prev_close / a.base_price;
    k = r < 1 ? 'merge' : (r - 1 < 0.95 ? 'bonus' : 'split');
    ratio = Math.round(r * 100) / 100;
  } else if (kind !== 'rights' && kind !== 'delist') return { error: '반영 방식이 올바르지 않습니다' };
  await db.prepare(`UPDATE corp_actions SET kind=?, ratio=?, status='applying', note=COALESCE(note,'') || ' · 관리자 확인' WHERE id=? AND status='needs_review'`)
    .bind(k, ratio, id).run();
  return { ok: true };
}

export async function dismissAction(db, id) {
  const r = await db.prepare(`UPDATE corp_actions SET status='dismissed' WHERE id=? AND status='needs_review'`).bind(id).run();
  return r.meta.changes ? { ok: true } : { error: '이미 처리된 항목입니다' };
}

/** 계좌 화면용 — 이 회원에게 반영된 최근 권리 변동 */
export async function accountActions(db, season, uid, now) {
  const rows = (await db.prepare(
    `SELECT a.*, c.kind, c.ratio, c.ex_date, c.name FROM ca_applications a JOIN corp_actions c ON c.id = a.action_id
     WHERE a.season_id=? AND a.uid=? AND a.at > ? ORDER BY a.at DESC LIMIT 10`
  ).bind(season.id, uid, now - 30 * 86400e3).all()).results || [];
  return rows.map((r) => ({
    code: r.code, name: r.name, kind: r.kind, ratio: r.ratio, qtyBefore: r.qty_before, qtyAfter: r.qty_after,
    cashDelta: r.cash_delta, exDate: r.ex_date, at: r.at
  }));
}
