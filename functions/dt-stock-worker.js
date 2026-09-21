// DT 재테크 시세 Worker
// 네이버 증권(무인증)을 프록시 + KV 캐시. 전부 표준 443이라 fetch()로 충분하다.
// Secrets: FIREBASE_PROJECT_ID(vars), 없음(시세 소스에 키 불필요)
// KV: STOCK_KV

import { naver, daum, yahoo } from './providers/naver.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8'
};

// 캐시 TTL(초) — 네이버 권장 폴링이 7초라 그보다 짧게 잡을 이유가 없다
const TTL = { quote: 3, book: 3, index: 15, ohlcIntra: 30, ohlcDay: 43200, search: 86400,
              rank: 60, sectors: 120, news: 300, spark: 60, trend: 600 };

function json(data, status = 200, extra) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...(extra || {}) } });
}
function fail(msg, status = 502) { return json({ error: msg }, status); }

const isCode = (c) => /^\d{6}$/.test(c || '');

// ── KV 캐시 래퍼 ───────────────────────────────────────────────
async function cached(env, key, ttl, produce) {
  if (env.STOCK_KV) {
    const hit = await env.STOCK_KV.get(key, 'json');
    if (hit) return { ...hit, cached: true };
  }
  const fresh = await produce();
  if (env.STOCK_KV) {
    // expirationTtl 최소값이 60초라 그 아래는 KV 대신 짧은 edge 캐시에 의존
    await env.STOCK_KV.put(key, JSON.stringify(fresh), { expirationTtl: Math.max(60, ttl) });
  }
  return fresh;
}

// TTL이 60초 미만인 항목은 KV 대신 워커 인스턴스 메모리로 처리
const mem = new Map();
async function memo(key, ttlSec, produce) {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && now - hit.at < ttlSec * 1000) return { ...hit.v, cached: true };
  const v = await produce();
  mem.set(key, { at: now, v });
  if (mem.size > 500) mem.delete(mem.keys().next().value);
  return v;
}

// ── 장 운영시간 (KST 08:30~16:00 평일) ─────────────────────────
/* 거래가 일어나는 시간대 — 캐시 TTL 을 여기서 가른다.
 * 넥스트레이드(NXT) 출범으로 국내 거래시간이 08:00~20:00 으로 연장됐다.
 *   프리마켓 08:00~08:50 / 메인마켓 09:00~15:20 / 애프터마켓 15:40~20:00
 *   KRX 정규장은 09:00~15:30 유지.
 * 정규장만 잡으면 애프터마켓 동안 캐시가 얼어붙어 시세가 멈춘 것처럼 보인다. */
function marketOpen(d = new Date()) {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const min = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return min >= 8 * 60 && min <= 20 * 60 + 10;
}

function kstStamp(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    ymd: `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}`,
    full: `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}${p(k.getUTCHours())}${p(k.getUTCMinutes())}`
  };
}

// ── Firebase ID 토큰 검증 (폐쇄형 게이트) ──────────────────────
// securetoken 공개키를 JWK로 받아 RS256 서명을 직접 검증한다.
// (x509 PEM은 WebCrypto가 직접 import하지 못하므로 JWK 엔드포인트를 쓴다)
const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let _jwks = { at: 0, byKid: null };

async function jwkFor(kid) {
  if (!_jwks.byKid || Date.now() - _jwks.at > 3600e3) {
    const r = await fetch(JWK_URL);
    if (!r.ok) throw new Error('jwk fetch failed');
    const d = await r.json();
    const byKid = {};
    for (const k of d.keys || []) byKid[k.kid] = k;
    _jwks = { at: Date.now(), byKid };
  }
  return _jwks.byKid[kid] || null;
}

function b64urlToBytes(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function verifyIdToken(token, projectId) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header  = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { return null; }

  // 1) 클레임 검증
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || !header.kid) return null;
  if (!payload.exp || payload.exp <= now) return null;
  if (payload.iat && payload.iat > now + 300) return null;      // 시계 오차 5분 허용
  if (payload.aud !== projectId) return null;
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (!payload.sub) return null;
  // 게스트(익명 로그인) 차단 — 폐쇄형 동호회 전제
  if (payload.firebase && payload.firebase.sign_in_provider === 'anonymous') return null;

  // 2) 서명 검증
  const jwk = await jwkFor(header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  return ok ? payload : null;
}

// ── 라우팅 ────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const q = url.searchParams;

    if (path === '/api/health') {
      // 소스별 실제 도달 여부를 확인한다 (데이터센터 IP 차단 감지용).
      // 값은 싣지 않고 성공/지연/에러만 보고 — 무인증 엔드포인트이므로.
      const probe = async (name, fn) => {
        const t0 = Date.now();
        try { await fn(); return [name, { ok: true, ms: Date.now() - t0 }]; }
        catch (e) { return [name, { ok: false, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 120) }]; }
      };
      const results = Object.fromEntries(await Promise.all([
        probe('naver.quote', () => naver.getQuote('005930')),
        probe('naver.book',  () => naver.getOrderBook('005930')),
        probe('naver.index', () => naver.getIndex()),
        probe('daum.quote',  () => daum.getQuote('005930')),
        probe('yahoo.quote', () => yahoo.getQuote('005930', 'KOSPI'))
      ]));
      const primaryOk = results['naver.quote'].ok && results['naver.book'].ok;
      return json({
        status: primaryOk ? 'ok' : 'degraded',
        marketOpen: marketOpen(),
        provider: naver.name,
        kv: !!env.STOCK_KV,
        colo: request.cf && request.cf.colo,
        probes: results,
        ts: new Date().toISOString()
      }, primaryOk ? 200 : 503);
    }

    // 회원 전용 게이트 — health 제외한 모든 엔드포인트
    if (env.REQUIRE_AUTH !== 'false') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : q.get('token');
      const user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
      if (!user) return json({ error: '회원 전용입니다' }, 401);
    }

    try {
      if (path === '/api/quote')  return json(await handleQuote(env, q.get('code')));
      if (path === '/api/book')   return json(await handleBook(env, q.get('code')));
      if (path === '/api/ohlc')   return json(await handleOhlc(env, q.get('code'), q.get('tf') || 'D'));
      if (path === '/api/index')  return json(await handleIndex(env));
      if (path === '/api/search') return json(await handleSearch(env, q.get('q')));
      if (path === '/api/rank')    return json(await handleRank(env, q.get('type'), q.get('market')));
      if (path === '/api/sectors') return json(await handleSectors(env, q.get('kind'), q.get('no')));
      if (path === '/api/news')    return json(await handleNews(env, q.get('code')));
      if (path === '/api/trend')   return json(await handleTrend(env, q.get('code')));
      if (path === '/api/spark')   return json(await handleSpark(env, q.get('code')));
    } catch (e) {
      return fail(e.message || '시세 조회 실패');
    }

    return json({ error: 'Not Found' }, 404);
  }
};

// ── 핸들러 ────────────────────────────────────────────────────
async function handleQuote(env, code) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  return memo(`q:${code}`, TTL.quote, async () => {
    // 폴백 체인: 네이버 → 다음 → 야후
    try { return await naver.getQuote(code); }
    catch (e1) {
      try { return await daum.getQuote(code); }
      catch (e2) { return await yahoo.getQuote(code); }
    }
  });
}

async function handleBook(env, code) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  // 호가는 네이버에만 있다 — 실패하면 폴백 없이 명시적으로 알린다
  return memo(`b:${code}`, TTL.book, async () => {
    try { return await naver.getOrderBook(code); }
    catch (e) { return { code, unavailable: true, reason: '호가 일시 제공 중단', source: 'naver' }; }
  });
}

async function handleOhlc(env, code, tf) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  const st = kstStamp();
  if (tf === '1m') {
    return memo(`o:${code}:1m:${st.ymd}`, TTL.ohlcIntra, async () => ({
      code, tf, bars: await naver.getOhlc(code, '1m', { start: `${st.ymd}0800`, end: st.full }), source: 'naver'
    }));
  }
  const startY = String(Number(st.ymd.slice(0, 4)) - 2) + '0101';
  // 오늘 봉은 장중·시간외에 계속 변하므로 12시간 캐시를 그대로 쓰면 종가가 어긋난다.
  // 장이 도는 동안에는 짧게, 끝난 뒤에는 길게.
  const dayTtl = marketOpen() ? 180 : TTL.ohlcDay;
  return cached(env, `o:${code}:D:${st.ymd}`, dayTtl, async () => ({
    code, tf: 'D', bars: await naver.getOhlc(code, 'D', { start: `${startY}0000`, end: `${st.ymd}0000` }), source: 'naver'
  }));
}

async function handleIndex(env) {
  return memo('idx', TTL.index, () => naver.getIndex());
}

/**
 * 스파크라인용 초경량 종가 배열.
 * 관심종목 카드마다 ohlc 전체(수십 KB)를 받으면 모바일에서 감당이 안 되므로
 * 종가만 뽑아 40포인트로 다운샘플링해 내려보낸다.
 */
async function handleSpark(env, code) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  const st = kstStamp();
  return memo(`sp:${code}:${st.ymd}:${marketOpen() ? Math.floor(Date.now() / 60000) : 'c'}`, TTL.spark, async () => {
    let bars = [];
    let span = 'intraday';
    try {
      bars = await naver.getOhlc(code, '1m', { start: `${st.ymd}0800`, end: st.full });
    } catch (e) { bars = []; }

    // 장 시작 전이거나 분봉이 없으면 최근 일봉으로 대체
    if (bars.length < 3) {
      span = 'daily';
      const startY = String(Number(st.ymd.slice(0, 4)) - 1) + '0101';
      const daily = await naver.getOhlc(code, 'D', { start: `${startY}0000`, end: `${st.ymd}0000` });
      bars = daily.slice(-60);
    }

    const closes = bars.map((b) => b.c).filter((c) => typeof c === 'number');
    const MAX = 40;
    let pts = closes;
    if (closes.length > MAX) {
      const step = closes.length / MAX;
      pts = [];
      for (let i = 0; i < MAX; i++) pts.push(closes[Math.min(closes.length - 1, Math.floor(i * step))]);
      pts[MAX - 1] = closes[closes.length - 1];   // 마지막 값은 항상 실제 최신가
    }
    return { code, span, points: pts, source: 'naver' };
  });
}

/** 급상승·급하락·시총 랭킹 (토스 "실시간 차트") */
async function handleRank(env, type, market) {
  const t = ['up', 'down', 'marketValue', 'value'].includes(type) ? type : 'up';
  const m = market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';
  if (t === 'value') {
    return cached(env, `r:value:${m}`, TTL.rank, async () => ({
      type: 'value', market: m, approx: true,
      items: await naver.getTopValue(m, 20), source: 'naver'
    }));
  }
  return cached(env, `r:${t}:${m}`, TTL.rank, async () => ({
    type: t, market: m, items: await naver.getRanking(t, m, 20), source: 'naver'
  }));
}

/** 업종·테마 (토스 "지금 뜨는 산업") — no가 있으면 해당 그룹의 종목 목록 */
async function handleSectors(env, kind, no) {
  const k = kind === 'industry' ? 'industry' : 'theme';
  if (no) {
    return cached(env, `sg:${k}:${no}`, TTL.sectors, async () => ({
      kind: k, no, items: await naver.getSectorStocks(k, no, 20), source: 'naver'
    }));
  }
  return cached(env, `sc:${k}`, TTL.sectors, async () => ({
    kind: k, groups: await naver.getSectors(k, 20), source: 'naver'
  }));
}

/** 투자자별 매매동향 (개인·외국인·기관) */
async function handleTrend(env, code) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  return cached(env, `dt:${code}:${kstStamp().ymd}`, TTL.trend, async () => ({
    code, rows: await naver.getDealTrend(code), source: 'naver'
  }));
}

/** 종목 뉴스 */
async function handleNews(env, code) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  return cached(env, `n:${code}`, TTL.news, async () => ({
    code, items: await naver.getNews(code, 10), source: 'naver'
  }));
}

async function handleSearch(env, term) {
  const t = (term || '').trim();
  if (t.length < 1) return { items: [] };
  return cached(env, `s:${t}`, TTL.search, async () => ({ query: t, items: await naver.search(t) }));
}
