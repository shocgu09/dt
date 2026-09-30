// DT 모의투자 — API 라우트 + 크론
// dt-stock 워커가 인증(서명 검증)을 끝낸 뒤 /api/mock/* 를 이리로 넘긴다.
// 장부(D1: env.MOCK_DB)는 여기서만 읽고 쓴다.

import { naver } from '../providers/naver.js';
import { buildMetrics } from './review.js';
import * as H from './holidays.js';
import { profileOf } from '../lib/profile.js';
import * as E from './engine.js';
import * as C from './corp.js';
import * as N from './nick.js';
import * as K from './credit.js';
import * as S from './settle.js';

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
 *  - closingYmd: 시즌 마지막 날 15:30 이후. 그날은 시간외 주문을 받지 않고 최종 순위를 15:30 종가로 매기므로,
 *    평가도 그 종가로 멈춘다. 예전에는 20:00 까지 애프터마켓 가격으로 순위가 움직이다가 확정 순위와 달라졌다.
 *    크론이 받아 둔 그날 종가를 먼저 쓰고, 아직 없으면 KRX 가격(16:00 KRX 애프터마켓 전까지는 종가)을 쓴다.
 */
async function pricer(db, codes, now, official, asOfYmd, closingYmd) {
  const t = E.kstNow(now);
  const live = !official && !closingYmd && E.isTradingDay(t) && t.hm >= E.PRE_FROM && t.hm < E.AFTER_TO;
  const quotes = codes.length ? await quotesFor(codes) : {};
  const closes = {};
  const finals = {};
  if (closingYmd && codes.length) {
    // 종가는 보유 종목만 저장하므로 그날 것을 통째로 읽어도 작다 (IN (...) 은 바인딩 100개 한도에 걸린다)
    const rows = (await db.prepare(`SELECT code, close FROM closes WHERE date=?`).bind(closingYmd).all()).results || [];
    for (const r of rows) finals[r.code] = r.close;
  }
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
    live, closing: !!closingYmd, quotes,
    priceOf: (code) => {
      if (official && closes[code] != null) return closes[code];
      if (finals[code] != null) return finals[code];
      const q = quotes[code];
      const krx = q && q.krx ? q.krx.price : null;
      const p = q ? (closingYmd && krx != null ? krx : (q.price != null ? q.price : krx)) : null;
      return p != null ? p : (closes[code] != null ? closes[code] : null);
    }
  };
}

/** 종료일이 지났는데 아직 마감되지 않았으면(마감 크론 실패) 그 종료일(YYYYMMDD) — 평가를 그날 종가로 멈춘다.
 *  마지막 날 당일은 20:00 까지 애프터마켓 가격으로 평가가 움직이고, 20:00 크론이 그 값으로 최종 순위를 확정한다. */
function closingYmd(season, now) {
  const t = E.kstNow(now);
  const after = t.iso > season.end_date;
  return after ? season.end_date.replace(/-/g, '') : null;
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

// ── 랭킹 탭 "계좌 공유" ──
const SHARE_DAILY_MAX = 3;          // 회원당 하루 공유 (지운 것도 센다 — 지웠다 다시 올려 제한을 피하지 못하게)
const SHARE_GAP_MS = 60000;         // 연달아 공유 간격
const POST_BODY_MAX = 2000;         // 커뮤니티 글 본문 (계좌 공유 글도 같다)
const POST_DAILY_MAX = 20;          // 일반 글(사진·글만) 하루 — 도배 방지용
const POST_GAP_MS = 30000;
const IMG_MAX = 4;                  // 글 하나에 사진
const IMG_BYTES_MAX = 1200000;      // 사진 한 장 (화면이 1280px JPEG 로 줄여 보낸다 — 보통 150~400KB)
const SHARE_PAGE = 20;
const SHARE_POS_MAX = 10;           // 카드에 넣는 보유 종목 수 (평가금액 상위) — 나머지는 개수만 (holdings)
const COMMENT_DAILY_MAX = 50;
const COMMENT_BODY_MAX = 300;
const round2 = (v) => Math.round(v * 100) / 100;

/** 글·댓글 본문 — 제어문자·과한 빈 줄을 정리한다. 길이는 자르지 않고 거절한다 (화면이 이미 막는다) */
function cleanText(v, max, label) {
  const t = String(v == null ? '' : v).replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > max) throw new HttpError(400, `${label}은 ${max}자까지 쓸 수 있습니다`);
  return t;
}
/** uid 는 내보내지 않는다 — 순위표와 같은 원칙. 대신 내 글인지·지울 수 있는지만 알려 준다 */
const publicShare = (r, uid, isAdmin, nicks) => ({
  id: r.id, nickname: (nicks && nicks.get(r.uid)) || '회원', ...(isAdmin ? { realName: r.nickname } : {}), kind: r.kind, code: r.code || null, card: JSON.parse(r.card),
  body: r.body, images: JSON.parse(r.images || '[]'), commentCount: r.comment_count, createdAt: r.created_at,
  mine: r.uid === uid, canDelete: r.uid === uid || isAdmin
});
/** 사진 — JPEG data URL 만 받는다 (SVG·HTML 등은 형식에서 걸러진다). base64 그대로 저장한다 */
function decodeImages(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, '사진 형식이 올바르지 않습니다');
  if (list.length > IMG_MAX) throw new HttpError(400, `사진은 ${IMG_MAX}장까지 올릴 수 있습니다`);
  return list.map((u) => {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(u || ''));
    if (!m) throw new HttpError(400, '사진 형식이 올바르지 않습니다');
    const b64 = m[1];
    const size = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    if (size > IMG_BYTES_MAX) throw new HttpError(400, '사진 용량이 너무 큽니다');
    const head = atob(b64.slice(0, 8));
    if (head.charCodeAt(0) !== 0xff || head.charCodeAt(1) !== 0xd8 || head.charCodeAt(2) !== 0xff) throw new HttpError(400, '사진 형식이 올바르지 않습니다');
    return { data: b64, size };
  });
}
const publicComment = (c, uid, isAdmin, nicks) => ({
  id: c.id, nickname: (nicks && nicks.get(c.uid)) || '회원', ...(isAdmin ? { realName: c.nickname } : {}), body: c.body, createdAt: c.created_at,
  mine: c.uid === uid, canDelete: c.uid === uid || isAdmin
});

const publicOrder = (o) => o && ({
  id: o.id, code: o.code, name: o.name, side: o.side, type: o.type, qty: o.qty, limitPrice: o.limit_price,
  filledQty: o.filled_qty, status: o.status, reason: o.reason, acceptedAt: o.accepted_at, updatedAt: o.updated_at,
  origOrderId: o.orig_order_id || null,
  credit: o.credit || null, lotId: o.lot_id || null, forced: o.forced || null, marginRate: o.margin_rate != null ? o.margin_rate : null
});

// ③ 회원 보유 현황 — 이 인원 미만이면 숫자를 보여 주지 않는다 (개인이 특정되지 않게)
const CROWD_MIN = 3;
const round1 = (v) => Math.round(v * 10) / 10;
const kstDayStart = (now) => { const t = E.kstNow(now); return Date.UTC(+t.ymd.slice(0, 4), +t.ymd.slice(4, 6) - 1, +t.ymd.slice(6, 8)) - 9 * 3600e3; };

/* AI 계좌 평가 하루 횟수. 0 이면 무제한 — 유료 API 를 부르므로 풀어 두지 않는다.
 * (2026-09-23 테스트 기간에 0 으로 풀었다가 2026-09-29 3 으로 되돌렸다) */
const REVIEW_DAILY_MAX = 3;

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
    // 종목 증거금률·신용 가능 여부 — 주문창이 주문가능금액·수량을 계산한다 (접수 때 서버가 다시 계산한다)
    const q = (await quotesFor([code]).catch(() => ({})))[code] || null;
    const terms = K.stockTerms(kind, (q && q.name) || url.searchParams.get('name'), q);
    return { code, kind, taxFree: kind === 'etf' || kind === 'etn', marginRate: terms.marginRate, creditOk: terms.creditOk, creditReason: terms.reason };
  }

  if (path === '/hall' && method === 'GET') {
    const rows = (await db.prepare(
      `SELECT f.season_id, s.name AS season_name, s.start_date, s.end_date, f.rank, f.uid, f.nickname, f.equity, f.fills, s.seed, COALESCE(f.principal, s.seed) AS principal
       FROM final_rankings f JOIN seasons s ON s.id = f.season_id
       WHERE f.rank <= 10 ORDER BY s.end_date DESC, f.rank ASC`
    ).all()).results || [];
    // 저장된 이름은 그때의 실명이다 — 지난 시즌도 지금 닉네임으로 보여 준다
    const nicks = await N.nicksFor(db, rows.map((r) => r.uid));
    // 시즌별 참가자 수와 내 최종 순위 — 1~3위 밖이어도 '5위 / 7명'처럼 볼 수 있게 (내 것만, 남의 순위는 top 10 까지만)
    const [cnt, mine] = await db.batch([
      db.prepare(`SELECT season_id, COUNT(*) AS n FROM final_rankings GROUP BY season_id`),
      db.prepare(`SELECT f.season_id, f.rank, f.equity, COALESCE(f.principal, s.seed) AS principal FROM final_rankings f JOIN seasons s ON s.id = f.season_id WHERE f.uid=?`).bind(uid)
    ]);
    const seasons = {};
    for (const c of cnt.results || []) seasons[c.season_id] = { participants: c.n, me: null };
    for (const m of mine.results || []) if (seasons[m.season_id]) seasons[m.season_id].me = { rank: m.rank, equity: m.equity, principal: m.principal };
    return {
      items: rows.map(({ uid: u, nickname, ...r }) => ({ ...r, nickname: nicks.get(u) || '회원', me: u === uid, ...(isAdmin ? { realName: nickname } : {}) })),
      seasons
    };
  }

  /* ── 닉네임 — 참가하지 않은 회원도 (커뮤니티 댓글에 쓰인다) ── */
  if (path === '/nickname' && method === 'GET') {
    return N.nickView(await N.myNick(db, uid), now);
  }
  // 시황 댓글(Firestore)처럼 다른 곳에 저장된 글의 작성자 닉네임 — 화면이 이미 아는 uid 로만 묻는다
  if (path === '/nicknames' && method === 'POST') {
    const input = await body();
    const uids = (Array.isArray(input.uids) ? input.uids : [])
      .filter((u) => typeof u === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(u)).slice(0, 300);
    return { nicks: Object.fromEntries(await N.nicksFor(db, uids)) };
  }
  if (path === '/nickname' && method === 'POST') {
    const input = await body();
    const r = await N.setNick(db, uid, input.nick, now);
    if (r.error) throw new HttpError(r.status, r.error, r.code);
    return N.nickView(r, now);
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
        seed: season.seed, feeRate: season.fee_rate, taxRate: season.tax_rate, notice: season.notice || '',
        creditMode: season.credit_mode || 'off', creditOn: E.creditOn(season, isAdmin)
      },
      next, joined: !!account, participants: count ? count.n : 0, isAdmin, ...sessionInfo(now)
    };
  }
  /* ── 계좌 공유: 읽기·댓글·삭제 — 시즌에 참가하지 않은 회원도 읽고 댓글을 달 수 있다 ──
   * 공유하기(POST /shares)만 참가자 전용이라 아래 계좌 확인 뒤에 있다. */
  if (path === '/shares' && method === 'GET') {
    // 시즌 고르기 — 지난 시즌 글도 읽을 수 있다 (댓글은 아래 POST 에서 진행 중인 시즌만 받는다).
    // 고르지 않으면 진행 중인 시즌, 없으면(시즌 사이) 가장 최근에 끝난 시즌
    const list = (await db.prepare(
      `SELECT id, name, status FROM seasons WHERE status IN ('active','closed') ORDER BY start_date DESC LIMIT 12`
    ).all()).results || [];
    const want = String(url.searchParams.get('season') || '');
    const pick = list.find((x) => x.id === want) || (season && list.find((x) => x.id === season.id)) || list.find((x) => x.status === 'closed');
    const seasons = list.map((x) => ({ id: x.id, name: x.name, closed: x.status !== 'active' }));
    if (!pick) return { season: null, seasons, items: [], next: null };
    // 다음 페이지 기준은 (시각, id) — 같은 밀리초에 두 건이 들어와도 경계에서 빠지지 않게
    const cur = String(url.searchParams.get('before') || '');
    const mm = /^(\d{1,15})_([0-9a-f-]{36})$/i.exec(cur);
    const bAt = mm ? Number(mm[1]) : now + 1, bId = mm ? mm[2] : 'ffffffff';
    const rows = (await db.prepare(
      `SELECT * FROM shares WHERE season_id=? AND deleted_at IS NULL AND (created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC LIMIT ?`
    ).bind(pick.id, bAt, bAt, bId, SHARE_PAGE).all()).results || [];
    const last = rows[rows.length - 1];
    const nicks = await N.nicksFor(db, rows.map((r) => r.uid));
    return {
      season: { id: pick.id, name: pick.name, closed: pick.status !== 'active' },
      seasons,
      items: rows.map((r) => publicShare(r, uid, isAdmin, nicks)),
      next: rows.length === SHARE_PAGE ? `${last.created_at}_${last.id}` : null
    };
  }
  /* ── 커뮤니티 글쓰기 ─────────────────────────────────────────
   * kind: text(일반 글 — 회원 누구나) · account/stock(계좌 공유 — 시즌 참가자, 하루 3번)
   * 계좌 카드 숫자는 여기서 장부를 읽어 계산한다 — 화면이 보낸 숫자는 쓰지 않는다.
   * 가격 기준은 계좌 화면·순위표와 같은 pricer(장중 시세, 시즌 마지막 날 장 마감 뒤에는 15:30 종가).
   */
  if (path === '/shares' && method === 'POST') {
    if (!season) throw new HttpError(409, '진행 중인 시즌이 없습니다', 'no_season');
    const input = await body();
    const kind = input.kind === 'account' || input.kind === 'stock' ? input.kind : 'text';
    const isShare = kind !== 'text';
    const text = cleanText(input.body, POST_BODY_MAX, '글');
    const images = decodeImages(input.images);
    if (!isShare && !text && !images.length) throw new HttpError(400, '내용을 입력하거나 사진을 올려 주세요');
    if (kind === 'stock' && !isCode(input.code)) throw new HttpError(400, '종목코드가 올바르지 않습니다');

    // 계좌 공유와 일반 글은 한도를 따로 센다 (지운 글도 센다)
    const kinds = isShare ? `kind IN ('account','stock')` : `kind = 'text'`;
    const [cnt, last] = await db.batch([
      db.prepare(`SELECT COUNT(*) AS n FROM shares WHERE uid=? AND ${kinds} AND created_at >= ?`).bind(uid, kstDayStart(now)),
      db.prepare(`SELECT MAX(created_at) AS at FROM shares WHERE uid=? AND ${kinds}`).bind(uid)
    ]);
    const used = (cnt.results[0] || {}).n || 0, lastAt = (last.results[0] || {}).at;
    if (isShare && used >= SHARE_DAILY_MAX) throw new HttpError(429, `계좌 공유는 하루 ${SHARE_DAILY_MAX}번까지 할 수 있습니다`, 'quota');
    if (!isShare && used >= POST_DAILY_MAX) throw new HttpError(429, `글은 하루 ${POST_DAILY_MAX}개까지 올릴 수 있습니다`, 'quota');
    if (lastAt && now - lastAt < (isShare ? SHARE_GAP_MS : POST_GAP_MS)) {
      throw new HttpError(429, isShare ? '방금 계좌를 공유했습니다. 1분 뒤에 다시 시도하세요' : '방금 글을 올렸습니다. 잠시 뒤에 다시 시도하세요', 'cooldown');
    }

    let nick = profile.name || '회원';
    let card = { v: 1, kind: 'text', seasonName: season.name, at: now };
    if (isShare) {
      const account = await E.getAccount(db, season.id, uid);
      if (!account) throw new HttpError(409, '시즌에 참가하면 계좌를 공유할 수 있습니다', 'not_joined');
      if (account.status !== 'active') throw new HttpError(403, '이용이 제한된 계정입니다');
      nick = profile.name || account.nickname;
      const [view, board] = await Promise.all([accountView(db, season, account, now, isAdmin), liveBoard(db, season, now).catch(() => null)]);
      const me = board ? board.rows.find((r) => r.uid === uid) : null;
      const pos = (p) => ({
        code: p.code, name: p.name, qty: p.qty, avgPrice: p.avgPrice, price: p.price,
        value: p.value, pnl: p.pnl, pnlRate: round2(p.pnlRate), ...(p.lot ? { lot: p.lot } : {})
      });
      const base = { v: 1, kind, seasonName: season.name, at: now, live: view.live, closing: view.closing };
      if (kind === 'account') {
        // 신용·담보 잔고도 보유 종목으로 싣는다 (구분 표시). 빚은 따로 — 순자산이 빌린 돈을 뺀 값임을 카드에서도 알 수 있게
        const list = view.positions.concat(view.credit.lots.filter((l) => l.qty > 0).map((l) => ({ ...l, lot: l.kind })))
          .sort((x, y) => y.value - x.value);
        card = {
          ...base, seed: season.seed, principal: view.principal, equity: view.equity, pnl: view.equity - view.principal, returnRate: round2(view.returnRate),
          cash: view.cash, stock: view.stock, realizedPnl: view.realizedPnl, debt: view.credit.debt,
          rank: me ? me.rank : null, participants: board ? board.rows.length : null,
          holdings: list.length, positions: list.slice(0, SHARE_POS_MAX).map(pos)
        };
      } else {
        const lotP = view.credit.lots.find((x) => x.code === input.code && x.qty > 0);
        const p = view.positions.find((x) => x.code === input.code) || (lotP ? { ...lotP, lot: lotP.kind } : null);
        if (!p) throw new HttpError(409, '보유 중인 종목만 공유할 수 있습니다', 'no_position');
        card = { ...base, position: pos(p) };
      }
    }
    const id = crypto.randomUUID();
    const imgIds = images.map(() => crypto.randomUUID());
    const row = { id, season_id: season.id, uid, nickname: nick, kind, code: kind === 'stock' ? input.code : null,
      card: JSON.stringify(card), body: text, images: JSON.stringify(imgIds), comment_count: 0, created_at: now };
    await db.batch([
      db.prepare(`INSERT INTO shares (id, season_id, uid, nickname, kind, code, card, body, images, comment_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?)`)
        .bind(row.id, row.season_id, row.uid, row.nickname, row.kind, row.code, row.card, row.body, row.images, row.created_at),
      ...images.map((im, i) => db.prepare(`INSERT INTO share_images (id, share_id, uid, data, size, created_at) VALUES (?,?,?,?,?,?)`)
        .bind(imgIds[i], id, uid, im.data, im.size, now))
    ]);
    return { share: publicShare(row, uid, isAdmin, await N.nicksFor(db, [uid])), left: (isShare ? SHARE_DAILY_MAX : POST_DAILY_MAX) - (used + 1) };
  }
  /* 사진 — 회원만 (토큰 필요). 지운 글의 사진은 내보내지 않는다. id 가 바뀌지 않으므로 오래 캐시한다 */
  const im = /^\/share-images\/([0-9a-f-]{36})$/i.exec(path);
  if (im && method === 'GET') {
    const r = await db.prepare(
      `SELECT i.data FROM share_images i JOIN shares s ON s.id = i.share_id WHERE i.id=? AND s.deleted_at IS NULL`
    ).bind(im[1]).first();
    if (!r) throw new HttpError(404, '사진을 찾을 수 없습니다', 'gone');
    const bin = atob(r.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: {
      'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff'
    } });
  }
  const sm = /^\/shares\/([0-9a-f-]{36})(?:\/comments(?:\/([0-9a-f-]{36}))?)?$/i.exec(path);
  if (sm) {
    const share = await db.prepare(`SELECT * FROM shares WHERE id=?`).bind(sm[1]).first();
    if (!share || share.deleted_at) throw new HttpError(404, '삭제된 공유입니다', 'gone');
    const withComments = path.includes('/comments');
    const countSql = `UPDATE shares SET comment_count = (SELECT COUNT(*) FROM share_comments WHERE share_id=? AND deleted_at IS NULL) WHERE id=?`;

    if (!withComments && method === 'DELETE') {
      if (share.uid !== uid && !isAdmin) throw new HttpError(403, '내 공유만 삭제할 수 있습니다');
      const stmts = [
        db.prepare(`UPDATE shares SET deleted_at=? WHERE id=?`).bind(now, share.id),
        db.prepare(`UPDATE share_comments SET deleted_at=? WHERE share_id=? AND deleted_at IS NULL`).bind(now, share.id)
      ];
      if (share.uid !== uid) stmts.push(db.prepare(`INSERT INTO audit_log (at, actor, action, detail) VALUES (?,?,?,?)`)
        .bind(now, uid, 'share.delete', JSON.stringify({ id: share.id, author: share.nickname })));
      await db.batch(stmts);
      return { ok: true };
    }
    if (withComments && !sm[2] && method === 'GET') {
      const rows = (await db.prepare(
        `SELECT * FROM share_comments WHERE share_id=? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC LIMIT 300`
      ).bind(share.id).all()).results || [];
      const nicks = await N.nicksFor(db, rows.map((c) => c.uid));
      return { items: rows.map((c) => publicComment(c, uid, isAdmin, nicks)) };
    }
    if (withComments && !sm[2] && method === 'POST') {
      // 지난 시즌 공유는 목록에서 빠진다 — 그 공유에 댓글이 새로 쌓이지 않게 한다
      if (!season || share.season_id !== season.id) throw new HttpError(409, '지난 시즌 공유에는 댓글을 달 수 없습니다', 'closed');
      const input = await body();
      const text = cleanText(input.body, COMMENT_BODY_MAX, '댓글');
      if (!text) throw new HttpError(400, '댓글 내용을 입력하세요');
      const [cnt, last] = await db.batch([
        db.prepare(`SELECT COUNT(*) AS n FROM share_comments WHERE uid=? AND created_at >= ?`).bind(uid, kstDayStart(now)),
        db.prepare(`SELECT body, created_at FROM share_comments WHERE uid=? ORDER BY created_at DESC LIMIT 1`).bind(uid)
      ]);
      if ((cnt.results[0] || {}).n >= COMMENT_DAILY_MAX) throw new HttpError(429, `댓글은 하루 ${COMMENT_DAILY_MAX}개까지 달 수 있습니다`, 'quota');
      const prev = last.results[0];
      if (prev && prev.body === text && now - prev.created_at < 10 * 60000) throw new HttpError(409, '같은 댓글을 방금 달았습니다', 'dup');
      const id = crypto.randomUUID();
      const nick = profile.name || '회원';
      await db.batch([
        db.prepare(`INSERT INTO share_comments (id, share_id, uid, nickname, body, created_at) VALUES (?,?,?,?,?,?)`)
          .bind(id, share.id, uid, nick, text, now),
        db.prepare(countSql).bind(share.id, share.id)
      ]);
      const count = await db.prepare(`SELECT comment_count AS n FROM shares WHERE id=?`).bind(share.id).first();
      return { comment: publicComment({ id, uid, nickname: nick, body: text, created_at: now }, uid, isAdmin, await N.nicksFor(db, [uid])), commentCount: count ? count.n : null };
    }
    if (withComments && sm[2] && method === 'DELETE') {
      const c = await db.prepare(`SELECT * FROM share_comments WHERE id=? AND share_id=?`).bind(sm[2], share.id).first();
      if (!c || c.deleted_at) throw new HttpError(404, '이미 삭제된 댓글입니다', 'gone');
      if (c.uid !== uid && !isAdmin) throw new HttpError(403, '내 댓글만 삭제할 수 있습니다');
      const stmts = [db.prepare(`UPDATE share_comments SET deleted_at=? WHERE id=?`).bind(now, c.id), db.prepare(countSql).bind(share.id, share.id)];
      if (c.uid !== uid) stmts.push(db.prepare(`INSERT INTO audit_log (at, actor, action, detail) VALUES (?,?,?,?)`)
        .bind(now, uid, 'share.comment.delete', JSON.stringify({ id: c.id, share: share.id, author: c.nickname })));
      await db.batch(stmts);
      const count = await db.prepare(`SELECT comment_count AS n FROM shares WHERE id=?`).bind(share.id).first();
      return { ok: true, commentCount: count ? count.n : null };
    }
    throw new HttpError(405, '지원하지 않는 요청입니다');
  }

  /* ── ③ DT 회원 보유 현황 — 참가하지 않은 회원도 볼 수 있다. 이름·평단·수량은 내보내지 않는다 ── */
  if (path === '/crowd' && method === 'GET') {
    const code = url.searchParams.get('code');
    if (!isCode(code)) throw new HttpError(400, '종목코드가 올바르지 않습니다');
    if (!season) return { season: null };
    return memo(`crowd:${season.id}:${code}`, 60000, async () => {
      const [posRes, dayRes] = await Promise.all([
        // 회원별 보유 — 현금 보유와 신용·담보 잔고를 합친다
        db.prepare(`SELECT SUM(x.qty) AS qty, SUM(x.cost) AS cost FROM (
                       SELECT uid, qty, cost FROM positions WHERE season_id=? AND code=?
                       UNION ALL SELECT uid, qty, cost FROM lots WHERE season_id=? AND code=? AND qty > 0) x
                     JOIN accounts a ON a.season_id=? AND a.uid = x.uid WHERE a.status='active' GROUP BY x.uid`)
          .bind(season.id, code, season.id, code, season.id).all(),
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
        ? `SELECT x.code, MAX(x.name) AS name, COUNT(DISTINCT x.uid) AS count FROM (
             SELECT uid, code, name FROM positions WHERE season_id=?1 UNION ALL SELECT uid, code, name FROM lots WHERE season_id=?1 AND qty > 0) x
           JOIN accounts a ON a.season_id=?1 AND a.uid = x.uid WHERE a.status='active' GROUP BY x.code HAVING count >= ?2 ORDER BY count DESC, x.code LIMIT 10`
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
    const nicks = await N.nicksFor(db, board.rows.map((r) => r.uid));
    return {
      season: { id: season.id, name: season.name, seed: season.seed, endDate: season.end_date },
      asOf: board.asOf, live: board.live, closing: board.closing,
      // uid 는 내보내지 않는다 — 순위표에는 닉네임만 (key 는 갱신 간 순위 변동 표시용 해시). 실명은 관리자에게만
      rows: board.rows.map((r) => ({ key: rowKey(r.uid), rank: r.rank, nickname: nicks.get(r.uid) || '회원',
        ...(isAdmin ? { realName: r.nickname } : {}), equity: r.equity, principal: season.seed + (r.deposits || 0), fills: r.fills, me: r.uid === uid,
        // 신용·담보대출을 쓰는 계좌 — 순자산은 빚을 뺀 값이지만 빌린 돈으로 굴리는 중임을 알 수 있게
        credit: r.debt > 0 || r.cash < 0 })),
      me: me ? { rank: me.rank, equity: me.equity, principal: season.seed + (me.deposits || 0) } : null
    };
  }

  const account = await E.getAccount(db, season.id, uid);
  if (!account) throw new HttpError(409, '시즌 참가 후 이용할 수 있습니다', 'not_joined');
  if (account.status !== 'active') throw new HttpError(403, '이용이 제한된 계정입니다');
  // 개명했으면 저장된 실명도 맞춘다 (화면에는 닉네임이 나가고, 실명은 관리자 확인용)
  if (profile.name && profile.name !== account.nickname) {
    await db.prepare(`UPDATE accounts SET nickname=? WHERE season_id=? AND uid=?`).bind(profile.name, season.id, uid).run();
  }

  /* ── 출석 보상 — 거래일 하루 1번 ATTEND_AMOUNT, ATTEND_EVERY 일 연속마다 ATTEND_BONUS 를 더 준다 ── */
  if (path === '/attendance' && method === 'GET') return attendanceInfo(db, season, uid, now);
  if (path === '/attendance' && method === 'POST') {
    const t = E.kstNow(now);
    if (!E.isTradingDay(t)) throw new HttpError(409, '오늘은 휴장일이라 출석 보상이 없습니다', 'holiday');
    if (t.iso < season.start_date || t.iso > season.end_date) throw new HttpError(409, '시즌 기간이 아닙니다', 'season');
    const last = await db.prepare(`SELECT ymd, streak FROM attendance WHERE season_id=? AND uid=? ORDER BY ymd DESC LIMIT 1`).bind(season.id, uid).first();
    if (last && last.ymd === t.ymd) throw new HttpError(409, '오늘은 이미 출석했습니다', 'done');
    // 연속 — 직전 거래일에 출석했으면 이어진다 (주말·휴장일은 끊지 않는다)
    const streak = last && last.ymd === prevTradingYmd(t.ymd) ? last.streak + 1 : 1;
    const bonus = streak % ATTEND_EVERY === 0 ? ATTEND_BONUS : 0;
    const total = ATTEND_AMOUNT + bonus;
    try {
      await db.batch([
        db.prepare(`INSERT INTO attendance (season_id, uid, ymd, amount, bonus, streak, at) VALUES (?,?,?,?,?,?,?)`)
          .bind(season.id, uid, t.ymd, ATTEND_AMOUNT, bonus, streak, now),
        // 입금 — 미수(cash_short)가 있으면 먼저 갚는다
        db.prepare(`UPDATE accounts SET ${K.SQL_CREDIT}, deposits = deposits + ? WHERE season_id=? AND uid=? AND status='active'`)
          .bind(total, total, total, season.id, uid)
      ]);
    } catch (e) {
      // 같은 순간 두 번 눌렀다 — PK 가 막고 batch 전체가 되돌려진다
      if (/UNIQUE|PRIMARY/i.test(String(e && e.message))) throw new HttpError(409, '오늘은 이미 출석했습니다', 'done');
      throw e;
    }
    mem.delete(`lb:${season.id}`);
    return { ...(await attendanceInfo(db, season, uid, now)), paid: { amount: ATTEND_AMOUNT, bonus, streak } };
  }

  if (path === '/account' && method === 'GET') {
    const [view, board, corpActions] = await Promise.all([
      // 순위표는 시즌 전체 보유 종목 시세가 필요해 실패할 일이 더 많다 — 실패해도 계좌는 보여 주고 순위만 비운다
      accountView(db, season, account, now, isAdmin), liveBoard(db, season, now).catch(() => null), C.accountActions(db, season, uid, now)
    ]);
    if (!board) return { ...view, rank: null, participants: null, corpActions };
    // 순위표는 10초 캐시라 방금 계산한 내 자산과 어긋날 수 있다 — 내 줄만 방금 값으로 바꿔 순위를 다시 매긴다.
    // 안 그러면 '내 자산'은 새 시세인데 순위는 몇 초 전 자산 기준이라, 순위가 바뀌는 순간 둘이 맞지 않았다
    const rows = board.rows.filter((r) => r.uid !== uid)
      .concat({ uid, equity: view.equity, joined_at: account.joined_at })
      .sort((a, b) => (b.equity - a.equity) || (a.joined_at - b.joined_at));
    return { ...view, rank: rows.findIndex((r) => r.uid === uid) + 1, participants: rows.length, corpActions };
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
      const terms = K.stockTerms(kind, quote && quote.name, quote);
      const order = await E.acceptOrder(db, season, account, input, quote, kind === 'etf' || kind === 'etn', now, { terms, isAdmin });
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
    // 체결 알림에 쓸 평균 체결가 — 크론이 체결했거나 여러 번에 나눠 체결됐으면 위 fill 만으로는 가격을 알 수 없다
    let fillAvg = null, fillCount = 0;
    if (order.filled_qty > 0 && order.status !== 'open' && order.status !== 'partial') {
      const s = await db.prepare(`SELECT COUNT(*) AS n, SUM(qty) AS q, SUM(qty * price) AS amt FROM fills WHERE order_id=? AND uid=?`).bind(order.id, uid).first();
      if (s && s.q > 0) { fillAvg = Math.round(s.amt / s.q); fillCount = s.n; }
    }
    return { order: publicOrder(order), fill, fillAvg, fillCount };
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
      const r = await E.amendOrder(db, season, account, am[1], input, quote, kind === 'etf' || kind === 'etn', now,
        { terms: K.stockTerms(kind, quote && quote.name, quote), isAdmin });
      return { order: publicOrder(r.order), replaced: r.replaced };
    } catch (e) {
      if (e instanceof E.OrderError) throw new HttpError(422, e.message, e.code);
      throw e;
    }
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
    // taxFree — 매도 세금 0원이 ETF·ETN 면제인지, 소액이라 원 미만이 버려진 것인지 화면이 가를 수 있게
    const rows = (await db.prepare(
      `SELECT f.id, f.code, f.name, f.side, f.qty, f.price, f.fee, f.tax, f.at, COALESCE(o.tax_free, 0) AS tax_free,
              f.settle_ymd, f.cash_delta, f.loan, f.interest, f.forced, o.credit, CASE WHEN f.lot_id IS NULL THEN 0 ELSE 1 END AS lot,
              (SELECT kind FROM lots WHERE id = f.lot_id) AS lot_kind
       FROM fills f LEFT JOIN orders o ON o.id = f.order_id
       WHERE f.season_id=? AND f.uid=? AND (f.at < ? OR (f.at = ? AND f.id < ?)) ORDER BY f.at DESC, f.id DESC LIMIT 50`
    ).bind(season.id, uid, bAt, bAt, bId).all()).results || [];
    const last = rows[rows.length - 1];
    const items = rows.map(({ tax_free, settle_ymd, cash_delta, lot_kind, lot, ...r }) => ({
      ...r, taxFree: !!tax_free, settleYmd: settle_ymd || null, cashDelta: cash_delta, lotKind: lot ? lot_kind : null
    }));
    return { items, next: rows.length === 50 ? `${last.at}_${last.id}` : null };
  }

  /* ── 결제·신용 ────────────────────────────────────────────
   * 계좌 증거금률 설정 · 증권담보대출 · 신용/담보 현금상환 · 대출·이자 내역 (규칙은 credit.js)
   */
  if (path === '/margin-mode' && method === 'POST') {
    if (!E.creditOn(season, isAdmin)) throw new HttpError(409, '이 시즌에는 미수·신용거래를 이용할 수 없습니다', 'credit_off');
    const input = await body();
    const mode = input.mode === 'spectrum' ? 'spectrum' : input.mode === 'cash' ? 'cash' : null;
    if (!mode) throw new HttpError(400, '증거금률 설정이 올바르지 않습니다');
    // 키움: 07:00~23:30 에 바꿀 수 있고, 바꾼 뒤의 새 주문부터 적용된다 (접수된 주문은 접수 때 증거금률 그대로)
    const hm = E.kstNow(now).hm;
    if (hm < 7 * 60 || hm >= 23 * 60 + 30) throw new HttpError(409, '증거금률은 07:00~23:30 에 바꿀 수 있습니다', 'hours');
    await db.prepare(`UPDATE accounts SET margin_mode=? WHERE season_id=? AND uid=?`).bind(mode, season.id, uid).run();
    return { ok: true, marginMode: mode };
  }

  if (path === '/loans' && method === 'POST') {
    if (!E.creditOn(season, isAdmin)) throw new HttpError(409, '이 시즌에는 증권담보대출을 이용할 수 없습니다', 'credit_off');
    const input = await body();
    const code = input.code, qty = Number(input.qty), amount = Number(input.amount);
    if (!isCode(code)) throw new HttpError(400, '종목코드가 올바르지 않습니다');
    if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, '담보 수량은 1주 이상이어야 합니다');
    if (!Number.isInteger(amount) || amount < K.RULES.loanMin || amount % K.RULES.loanUnit) {
      throw new HttpError(400, `대출 금액은 ${K.RULES.loanMin.toLocaleString()}원 이상, ${K.RULES.loanUnit.toLocaleString()}원 단위입니다`);
    }
    const t = E.kstNow(now);
    if (!E.isTradingDay(t) || t.hm < K.RULES.loanFrom || t.hm >= K.RULES.loanTo) throw new HttpError(409, '증권담보대출은 거래일 08:00~17:30 에 신청할 수 있습니다', 'hours');
    const view = await accountView(db, season, account, now, isAdmin);
    if (view.settle.misu > 0) throw new HttpError(409, '미수금이 있으면 대출을 받을 수 없습니다', 'misu');
    if (view.credit.calls.some((c) => c.kind !== 'misu' && c.status !== 'covered')) throw new HttpError(409, '담보부족·만기 처리 중에는 대출을 받을 수 없습니다', 'call');
    const pos = view.positions.find((p) => p.code === code);
    if (!pos) throw new HttpError(409, '보유 중인 종목만 담보로 잡을 수 있습니다', 'no_position');
    const quote = await naver.getQuote(code).catch(() => null);
    const kind = await kindOf(code, quote && quote.name);
    const terms = K.stockTerms(kind, quote && quote.name, quote);
    // 키움 증권담보대출 대상은 코스피·코스닥 주권 — ETF·ETN 과 증거금 100% 종목은 뺀다
    if (kind !== 'stock' || !terms.creditOk) throw new HttpError(409, terms.reason || '담보로 잡을 수 없는 종목입니다 (주권만 가능)', 'loan_stock');
    const pendingSell = view.openOrders.filter((o) => o.code === code && o.side === 'sell' && !o.lotId).reduce((a, o) => a + (o.qty - o.filledQty), 0);
    const pledgeable = pos.settledQty - pendingSell;
    if (qty > pledgeable) throw new HttpError(409, `담보로 잡을 수 있는 수량은 ${Math.max(0, pledgeable)}주입니다 (결제 전 주식·매도 주문 중인 주식 제외)`, 'qty');
    const prevClose = quote && quote.krx && quote.krx.prevClose;
    if (!prevClose) throw new HttpError(503, '시세를 확인하지 못했습니다. 잠시 후 다시 시도하세요');
    const limit = Math.floor(qty * prevClose * K.RULES.loanLtv / K.RULES.loanUnit) * K.RULES.loanUnit;
    if (amount > limit) throw new HttpError(409, `대출 가능 금액은 ${limit.toLocaleString()}원입니다 (전일종가 × 담보 ${qty}주 × ${K.RULES.loanLtv * 100}%)`, 'limit');
    if (view.credit.loanPrincipal + amount > K.RULES.loanLimit) throw new HttpError(409, '증권담보대출 한도(10억 원)를 넘습니다', 'loan_limit');

    const lotId = [season.id, uid, 'loan', code, t.ymd].join(':');
    const posRow = await db.prepare(`SELECT qty, cost FROM positions WHERE season_id=? AND uid=? AND code=?`).bind(season.id, uid, code).first();
    if (!posRow || posRow.qty < qty) throw new HttpError(409, '보유 수량이 바뀌었습니다. 다시 시도하세요', 'raced');
    const moved = qty === posRow.qty ? posRow.cost : Math.round(posRow.cost * qty / posRow.qty);
    const cs = K.cashSet(amount);
    try {
      await db.batch([
        db.prepare(`UPDATE positions SET qty = qty - ?, cost = cost - ? WHERE season_id=? AND uid=? AND code=? AND qty=? AND cost=?`)
          .bind(qty, moved, season.id, uid, code, posRow.qty, posRow.cost),
        db.prepare(`UPDATE accounts SET cash = -1 WHERE season_id=? AND uid=? AND NOT EXISTS
                    (SELECT 1 FROM positions WHERE season_id=? AND uid=? AND code=? AND qty=? AND cost=?)`)
          .bind(season.id, uid, season.id, uid, code, posRow.qty - qty, posRow.cost - moved),
        db.prepare(`DELETE FROM positions WHERE season_id=? AND uid=? AND code=? AND qty=0`).bind(season.id, uid, code),
        db.prepare(`INSERT INTO lots (id, season_id, uid, kind, code, name, qty, cost, principal, rate, start_ymd, due_ymd, created_at)
                    VALUES (?,?,?,'loan',?,?,?,?,?,?,?,?,?)
                    ON CONFLICT (season_id, uid, kind, code, start_ymd) DO UPDATE SET
                      qty = qty + excluded.qty, cost = cost + excluded.cost, principal = principal + excluded.principal, closed_at = NULL`)
          .bind(lotId, season.id, uid, code, pos.name, qty, moved, amount, K.RULES.loanRate, t.ymd, K.addCalendarDays(t.ymd, K.RULES.loanTermDays), now),
        db.prepare(`UPDATE accounts SET ${cs.sql} WHERE season_id=? AND uid=?`).bind(...cs.args, season.id, uid),
        db.prepare(`INSERT INTO lot_moves (id, season_id, uid, lot_id, code, dir, qty, cost, at) VALUES (?,?,?,?,?,'in',?,?,?)`)
          .bind(crypto.randomUUID(), season.id, uid, lotId, code, qty, moved, now),
        db.prepare(`INSERT INTO cash_events (id, season_id, uid, kind, amount, lot_id, detail, at) VALUES (?,?,?,'loan_in',?,?,?,?)`)
          .bind(crypto.randomUUID(), season.id, uid, amount, lotId, JSON.stringify({ code, name: pos.name, qty, prevClose }), now)
      ]);
    } catch (e) {
      throw new HttpError(409, '보유 수량이 바뀌었습니다. 다시 시도하세요', 'raced');
    }
    mem.delete(`lb:${season.id}`);
    return { ok: true, amount, qty, lotId };
  }

  const rp = /^\/lots\/([^/]{10,200})\/repay$/.exec(path);
  if (rp && method === 'POST') {
    const lotId = decodeURIComponent(rp[1]);
    const lot = await db.prepare(`SELECT * FROM lots WHERE id=? AND season_id=? AND uid=?`).bind(lotId, season.id, uid).first();
    if (!lot || (lot.qty <= 0 && lot.principal <= 0)) throw new HttpError(404, '상환할 잔고를 찾을 수 없습니다', 'lot');
    const input = await body();
    const t = E.kstNow(now);
    const to = lot.kind === 'credit' ? K.RULES.creditRepayTo : K.RULES.loanRepayTo;
    if (!E.isTradingDay(t) || t.hm < K.RULES.repayFrom || t.hm >= to) {
      throw new HttpError(409, `현금상환은 거래일 08:00~${Math.floor(to / 60)}:${String(to % 60).padStart(2, '0')} 에 할 수 있습니다`, 'hours');
    }
    // 신용은 매수 결제일(D+2)에 융자가 실행된다 — 그 전에는 현금상환할 대출이 없다 (키움: 결제 완료 후 가능)
    if (lot.start_ymd > t.ymd) throw new HttpError(409, `신용 융자는 결제일(${lot.start_ymd.slice(4, 6)}/${lot.start_ymd.slice(6)})에 실행됩니다. 그 뒤에 현금상환할 수 있습니다`, 'not_executed');
    const pending = await db.prepare(`SELECT COALESCE(SUM(qty - filled_qty),0) AS q FROM orders WHERE season_id=? AND uid=? AND lot_id=? AND side='sell' AND status IN ('open','partial')`)
      .bind(season.id, uid, lot.id).first();
    const free = lot.qty - (pending ? pending.q : 0);
    const qty = lot.qty === 0 ? 0 : (input.qty == null ? free : Number(input.qty));
    if (lot.qty > 0 && (!Number.isInteger(qty) || qty <= 0 || qty > free)) throw new HttpError(409, `현금상환할 수 있는 수량은 ${free}주입니다 (매도 주문 중인 수량 제외)`, 'qty');
    const part = lot.qty === 0 ? { principal: lot.principal, interest: K.interestAccrued(lot, t.ymd), paidPart: lot.interest_paid, cost: 0 }
      : K.repayPortion(lot, qty, t.ymd);
    const total = part.principal + part.interest;
    const avail = await E.orderableCash(db, season, account, null, now);
    if (total > avail) throw new HttpError(409, `상환에 ${total.toLocaleString()}원(원금 ${part.principal.toLocaleString()} + 이자 ${part.interest.toLocaleString()})이 필요합니다. 주문가능현금 ${Math.max(0, avail).toLocaleString()}원`, 'cash');
    const cs = K.cashSet(-total);
    const stmts = [
      db.prepare(`UPDATE lots SET qty = qty - ?, cost = cost - ?, principal = principal - ?, interest_paid = interest_paid - ?,
                    closed_at = CASE WHEN principal - ? = 0 THEN ? ELSE NULL END
                  WHERE id=? AND qty=? AND principal=?`).bind(qty, part.cost, part.principal, part.paidPart, part.principal, now, lot.id, lot.qty, lot.principal),
      db.prepare(`UPDATE accounts SET cash = -1 WHERE season_id=? AND uid=? AND NOT EXISTS (SELECT 1 FROM lots WHERE id=? AND qty=? AND principal=?)`)
        .bind(season.id, uid, lot.id, lot.qty - qty, lot.principal - part.principal),
      db.prepare(`UPDATE accounts SET ${cs.sql}, interest_paid = interest_paid + ? WHERE season_id=? AND uid=?`).bind(...cs.args, part.interest, season.id, uid),
      // 상환 뒤 주문가능현금이 음수면 되돌린다 (그 사이 다른 매수가 체결된 경합)
      db.prepare(`UPDATE accounts SET cash = -1 WHERE season_id=? AND uid=? AND (cash - cash_short) + ${E.ORDERABLE_ADJ_SQL}
                    - COALESCE((SELECT SUM(reserved) FROM orders WHERE season_id=? AND uid=? AND side='buy' AND status IN ('open','partial')), 0) < 0`)
        .bind(season.id, uid, season.id, uid, t.ymd, season.id, uid),
      db.prepare(`INSERT INTO cash_events (id, season_id, uid, kind, amount, lot_id, detail, at) VALUES (?,?,?,'repay',?,?,?,?)`)
        .bind(crypto.randomUUID(), season.id, uid, -total, lot.id, JSON.stringify({ code: lot.code, name: lot.name, kind: lot.kind, qty, principal: part.principal, interest: part.interest }), now)
    ];
    if (qty > 0) {
      // 상환한 수량만큼 현금 보유 주식으로 돌아온다
      stmts.push(
        db.prepare(`INSERT INTO positions (season_id, uid, code, name, qty, cost) VALUES (?,?,?,?,?,?)
                    ON CONFLICT (season_id, uid, code) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost`)
          .bind(season.id, uid, lot.code, lot.name, qty, part.cost),
        db.prepare(`INSERT INTO lot_moves (id, season_id, uid, lot_id, code, dir, qty, cost, at) VALUES (?,?,?,?,?,'out',?,?,?)`)
          .bind(crypto.randomUUID(), season.id, uid, lot.id, lot.code, qty, part.cost, now)
      );
    }
    try { await db.batch(stmts); }
    catch (e) { throw new HttpError(409, '잔고나 예수금이 바뀌었습니다. 다시 시도하세요', 'raced'); }
    mem.delete(`lb:${season.id}`);
    return { ok: true, qty, principal: part.principal, interest: part.interest, total };
  }

  if (path === '/ledger' && method === 'GET') {
    const [ev, calls] = await db.batch([
      db.prepare(`SELECT kind, amount, lot_id, detail, at FROM cash_events WHERE season_id=? AND uid=? ORDER BY at DESC LIMIT 60`).bind(season.id, uid),
      db.prepare(`SELECT kind, ymd, amount, ratio, due_ymd, status, detail, updated_at FROM margin_calls WHERE season_id=? AND uid=? ORDER BY ymd DESC, created_at DESC LIMIT 30`).bind(season.id, uid)
    ]);
    const parse = (d) => { try { return d ? JSON.parse(d) : null; } catch (e) { return null; } };
    return {
      events: (ev.results || []).map((r) => ({ kind: r.kind, amount: r.amount, lotId: r.lot_id, detail: parse(r.detail), at: r.at })),
      calls: (calls.results || []).map((c) => ({ kind: c.kind, ymd: c.ymd, amount: c.amount, ratio: c.ratio, dueYmd: c.due_ymd, status: c.status, detail: parse(c.detail), updatedAt: c.updated_at }))
    };
  }

  throw new HttpError(404, 'Not Found');
}

async function accountView(db, season, account, now, isAdmin = false) {
  const uid = account.uid;
  const today = E.kstNow(now).ymd;
  // 현금·보유·미체결·신용 잔고를 한 트랜잭션(batch)으로 읽는다. 따로 읽으면 그 사이 체결이 끼어
  // 체결 전 현금 + 체결 후 보유가 합쳐져 총자산이 매수 금액만큼 부풀 수 있었다
  const [accRes, posRes, ordRes, feeRes, lotRes, setRes, adjRes, callRes, unsetRes] = await db.batch([
    db.prepare(`SELECT * FROM accounts WHERE season_id=? AND uid=?`).bind(season.id, uid),
    db.prepare(`SELECT code, name, qty, cost FROM positions WHERE season_id=? AND uid=? ORDER BY cost DESC`).bind(season.id, uid),
    db.prepare(`SELECT * FROM orders WHERE season_id=? AND uid=? AND status IN ('open','partial') ORDER BY accepted_at DESC`).bind(season.id, uid),
    // 매수 수수료는 매입금액에 넣지 않으므로(원가법) 평가손익·실현손익 어디에도 없다 — 합이 총손익과 맞도록 따로 보여 준다
    db.prepare(`SELECT COALESCE(SUM(fee), 0) AS fee FROM fills WHERE season_id=? AND uid=? AND side='buy'`).bind(season.id, uid),
    db.prepare(`SELECT * FROM lots WHERE season_id=? AND uid=? AND (qty > 0 OR principal > 0) ORDER BY start_ymd, code`).bind(season.id, uid),
    // 결제 전 체결의 결제일별 예수금 증감 — D+0·D+1 예수금 계산
    db.prepare(`SELECT settle_ymd, SUM(cash_delta) AS d FROM fills WHERE season_id=? AND uid=? AND settle_ymd > ? AND cash_delta IS NOT NULL GROUP BY settle_ymd`).bind(season.id, uid, today),
    db.prepare(`SELECT ${E.ORDERABLE_ADJ_SQL} AS adj`).bind(season.id, uid, today),
    db.prepare(`SELECT * FROM margin_calls WHERE season_id=? AND uid=? AND status IN ('open','due','ordered','covered') ORDER BY ymd DESC LIMIT 10`).bind(season.id, uid),
    // 결제 전 현금 매수 수량 — 담보로 잡을 수 없다 (키움: 미결제 종목 대출 불가)
    db.prepare(`SELECT code, SUM(qty) AS q FROM fills WHERE season_id=? AND uid=? AND side='buy' AND lot_id IS NULL AND settle_ymd > ? GROUP BY code`).bind(season.id, uid, today)
  ]);
  const acc = (accRes.results && accRes.results[0]) || account;
  const positions = posRes.results || [], orders = ordRes.results || [], lots = lotRes.results || [];
  const buyFees = (feeRes.results && feeRes.results[0] && feeRes.results[0].fee) || 0;
  const unsettled = {};
  for (const r of unsetRes.results || []) unsettled[r.code] = r.q;
  const px = await pricer(db, positions.map((p) => p.code).concat(lots.map((l) => l.code)), now, false, null, closingYmd(season, now));
  let stock = 0;
  const items = positions.map((p) => {
    const price = px.priceOf(p.code);
    const value = price != null ? price * p.qty : p.cost;
    stock += value;
    const q = px.quotes[p.code];
    return {
      code: p.code, name: p.name, qty: p.qty, avgPrice: Math.round(p.cost / p.qty), cost: p.cost,
      price, value, pnl: value - p.cost, pnlRate: p.cost ? (value - p.cost) / p.cost * 100 : 0,
      changeRate: q ? q.changeRate : null, halted: q ? q.halted : false,
      settledQty: Math.max(0, p.qty - (unsettled[p.code] || 0)),
      prevClose: q && q.krx ? q.krx.prevClose : null
    };
  });
  let creditPrincipal = 0, loanPrincipal = 0, accrued = 0, lotValue = 0;
  const lotItems = lots.map((l) => {
    const price = px.priceOf(l.code);
    const value = l.qty > 0 ? (price != null ? price * l.qty : l.cost) : 0;
    const due = K.interestAccrued(l, today);
    const days = Math.max(0, K.daysBetween(l.start_ymd, today));
    lotValue += value; accrued += due;
    if (l.kind === 'credit') creditPrincipal += l.principal; else loanPrincipal += l.principal;
    const q = px.quotes[l.code];
    return {
      id: l.id, kind: l.kind, code: l.code, name: l.name, qty: l.qty, avgPrice: l.qty ? Math.round(l.cost / l.qty) : 0, cost: l.cost,
      price, value, pnl: value - l.cost, pnlRate: l.cost ? (value - l.cost) / l.cost * 100 : 0,
      changeRate: q ? q.changeRate : null, halted: q ? q.halted : false,
      principal: l.principal, startYmd: l.start_ymd, dueYmd: l.due_ymd, days,
      rate: l.kind === 'credit' ? K.creditRate(Math.max(1, days)) : (l.rate || K.RULES.loanRate),
      accrued: due, interestPaid: l.interest_paid,
      executed: l.start_ymd <= today           // 신용은 매수 결제일에 융자가 실행된다 — 그 전엔 현금상환 불가
    };
  });
  stock += lotValue;
  const reserved = orders.filter((o) => o.side === 'buy').reduce((s, o) => s + o.reserved, 0);
  const net = acc.cash - (acc.cash_short || 0);                           // 예수금(D+2)
  const pend = {};
  for (const r of setRes.results || []) pend[r.settle_ymd] = r.d;
  const d1Ymd = K.addTradingDays(today, 1);
  const after = (ymd) => Object.keys(pend).filter((d) => d > ymd).reduce((s2, d) => s2 + pend[d], 0);
  const d0 = net - after(today), d1 = net - after(d1Ymd);
  const adj = (adjRes.results && adjRes.results[0] && adjRes.results[0].adj) || 0;
  const debt = creditPrincipal + loanPrincipal + accrued;
  const equity = net + stock - debt;
  // 담보비율 (지금 시세 기준 참고값 — 판정은 장 마감 후 종가로 한다): (잔고 평가 + 현금 보유 × 대용비율 + 예수금) ÷ 원금
  const principal0 = creditPrincipal + loanPrincipal;
  const collateral = principal0 > 0
    ? { value: lotValue + Math.floor((stock - lotValue) * K.RULES.substituteRate) + net, debt: principal0 } : null;
  if (collateral) collateral.ratio = collateral.value / collateral.debt * 100;
  // 원금 = 시드 + 출석금. 출석금은 수익이 아니므로 수익률·손익은 원금 기준 (순위는 순자산)
  const deposits = acc.deposits || 0, principal = season.seed + deposits;
  const on = E.creditOn(season, isAdmin);
  return {
    season: { id: season.id, name: season.name, seed: season.seed, endDate: season.end_date, feeRate: season.fee_rate, taxRate: season.tax_rate },
    cash: net, available: net + adj - reserved, reserved, stock, equity, deposits, principal,
    returnRate: (equity - principal) / principal * 100,
    realizedPnl: acc.realized_pnl, buyFees, fills: acc.fills,
    // 결제·신용 — 신용 기능이 꺼진 시즌도 값은 내려준다 (장부에 남은 잔고가 있을 수 있다)
    settle: { d0, d1, d2: net, misu: Math.max(0, -d0), d1Ymd, d2Ymd: K.addTradingDays(today, 2) },
    credit: {
      on, mode: season.credit_mode || 'off', marginMode: acc.margin_mode || 'cash',
      frozenUntil: acc.frozen_until && acc.frozen_until >= today ? acc.frozen_until : null,
      creditPrincipal, loanPrincipal, accrued, debt, interestPaid: acc.interest_paid || 0,
      collateral, lots: lotItems,
      calls: (callRes.results || []).map((c) => ({ kind: c.kind, ymd: c.ymd, amount: c.amount, ratio: c.ratio, dueYmd: c.due_ymd, status: c.status })),
      rules: {
        stockMarginRate: K.RULES.stockMarginRate, creditDepositRate: K.RULES.creditDepositRate, creditTermDays: K.RULES.creditTermDays,
        creditBrackets: K.RULES.creditBrackets.map((b) => ({ upto: isFinite(b.upto) ? b.upto : null, rate: b.rate })),
        loanLtv: K.RULES.loanLtv, loanRate: K.RULES.loanRate, loanTermDays: K.RULES.loanTermDays, loanMin: K.RULES.loanMin, loanUnit: K.RULES.loanUnit,
        maintRatio: K.RULES.maintRatio, misuOverdueRate: K.RULES.misuOverdueRate, forcedFeeRate: K.RULES.forcedFeeRate,
        misuFreezeMin: K.RULES.misuFreezeMin, misuFreezeDays: K.RULES.misuFreezeDays
      }
    },
    positions: items, openOrders: orders.map(publicOrder), live: px.live, closing: px.closing, ...sessionInfo(now)
  };
}

// 출석 보상 — 거래일 하루 1번. 5일 연속마다 보너스 (주말·휴장일은 연속을 끊지 않는다)
const ATTEND_AMOUNT = 100000, ATTEND_BONUS = 200000, ATTEND_EVERY = 5;

/** 직전 거래일 (YYYYMMDD) — 주말·휴장일을 건너뛴다 */
function prevTradingYmd(ymd) {
  let d = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
  for (let i = 0; i < 20; i++) {
    d -= 86400e3;
    const x = new Date(d), y = x.toISOString().slice(0, 10).replace(/-/g, '');
    if (E.isTradingDay({ dow: x.getUTCDay(), ymd: y })) return y;
  }
  return null;
}

/** 내 출석 현황 — 오늘 받았는지, 받을 수 있는지, 연속 일수, 다음 보너스까지 */
async function attendanceInfo(db, season, uid, now) {
  const t = E.kstNow(now);
  const [lastRes, sumRes] = await db.batch([
    db.prepare(`SELECT ymd, streak FROM attendance WHERE season_id=? AND uid=? ORDER BY ymd DESC LIMIT 1`).bind(season.id, uid),
    db.prepare(`SELECT COUNT(*) AS days, COALESCE(SUM(amount + bonus), 0) AS total FROM attendance WHERE season_id=? AND uid=?`).bind(season.id, uid)
  ]);
  const last = lastRes.results && lastRes.results[0];
  const sum = (sumRes.results && sumRes.results[0]) || { days: 0, total: 0 };
  const tradingDay = E.isTradingDay(t);
  const inSeason = t.iso >= season.start_date && t.iso <= season.end_date;
  const today = !!(last && last.ymd === t.ymd);
  // 지금 이어지고 있는 연속 — 오늘 받았으면 오늘까지, 아니면 직전 거래일까지 (그보다 전이면 끊겼다)
  const alive = last && (today || last.ymd === prevTradingYmd(t.ymd) || (!tradingDay && last.ymd >= prevTradingYmd(t.ymd)));
  const streak = alive ? last.streak : 0;
  // 다음 보너스까지 남은 출석 수 (다음 출석을 1로 센다) — 1 이면 다음 출석에 보너스
  const untilBonus = ATTEND_EVERY - (streak % ATTEND_EVERY);
  return {
    amount: ATTEND_AMOUNT, bonus: ATTEND_BONUS, every: ATTEND_EVERY,
    today, canAttend: tradingDay && inSeason && !today, tradingDay, inSeason,
    streak, days: sum.days, total: sum.total,
    untilBonus, bonusToday: !today && untilBonus === 1
  };
}

/** 실시간 순위표 — 10초 동안은 같은 계산을 다시 하지 않는다 (시세는 3초 캐시를 함께 쓴다) */
function liveBoard(db, season, now) {
  return memo(`lb:${season.id}`, 10000, () => leaderboard(db, season, now));
}

async function leaderboard(db, season, now, official, asOfYmd) {
  // 현금과 보유를 한 트랜잭션(batch)으로 읽는다 — 사이에 체결이 끼면 그 회원 자산이 틀린 채 10초 캐시에 올라갔다
  const [accRes, posRes, lotRes] = await db.batch([
    db.prepare(`SELECT uid, nickname, cash, cash_short, fills, joined_at, deposits FROM accounts WHERE season_id=? AND status='active'`).bind(season.id),
    db.prepare(`SELECT uid, code, qty, cost FROM positions WHERE season_id=?`).bind(season.id),
    // 신용·담보 잔고 — 평가에 더하고 원금·이자는 뺀다 (순자산)
    db.prepare(`SELECT uid, kind, code, qty, cost, principal, rate, start_ymd, interest_paid FROM lots WHERE season_id=? AND (qty > 0 OR principal > 0)`).bind(season.id)
  ]);
  const positions = posRes.results || [], lots = lotRes.results || [];
  const px = await pricer(db, positions.map((p) => p.code).concat(lots.map((l) => l.code)), now, official, asOfYmd, official ? null : closingYmd(season, now));
  // 이자는 평가 기준일까지 — 최종 순위(official)는 그 종가 날짜, 평소엔 오늘
  const endYmd = official && asOfYmd ? asOfYmd : E.kstNow(now).ymd;
  return { rows: E.valuate(accRes.results || [], positions, px.priceOf, lots, endYmd), asOf: now, live: px.live, closing: px.closing };
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
        if (existing.status === 'closed') throw new HttpError(409, '종료된 시즌은 수정할 수 없습니다');
        if (b.startDate !== existing.start_date) throw new HttpError(409, '진행 중인 시즌의 시작일은 바꿀 수 없습니다');
        if ((b.seed != null && Number(b.seed) !== existing.seed) || (b.feeRate != null && Number(b.feeRate) !== existing.fee_rate)
            || (b.taxRate != null && Number(b.taxRate) !== existing.tax_rate)) {
          throw new HttpError(409, '진행 중인 시즌의 시드·수수료·세율은 바꿀 수 없습니다');
        }
      }
      // 보내지 않은 값은 기존 값을 유지한다 (화면 폼이 시드·요율을 안 보내도 기본값으로 덮이지 않게)
      // 신용·미수·담보대출 사용 여부(credit_mode)는 진행 중에도 바꿀 수 있다 — 끄면 새 신용매수·대출·미수 매수만 막고
      // 이미 있는 잔고는 그대로 두고 상환·반대매매를 계속한다
      await db.prepare(
        `UPDATE seasons SET name=?, start_date=?, end_date=?, seed=?, fee_rate=?, tax_rate=?, volume_fill=?, notice=?, credit_mode=? WHERE id=?`
      ).bind(String(b.name).slice(0, 40), b.startDate, b.endDate,
        b.seed != null ? Number(b.seed) : existing.seed,
        b.feeRate != null ? Number(b.feeRate) : existing.fee_rate,
        b.taxRate != null ? Number(b.taxRate) : existing.tax_rate,
        b.volumeFill == null ? existing.volume_fill : (b.volumeFill === false ? 0 : 1),
        b.notice != null ? (String(b.notice).slice(0, 1000) || null) : existing.notice,
        ['off', 'admin', 'on'].includes(b.creditMode) ? b.creditMode : (existing.credit_mode || 'off'), b.id).run();
      await log('season.update', b);
      return { ok: true, updated: true };
    }
    // 기본값은 기획안 v2 — 시드 1억, 수수료 0.015%, 매도세 0.20%
    await db.prepare(
      `INSERT INTO seasons (id, name, start_date, end_date, seed, fee_rate, tax_rate, volume_fill, notice, status, credit_mode)
       VALUES (?,?,?,?,?,?,?,?,?, 'upcoming', ?)`
    ).bind(b.id, String(b.name).slice(0, 40), b.startDate, b.endDate, Number(b.seed) || 100000000,
      b.feeRate != null ? Number(b.feeRate) : 0.00015, b.taxRate != null ? Number(b.taxRate) : 0.002,
      b.volumeFill === false ? 0 : 1, String(b.notice || '').slice(0, 1000) || null,
      ['off', 'admin', 'on'].includes(b.creditMode) ? b.creditMode : 'off').run();
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
  // 23:30~ 결제일 정산 (미수·동결·연체이자, 담보비율, 만기) — 키움의 미수 변제 마감 23:30 에 맞춘다
  if (t.hm >= 23 * 60 + 30) { await S.nightly(db, season, now, stats); return; }
  // 08:00~08:59 이자 정기징수(매월 첫 영업일)·반대매매 주문 접수 — 체결 판정보다 먼저 (반대매매는 09:00 시가에 체결)
  if (t.hm >= E.PRE_FROM && t.hm < E.OPEN_AT) {
    await S.morning(db, season, now, stats, { quotesFor, kindOf }).catch((e) => console.error('settle morning failed', e && e.message));
  }
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
  // 시즌 마지막 날 20:00 — 애프터마켓까지 끝난 평가액(마지막 시간외 가격 포함)으로 최종 순위를 확정한다
  if (t.hm >= E.AFTER_TO && t.iso >= season.end_date) await finalizeLastDay(db, season, now);
}

/** 마지막 날 20:00 마감 — 실시간 순위와 같은 평가(시간외 가격 포함)라 20:00 에 보이던 순위가 그대로 최종 순위가 된다.
 *  20:00~20:05 크론이 한 번이라도 돌면 끝난다. 못 돌면 다음 날 finalizeOverdue 가 15:30 종가로 마감한다 */
async function finalizeLastDay(db, season, now) {
  await E.expireStale(db, now);                       // 20:00 에 만료된 애프터마켓 미체결 주문이 현금을 묶고 있지 않게
  const board = await leaderboard(db, season, now);   // official 이 아닌 평가 — 20:00 이후엔 마지막 시간외 가격에서 멈춰 있다
  await db.batch(finalStatements(db, season, board.rows));
  mem.delete(`lb:${season.id}`);
  console.log('season finalized (20:00)', season.id, board.rows.length);
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
  // 주문가능현금의 나머지 한 조각 — 결제 전 증거금 매수의 외상분·미결제주식 매도의 재사용 불가분 (engine.orderableCash 와 같은 식)
  stats.q += 1;
  const adj = {};
  for (const r of ((await db.prepare(
    `SELECT uid, SUM(CASE WHEN side='buy' THEN -cash_delta - margin ELSE -margin END) AS a FROM fills
     WHERE season_id=? AND settle_ymd > ? AND margin IS NOT NULL
       AND uid IN (SELECT DISTINCT uid FROM orders WHERE season_id=? AND status IN ('open','partial')) GROUP BY uid`
  ).bind(season.id, E.kstNow(now).ymd, season.id).all()).results || [])) adj[r.uid] = r.a || 0;

  let filled = 0;
  for (const o of orders) {
    if (stats.q >= FILL_QUERY_BUDGET - 9) break;    // 한 건 더 체결할 여유가 없으면 다음 분으로 넘긴다 (체결 1건 = 최대 9문장)
    const acc = accounts[o.uid];
    if (!quotes[o.code] || !acc) continue;
    const available = (acc.cash - (acc.cash_short || 0)) + (adj[o.uid] || 0) - ((reserved[o.uid] || 0) - (o.side === 'buy' ? o.reserved : 0));
    try {
      const f = await E.tryFill(db, season, o, { quote: quotes[o.code], bars: bars[o.code] || null, account: acc, available, stats }, now);
      if (f) {
        filled++;
        // 읽어 둔 잔고를 이어서 쓴다 — 예수금은 cash 한 칸으로 합쳐 두고(cash_short 0), 외상·재사용 불가분은 adj 로
        acc.cash = (acc.cash - (acc.cash_short || 0)) + f.cashDelta; acc.cash_short = 0;
        adj[o.uid] = (adj[o.uid] || 0) + (f.availDelta - f.cashDelta);
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

  // 신용·담보 잔고 종목도 — 밤 정산의 담보비율이 이 종가로 매겨진다
  const held = ((await db.prepare(`SELECT code FROM positions WHERE season_id=? UNION SELECT code FROM lots WHERE season_id=? AND qty > 0`)
    .bind(season.id, season.id).all()).results || []).map((r) => r.code);
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
  // 최종 순위는 여기서 확정하지 않는다 — 마지막 날도 20:00 애프터마켓까지 매매하고 finalizeLastDay 가 20:00 평가액으로 확정한다
  if (stmts.length) await db.batch(stmts);
  mem.delete(`lb:${season.id}`);
}

/** 최종 순위 확정 + 시즌 종료 — 두 문장 */
function finalStatements(db, season, rows) {
  const out = [];
  if (rows.length) out.push(db.prepare(
    `INSERT OR REPLACE INTO final_rankings (season_id, rank, uid, nickname, equity, fills, principal)
     SELECT ?, json_extract(value, '$.rank'), json_extract(value, '$.uid'), json_extract(value, '$.nickname'),
            json_extract(value, '$.equity'), json_extract(value, '$.fills'), json_extract(value, '$.principal') FROM json_each(?)`
  ).bind(season.id, JSON.stringify(rows.map((r) => ({ rank: r.rank, uid: r.uid, nickname: r.nickname, equity: r.equity, fills: r.fills,
    principal: season.seed + (r.deposits || 0) })))));
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
    `SELECT code FROM (SELECT code FROM positions WHERE season_id=?1 UNION SELECT code FROM lots WHERE season_id=?1 AND qty > 0)
     WHERE code NOT IN (SELECT code FROM closes WHERE date=?2) LIMIT 15`
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
