// DT 재테크 시세 Worker
// 네이버 증권(무인증)을 프록시 + KV 캐시. 전부 표준 443이라 fetch()로 충분하다.
// Secrets: FIREBASE_PROJECT_ID(vars), 없음(시세 소스에 키 불필요)
// KV: STOCK_KV

import { naver, daum, yahoo } from './providers/naver.js';
import { verifyIdToken, bearerToken } from './lib/verify-id-token.js';
import { profileOf } from './lib/profile.js';
import { handleMock, mockErrorResponse, runCron } from './mock/api.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8'
};

// 캐시 TTL(초) — 네이버 권장 폴링이 7초라 그보다 짧게 잡을 이유가 없다
const TTL = { quote: 3, book: 3, index: 15, ohlcIntra: 30, ohlcDay: 43200, search: 86400,
              rank: 60, sectors: 120, news: 300, spark: 60, trend: 600 };

const KV_MIN_TTL = 600;
const MAX_BATCH = 50;

function json(data, status = 200, extra) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...(extra || {}) } });
}
function fail(msg, status = 502) { return json({ error: msg }, status); }

const isCode = (c) => /^[0-9A-Z]{6}$/.test(c || '');
// 업종·테마 번호 — 네이버 URL 경로에 들어가므로 숫자만 통과시킨다
const isGroupNo = (n) => /^\d{1,8}$/.test(n || '');

// ── KV 캐시 래퍼 ───────────────────────────────────────────────
// KV 는 어디까지나 캐시다 — 읽기/쓰기가 실패해도(일일 쓰기 한도 초과 등) 요청은 살린다.
// KV 가 죽으면 워커 메모리 캐시로 떨어져 네이버 호출이 폭증하지 않게 한다.
async function cached(env, key, ttl, produce) {
  if (key.length > 200) return produce();          // KV 키 한도(512B) — 비정상적으로 긴 입력은 캐시하지 않는다
  // 10분 미만짜리(랭킹·테마·뉴스·장중 일봉)는 워커 메모리 캐시로만 돌린다.
  // KV 무료 쓰기 한도가 하루 1,000건이라, 분 단위 캐시를 KV 에 쓰면 오전 중에 소진된다.
  if (ttl < KV_MIN_TTL) return memo(`kv:${key}`, ttl, produce);
  if (env.STOCK_KV) {
    try {
      const hit = await env.STOCK_KV.get(key, 'json');
      if (hit) return { ...hit, cached: true };
    } catch (e) { /* 캐시 미스로 취급 */ }
  }
  return memo(`kv:${key}`, Math.min(ttl, 60), async () => {
    const fresh = await produce();
    if (env.STOCK_KV) {
      try {
        // expirationTtl 최소값이 60초라 그 아래는 KV 대신 짧은 edge 캐시에 의존
        await env.STOCK_KV.put(key, JSON.stringify(fresh), { expirationTtl: Math.max(60, ttl) });
      } catch (e) { console.warn('KV put 실패', key, String((e && e.message) || e).slice(0, 120)); }
    }
    return fresh;
  });
}

// TTL이 60초 미만인 항목은 KV 대신 워커 인스턴스 메모리로 처리
const mem = new Map();
const inflight = new Map();
async function memo(key, ttlSec, produce) {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && now - hit.at < ttlSec * 1000) return { ...hit.v, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await produce();
      mem.set(key, { at: Date.now(), v });
      if (mem.size > 500) mem.delete(mem.keys().next().value);
      return v;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

// ── 거래가 도는 시간대 (KST 08:00~20:10 평일) ──────────────────
/* 거래가 일어나는 시간대 — 캐시 TTL 을 여기서 가른다.
 * 넥스트레이드(NXT) 출범으로 국내 거래시간이 08:00~20:00 으로 연장됐다.
 *   프리마켓 08:00~08:50 / 메인마켓 09:00~15:20 / 애프터마켓 15:40~20:00
 *   KRX 정규장은 09:00~15:30 유지. KRX 도 2026-09-14 부터 애프터마켓(16:00~20:00)을 열었고
 *   기존 시간외 단일가(16:00~18:00)는 폐지됐다.
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
      // 결과를 60초 공유한다 — 무인증이라 누가 반복 호출해도 외부 호출은 분당 5건을 넘지 않는다
      const { results } = await memo('health', 60, async () => ({
        results: Object.fromEntries(await Promise.all([
          probe('naver.quote', () => naver.getQuote('005930')),
          probe('naver.book',  () => naver.getOrderBook('005930')),
          probe('naver.index', () => naver.getIndex()),
          probe('daum.quote',  () => daum.getQuote('005930')),
          probe('yahoo.quote', () => yahoo.getQuote('005930', 'KOSPI')),
          // ETF 목록은 EUC-KR 디코딩이 필요하다 — 런타임에서 되는지 여기서 확인된다
          probe('naver.etfList', async () => { const l = await naver.getEtfList(); if (l.length < 500) throw new Error('etf list too short: ' + l.length); })
        ]))
      }));
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
    let user = null;
    if (env.REQUIRE_AUTH !== 'false') {
      // 게스트(익명 로그인)는 공용 모듈에서 걸러진다 — 폐쇄형 동호회 전제
      user = await verifyIdToken(bearerToken(request), env.FIREBASE_PROJECT_ID);
      if (!user) return json({ error: '회원 전용입니다' }, 401);
      // 토큰이 살아 있어도 users 문서에 role 이 없으면(강퇴·탈퇴) 회원이 아니다 — 시세도 막는다
      const prof = await profileOf(env, user.sub, bearerToken(request));
      if (!prof.role) return json({ error: 'DT Club 회원만 이용할 수 있습니다' }, 403);
    }

    // 모의투자 — 장부(D1)를 다루므로 인증을 끈 개발 모드에서는 열지 않는다
    if (path.startsWith('/api/mock')) {
      if (!user) return json({ error: '회원 전용입니다' }, 401);
      try { return json(await handleMock(request, env, user, bearerToken(request), url)); }
      catch (e) { return mockErrorResponse(e, json); }
    }
    if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

    try {
      if (path === '/api/quote')  return json(await handleQuote(env, q.get('code')));
      if (path === '/api/quotes') return json(await handleQuotes(env, q.get('codes')));
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
      // 업스트림 URL·내부 예외 원문은 로그에만 남긴다 (회원에게 그대로 보이면 내부 구조가 드러난다)
      console.warn('quote api failed', path, String((e && e.message) || e).slice(0, 200));
      const timeout = e && (e.name === 'TimeoutError' || /abort/i.test(String(e.message)));
      return fail(timeout ? '시세 서버 응답이 늦습니다. 잠시 후 다시 시도해 주세요' : '시세를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요');
    }

    return json({ error: 'Not Found' }, 404);
  },

  // 평일 장중 매분 — 미체결 주문 체결, 장 마감 후 종가 저장·자산 스냅샷
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env).catch((e) => console.error('cron failed', e && e.stack || e)));
  }
};

// ── 핸들러 ────────────────────────────────────────────────────
async function handleQuote(env, code) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  return memo(`q:${code}`, TTL.quote, async () => {
    // 폴백 체인: 네이버 → 다음 → 야후 (야후는 코스피/코스닥 접미사를 모두 시도한다)
    try { return await naver.getQuote(code); }
    catch (e1) {
      try { return await daum.getQuote(code); }
      catch (e2) { return await yahoo.getQuote(code); }
    }
  });
}

/**
 * 여러 종목 현재가 — 관심종목·보유종목을 종목 수만큼 따로 부르지 않도록 한 번에 내려준다.
 * 네이버 호출도 1회다 (polling API 가 콤마로 이은 코드를 받는다).
 */
async function handleQuotes(env, codes) {
  const list = Array.from(new Set(String(codes || '').split(',').map((c) => c.trim()).filter(isCode)))
    .slice(0, MAX_BATCH).sort();
  if (!list.length) return { items: [] };
  return memo(`qs:${list.join(',')}`, TTL.quote, async () => {
    const items = await naver.getQuotes(list);
    // 단건 캐시도 채워 둔다 — 목록에서 종목 상세로 들어갈 때 바로 쓴다
    const now = Date.now();
    for (const it of items) mem.set(`q:${it.code}`, { at: now, v: it });
    return { items };
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
  return memo('idx', TTL.index, async () => {
    // 지수의 marketStatus 는 15:30 에 CLOSE 가 되지만 종목은 애프터마켓 동안 OPEN 이다(실측).
    // 화면의 "실시간 / 장 마감"은 종목 기준이 맞으므로 대표 종목의 상태를 함께 싣는다.
    // 휴장일에는 CLOSE 가 와서 시계만 보고 "실시간"이라 표시하던 문제도 없어진다.
    const [idx, ref] = await Promise.all([
      naver.getIndex(),
      naver.getQuote('005930').catch(() => null)
    ]);
    return { ...idx, marketStatus: ref ? ref.marketStatus : null, sessionType: ref ? ref.sessionType : null };
  });
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

/** 거래대금·거래량·급상승·급하락·시총 랭킹 (토스 "실시간 차트") */
async function handleRank(env, type, market) {
  const t = ['up', 'down', 'marketValue', 'value', 'volume'].includes(type) ? type : 'up';
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
    if (!isGroupNo(no)) return { error: '업종·테마 번호가 올바르지 않습니다' };
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
  const t = (term || '').trim().slice(0, 40);
  if (t.length < 1) return { items: [] };
  // 검색어는 KV 에 쓰지 않는다 — 입력 도중 스쳐 가는 부분 문자열마다 KV 쓰기 1건이면
  // 무료 일 1,000건 한도를 회원 타이핑만으로 소진한다. 인스턴스 메모리 캐시(5분)로 충분하다.
  // (ETF 전체 목록만 KV 에 하루 두 번 둔다)
  const key = t.toLowerCase().replace(/\s+/g, '');
  if (t.length < 2) return memo(`s:${key}`, 300, async () => ({ query: t, items: await naver.search(t) }));
  // ETF 키워드 보강은 화면의 종목 마스터(invest/stock-master.json, ETF·ETN 포함)가 맡는다.
  // 예전엔 여기서 finance.naver.com ETF 목록을 기다렸는데, 일부 콜로(HKG)에서 그 호출이 8초 타임아웃에
  // 걸려 검색 한 번에 8초씩 걸렸다. 자동완성 한 번만 부른다.
  return memo(`s2:${key}`, 300, async () => ({ query: t, items: await naver.search(t) }));
}

/** ETF 전체 목록 — 하루 두 번만 받아 KV 에 둔다 */
function etfList(env) {
  return cached(env, 'etf:list:v1', 43200, async () => ({ items: await naver.getEtfList() })).then((d) => d.items || []);
}

