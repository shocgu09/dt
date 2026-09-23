// DT 모의투자 — API 라우트 + 크론
// dt-stock 워커가 인증(서명 검증)을 끝낸 뒤 /api/mock/* 를 이리로 넘긴다.
// 장부(D1: env.MOCK_DB)는 여기서만 읽고 쓴다.

import { naver } from '../providers/naver.js';
import { buildMetrics } from './review.js';
import * as H from './holidays.js';
import { profileOf } from '../lib/profile.js';
import * as E from './engine.js';
import * as C from './corp.js';

const isCode = (c) => /^[0-9A-Z]{6}$/.test(c || '');

/** 순위표용 안정 키 — uid 를 내보내지 않으면서 같은 회원을 갱신 간에 이어 붙일 수 있게 (되돌릴 수 없는 짧은 해시) */
function rowKey(uid) {
  let h = 5381;
  for (let i = 0; i < uid.length; i++) h = ((h * 33) ^ uid.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ── 작은 메모리 캐시 (워커 인스턴스 단위) ─────────────────────
const mem = new Map();
async function memo(key, ttlMs, produce) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  const v = await produce();
  mem.set(key, { at: Date.now(), v });
  if (mem.size > 300) mem.delete(mem.keys().next().value);
  return v;
}

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// ── 회원 정보는 lib/profile.js (시세 경로와 같은 캐시를 쓴다) ──

// ── 시세 ──────────────────────────────────────────────────────
async function quotesFor(codes) {
  const list = Array.from(new Set(codes)).filter(isCode).sort();
  const out = {};
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const items = await memo(`qs:${chunk.join(',')}`, 3000, () => naver.getQuotes(chunk));
    for (const q of items) out[q.code] = q;
  }
  return out;
}

/**
 * 종목 종류 (stock | etf | etn) — 호가단위·거래세·시간외 가능 여부가 갈린다.
 * 네이버 basic API 가 Cloudflare 에서 자주 시간 초과되는데(2026-09-22 실측), 그때 'stock' 으로 두면
 * ETF 지정가가 "호가단위 불일치"로 거절되고 ETF 매도에 거래세가 붙는다. 실패하면 사이트의 종목 마스터
 * (invest/stock-master.json, 시장 구분에 ETF·ETN 이 있다)로 판정하고, 그마저 없으면 이름으로 추정한다.
 */
const MASTER_URL = 'https://dt-1js.pages.dev/invest/stock-master.json';
async function masterKinds() {
  return memo('master:kinds', 12 * 3600e3, async () => {
    const r = await fetch(MASTER_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('master ' + r.status);
    const d = await r.json();
    const m = {};
    for (const x of d.items || []) if (x[2] === 'ETF' || x[2] === 'ETN') m[x[0]] = x[2].toLowerCase();
    return m;
  });
}
const ETF_BRANDS = /^(KODEX|TIGER|ACE|RISE|SOL|KBSTAR|HANARO|ARIRANG|KOSEF|TIMEFOLIO|PLUS|WON|1Q|BNK|ITF|UNICORN|VITA|HK|KIWOOM|KoAct|마이티|에셋플러스|파워|FOCUS|TREX|WOORI|DAISHIN343)\s/i;
async function kindOf(code, name) {
  return memo(`kind:${code}`, 86400e3, async () => {
    try { return await naver.getKind(code); }
    catch (e) {
      try { const m = await masterKinds(); if (m[code]) return m[code]; } catch (e2) { /* 마스터도 실패 */ }
      const n = String(name || '');
      if (/\sETN$/i.test(n)) return 'etn';
      if (ETF_BRANDS.test(n)) return 'etf';
      // 알 수 없으면 캐시하지 않는다 — 다음 주문 때 다시 확인한다
      throw new Error('kind unknown');
    }
  }).catch(() => 'stock');
}

/**
 * 오늘 1분봉. fromHm(KST 분) 이후만 받는다 — 판정에는 접수 이후 봉만 쓰이는데, 늘 09:00 부터 받으면
 * 오후엔 종목당 수백 봉을 파싱하느라 무료 요금제 CPU 한도(호출당 10ms)를 넘길 수 있다.
 */
async function todayBars(code, now, fromHm) {
  const t = E.kstNow(now);
  const p = (n) => String(n).padStart(2, '0');
  const hhmm = (m) => `${p(Math.floor(m / 60))}${p(m % 60)}`;
  const from = Math.max(E.OPEN_AT, Math.min(fromHm == null ? E.OPEN_AT : fromHm, t.hm));
  const end = `${t.ymd}${hhmm(t.hm)}`;
  const start = `${t.ymd}${hhmm(from)}`;
  return memo(`bars:${code}:${start}:${end}`, 20000, () => naver.getOhlc(code, '1m', { start, end }).catch(() => []));
}

/**
 * 평가가
 *  - 평소: 시세 탭에 보이는 것과 같은 현재가 (프리·애프터마켓에는 그 시장의 가격). 시간외에도 거래할 수 있으므로
 *    평가도 시간외 가격을 따라간다. 20:00 이후에는 마지막 시간외 가격에서 멈춘다.
 *  - official: 저장해 둔 15:30 종가 — 일일 스냅샷과 시즌 최종 순위는 KRX 정규장 종가로 확정한다.
 */
async function pricer(db, codes, now, official, asOfYmd) {
  const t = E.kstNow(now);
  const live = !official && E.isTradingDay(t) && t.hm >= E.PRE_FROM && t.hm < E.AFTER_TO;
  const quotes = codes.length ? await quotesFor(codes) : {};
  const closes = {};
  // 시세가 없는 종목(상장폐지 뒤 네이버 응답에서 빠짐 등) — 매입가로 평가하면 손실이 0% 로 보인다.
  // 저장해 둔 마지막 15:30 종가(정리매매 마지막 날 가격)로 평가한다
  const missing = official ? [] : Array.from(new Set(codes)).filter((c) => {
    const q = quotes[c];
    return !q || (q.price == null && !(q.krx && q.krx.price != null));
  });
  if (missing.length) {
    const rows = (await db.prepare(
      `SELECT c.code, c.close FROM closes c
       JOIN (SELECT code, MAX(date) AS d FROM closes WHERE code IN (${missing.map(() => '?').join(',')}) GROUP BY code) m
         ON m.code = c.code AND m.d = c.date`
    ).bind(...missing).all()).results || [];
    for (const r of rows) closes[r.code] = r.close;
  }
  if (official && codes.length) {
    // asOfYmd — 시즌 종료일이 지난 뒤 늦게 마감할 때, 그 뒤 날짜의 종가가 섞이지 않게 한다
    const rows = (await db.prepare(
      `SELECT c.code, c.close FROM closes c
       JOIN (SELECT code, MAX(date) AS d FROM closes WHERE date <= ? GROUP BY code) m ON m.code = c.code AND m.d = c.date`
    ).bind(asOfYmd || '99999999').all()).results || [];
    for (const r of rows) closes[r.code] = r.close;
  }
  return {
    live, quotes,
    priceOf: (code) => {
      if (official && closes[code] != null) return closes[code];
      const q = quotes[code];
      const p = q ? (q.price != null ? q.price : (q.krx ? q.krx.price : null)) : null;
      return p != null ? p : (closes[code] != null ? closes[code] : null);
    }
  };
}

function sessionInfo(now) {
  const t = E.kstNow(now);
  const weekday = t.dow >= 1 && t.dow <= 5;
  const tradingDay = E.isTradingDay(t);
  let phase = 'closed';
  if (tradingDay) {
    if (t.hm >= E.PRE_FROM && t.hm < E.ACCEPT_FROM) phase = 'pre_market';          // NXT 프리마켓 (지정가만)
    else if (t.hm >= E.ACCEPT_FROM && t.hm < E.OPEN_AT) phase = 'pre_open';         // 정규장 장전 → 시가
    else if (t.hm >= E.OPEN_AT && t.hm < 15 * 60 + 20) phase = 'continuous';
    else if (t.hm >= 15 * 60 + 20 && t.hm < E.ACCEPT_TO) phase = 'close_auction';   // → 종가
    else if (t.hm >= E.ACCEPT_TO && t.hm < E.AFTER_FROM) phase = 'break';           // 15:30~15:40
    else if (t.hm >= E.AFTER_FROM && t.hm < E.AFTER_TO) phase = 'after_market';     // NXT·KRX 애프터마켓 (지정가만)
  }
  const canOrder = phase !== 'closed' && phase !== 'break';
  return { canOrder, phase, limitOnly: phase === 'pre_market' || phase === 'after_market', holiday: weekday && !tradingDay, serverTime: now };
}

const publicBrag = (b, seasonName) => ({
  id: b.id, code: b.code, name: b.name, nickname: b.nickname,
  qty: b.qty, avgPrice: b.avg_price, price: b.price,
  pnl: b.pnl, pnlRate: b.pnl_rate, seasonName: seasonName || null, createdAt: b.created_at
});

const publicOrder = (o) => o && ({
  id: o.id, code: o.code, name: o.name, side: o.side, type: o.type, qty: o.qty, limitPrice: o.limit_price,
  filledQty: o.filled_qty, status: o.status, reason: o.reason, acceptedAt: o.accepted_at, updatedAt: o.updated_at,
  origOrderId: o.orig_order_id || null
});

// ③ 회원 보유 현황 — 이 인원 미만이면 숫자를 보여 주지 않는다 (개인이 특정되지 않게)
const CROWD_MIN = 3;
const round1 = (v) => Math.round(v * 10) / 10;
const kstDayStart = (now) => { const t = E.kstNow(now); return Date.UTC(+t.ymd.slice(0, 4), +t.ymd.slice(4, 6) - 1, +t.ymd.slice(6, 8)) - 9 * 3600e3; };

/* AI 계좌 평가 하루 횟수. 0 이면 무제한.
 * 2026-09-23 — 회원님 테스트 기간이라 풀어 두었다. 요청이 오면 3 으로 되돌린다.
 * 유료 API 를 부르므로 테스트가 끝나면 반드시 다시 막아야 한다. */
const REVIEW_DAILY_MAX = 0;

// ── 라우팅 ────────────────────────────────────────────────────
/**
 * @param user  검증된 ID 토큰 payload (sub = uid)
 * @param token 원본 ID 토큰 — Firestore 에서 본인 문서를 읽는 데 쓴다
 */
export async function handleMock(request, env, user, token, url, now = Date.now()) {
  const db = env.MOCK_DB;
  if (!db) throw new HttpError(503, '모의투자가 아직 준비되지 않았습니다');
  const uid = user.sub;
  const path = url.pathname.replace(/^\/api\/mock/, '') || '/';
  const method = request.method;
  const body = async () => { try { return await request.json(); } catch { throw new HttpError(400, '요청 형식이 올바르지 않습니다'); } };

  E.setHolidays(await H.holidaySet(db));   // 거래일 판정 전에 최신 목록을 넣는다

  const profile = await profileOf(env, uid, token);
  if (profile.transient) throw new HttpError(503, '회원 확인이 지연되고 있습니다. 잠시 후 다시 시도하세요');
  if (!profile.role) throw new HttpError(403, 'DT Club 회원만 이용할 수 있습니다');
  const isAdmin = profile.role === 'admin' || profile.role === 'superadmin';

  // ── 관리자 ──
  if (path.startsWith('/admin/')) {
    if (!isAdmin) throw new HttpError(403, '관리자만 가능합니다');
    return handleAdmin(db, uid, path, method, body, now, url);
  }

  // 주문창의 호가단위 ± 버튼용 — ETF·ETN 은 호가단위와 세금이 다르다
  if (path === '/kind' && method === 'GET') {
    const code = url.searchParams.get('code');
    if (!isCode(code)) throw new HttpError(400, '종목코드가 올바르지 않습니다');
    const kind = await kindOf(code, url.searchParams.get('name'));
    return { code, kind, taxFree: kind === 'etf' || kind === 'etn' };
  }

  if (path === '/hall' && method === 'GET') {
    const rows = (await db.prepare(
      `SELECT f.season_id, s.name AS season_name, f.rank, f.nickname, f.equity, f.fills, s.seed
       FROM final_rankings f JOIN seasons s ON s.id = f.season_id
       WHERE f.rank <= 10 ORDER BY s.end_date DESC, f.rank ASC`
    ).all()).results || [];
    return { items: rows };
  }

  // 글을 그릴 때 여러 개를 한 번에 — 글마다 따로 부르면 화면 하나에 수십 번이 된다
  if (path === '/brag' && method === 'GET') {
    const ids = String(url.searchParams.get('ids') || '')
      .split(',').map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 30);
    if (!ids.length) return { items: [] };
    const rows = (await db.prepare(
      `SELECT b.*, s.name AS season_name FROM brags b
       LEFT JOIN seasons s ON s.id = b.season_id
       WHERE b.id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all()).results || [];
    return { items: rows.map((r) => publicBrag(r, r.season_name)) };
  }

  const season = await E.activeSeason(db, now);
  // 장이 끝난 미체결 주문은 크론(08:00~20:10)이 만료시키지만, 크론이 놓친 뒤 화면을 열면 여기서 정리한다
  // (안 그러면 '주문 가능 금액'이 밤새 묶인 채로 보인다). UPDATE 1건이라 비용은 없다.
  if (method === 'GET' && (path === '/season' || path === '/account')) await E.expireStale(db, now);
  if (path === '/season' && method === 'GET') {
    const next = season ? null : await db.prepare(`SELECT id, name, start_date, end_date FROM seasons WHERE status='upcoming' ORDER BY start_date LIMIT 1`).first();
    const account = season ? await E.getAccount(db, season.id, uid) : null;
    const count = season ? await db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE season_id=? AND status='active'`).bind(season.id).first() : null;
    return {
      season: season && {
        id: season.id, name: season.name, startDate: season.start_date, endDate: season.end_date,
        seed: season.seed, feeRate: season.fee_rate, taxRate: season.tax_rate, notice: season.notice || ''
      },
      next, joined: !!account, participants: count ? count.n : 0, isAdmin, ...sessionInfo(now)
    };
  }
  /* ── ③ DT 회원 보유 현황 — 참가하지 않은 회원도 볼 수 있다. 이름·평단·수량은 내보내지 않는다 ── */
  if (path === '/crowd' && method === 'GET') {
    const code = url.searchParams.get('code');
    if (!isCode(code)) throw new HttpError(400, '종목코드가 올바르지 않습니다');
    if (!season) return { season: null };
    return memo(`crowd:${season.id}:${code}`, 60000, async () => {
      const [posRes, dayRes] = await Promise.all([
        db.prepare(`SELECT p.qty, p.cost FROM positions p JOIN accounts a ON a.season_id = p.season_id AND a.uid = p.uid
                     WHERE p.season_id=? AND p.code=? AND a.status='active'`).bind(season.id, code).all(),
        db.prepare(`SELECT f.side, COUNT(DISTINCT f.uid) AS n FROM fills f JOIN accounts a ON a.season_id = f.season_id AND a.uid = f.uid
                     WHERE f.season_id=? AND f.code=? AND f.at >= ? AND a.status='active' GROUP BY f.side`).bind(season.id, code, kstDayStart(now)).all()
      ]);
      const rows = posRes.results || [];
      const day = {};
      for (const r of dayRes.results || []) day[r.side] = r.n;
      const base = { season: { id: season.id, name: season.name }, asOf: Date.now() };
      if (rows.length < CROWD_MIN) return { ...base, few: true, holders: null, avgReturn: null, winners: null, boughtToday: null, soldToday: null };
      const q = (await quotesFor([code]))[code];
      const price = q ? (q.price != null ? q.price : (q.krx ? q.krx.price : null)) : null;
      // 보유자별 수익률의 단순 평균 — 큰 계좌 하나가 좌우하지 않게 (금액 가중이 아니다)
      const rets = price == null ? [] : rows.filter((r) => r.cost > 0).map((r) => (price * r.qty - r.cost) / r.cost * 100);
      return {
        ...base, few: false, holders: rows.length,
        avgReturn: rets.length ? round1(rets.reduce((a, b) => a + b, 0) / rets.length) : null,
        winners: price == null ? null : rows.filter((r) => price * r.qty > r.cost).length,
        boughtToday: (day.buy || 0) >= CROWD_MIN ? day.buy : null,
        soldToday: (day.sell || 0) >= CROWD_MIN ? day.sell : null
      };
    });
  }
  if (path === '/crowd/top' && method === 'GET') {
    const type = url.searchParams.get('type') === 'bought' ? 'bought' : 'held';
    if (!season) return { season: null, items: [] };
    return memo(`crowdtop:${season.id}:${type}`, 300000, async () => {
      const sql = type === 'held'
        ? `SELECT p.code, MAX(p.name) AS name, COUNT(*) AS count FROM positions p JOIN accounts a ON a.season_id = p.season_id AND a.uid = p.uid
           WHERE p.season_id=? AND a.status='active' GROUP BY p.code HAVING count >= ? ORDER BY count DESC, p.code LIMIT 10`
        : `SELECT f.code, MAX(f.name) AS name, COUNT(DISTINCT f.uid) AS count FROM fills f JOIN accounts a ON a.season_id = f.season_id AND a.uid = f.uid
           WHERE f.season_id=? AND f.side='buy' AND f.at >= ? AND a.status='active' GROUP BY f.code HAVING count >= ? ORDER BY count DESC, f.code LIMIT 10`;
      const st = type === 'held' ? db.prepare(sql).bind(season.id, CROWD_MIN) : db.prepare(sql).bind(season.id, kstDayStart(now), CROWD_MIN);
      const items = ((await st.all()).results || []).filter((r) => isCode(r.code)).map((r) => ({ code: r.code, name: r.name, count: r.count }));
      return { season: { id: season.id, name: season.name }, items };
    });
  }

  if (!season) throw new HttpError(409, '진행 중인 시즌이 없습니다', 'no_season');

  if (path === '/join' && method === 'POST') {
    const acc = await E.join(db, season, uid, profile.name || '회원', now);
    return { joined: true, cash: acc.cash };
  }

  if (path === '/leaderboard' && method === 'GET') {
    const board = await liveBoard(db, season, now);
    const me = board.rows.find((r) => r.uid === uid);
    return {
      season: { id: season.id, name: season.name, seed: season.seed, endDate: season.end_date },
      asOf: board.asOf, live: board.live,
      // uid 는 내보내지 않는다 — 순위표에는 닉네임만 (key 는 갱신 간 순위 변동 표시용 해시)
      rows: board.rows.map((r) => ({ key: rowKey(r.uid), rank: r.rank, nickname: r.nickname, equity: r.equity, fills: r.fills, me: r.uid === uid })),
      me: me ? { rank: me.rank, equity: me.equity } : null
    };
  }

  const account = await E.getAccount(db, season.id, uid);
  if (!account) throw new HttpError(409, '시즌 참가 후 이용할 수 있습니다', 'not_joined');
  if (account.status !== 'active') throw new HttpError(403, '이용이 제한된 계정입니다');
  // 개명했으면 순위표 이름도 맞춘다
  if (profile.name && profile.name !== account.nickname) {
    await db.prepare(`UPDATE accounts SET nickname=? WHERE season_id=? AND uid=?`).bind(profile.name, season.id, uid).run();
  }

  if (path === '/account' && method === 'GET') {
    const [view, board, corpActions] = await Promise.all([
      accountView(db, season, account, now), liveBoard(db, season, now), C.accountActions(db, season, uid, now)
    ]);
    const me = board.rows.find((r) => r.uid === uid);
    return { ...view, rank: me ? me.rank : null, participants: board.rows.length, corpActions };
  }

  if (path === '/orders' && method === 'POST') {
    const input = await body();
    if (!isCode(input.code)) throw new HttpError(400, '종목코드가 올바르지 않습니다');
    // 주문은 캐시가 아닌 방금 받은 시세로 검증한다
    const quote = await naver.getQuote(input.code).catch(() => null);
    const kind = await kindOf(input.code, quote && quote.name);
    try {
      // 오늘 권리 변동(분할 등)이 감지됐는데 아직 반영 전이면 매도를 받지 않는다 — 옛 수량을 새 가격에 파는 사고 방지
      if (input.side === 'sell' && quote && await C.sellBlocked(db, season, uid, quote, now)) {
        throw new E.OrderError('권리 변동(액면분할 등)을 반영하고 있습니다. 1~2분 뒤 다시 주문해 주세요', 'corp_action');
      }
      const order = await E.acceptOrder(db, season, account, input, quote, kind === 'etf' || kind === 'etn', now);
      return { order: publicOrder(order) };
    } catch (e) {
      if (e instanceof E.OrderError) throw new HttpError(422, e.message, e.code);
      throw e;
    }
  }

  const m = /^\/orders\/([0-9a-f-]{36})$/.exec(path);
  if (m && method === 'GET') {
    let order = await db.prepare(`SELECT * FROM orders WHERE id=? AND uid=?`).bind(m[1], uid).first();
    if (!order) throw new HttpError(404, '주문을 찾을 수 없습니다');
    let fill = null;
    if (order.status === 'open' || order.status === 'partial') {
      // 화면이 주문 상태를 물어볼 때마다 체결을 시도한다 (크론을 기다리지 않고 바로 체결되도록)
      const quote = await naver.getQuote(order.code).catch(() => null);
      const needBars = (order.type === 'limit' || order.pre_open) && order.session !== 'pre';   // NXT 프리마켓은 분봉이 없다
      const bars = needBars ? await todayBars(order.code, now, E.kstNow(order.accepted_at).hm) : null;
      fill = await E.tryFill(db, season, order, { quote, bars }, now);
      if (fill) { mem.delete(`lb:${season.id}`); order = await db.prepare(`SELECT * FROM orders WHERE id=?`).bind(m[1]).first(); }
    }
    return { order: publicOrder(order), fill };
  }
  if (m && method === 'DELETE') {
    const ok = await E.cancelOrder(db, uid, m[1], now);
    if (!ok) throw new HttpError(409, '이미 체결되었거나 취소된 주문입니다');
    return { cancelled: true };
  }

  /* ── ④ 주문 정정 — 가격·종류를 바꾸면 새 주문(대기 순서 뒤로), 수량만 줄이면 같은 주문(순서 유지) ── */
  const am = /^\/orders\/([0-9a-f-]{36})\/amend$/.exec(path);
  if (am && method === 'POST') {
    const input = await body();
    const order = await db.prepare(`SELECT code, side FROM orders WHERE id=? AND uid=?`).bind(am[1], uid).first();
    if (!order) throw new HttpError(404, '주문을 찾을 수 없습니다');
    const quote = await naver.getQuote(order.code).catch(() => null);
    const kind = await kindOf(order.code, quote && quote.name);
    try {
      if (order.side === 'sell' && quote && await C.sellBlocked(db, season, uid, quote, now)) {
        throw new E.OrderError('권리 변동(액면분할 등)을 반영하고 있습니다. 1~2분 뒤 다시 주문해 주세요', 'corp_action');
      }
      const r = await E.amendOrder(db, season, account, am[1], input, quote, kind === 'etf' || kind === 'etn', now);
      return { order: publicOrder(r.order), replaced: r.replaced };
    } catch (e) {
      if (e instanceof E.OrderError) throw new HttpError(422, e.message, e.code);
      throw e;
    }
  }

  /* ── 자랑하기 ──────────────────────────────────────────────
   * 커뮤니티 글에 붙일 "내 수익률" 스냅샷.
   * 숫자는 여기(서버)에서 장부를 직접 읽어 만든다 — 클라이언트가 보낸 값은 쓰지 않는다.
   * 글에는 이 id 만 저장되므로 수익률을 고쳐 쓸 수 없다.
   */
  if (path === '/brag' && method === 'POST') {
    const input = await body();
    if (!isCode(input.code)) throw new HttpError(400, '종목코드가 올바르지 않습니다');
    const pos = await db.prepare(
      `SELECT code, name, qty, cost FROM positions WHERE season_id=? AND uid=? AND code=?`
    ).bind(season.id, uid, input.code).first();
    if (!pos || pos.qty <= 0) throw new HttpError(409, '보유 중인 종목만 자랑할 수 있습니다', 'no_position');

    const quote = await naver.getQuote(pos.code).catch(() => null);
    if (!quote || quote.price == null) throw new HttpError(503, '시세를 가져오지 못했습니다. 잠시 후 다시 시도하세요');

    const nick = profile.name || account.nickname;
    const avg = Math.round(pos.cost / pos.qty);
    const value = quote.price * pos.qty;
    const pnl = value - pos.cost;
    const rate = pos.cost > 0 ? Math.round((pnl / pos.cost) * 10000) / 100 : 0;
    const id = crypto.randomUUID();

    await db.prepare(
      `INSERT INTO brags (id, season_id, uid, nickname, code, name, qty, avg_price, price, pnl, pnl_rate, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id, season.id, uid, nick, pos.code, pos.name, pos.qty, avg, quote.price, pnl, rate, now).run();

    return { brag: publicBrag({
      id, season_id: season.id, nickname: nick, code: pos.code, name: pos.name,
      qty: pos.qty, avg_price: avg, price: quote.price, pnl, pnl_rate: rate, created_at: now
    }, season.name) };
  }

  /* ── AI 계좌 평가 ────────────────────────────────────────
   * 지표는 여기서 D1 로 계산하고, 문장만 dt-ai 워커(OpenAI)에 맡긴다.
   * 화면이 지표를 보내면 숫자를 위조할 수 있으므로 서버끼리 주고받는다.
   * 유료 API 라 하루 횟수를 제한한다.
   */
  if (path === '/review' && method === 'POST') {
    if (!env.AI_WORKER_URL || !env.REVIEW_SECRET) throw new HttpError(503, 'AI 평가가 아직 준비되지 않았습니다');
    const ymd = E.kstNow(now).ymd;
    const used = await db.prepare(`SELECT COUNT(*) AS n FROM reviews WHERE uid=? AND ymd=?`).bind(uid, ymd).first();
    if (REVIEW_DAILY_MAX > 0 && used && used.n >= REVIEW_DAILY_MAX) {
      throw new HttpError(429, `평가는 하루 ${REVIEW_DAILY_MAX}번까지 받을 수 있습니다. 내일 다시 시도해 주세요`, 'quota');
    }

    // 하루 횟수를 풀어 둔 동안에도 연타로 유료 API 가 연달아 불리지 않게 1분 간격은 둔다
    const lastAt = await db.prepare(`SELECT MAX(created_at) AS at FROM reviews WHERE uid=?`).bind(uid).first();
    if (lastAt && lastAt.at && now - lastAt.at < 60000) {
      throw new HttpError(429, '방금 평가를 받았습니다. 1분 뒤에 다시 시도해 주세요', 'cooldown');
    }

    const view = await accountView(db, season, account, now);
    const metrics = await buildMetrics(db, season, account, view, now);

    let text;
    try {
      const r = await fetch(env.AI_WORKER_URL + '/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Review-Secret': env.REVIEW_SECRET },
        body: JSON.stringify({ metrics }),
        signal: AbortSignal.timeout(60000)   // 추론 모델은 생각하는 시간이 있어 넉넉히 준다
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 401 은 OpenAI 키 문제다 — 로그로 구분해 두고, 회원에게는 담백하게 알린다
        if (d && d.upstream === 401) { console.error('review: OpenAI 401 — 키 확인 필요'); throw new HttpError(502, 'AI 평가를 잠시 이용할 수 없습니다'); }
        throw new HttpError(502, (d && d.error) || 'AI 평가를 가져오지 못했습니다');
      }
      text = d.text;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, e && e.name === 'TimeoutError' ? 'AI 응답이 늦습니다. 잠시 후 다시 시도해 주세요' : 'AI 평가를 가져오지 못했습니다');
    }
    if (!text) throw new HttpError(502, 'AI 평가를 가져오지 못했습니다');

    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO reviews (id, season_id, uid, ymd, metrics, body, created_at) VALUES (?,?,?,?,?,?,?)`
    ).bind(id, season.id, uid, ymd, JSON.stringify(metrics), text, now).run();

    return {
      review: { id, metrics, body: text, createdAt: now },
      remaining: REVIEW_DAILY_MAX > 0 ? REVIEW_DAILY_MAX - ((used ? used.n : 0) + 1) : null
    };
  }

  // 가장 최근 평가 (다시 열어 볼 때 — 새로 부르지 않는다)
  if (path === '/review' && method === 'GET') {
    const ymd = E.kstNow(now).ymd;
    const [last, used] = await Promise.all([
      db.prepare(`SELECT id, metrics, body, created_at FROM reviews WHERE season_id=? AND uid=? ORDER BY created_at DESC LIMIT 1`).bind(season.id, uid).first(),
      db.prepare(`SELECT COUNT(*) AS n FROM reviews WHERE uid=? AND ymd=?`).bind(uid, ymd).first()
    ]);
    return {
      review: last ? { id: last.id, metrics: JSON.parse(last.metrics), body: last.body, createdAt: last.created_at } : null,
      remaining: REVIEW_DAILY_MAX > 0 ? Math.max(0, REVIEW_DAILY_MAX - (used ? used.n : 0)) : null
    };
  }

  if (path === '/history' && method === 'GET') {
    // 다음 페이지 기준은 (시각, id) — 크론 한 번의 체결은 모두 같은 시각이라 시각만 쓰면 경계에서 빠진다.
    // before 는 "시각" 또는 "시각_id" (옛 화면이 보내는 숫자도 받는다)
    const cur = String(url.searchParams.get('before') || '');
    const mm = /^(\d{1,15})(?:_([0-9a-f-]{36}))?$/i.exec(cur);
    const bAt = mm ? Number(mm[1]) : now + 1;
    const bId = mm && mm[2] ? mm[2] : (mm ? '' : 'ffffffff');
    const rows = (await db.prepare(
      `SELECT id, code, name, side, qty, price, fee, tax, at FROM fills
       WHERE season_id=? AND uid=? AND (at < ? OR (at = ? AND id < ?)) ORDER BY at DESC, id DESC LIMIT 50`
    ).bind(season.id, uid, bAt, bAt, bId).all()).results || [];
    const last = rows[rows.length - 1];
    return { items: rows, next: rows.length === 50 ? `${last.at}_${last.id}` : null };
  }

  throw new HttpError(404, 'Not Found');
}

async function accountView(db, season, account, now) {
  const uid = account.uid;
  const [posRes, ordRes] = await Promise.all([
    db.prepare(`SELECT code, name, qty, cost FROM positions WHERE season_id=? AND uid=? ORDER BY cost DESC`).bind(season.id, uid).all(),
    db.prepare(`SELECT * FROM orders WHERE season_id=? AND uid=? AND status IN ('open','partial') ORDER BY accepted_at DESC`).bind(season.id, uid).all()
  ]);
  const positions = posRes.results || [], orders = ordRes.results || [];
  const px = await pricer(db, positions.map((p) => p.code), now);
  let stock = 0;
  const items = positions.map((p) => {
    const price = px.priceOf(p.code);
    const value = price != null ? price * p.qty : p.cost;
    stock += value;
    const q = px.quotes[p.code];
    return {
      code: p.code, name: p.name, qty: p.qty, avgPrice: Math.round(p.cost / p.qty), cost: p.cost,
      price, value, pnl: value - p.cost, pnlRate: p.cost ? (value - p.cost) / p.cost * 100 : 0,
      changeRate: q ? q.changeRate : null, halted: q ? q.halted : false
    };
  });
  const reserved = orders.filter((o) => o.side === 'buy').reduce((s, o) => s + o.reserved, 0);
  const equity = account.cash + stock;
  return {
    season: { id: season.id, name: season.name, seed: season.seed, endDate: season.end_date, feeRate: season.fee_rate, taxRate: season.tax_rate },
    cash: account.cash, available: account.cash - reserved, stock, equity,
    returnRate: (equity - season.seed) / season.seed * 100,
    realizedPnl: account.realized_pnl, fills: account.fills,
    positions: items, openOrders: orders.map(publicOrder), live: px.live, ...sessionInfo(now)
  };
}

/** 실시간 순위표 — 10초 동안은 같은 계산을 다시 하지 않는다 (시세는 3초 캐시를 함께 쓴다) */
function liveBoard(db, season, now) {
  return memo(`lb:${season.id}`, 10000, () => leaderboard(db, season, now));
}

async function leaderboard(db, season, now, official, asOfYmd) {
  const [accRes, posRes] = await Promise.all([
    db.prepare(`SELECT uid, nickname, cash, fills, joined_at FROM accounts WHERE season_id=? AND status='active'`).bind(season.id).all(),
    db.prepare(`SELECT uid, code, qty, cost FROM positions WHERE season_id=?`).bind(season.id).all()
  ]);
  const positions = posRes.results || [];
  const px = await pricer(db, positions.map((p) => p.code), now, official, asOfYmd);
  return { rows: E.valuate(accRes.results || [], positions, px.priceOf), asOf: now, live: px.live };
}

// ── 관리자 ────────────────────────────────────────────────────
async function handleAdmin(db, actor, path, method, body, now, url) {
  const log = (action, detail) => db.prepare(`INSERT INTO audit_log (at, actor, action, detail) VALUES (?,?,?,?)`)
    .bind(now, actor, action, JSON.stringify(detail)).run();

  /* 휴장일 — 운영진이 직접 넣는다. 자동으로 표를 고치지 않는다.
     자동 탐지는 쓰지 않는다 — 오판하면 멀쩡한 거래일에 주문이 통째로 막힌다. */
  if (path === '/admin/holidays' && method === 'GET') {
    const today = E.kstNow(now).ymd;
    return { items: await H.listHolidays(db, today), today };
  }
  if (path === '/admin/holidays' && method === 'POST') {
    const b2 = await body();
    const items = Array.isArray(b2.items) ? b2.items
      : [{ ymd: String(b2.ymd || '').replace(/-/g, ''), name: b2.name }];
    const bad = items.find((x) => !/^\d{8}$/.test(String(x.ymd || '').replace(/-/g, '')));
    if (bad) throw new HttpError(400, '날짜는 YYYY-MM-DD 형식이어야 합니다');
    // 주말은 요일로 이미 걸러진다 — 표에 넣으면 목록만 지저분해진다
    const weekend = items.find((x) => {
      const y = String(x.ymd).replace(/-/g, '');
      const w = new Date(Date.UTC(+y.slice(0, 4), +y.slice(4, 6) - 1, +y.slice(6, 8))).getUTCDay();
      return w === 0 || w === 6;
    });
    if (weekend) throw new HttpError(400, '주말은 넣지 않아도 됩니다. 평일 휴장일만 등록하세요', 'weekend');
    const added = await H.addHolidays(db, items.map((x) => ({
      ymd: String(x.ymd).replace(/-/g, ''), name: x.name
    })), now);
    await log('holiday.add', { n: added });
    return { ok: true, added };
  }
  if (path === '/admin/holidays' && method === 'DELETE') {
    const ymd = String(url.searchParams.get('ymd') || '').replace(/-/g, '');
    if (!/^\d{8}$/.test(ymd)) throw new HttpError(400, '날짜가 올바르지 않습니다');
    await H.removeHoliday(db, ymd);
    await log('holiday.remove', { ymd });
    return { ok: true };
  }
  /* ⑤ 권리 변동 — 자동 반영 내역과 '확인 필요' 건 */
  if (path === '/admin/corp-actions' && method === 'GET') {
    const season = await E.activeSeason(db, now);
    return { items: await C.listActions(db, season) };
  }
  const ca = /^\/admin\/corp-actions\/([0-9a-f-]{36})\/(apply|dismiss)$/.exec(path);
  if (ca && method === 'POST') {
    const b = ca[2] === 'apply' ? await body() : {};
    const r = ca[2] === 'apply' ? await C.resolveAction(db, ca[1], b.kind, now) : await C.dismissAction(db, ca[1]);
    if (r.error) throw new HttpError(409, r.error);
    await log('corp.' + ca[2], { id: ca[1], kind: b.kind || null });
    return r;
  }
  if (path === '/admin/seasons' && method === 'GET') {
    // 참가자 수와 최종 순위 확정 여부를 같이 준다 — 목록에서 시즌 상태를 한눈에 보기 위해
    const rows = (await db.prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM accounts a WHERE a.season_id = s.id AND a.status = 'active') AS participants,
              (SELECT COUNT(*) FROM final_rankings f WHERE f.season_id = s.id) AS finals
       FROM seasons s ORDER BY s.start_date DESC`
    ).all()).results || [];
    return { items: rows };
  }
  if (path === '/admin/seasons' && method === 'POST') {
    const b = await body();
    const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    if (!/^[0-9A-Za-z_-]{3,20}$/.test(b.id || '') || !b.name || !okDate(b.startDate) || !okDate(b.endDate) || b.endDate < b.startDate) {
      throw new HttpError(400, '시즌 ID·이름·시작일·종료일을 확인해 주세요');
    }
    // 기간이 겹치면 안 된다 — 같은 날 두 시즌이 열리면 activeSeason() 이 하나만 집어 장부가 갈린다.
    // 겹침 = (새 시작 <= 기존 종료) AND (새 종료 >= 기존 시작). 자기 자신은 제외한다.
    const clash = await db.prepare(
      `SELECT id, name, start_date, end_date FROM seasons
       WHERE id <> ? AND start_date <= ? AND end_date >= ? LIMIT 1`
    ).bind(b.id, b.endDate, b.startDate).first();
    if (clash) {
      throw new HttpError(409,
        `기간이 "${clash.name}"(${clash.start_date} ~ ${clash.end_date}) 과 겹칩니다. 날짜를 조정해 주세요`,
        'overlap');
    }

    const existing = await db.prepare(`SELECT * FROM seasons WHERE id=?`).bind(b.id).first();
    if (existing) {
      // 이미 시작한 시즌은 이름·종료일·전달사항만 고칠 수 있다 — 시드·요율·시작일이 바뀌면 참가자 장부와 어긋난다
      if (existing.status !== 'upcoming') {
        if (b.startDate !== existing.start_date) throw new HttpError(409, '진행 중인 시즌의 시작일은 바꿀 수 없습니다');
        if ((b.seed != null && Number(b.seed) !== existing.seed) || (b.feeRate != null && Number(b.feeRate) !== existing.fee_rate)
            || (b.taxRate != null && Number(b.taxRate) !== existing.tax_rate)) {
          throw new HttpError(409, '진행 중인 시즌의 시드·수수료·세율은 바꿀 수 없습니다');
        }
        if (existing.status === 'closed') throw new HttpError(409, '종료된 시즌은 수정할 수 없습니다');
      }
      // 보내지 않은 값은 기존 값을 유지한다 (화면 폼이 시드·요율을 안 보내도 기본값으로 덮이지 않게)
      await db.prepare(
        `UPDATE seasons SET name=?, start_date=?, end_date=?, seed=?, fee_rate=?, tax_rate=?, volume_fill=?, notice=? WHERE id=?`
      ).bind(String(b.name).slice(0, 40), b.startDate, b.endDate,
        b.seed != null ? Number(b.seed) : existing.seed,
        b.feeRate != null ? Number(b.feeRate) : existing.fee_rate,
        b.taxRate != null ? Number(b.taxRate) : existing.tax_rate,
        b.volumeFill == null ? existing.volume_fill : (b.volumeFill === false ? 0 : 1),
        b.notice != null ? (String(b.notice).slice(0, 1000) || null) : existing.notice, b.id).run();
      await log('season.update', b);
      return { ok: true, updated: true };
    }
    // 기본값은 기획안 v2 — 시드 1억, 수수료 0.015%, 매도세 0.20%
    await db.prepare(
      `INSERT INTO seasons (id, name, start_date, end_date, seed, fee_rate, tax_rate, volume_fill, notice, status)
       VALUES (?,?,?,?,?,?,?,?,?, 'upcoming')`
    ).bind(b.id, String(b.name).slice(0, 40), b.startDate, b.endDate, Number(b.seed) || 100000000,
      b.feeRate != null ? Number(b.feeRate) : 0.00015, b.taxRate != null ? Number(b.taxRate) : 0.002,
      b.volumeFill === false ? 0 : 1, String(b.notice || '').slice(0, 1000) || null).run();
    await log('season.create', b);
    return { ok: true, created: true };
  }
  // 상태 수동 변경 — 화면에는 두지 않는다. 시작(시작일 도달)과 종료(종료일 장 마감)는 자동이다.
  // 상태가 꼬인 예외 상황에서 운영진이 직접 부를 수 있게 엔드포인트만 남긴다.
  if (path === '/admin/seasons/status' && method === 'POST') {
    const b = await body();
    if (!['upcoming', 'active', 'settling', 'closed'].includes(b.status)) throw new HttpError(400, '상태 값이 올바르지 않습니다');
    await db.prepare(`UPDATE seasons SET status=? WHERE id=?`).bind(b.status, b.id).run();
    await log('season.status', b);
    return { ok: true };
  }
  if (path === '/admin/accounts' && method === 'POST') {
    const b = await body();
    if (!['active', 'hidden'].includes(b.status)) throw new HttpError(400, '상태 값이 올바르지 않습니다');
    await db.prepare(`UPDATE accounts SET status=? WHERE season_id=? AND uid=?`).bind(b.status, b.seasonId, b.uid).run();
    await log('account.status', b);
    return { ok: true };
  }
  if (path === '/admin/block' && method === 'POST') {
    const b = await body();
    if (!isCode(b.code)) throw new HttpError(400, '종목코드가 올바르지 않습니다');
    if (b.blocked === false) await db.prepare(`DELETE FROM blocked_codes WHERE code=?`).bind(b.code).run();
    else await db.prepare(`INSERT OR REPLACE INTO blocked_codes (code, reason, by_uid, at) VALUES (?,?,?,?)`).bind(b.code, b.reason || null, actor, now).run();
    await log('code.block', b);
    return { ok: true };
  }
  throw new HttpError(404, 'Not Found');
}

export function mockErrorResponse(e, json) {
  if (e instanceof HttpError) return json({ error: e.message, code: e.code || null }, e.status);
  console.error('mock error', e && e.stack || e);
  return json({ error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요' }, 500);
}

// ── 크론 (평일 08:00~20:05 KST 매분) ──────────────────────────
// 무료 요금제 한도 (호출 1번 = 크론 1회):
//   - 외부 요청 50건 → 한 번에 다루는 종목 수를 자른다
//   - D1 쿼리 50건 (batch 안의 문장도 한 건씩 센다) → 체결 한 건이 5~6문장이라 한 번에 처리하는 체결 수를 자른다.
//     남은 주문은 다음 분에 이어서 처리하고, 주문 상태를 보고 있는 회원은 화면 폴링(별도 호출)으로 바로 체결된다.
const MAX_CODES_PER_RUN = 20;
const FILL_QUERY_BUDGET = 38;      // 크론 한 번의 D1 문장 누계 상한(권리 변동·체결 합) — 장 마감 처리 약 10건을 더해도 50 미만
const MAX_CLOSES_PER_RUN = 10;     // 15:40~16:30 에는 체결 판정과 종가 저장이 같은 호출에 겹친다 — 외부 요청 합이 50 을 넘지 않게

export async function runCron(env, now = Date.now()) {
  const db = env.MOCK_DB;
  if (!db) return;
  E.setHolidays(await H.holidaySet(db));
  const t = E.kstNow(now);

  // 종료일이 지났는데 아직 열려 있는 시즌을 먼저 마감한다 — 휴장일에도 돈다.
  // 종료일이 휴장일이거나 그날 크론이 실패하면 closeOfDay 의 "종료일" 분기를 못 타서 시즌이 영영 열려 있었다.
  await finalizeOverdue(db, now);

  // 휴장일은 자동으로 고치지 않는다 — 오판하면 멀쩡한 날 주문이 통째로 막힌다 (관리 화면에서 넣는다)
  if (!E.isTradingDay(t)) return;
  const season = await E.activeSeason(db, now);
  await E.expireStale(db, now);
  if (!season) return;

  // 이 호출에서 쓴 D1 문장 수 — 여기까지 약 6건
  const stats = { q: 6 };
  if (t.hm >= E.PRE_FROM && t.hm < E.AFTER_TO) {
    // ⑤ 권리 변동을 가장 먼저 — 체결이 옛 수량·옛 가격으로 돌지 않게.
    //    반영이 일어난 분에는 쿼리 한도를 넘지 않도록 나머지를 다음 분으로 미룬다
    const applied = await C.runCorpActions(db, season, now, quotesFor, stats).catch((e) => { console.error('corp failed', e && e.message); return 0; });
    if (!applied) await fillOpenOrders(db, season, now, stats);
  }
  // 종가 저장·스냅샷은 한 번 끝나면 다시 하지 않는다 (16:30 까지 시도)
  if (t.hm >= 15 * 60 + 40 && t.hm < 16 * 60 + 30) await closeOfDay(db, season, now);
  // 20:00 이후 — 애프터마켓(15:40~)에 새로 산 종목은 오늘 종가가 저장되지 않았다. 내일 권리 변동 비교 기준이 되므로 채운다
  if (t.hm >= E.AFTER_TO) await backfillCloses(db, season, now);
}

async function fillOpenOrders(db, season, now, stats = { q: 0 }) {
  stats.q += 4;   // 아래 고정 조회 (종목·주문·계정·증거금)
  // 종목 단위로 돌려 가며 고른다 — 접수순으로 앞 N건만 보면 미체결이 쌓였을 때 새 주문이 영영 판정되지 않는다
  const allCodes = ((await db.prepare(
    `SELECT DISTINCT code FROM orders WHERE season_id=? AND status IN ('open','partial') ORDER BY code`
  ).bind(season.id).all()).results || []).map((r) => r.code);
  if (!allCodes.length) return;
  const rot = Math.floor(now / 60000) % allCodes.length;
  const codes = allCodes.slice(rot).concat(allCodes.slice(0, rot)).slice(0, MAX_CODES_PER_RUN * 2);
  const orders = (await db.prepare(
    `SELECT * FROM orders WHERE season_id=? AND status IN ('open','partial') AND code IN (${codes.map(() => '?').join(',')})
     ORDER BY accepted_at LIMIT 300`
  ).bind(season.id, ...codes).all()).results || [];
  if (!orders.length) return;

  const quotes = await quotesFor(codes);
  // 지정가·장전 주문이 걸린 종목만 분봉을 받는다 (종목당 외부 요청 1건). 가장 이른 접수 시각부터만 받는다.
  // 프리마켓 주문은 NXT 라 분봉이 없다 — 시세 폴링만으로 판정한다
  const fromByCode = {};
  for (const o of orders) {
    if (!((o.type === 'limit' || o.pre_open) && o.session !== 'pre')) continue;
    const hm = E.kstNow(o.accepted_at).hm;
    fromByCode[o.code] = fromByCode[o.code] == null ? hm : Math.min(fromByCode[o.code], hm);
  }
  const needBars = codes.filter((c) => fromByCode[c] != null).slice(0, MAX_CODES_PER_RUN);
  const bars = {};
  await Promise.all(needBars.map(async (c) => { bars[c] = await todayBars(c, now, fromByCode[c]); }));

  // 계정과 묶인 증거금을 한 번에 읽어 둔다 (주문마다 읽으면 D1 쿼리가 두 배)
  const accounts = {};
  for (const a of ((await db.prepare(
    `SELECT * FROM accounts WHERE season_id=? AND uid IN (SELECT DISTINCT uid FROM orders WHERE season_id=? AND status IN ('open','partial'))`
  ).bind(season.id, season.id).all()).results || [])) accounts[a.uid] = a;
  const reserved = {};
  for (const r of ((await db.prepare(
    `SELECT uid, COALESCE(SUM(reserved),0) AS r FROM orders WHERE season_id=? AND side='buy' AND status IN ('open','partial') GROUP BY uid`
  ).bind(season.id).all()).results || [])) reserved[r.uid] = r.r;

  let filled = 0;
  for (const o of orders) {
    if (stats.q >= FILL_QUERY_BUDGET - 6) break;    // 한 건 더 체결할 여유가 없으면 다음 분으로 넘긴다
    const acc = accounts[o.uid];
    if (!quotes[o.code] || !acc) continue;
    const available = acc.cash - ((reserved[o.uid] || 0) - (o.side === 'buy' ? o.reserved : 0));
    try {
      const f = await E.tryFill(db, season, o, { quote: quotes[o.code], bars: bars[o.code] || null, account: acc, available, stats }, now);
      if (f) {
        filled++;
        acc.cash += f.cashDelta;
        reserved[o.uid] = (reserved[o.uid] || 0) + f.reservedDelta;
      }
    } catch (e) { console.error('fill failed', o.id, e && e.message); }
  }
  if (filled) mem.delete(`lb:${season.id}`);
}

/** 15:40 이후: 보유 종목의 15:30 종가를 저장하고, 다 모이면 그날의 자산 스냅샷(시즌 종료일이면 최종 순위)을 남긴다 */
async function closeOfDay(db, season, now) {
  const t = E.kstNow(now);
  const done = await db.prepare(`SELECT 1 AS x FROM daily_snapshots WHERE season_id=? AND date=? LIMIT 1`).bind(season.id, t.ymd).first();
  if (done) return;

  const held = ((await db.prepare(`SELECT DISTINCT code FROM positions WHERE season_id=?`).bind(season.id).all()).results || []).map((r) => r.code);
  const have = new Set(((await db.prepare(`SELECT code FROM closes WHERE date=?`).bind(t.ymd).all()).results || []).map((r) => r.code));
  const todo = held.filter((c) => !have.has(c)).slice(0, MAX_CLOSES_PER_RUN);
  const lastTry = t.hm >= 16 * 60 + 25;    // 16:30 이 마지막 기회 — 그때까지 못 받은 종목은 직전 종가로 평가한다
  let tradingDay = have.size > 0 || held.length === 0;
  let failed = 0;
  const got = [];
  const noBars = [];
  // 오늘 봉을 받아 온다. 조회 실패(네이버 일시 장애)와 "오늘 봉 없음"(거래정지)을 구분한다 —
  // 예전에는 둘 다 빈 배열이라 장애가 나면 직전 종가로 스냅샷·최종 순위가 확정됐다.
  const dayBars = async (code, from) => (await naver.getOhlc(code, '1m', { start: `${t.ymd}${from}`, end: `${t.ymd}1531` }))
    .filter((b) => String(b.t).slice(0, 8) === t.ymd && String(b.t).slice(8, 12) <= '1530');
  await Promise.all(todo.map(async (code) => {
    try {
      // 종가 부근만 먼저 본다. 비어 있으면(장중 거래정지 등) 하루 전체에서 마지막 체결가를 찾는다
      let day = await dayBars(code, '1525');
      if (!day.length) day = await dayBars(code, '0900');
      if (!day.length) { noBars.push(code); return; }   // 오늘 거래가 없다 — 휴장일이거나 거래정지
      tradingDay = true;
      // 15:30 봉(종가 단일가)이 없으면 그 전 마지막 체결가가 종가다
      got.push({ code, close: Math.round(day[day.length - 1].c) });
    } catch (e) { failed++; }
  }));
  if (got.length) {
    await db.prepare(
      `INSERT OR REPLACE INTO closes (code, date, close)
       SELECT json_extract(value, '$.code'), ?, json_extract(value, '$.close') FROM json_each(?)`
    ).bind(t.ymd, JSON.stringify(got)).run();
    for (const g of got) have.add(g.code);
  }
  if (failed && !lastTry) return;                   // 다음 분에 다시 받는다
  // 거래정지 종목은 직전 종가를 오늘 종가로 이어 둔다 — 분할 뒤 재상장일에 "전 거래일 종가"와 기준가를 비교해야 해서
  if (noBars.length && tradingDay) {
    await carryForward(db, t.ymd, noBars);
    for (const c of noBars) have.add(c);
  }
  // 보유 종목이 없을 때는 대표 종목으로 거래일인지 확인한다
  if (!held.length) {
    const probe = await naver.getOhlc('005930', '1m', { start: `${t.ymd}0900`, end: `${t.ymd}0905` }).catch(() => null);
    if (probe == null && !lastTry) return;
    tradingDay = (probe || []).some((b) => String(b.t).slice(0, 8) === t.ymd) || (probe == null && lastTry);
  }
  if (!tradingDay) return;
  // 남은 종목이 있으면 다음 분에 이어서
  if (held.filter((c) => !have.has(c)).length > 0 && todo.length === MAX_CLOSES_PER_RUN && !lastTry) return;

  const board = await leaderboard(db, season, now, true, t.ymd);      // 15:30 종가 기준
  const rows = board.rows.map((r) => ({ uid: r.uid, equity: r.equity, cash: r.cash, rank: r.rank }));
  const stmts = [];
  // 참가자마다 한 문장씩 쓰면 D1 쿼리 한도(호출당 50)를 참가자 수만으로 넘긴다 — JSON 한 덩어리로 한 문장에 넣는다
  if (rows.length) stmts.push(db.prepare(
    `INSERT OR REPLACE INTO daily_snapshots (season_id, uid, date, equity, cash, rank)
     SELECT ?, json_extract(value, '$.uid'), ?, json_extract(value, '$.equity'), json_extract(value, '$.cash'), json_extract(value, '$.rank')
     FROM json_each(?)`
  ).bind(season.id, t.ymd, JSON.stringify(rows)));
  if (t.iso >= season.end_date) stmts.push(...finalStatements(db, season, board.rows));
  if (stmts.length) await db.batch(stmts);
  mem.delete(`lb:${season.id}`);
}

/** 최종 순위 확정 + 시즌 종료 — 두 문장 */
function finalStatements(db, season, rows) {
  const out = [];
  if (rows.length) out.push(db.prepare(
    `INSERT OR REPLACE INTO final_rankings (season_id, rank, uid, nickname, equity, fills)
     SELECT ?, json_extract(value, '$.rank'), json_extract(value, '$.uid'), json_extract(value, '$.nickname'),
            json_extract(value, '$.equity'), json_extract(value, '$.fills') FROM json_each(?)`
  ).bind(season.id, JSON.stringify(rows.map((r) => ({ rank: r.rank, uid: r.uid, nickname: r.nickname, equity: r.equity, fills: r.fills })))));
  out.push(db.prepare(`UPDATE seasons SET status='closed' WHERE id=? AND status='active'`).bind(season.id));
  return out;
}

/**
 * 종료일이 지났는데 열려 있는 시즌을 마감한다.
 * 기준은 종료일까지 저장된 마지막 15:30 종가 (종료일이 휴장일이면 그 직전 거래일 종가).
 */
async function finalizeOverdue(db, now) {
  const t = E.kstNow(now);
  const overdue = (await db.prepare(`SELECT * FROM seasons WHERE status='active' AND end_date < ?`).bind(t.iso).all()).results || [];
  for (const s of overdue) {
    try {
      await E.expireStale(db, now);
      const board = await leaderboard(db, s, now, true, s.end_date.replace(/-/g, ''));
      await db.batch(finalStatements(db, s, board.rows));
      mem.delete(`lb:${s.id}`);
      console.log('season finalized (overdue)', s.id, board.rows.length);
    } catch (e) { console.error('finalize failed', s.id, e && e.message); }
  }
}

/** 직전 저장 종가를 오늘 날짜로 잇는다 (거래가 없던 종목) */
async function carryForward(db, ymd, codes) {
  if (!codes.length) return;
  await db.prepare(
    `INSERT OR IGNORE INTO closes (code, date, close)
     SELECT c.code, ?, c.close FROM closes c
     JOIN (SELECT code, MAX(date) AS d FROM closes WHERE date < ? AND code IN (${codes.map(() => '?').join(',')}) GROUP BY code) m
       ON m.code = c.code AND m.d = c.date`
  ).bind(ymd, ymd, ...codes).run();
}

/** 20:00 이후 — 보유 종목 중 오늘 종가가 없는 것을 채운다 (한 번에 15종목, 20:05 까지) */
async function backfillCloses(db, season, now) {
  const t = E.kstNow(now);
  const todo = ((await db.prepare(
    `SELECT DISTINCT code FROM positions WHERE season_id=? AND code NOT IN (SELECT code FROM closes WHERE date=?) LIMIT 15`
  ).bind(season.id, t.ymd).all()).results || []).map((r) => r.code);
  if (!todo.length) return;
  const got = [], none = [];
  await Promise.all(todo.map(async (code) => {
    try {
      const bars = (await naver.getOhlc(code, '1m', { start: `${t.ymd}0900`, end: `${t.ymd}1531` }))
        .filter((b) => String(b.t).slice(0, 8) === t.ymd && String(b.t).slice(8, 12) <= '1530');
      if (bars.length) got.push({ code, close: Math.round(bars[bars.length - 1].c) }); else none.push(code);
    } catch (e) { /* 다음 분에 */ }
  }));
  if (got.length) await db.prepare(
    `INSERT OR IGNORE INTO closes (code, date, close) SELECT json_extract(value, '$.code'), ?, json_extract(value, '$.close') FROM json_each(?)`
  ).bind(t.ymd, JSON.stringify(got)).run();
  await carryForward(db, t.ymd, none);
}
