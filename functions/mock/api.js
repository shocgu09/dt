// DT 모의투자 — API 라우트 + 크론
// dt-stock 워커가 인증(서명 검증)을 끝낸 뒤 /api/mock/* 를 이리로 넘긴다.
// 장부(D1: env.MOCK_DB)는 여기서만 읽고 쓴다.

import { naver } from '../providers/naver.js';
import { profileOf } from '../lib/profile.js';
import * as E from './engine.js';

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

async function todayBars(code, now) {
  const t = E.kstNow(now);
  const p = (n) => String(n).padStart(2, '0');
  const end = `${t.ymd}${p(Math.floor(t.hm / 60))}${p(t.hm % 60)}`;
  return memo(`bars:${code}:${end}`, 20000, () => naver.getOhlc(code, '1m', { start: `${t.ymd}0900`, end }).catch(() => []));
}

/**
 * 평가가
 *  - 평소: 시세 탭에 보이는 것과 같은 현재가 (프리·애프터마켓에는 그 시장의 가격). 시간외에도 거래할 수 있으므로
 *    평가도 시간외 가격을 따라간다. 20:00 이후에는 마지막 시간외 가격에서 멈춘다.
 *  - official: 저장해 둔 15:30 종가 — 일일 스냅샷과 시즌 최종 순위는 KRX 정규장 종가로 확정한다.
 */
async function pricer(db, codes, now, official) {
  const t = E.kstNow(now);
  const live = !official && E.isTradingDay(t) && t.hm >= E.PRE_FROM && t.hm < E.AFTER_TO;
  const quotes = codes.length ? await quotesFor(codes) : {};
  const closes = {};
  if (official && codes.length) {
    const rows = (await db.prepare(
      `SELECT c.code, c.close FROM closes c
       JOIN (SELECT code, MAX(date) AS d FROM closes GROUP BY code) m ON m.code = c.code AND m.d = c.date`
    ).all()).results || [];
    for (const r of rows) closes[r.code] = r.close;
  }
  return {
    live, quotes,
    priceOf: (code) => {
      if (official && closes[code] != null) return closes[code];
      const q = quotes[code];
      if (!q) return null;
      return q.price != null ? q.price : (q.krx ? q.krx.price : null);
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
  filledQty: o.filled_qty, status: o.status, reason: o.reason, acceptedAt: o.accepted_at, updatedAt: o.updated_at
});

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

  const profile = await profileOf(env, uid, token);
  if (profile.transient) throw new HttpError(503, '회원 확인이 지연되고 있습니다. 잠시 후 다시 시도하세요');
  if (!profile.role) throw new HttpError(403, 'DT Club 회원만 이용할 수 있습니다');
  const isAdmin = profile.role === 'admin' || profile.role === 'superadmin';

  // ── 관리자 ──
  if (path.startsWith('/admin/')) {
    if (!isAdmin) throw new HttpError(403, '관리자만 가능합니다');
    return handleAdmin(db, uid, path, method, body, now);
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
    const [view, board] = await Promise.all([accountView(db, season, account, now), liveBoard(db, season, now)]);
    const me = board.rows.find((r) => r.uid === uid);
    return { ...view, rank: me ? me.rank : null, participants: board.rows.length };
  }

  if (path === '/orders' && method === 'POST') {
    const input = await body();
    if (!isCode(input.code)) throw new HttpError(400, '종목코드가 올바르지 않습니다');
    // 주문은 캐시가 아닌 방금 받은 시세로 검증한다
    const quote = await naver.getQuote(input.code).catch(() => null);
    const kind = await kindOf(input.code, quote && quote.name);
    try {
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
      const bars = needBars ? await todayBars(order.code, now) : null;
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

  if (path === '/history' && method === 'GET') {
    const before = Number(url.searchParams.get('before')) || now + 1;
    const rows = (await db.prepare(
      `SELECT id, code, name, side, qty, price, fee, tax, at FROM fills
       WHERE season_id=? AND uid=? AND at < ? ORDER BY at DESC LIMIT 50`
    ).bind(season.id, uid, before).all()).results || [];
    return { items: rows, next: rows.length === 50 ? rows[rows.length - 1].at : null };
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

async function leaderboard(db, season, now, official) {
  const [accRes, posRes] = await Promise.all([
    db.prepare(`SELECT uid, nickname, cash, fills, joined_at FROM accounts WHERE season_id=? AND status='active'`).bind(season.id).all(),
    db.prepare(`SELECT uid, code, qty, cost FROM positions WHERE season_id=?`).bind(season.id).all()
  ]);
  const positions = posRes.results || [];
  const px = await pricer(db, positions.map((p) => p.code), now, official);
  return { rows: E.valuate(accRes.results || [], positions, px.priceOf), asOf: now, live: px.live };
}

// ── 관리자 ────────────────────────────────────────────────────
async function handleAdmin(db, actor, path, method, body, now) {
  const log = (action, detail) => db.prepare(`INSERT INTO audit_log (at, actor, action, detail) VALUES (?,?,?,?)`)
    .bind(now, actor, action, JSON.stringify(detail)).run();

  if (path === '/admin/seasons' && method === 'GET') {
    return { items: (await db.prepare(`SELECT * FROM seasons ORDER BY start_date DESC`).all()).results || [] };
  }
  if (path === '/admin/seasons' && method === 'POST') {
    const b = await body();
    const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    if (!/^[0-9A-Za-z_-]{3,20}$/.test(b.id || '') || !b.name || !okDate(b.startDate) || !okDate(b.endDate) || b.endDate < b.startDate) {
      throw new HttpError(400, '시즌 ID·이름·시작일·종료일을 확인해 주세요');
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

// ── 크론 (평일 08:00~19:59 KST 매분) ──────────────────────────
// 무료 요금제는 호출당 외부 요청이 50건이라 한 번에 처리하는 종목 수를 제한한다.
const MAX_CODES_PER_RUN = 20;

export async function runCron(env, now = Date.now()) {
  const db = env.MOCK_DB;
  if (!db) return;
  const t = E.kstNow(now);
  if (!E.isTradingDay(t)) return;
  const season = await E.activeSeason(db, now);
  await E.expireStale(db, now);
  if (!season) return;

  if (t.hm >= E.PRE_FROM && t.hm < E.AFTER_TO) await fillOpenOrders(db, season, now);
  // 종가 저장·스냅샷은 한 번 끝나면 다시 하지 않는다 (16:30 까지 시도)
  if (t.hm >= 15 * 60 + 40 && t.hm < 16 * 60 + 30) await closeOfDay(db, season, now);
}

async function fillOpenOrders(db, season, now) {
  const orders = (await db.prepare(
    `SELECT * FROM orders WHERE season_id=? AND status IN ('open','partial') ORDER BY accepted_at LIMIT 200`
  ).bind(season.id).all()).results || [];
  if (!orders.length) return;
  // 무료 요금제의 외부 요청 한도 때문에 한 번에 다루는 종목 수를 자르는데, 늘 앞에서만 자르면 뒤 종목의 주문이
  // 영영 굶는다 — 분마다 시작 위치를 돌려 가며 모든 종목이 차례로 판정되게 한다
  const allCodes = Array.from(new Set(orders.map((o) => o.code)));
  const rot = allCodes.length ? Math.floor(now / 60000) % allCodes.length : 0;
  const rotated = allCodes.slice(rot).concat(allCodes.slice(0, rot));
  const codes = rotated.slice(0, MAX_CODES_PER_RUN * 2);
  const quotes = await quotesFor(codes);
  // 지정가·장전 주문이 걸린 종목만 분봉을 받는다 (종목당 외부 요청 1건)
  // 프리마켓 주문은 NXT 라 분봉이 없다 — 시세 폴링만으로 판정한다
  const needBarsSet = new Set(orders.filter((o) => (o.type === 'limit' || o.pre_open) && o.session !== 'pre').map((o) => o.code));
  const needBars = codes.filter((c) => needBarsSet.has(c)).slice(0, MAX_CODES_PER_RUN);
  const bars = {};
  await Promise.all(needBars.map(async (c) => { bars[c] = await todayBars(c, now); }));
  let filled = 0;
  for (const o of orders) {
    if (!quotes[o.code]) continue;
    try { if (await E.tryFill(db, season, o, { quote: quotes[o.code], bars: bars[o.code] || null }, now)) filled++; }
    catch (e) { console.error('fill failed', o.id, e && e.message); }
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
  const todo = held.filter((c) => !have.has(c)).slice(0, MAX_CODES_PER_RUN);
  let tradingDay = have.size > 0 || held.length === 0;
  for (const code of todo) {
    const day = (await naver.getOhlc(code, '1m', { start: `${t.ymd}0900`, end: `${t.ymd}1531` }).catch(() => []))
      .filter((b) => String(b.t).slice(0, 8) === t.ymd && String(b.t).slice(8, 12) <= '1530');
    if (!day.length) continue;                       // 오늘 봉이 없다 — 휴장일이거나 거래정지
    tradingDay = true;
    // 15:30 봉(종가 단일가)이 없으면 그 전 마지막 체결가가 종가다
    await db.prepare(`INSERT OR REPLACE INTO closes (code, date, close) VALUES (?,?,?)`).bind(code, t.ymd, Math.round(day[day.length - 1].c)).run();
    have.add(code);
  }
  // 보유 종목이 없을 때는 대표 종목으로 거래일인지 확인한다
  if (!held.length) {
    const probe = await naver.getOhlc('005930', '1m', { start: `${t.ymd}0900`, end: `${t.ymd}0905` }).catch(() => []);
    tradingDay = probe.some((b) => String(b.t).slice(0, 8) === t.ymd);
  }
  if (!tradingDay) return;
  // 거래정지 등으로 오늘 봉이 없는 종목은 직전 종가로 평가되므로 기다리지 않는다. 남은 종목이 있으면 다음 분에 이어서.
  if (held.filter((c) => !have.has(c)).length > 0 && todo.length === MAX_CODES_PER_RUN) return;

  const board = await leaderboard(db, season, now, true);      // 15:30 종가 기준
  const stmts = board.rows.map((r) => db.prepare(
    `INSERT OR REPLACE INTO daily_snapshots (season_id, uid, date, equity, cash, rank) VALUES (?,?,?,?,?,?)`
  ).bind(season.id, r.uid, t.ymd, r.equity, r.cash, r.rank));
  if (t.iso >= season.end_date) {
    for (const r of board.rows) {
      stmts.push(db.prepare(`INSERT OR REPLACE INTO final_rankings (season_id, rank, uid, nickname, equity, fills) VALUES (?,?,?,?,?,?)`)
        .bind(season.id, r.rank, r.uid, r.nickname, r.equity, r.fills));
    }
    stmts.push(db.prepare(`UPDATE seasons SET status='closed' WHERE id=?`).bind(season.id));
  }
  if (stmts.length) await db.batch(stmts);
  mem.delete(`lb:${season.id}`);
}
