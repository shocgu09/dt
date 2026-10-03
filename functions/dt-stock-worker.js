// DT 재테크 시세 Worker
// 네이버 증권(무인증)을 프록시 + KV 캐시. 야간선물만 한국투자증권 KIS Open API(9443 포트)를 쓴다.
// Secrets: KIS_APP_KEY·KIS_APP_SECRET(코스피200 야간선물, providers/kis.js), REVIEW_SECRET
// KV: STOCK_KV

import { naver, daum, yahoo } from './providers/naver.js';
import { upbit, isCoinMarket } from './providers/upbit.js';
import { kis } from './providers/kis.js';
import { naverUs, isUsCode, isUsDst, US_EXCHANGES } from './providers/naver-us.js';
import { verifyIdToken, bearerToken } from './lib/verify-id-token.js';
import { profileOf } from './lib/profile.js';
import { handleMock, mockErrorResponse, runCron } from './mock/api.js';
import { holidaySet } from './mock/holidays.js';
import * as AI from './mock/ai.js';
import { DurableObject } from 'cloudflare:workers';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  // Authorization 헤더 때문에 요청마다 preflight(OPTIONS)가 붙는다. 브라우저 기본 캐시는 5초라
  // 3~5초 폴링이 거의 매번 왕복 두 번이 됐다 — 하루 동안 재사용하게 한다 (크롬은 최대 2시간으로 자른다)
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json; charset=utf-8'
};

// 캐시 TTL(초) — 현재가·호가는 화면 폴링(장중 3초)에 맞춰 짧게, 하루 단위로 바뀌는 값은 길게
const TTL = { quote: 3, book: 3, index: 15, ohlcIntra: 30, ohlcDay: 43200, search: 86400,
              rank: 60, sectors: 120, news: 300, spark: 60, trend: 900, profile: 900,
              disclosure: 300, disclosureBody: 86400 };

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
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const q = url.searchParams;

    // 운영용 — AI 리그 장 마감 이야기를 지금 다시 쓰게 한다 (화면 버튼은 없앴다, 2026-10-02).
    // secret AI_OPS_KEY 가 설정돼 있고 X-Ops-Key 헤더가 같을 때만 — 아니면 없는 주소처럼 404
    if (path === '/api/internal/ai/post' && request.method === 'POST') {
      const key = request.headers.get('X-Ops-Key') || '';
      if (!env.AI_OPS_KEY || !env.HOUSE_AI || key.length < 32 || key !== env.AI_OPS_KEY) return json({ error: 'Not Found' }, 404);
      return json(await env.HOUSE_AI.get(env.HOUSE_AI.idFromName('house-ai'), { locationHint: 'apac' }).startPosts());
    }

    if (path === '/api/health') {
      // 소스별 실제 도달 여부를 확인한다 (데이터센터 IP 차단 감지용).
      // 값은 싣지 않고 성공/지연/에러만 보고 — 무인증 엔드포인트이므로.
      const probe = async (name, fn) => {
        const t0 = Date.now();
        try { const v = await fn(); return [name, { ok: true, ms: Date.now() - t0, ...(typeof v === 'string' ? { state: v } : {}) }]; }
        catch (e) { return [name, { ok: false, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 120) }]; }
      };
      // 결과를 60초 공유한다 — 무인증이라 누가 반복 호출해도 외부 호출은 분당 5건을 넘지 않는다
      const { results } = await memo('health', 60, async () => ({
        results: Object.fromEntries(await Promise.all([
          probe('naver.quote', () => naver.getQuote('005930')),
          probe('naver.book',  () => naver.getOrderBook('005930').catch((e) => { if (/book empty/.test(e.message)) return {}; throw e; })),   // 빈 호가(개장 뒤 20분·장외)는 장애가 아니다
          probe('naver.index', () => naver.getIndex()),
          probe('daum.quote',  () => daum.getQuote('005930')),
          probe('yahoo.quote', () => yahoo.getQuote('005930', 'KOSPI')),
          // ETF 목록은 EUC-KR 디코딩이 필요하다 — 런타임에서 되는지 여기서 확인된다
          probe('naver.etfList', async () => { const l = await naver.getEtfList(); if (l.length < 500) throw new Error('etf list too short: ' + l.length); }),
          // KIS 야간선물 — 값 대신 상태(pre/live/closed)만 싣는다. 지수 칸과 같은 캐시를 쓴다
          probe('kis.night', async () => {
            if (!kis.enabled(env)) throw new Error('no key');
            // 지수 응답은 2.5초만 기다리고 나머지는 뒤에서 받는다. 상태 점검은 60초 캐시라 끝까지 기다려도 된다 —
            // 기다리지 않으면 응답과 함께 KIS 호출이 끊겨 매번 'unavailable' 로 보였다
            let r = await nightFutCell(env, ctx);
            if (!r.nightfut && nightBusy) { await nightBusy; r = await nightFutCell(env, ctx); }
            if (!r.nightfut) throw new Error(lastNightErr || 'unavailable');
            return r.nightfut.state;
          })
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
      try {
        const out = await handleMock(request, env, user, bearerToken(request), url);
        // 커뮤니티 사진처럼 JSON 이 아닌 응답은 그대로 내보내되 CORS 만 붙인다
        if (out instanceof Response) {
          for (const [k, v] of Object.entries(CORS)) if (k !== 'Content-Type') out.headers.set(k, v);
          return out;
        }
        return json(out);
      }
      catch (e) { return mockErrorResponse(e, json); }
    }
    if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

    try {
      if (path === '/api/quote') {
        // 호가를 펼친 종목 화면은 시세와 호가를 한 요청으로 받는다 — 3초 폴링 두 줄이 한 줄이 돼 요청 수가 절반
        if (q.get('book') !== '1') return json(await withExpect(env, await handleQuote(env, q.get('code')), q.get('code')));
        const [quote, book] = await Promise.all([handleQuote(env, q.get('code')), handleBook(env, q.get('code'))]);
        return json({ ...(await withExpect(env, quote, q.get('code'))), book });
      }
      if (path === '/api/quotes') return json(await handleQuotes(env, q.get('codes')));
      if (path === '/api/book')   return json(await handleBook(env, q.get('code')));
      if (path === '/api/ohlc')   return json(await handleOhlc(env, q.get('code'), q.get('tf') || 'D'));
      if (path === '/api/index')  return json(await handleIndex(env, ctx));
      if (path === '/api/indexspark') return json(await handleIndexSpark(env));
      if (path === '/api/search') return json(await handleSearch(env, q.get('q')));
      if (path === '/api/rank')    return json(await handleRank(env, q.get('type'), q.get('market')));
      if (path === '/api/sectors') return json(await handleSectors(env, q.get('kind'), q.get('no')));
      if (path === '/api/news')    return json(await handleNews(env, q.get('code')));
      if (path === '/api/trend')   return json(await handleTrend(env, q.get('code')));
      if (path === '/api/profile') return json(await handleProfile(env, q.get('code')));
      if (path === '/api/disclosure') return json(await handleDisclosure(env, q.get('code'), q.get('id')));
      if (path === '/api/spark')   return json(await handleSpark(env, q.get('code')));
      if (path === '/api/coin/markets') return json(await handleCoinMarkets());
      if (path === '/api/coin/list')    return json(await handleCoinList(q.get('sort'), q.get('limit'), q.get('markets')));
      if (path === '/api/coin/quote')   return json(await handleCoinQuote(q.get('market')));
      if (path === '/api/coin/book')    return json(await handleCoinBook(q.get('market')));
      if (path === '/api/coin/trades')  return json(await handleCoinTrades(q.get('market')));
      if (path === '/api/coin/candles') return json(await handleCoinCandles(q.get('market'), q.get('tf')));
      if (path === '/api/us/list')    return json(await handleUsList(q.get('sort'), q.get('limit'), q.get('codes')));
      if (path === '/api/us/quote')   return json(await handleUsQuote(q.get('code')));
      if (path === '/api/us/candles') return json(await handleUsCandles(q.get('code'), q.get('tf')));
      if (path === '/api/us/search')  return json(await handleUsSearch(q.get('q')));
    } catch (e) {
      // 업스트림 URL·내부 예외 원문은 로그에만 남긴다 (회원에게 그대로 보이면 내부 구조가 드러난다)
      console.warn('quote api failed', path, String((e && e.message) || e).slice(0, 200));
      const timeout = e && (e.name === 'TimeoutError' || /abort/i.test(String(e.message)));
      return fail(timeout ? '시세 서버 응답이 늦습니다. 잠시 후 다시 시도해 주세요' : '시세를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요');
    }

    return json({ error: 'Not Found' }, 404);
  },

  // 평일 장중 매분 — 미체결 주문 체결, 장 마감 후 종가 저장·자산 스냅샷
  // 실제 일은 Durable Object(MockCron)가 한다. 무료 요금제에서 크론 호출은 CPU 10ms 까지인데,
  // 지정가 주문이 걸린 종목마다 분봉을 받아 판정하느라 장 초반엔 이미 12~20ms 를 쓰고 있었다(9/30 실측, 726회 중 93회 초과).
  // Durable Object 는 같은 무료 요금제에서 호출당 CPU 30초라 회원·주문이 늘어도 체결 판정이 잘리지 않는다.
  async scheduled(event, env, ctx) {
    // AI 리그 — 정해진 시각이면 판단 라운드를 시작한다 (실제 일은 HouseAI 알람이 나눠서 한다). 체결 크론과 따로 돈다.
    // 첫 판단(09:05) 전·20:00 뒤(08시대 프리마켓 크론, 23:30 밤 정산 크론)에는 할 일이 없으니 부르지 않는다 (하루 약 80번)
    const kstHm = (Math.floor(event.scheduledTime / 60000) + 9 * 60) % 1440;
    if (env.HOUSE_AI && kstHm >= AI.ROUNDS[0] && kstHm < 20 * 60) {
      const ai = env.HOUSE_AI.get(env.HOUSE_AI.idFromName('house-ai'), { locationHint: 'apac' });
      ctx.waitUntil(ai.tick().catch((e) => console.error('ai tick failed', e && e.stack || e)));
    }
    if (env.MOCK_CRON) {
      // 이름 하나로 고정 — 인스턴스가 하나라 두 크론이 겹쳐도 한 곳에서 차례로 돈다. D1·네이버가 있는 아시아에 둔다
      const stub = env.MOCK_CRON.get(env.MOCK_CRON.idFromName('mock-cron'), { locationHint: 'apac' });
      // Durable Object 를 부르지 못하면(배포 직후·일시 장애) 예전처럼 여기서 직접 돈다 — 체결 판정이 멈추지 않게.
      // 반쯤 돌다 실패했어도 두 번 도는 것은 안전하다 (체결은 주문 잠금으로, 마감·스냅샷은 '이미 했는지'를 보고 건너뛴다)
      ctx.waitUntil(stub.run().catch((e) => {
        console.error('cron (DO) failed — running inline', e && e.stack || e);
        return runCron(env).catch((e2) => console.error('cron failed', e2 && e2.stack || e2));
      }));
      return;
    }
    ctx.waitUntil(runCron(env).catch((e) => console.error('cron failed', e && e.stack || e)));
  }
};

// 무료 요금제는 호출 한 번에 D1 문장 50개까지다. 체결·반대매매 접수·밤 정산이 그 한도 때문에 일을 남기면(stats.more)
// 몇 초 뒤 알람으로 다시 돈다 — 알람은 새 호출이라 한도가 새로 잡힌다. 크론 한 번당 이어 돌기는 CHAIN_MAX 번까지
const CHAIN_MAX = 8, CHAIN_GAP_MS = 4000;
export class MockCron extends DurableObject {
  async run() {
    this.chain = 0;
    return this.work();
  }
  async alarm() {
    this.chain = (this.chain || 0) + 1;
    await this.work();
  }
  async work() {
    // 앞 호출이 1분 넘게 걸리면 다음 분 호출이 겹친다 — 체결은 주문 잠금으로 안전하지만 같은 일을 두 번 할 이유가 없다
    if (this.busyUntil && Date.now() < this.busyUntil) return 'busy';
    this.busyUntil = Date.now() + 5 * 60 * 1000;
    let stats = null;
    try { stats = await runCron(this.env); }
    finally { this.busyUntil = 0; }
    if (stats && stats.more && (this.chain || 0) < CHAIN_MAX) {
      await this.ctx.storage.setAlarm(Date.now() + CHAIN_GAP_MS).catch((e) => console.error('chain alarm failed', e && e.message));
    }
    return stats && stats.more ? 'more' : 'ok';
  }
}

// AI 리그 — 진행 상태·종목 기초자료 캐시를 이 객체의 저장소에 둔다 (D1 문장 수를 아끼려고)
export class HouseAI extends DurableObject {
  store() {
    const s = this.ctx.storage;
    return { get: (k) => s.get(k), put: (k, v) => s.put(k, v), getAlarm: () => s.getAlarm(), setAlarm: (t) => s.setAlarm(t) };
  }
  async tick() {
    const r = await AI.tick(this.env, this.store());
    // 하루 지난 기초자료 캐시는 지운다 (아침 첫 라운드 때 한 번)
    if (r === 'started') await this.prune().catch(() => {});
    return r;
  }
  async start() { return AI.start(this.env, this.store()); }
  async startPosts() { return AI.startPosts(this.env, this.store()); }
  async status() { return (await this.ctx.storage.get('round')) || null; }
  async alarm() { await AI.step(this.env, this.store()); }
  async prune() {
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
    // 날짜가 붙은 표시(st: 기초자료 · done: 회차 · snap: 순자산 기록 · post: 마감 이야기) — 'prefix:YYYYMMDD…'
    const keys = [];
    for (const prefix of ['st:', 'done:', 'snap:', 'post:']) {
      for (const k of (await this.ctx.storage.list({ prefix })).keys()) if (k.slice(prefix.length, prefix.length + 8) < today) keys.push(k);
    }
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
  }
}

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

/* 동시호가(장전 08:30~09:00 · 장 마감 15:20~15:30)에는 KRX 체결이 없어 네이버 현재가가 마지막 체결가에 멈춘다.
 * 증권사 앱처럼 예상체결가를 보이도록 종목 상세(단건 시세)에만 KIS 예상체결가를 붙인다 — 목록(여러 종목)은 KIS 호출이 많아 붙이지 않는다.
 * KIS 는 장이 끝난 뒤·휴장일에도 지난 예상가를 그대로 주므로(2026-10-01 실측) 시각과 휴장일(D1)로 거른다.
 * KIS 가 늦거나 실패해도 시세는 기다리지 않는다 (2.5초) */
function auctionWindow(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const day = k.getUTCDay(), hm = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (day === 0 || day === 6) return false;
  return (hm >= 8 * 60 + 30 && hm < 9 * 60) || (hm >= 15 * 60 + 20 && hm < 15 * 60 + 30);
}
async function withExpect(env, quote, code) {
  if (!quote || quote.error || !isCode(code) || !auctionWindow() || !kis.enabled(env)) return quote;
  if (env.MOCK_DB && (await holidaySet(env.MOCK_DB).catch(() => new Set())).has(kstStamp().ymd)) return quote;
  const ex = await Promise.race([
    // 실패도 5초 담아 둔다 — KIS 가 막혔을 때 시세 요청마다 다시 부르지 않게
    memo(`ex:${code}`, 5, () => kis.expected(env, code).then((v) => ({ v }), (e) => { console.warn('kis expect failed', String(e && e.message).slice(0, 120)); return { v: null }; })),
    new Promise((r) => setTimeout(() => r(null), 2500))
  ]).catch(() => null);
  return ex && ex.v ? { ...quote, expect: ex.v } : quote;
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
    catch (e) {
      // 네이버 호가는 20분 지연이라 개장 뒤 20분 동안은 빈 칸이다 (2026-10-01 실측)
      const hm = (Math.floor(Date.now() / 60000) + 9 * 60) % 1440;
      const early = hm >= 8 * 60 && hm < 9 * 60 + 20;
      return { code, unavailable: true, reason: !/book empty/.test(e && e.message) ? '호가 일시 제공 중단' : early ? '호가는 20분 지연이라 09:20 부터 보입니다' : '지금은 호가 정보가 없습니다', source: 'naver' };
    }
  });
}

async function handleOhlc(env, code, tf) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  const st = kstStamp();
  if (tf === '1m') {
    // 네이버 분봉은 09:00 봉부터 있다(NXT 프리마켓 날에도). 그 전·주말·휴장일에는 오늘 봉이 없어 1분·5분 차트가
    // 통째로 비었다 — 직전 거래일 분봉을 준다 (지난 날 봉은 바뀌지 않으므로 길게 캐시)
    const hm = Number(st.full.slice(8, 10)) * 60 + Number(st.full.slice(10, 12));
    const hol = env.MOCK_DB ? await holidaySet(env.MOCK_DB).catch(() => new Set()) : new Set();
    const tradingToday = (ymd) => { const w = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay(); return w >= 1 && w <= 5 && !hol.has(ymd); };
    if (tradingToday(st.ymd) && hm >= 9 * 60) {
      return memo(`o:${code}:1m:${st.ymd}`, TTL.ohlcIntra, async () => ({
        code, tf, day: st.ymd, bars: await naver.getOhlc(code, '1m', { start: `${st.ymd}0800`, end: st.full }), source: 'naver'
      }));
    }
    let d = Date.UTC(+st.ymd.slice(0, 4), +st.ymd.slice(4, 6) - 1, +st.ymd.slice(6, 8));
    let prev = null;
    for (let i = 0; i < 15 && !prev; i++) {
      d -= 86400e3;
      const k = new Date(d);
      const y = `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}`;
      if (tradingToday(y)) prev = y;
    }
    if (!prev) return { code, tf, bars: [], source: 'naver' };
    return memo(`o:${code}:1m:${prev}`, 600, async () => ({
      code, tf, day: prev, previous: true,
      bars: await naver.getOhlc(code, '1m', { start: `${prev}0800`, end: `${prev}2000` }), source: 'naver'
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

async function handleIndex(env, ctx) {
  // 비트코인·이더리움 칸은 코인 목록·상세와 같은 ticker(3초 캐시)에서 매번 붙인다 — 15초 지수 캐시 안에 두면
  // 목록보다 최대 15초 늦어 같은 화면에 두 값이 보였다
  const [base, coins] = await Promise.all([indexBase(env, ctx), coinIndexCells().catch(() => ({}))]);
  return { ...base, ...coins };
}

async function indexBase(env, ctx) {
  const v = await memo('idx', TTL.index, async () => {
    // 휴장일 목록을 함께 내려보낸다 — 화면이 같은 목록을 쓰게 해서 출처를 하나로 둔다.
    // (예전에는 invest/market.js 에 같은 목록을 복붙해 뒀다)
    const holidays = env.MOCK_DB ? [...(await holidaySet(env.MOCK_DB))].sort() : [];
    // 지수의 marketStatus 는 15:30 에 CLOSE 가 되지만 종목은 애프터마켓 동안 OPEN 이다(실측).
    // 화면의 "실시간 / 장 마감"은 종목 기준이 맞으므로 대표 종목의 상태를 함께 싣는다.
    // 휴장일에는 CLOSE 가 와서 시계만 보고 "실시간"이라 표시하던 문제도 없어진다.
    // 해외 지수선물은 국내 장중에도 돌아간다 — 지수 스트립에 같이 실어 보낸다.
    // 선물이 죽어도 국내 지수는 그려야 하므로 실패는 삼킨다.
    const [idx, ref, fut, extra, night] = await Promise.all([
      naver.getIndex(),
      naver.getQuote('005930').catch(() => null),
      naver.getWorldFutures().catch(() => ({})),
      naver.getMarketExtras().catch(() => ({})),
      nightFutCell(env, ctx)
    ]);
    // NXT 프리·애프터마켓 동안 배지는 '국내 실시간'인데 코스피·코스닥 지수는 정규장 값에 멈춰 있다 — 그 칸에 밝힌다
    for (const k of ['kospi', 'kosdaq', 'kpi200', 'kq150']) {
      const c = idx[k];
      if (!c) continue;
      c.tag = ref && ref.session && c.status !== 'OPEN' ? (ref.session === 'PRE_MARKET' ? '개장 전' : '마감') : '';
    }
    return {
      ...idx, ...fut, ...extra, ...night,
      holidays,
      // KRX 는 NXT 프리·애프터마켓(08:00~08:50 · 15:40~) 동안 CLOSE 다 — 거래가 도는 동안은 열림으로 싣는다
      marketStatus: ref ? (ref.session ? 'OPEN' : ref.marketStatus) : null,
      sessionType: ref ? ref.sessionType : null
    };
  });
  // 야간선물을 아직 못 받은 응답은 3초만 캐시한다 — 15초 동안 같은 '빈 칸' 응답이 나가 칸이 사라져 보였다 (2026-10-02)
  if (!v.nightfut && kis.enabled(env)) {
    const hit = mem.get('idx');
    if (hit) hit.at = Math.min(hit.at, Date.now() - (TTL.index - 3) * 1000);
  }
  return v;
}

/* 코스피200 야간선물 칸 (KIS). 지수 캐시(15초)와 따로 둔다 — KIS 는 초당 호출 한도가 낮아 두 번 부르는 데 2~3초 걸린다.
 * 그래서 지수 응답을 기다리게 하지 않는다: 갖고 있는 값을 바로 싣고 새 값은 뒤에서 받는다(10분 넘게 묵은 값만 기다린다).
 * 야간장 중(18:00~06:00)에는 30초, 그 밖에는 5분마다 새로 받는다. 실패하면 마지막 성공값을 쓰고 30초 뒤 다시 시도한다.
 * 값은 아이솔레이트 메모리에 있어서, 새로 뜬 아이솔레이트는 KIS 를 기다리다(2.5초) 빈 칸을 보냈다 — 칸이 사라졌다 나타났다 했다.
 * 그래서 마지막 값을 KV 에도 둔다. 새 아이솔레이트는 KV 값을 먼저 싣고 KIS 는 뒤에서 받는다.
 * KV 무료 쓰기 한도(하루 1,000건) 때문에 상태(개장 전·진행·마감)가 바뀔 때와 야간장 15분 · 그 밖 60분마다만 쓴다. */
const NIGHT_KV = 'kis:night';
let nightKvRead = false;   // 이 아이솔레이트가 KV 를 한 번 읽어 봤는가
let nightKvAt = 0;         // KV 에 들어 있는 값의 시각 (읽었거나 쓴 것)
let nightKvState = '';     // KV 에 들어 있는 값의 상태
let lastNight = null;
let nightAt = 0;
let nightBusy = null;
let lastNightErr = '';
let nightRetryAt = 0;      // 실패 뒤 다시 부를 수 있는 시각 — 값을 한 번도 못 받은 인스턴스에도 적용한다
let nightOkAt = 0;         // 마지막으로 새 값을 받은 시각 (실패 때 당기는 nightAt 과 따로 둔다)
/** 실어 보낼 칸 — KIS 가 계속 실패하면 실패 처리가 nightAt 을 당겨 두어 마지막 성공값이 몇 시간이고
 *  '실시간'으로 나갔다. 10분 넘게 새 값을 못 받았으면 지연으로 밝힌다 */
function nightOut() {
  if (!lastNight) return {};
  if (lastNight.state === 'live' && Date.now() - nightOkAt > 600000) return { nightfut: { ...lastNight, state: 'closed', tag: '지연' } };
  return { nightfut: lastNight };
}
async function nightFromKv(env) {
  nightKvRead = true;
  if (!env.STOCK_KV) return;
  const hit = await env.STOCK_KV.get(NIGHT_KV, 'json').catch(() => null);
  nightKvAt = hit ? hit.at : 0;
  nightKvState = hit && hit.c ? hit.c.state : '';
  // 90분 넘게 묵은 값은 쓰지 않는다 (진행 중 값은 nightOut 이 10분 넘으면 '지연'으로 밝힌다)
  if (lastNight || !hit || !hit.c || Date.now() - hit.at > 90 * 60000) return;
  lastNight = hit.c;
  nightAt = nightOkAt = hit.at;
}
function nightToKv(env, ctx, nightHours) {
  if (!env.STOCK_KV || !lastNight) return;
  const gap = (nightHours ? 15 : 60) * 60000;
  if (lastNight.state === nightKvState && Date.now() - nightKvAt < gap) return;
  const c = lastNight, at = nightOkAt;
  nightKvAt = at; nightKvState = c.state;
  const p = env.STOCK_KV.get(NIGHT_KV, 'json').catch(() => null).then((hit) => {
    // 다른 아이솔레이트가 같은 상태를 방금 썼으면 건너뛴다
    if (hit && hit.c && hit.c.state === c.state && at - hit.at < gap) return;
    return env.STOCK_KV.put(NIGHT_KV, JSON.stringify({ c, at }), { expirationTtl: 6 * 3600 });
  }).catch((e) => console.warn('kis night KV put 실패', String((e && e.message) || e).slice(0, 120)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}
async function nightFutCell(env, ctx) {
  if (!kis.enabled(env)) return {};
  if (!lastNight && !nightKvRead) await nightFromKv(env);
  const h = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  const nightHours = h >= 18 || h < 6;
  const ttl = (nightHours ? 30 : 300) * 1000;
  const age = Date.now() - nightAt;
  if (lastNight && age < ttl) return nightOut();
  if (!nightBusy && Date.now() >= nightRetryAt) {
    nightBusy = kis.nightCell(env)
      .then((c) => { lastNight = c; nightAt = nightOkAt = Date.now(); lastNightErr = ''; nightToKv(env, ctx, nightHours); })
      .catch((e) => {
        lastNightErr = String((e && e.message) || e).slice(0, 120);
        console.warn('kis night failed', lastNightErr);
        nightAt = Date.now() - ttl + 30000;
        nightRetryAt = Date.now() + 30000;   // KIS 는 토큰 발급이 분당 1회라 실패 직후 연달아 부르면 계속 실패한다
      })
      .finally(() => { nightBusy = null; });
  }
  if (nightBusy && ctx && ctx.waitUntil) ctx.waitUntil(nightBusy);
  if (lastNight && age < 600000) return nightOut();
  // 새 인스턴스(값 없음)이거나 10분 넘게 묵었다 — 잠깐만 기다린다.
  // 예전에는 끝까지 기다려서 KIS 가 막히면 15초마다 지수 응답(장 상태·휴장일 포함)이 수 초씩 붙들렸다
  if (nightBusy) await Promise.race([nightBusy, new Promise((r) => setTimeout(r, 2500))]);
  return nightOut();
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
  // 종목마다 KV 에 쓰면 보는 종목 수만큼 쓰기가 늘어난다 — 하루 단위 값이라 워커 메모리 캐시로 충분하다
  return memo(`dt:${code}:${kstStamp().ymd}`, TTL.trend, async () => ({
    code, rows: await naver.getDealTrend(code), source: 'naver'
  }));
}

/**
 * 종목 기본정보 — 투자지표·컨센서스 목표가·최근 분기 실적.
 * 하루 단위로만 바뀌는 값이라 길게 잡아도 되지만, KV 쓰기(무료 하루 1,000건)를 아끼려고
 * 워커 메모리 캐시만 쓴다. 회원이 보는 종목 수가 많지 않아 15분이면 네이버 호출이 충분히 준다.
 */
async function handleProfile(env, code) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  return memo(`pf:${code}`, TTL.profile, async () => ({ ...(await naver.getProfile(code)), source: 'naver' }));
}

/**
 * 지수 스트립 스파크라인 — 국내 지수 5종의 당일 분봉.
 * 해외 선물은 네이버에 분봉이 없어 빠진다(화면은 숫자만 보여 준다).
 * 항목당 외부 호출 1건(총 5건). 거래 시간대에는 1분, 그 밖에는 10분 캐시.
 * 개장 전에는 분봉이 없어 빈 결과가 나오므로 길게 캐시하면 개장 후에도 선이 안 생긴다 — 짧게 잡는다.
 */
async function handleIndexSpark(env) {
  const st = kstStamp();
  // 장이 닫힌 동안에는 값이 바뀌지 않는다 — KV 에 10분마다 쓰면 밤·주말에만 하루 수백 건을 썼다 (무료 한도 1,000건)
  return memo(`ixsp:${st.ymd}`, marketOpen() ? 60 : 1800, async () => ({
    series: await naver.getIndexSparks(), span: 'intraday', source: 'naver'
  }));
}

/**
 * 종목 공시 — id 가 없으면 목록, 있으면 그 공시의 본문.
 * 본문은 이미 공시된 확정 문서라 바뀌지 않는다 → 하루 캐시(KV).
 */
async function handleDisclosure(env, code, id) {
  if (!isCode(code)) return { error: '종목코드는 6자리 숫자입니다' };
  if (id) {
    if (!/^\d{1,12}$/.test(id)) return { error: '공시 번호가 올바르지 않습니다' };
    return cached(env, `dcb:${code}:${id}`, TTL.disclosureBody, async () => ({
      code, item: await naver.getDisclosure(code, id), source: 'naver'
    }));
  }
  return memo(`dc:${code}`, TTL.disclosure, async () => ({
    code, items: await naver.getDisclosures(code, 15), source: 'naver'
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


// ── 코인 (업비트 원화 마켓) ─────────────────────────────────────
// 시세 표시만 한다(모의투자 없음). 목록·현재가·지수 스트립은 모두 ticker/all 한 번(3초 캐시)에서 나온다 —
// 화면마다 출처가 달라 같은 코인이 다른 값으로 보이지 않게 한다.
const COIN_TTL = { tickers: 3, markets: 600, book: 2, trades: 2, candleMin: 10, candleDay: 60 };

function coinTickers() {
  return memo('coin:tickers', COIN_TTL.tickers, async () => ({ items: await upbit.getTickers(), at: Date.now() }));
}
function coinMarkets() {
  return memo('coin:markets', COIN_TTL.markets, async () => ({ items: await upbit.getMarkets() }));
}
// 이름·시장경보는 부가 정보다 — 목록 호출이 실패해도 시세는 내려보낸다
async function coinInfoMap() {
  try { return new Map((await coinMarkets()).items.map((m) => [m.market, m])); }
  catch (e) { return new Map(); }
}

function coinRow(t, info) {
  return {
    market: t.market,
    name: info ? info.name : t.market.slice(4),
    price: t.price, change: t.change, changeRate: t.changeRate, value24h: t.value24h,
    warning: !!(info && info.warning), caution: info ? info.caution : []
  };
}

/** 원화 마켓 이름·시장경보 — 24시간 거래대금 순 (검색 결과를 많이 거래되는 코인부터 보이게) */
async function handleCoinMarkets() {
  const [d, t] = await Promise.all([coinMarkets(), coinTickers().catch(() => ({ items: [] }))]);
  const val = new Map(t.items.map((r) => [r.market, r.value24h || 0]));
  const items = d.items.slice().sort((x, y) => (val.get(y.market) || 0) - (val.get(x.market) || 0));
  return { items, source: 'upbit' };
}

/** 코인 목록 — sort(value 24시간 거래대금 · up · down) 상위 limit 개, 또는 markets 로 지정한 것만 */
async function handleCoinList(sort, limit, markets) {
  const [t, info] = await Promise.all([coinTickers(), coinInfoMap()]);
  let rows = t.items;
  const s = ['value', 'up', 'down'].includes(sort) ? sort : 'value';
  if (markets) {
    const want = new Set(String(markets).split(',').map((x) => x.trim()).filter(isCoinMarket).slice(0, MAX_BATCH));
    rows = rows.filter((r) => want.has(r.market));
  } else {
    const key = s === 'value' ? (r) => -(r.value24h || 0) : (s === 'up' ? (r) => -(r.changeRate || 0) : (r) => (r.changeRate || 0));
    const lim = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 300);
    rows = rows.slice().sort((a, b) => key(a) - key(b)).slice(0, lim);
  }
  return { sort: markets ? null : s, total: t.items.length, items: rows.map((r) => coinRow(r, info.get(r.market))),
           asOf: new Date(t.at).toISOString(), source: 'upbit' };
}

async function handleCoinQuote(market) {
  if (!isCoinMarket(market)) return { error: '코인 코드가 올바르지 않습니다' };
  const [t, info] = await Promise.all([coinTickers(), coinInfoMap()]);
  const r = t.items.find((x) => x.market === market);
  if (!r) return { error: '거래되지 않는 코인입니다' };
  const m = info.get(market);
  return { ...r, name: m ? m.name : market.slice(4), en: m ? m.en : null,
           warning: !!(m && m.warning), caution: m ? m.caution : [], source: 'upbit' };
}

async function handleCoinBook(market) {
  if (!isCoinMarket(market)) return { error: '코인 코드가 올바르지 않습니다' };
  return memo(`coin:b:${market}`, COIN_TTL.book, () => upbit.getOrderBook(market));
}

async function handleCoinTrades(market) {
  if (!isCoinMarket(market)) return { error: '코인 코드가 올바르지 않습니다' };
  return memo(`coin:t:${market}`, COIN_TTL.trades, async () => ({ market, items: await upbit.getTrades(market, 40), source: 'upbit' }));
}

async function handleCoinCandles(market, tf) {
  if (!isCoinMarket(market)) return { error: '코인 코드가 올바르지 않습니다' };
  const t = ['m', 'm5', 'm15', 'm60', 'D', 'W', 'M'].includes(tf) ? tf : 'D';
  const ttl = t.startsWith('m') ? COIN_TTL.candleMin : COIN_TTL.candleDay;
  return memo(`coin:c:${market}:${t}`, ttl, async () => ({ market, tf: t, bars: await upbit.getCandles(market, t), source: 'upbit' }));
}

// ── 미국 주식 (네이버 해외주식) ────────────────────────────────
// 시세 표시만 한다(모의투자 없음). 프리마켓 04:00 ~ 애프터마켓 20:00 (뉴욕 시각, 평일)에는 짧게, 그 밖에는 길게 캐시한다.
function usActive(d = new Date()) {
  // 뉴욕 벽시계 — 서머타임이면 UTC-4, 아니면 UTC-5
  const u = new Date(d.getTime() - 4 * 3600 * 1000);
  const off = isUsDst(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), u.getUTCHours()) ? 4 : 5;
  const et = new Date(d.getTime() - off * 3600 * 1000);
  const day = et.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = et.getUTCHours();
  return h >= 4 && h < 20;
}
const usTtl = (live, idle) => (usActive() ? live : idle);

async function usFx() {
  const r = await memo('us:fx', 300, async () => ({ rate: await naverUs.getUsdKrw() }));
  return r.rate;
}

/** 미국 주식 목록 — sort(value 거래대금 · cap 시가총액 · up · down) 상위 limit 개, 또는 codes 로 지정한 것만.
 *  네이버 순위는 거래소별이라 나스닥·뉴욕·아멕스를 받아 합친다.
 *  급등락 순위는 권리증서·1달러 미만·거래대금 1천만 달러 미만을 뺀다 (그대로 두면 동전주가 목록을 채운다). */
async function handleUsList(sort, limit, codes) {
  if (codes) {
    const want = [...new Set(String(codes).split(',').map((x) => x.trim()).filter(isUsCode))].slice(0, MAX_BATCH);
    if (!want.length) return { items: [] };
    return memo(`us:q:${want.join(',')}`, usTtl(5, 60), async () => ({ items: await naverUs.getQuotes(want), source: 'naver' }));
  }
  const s = ['value', 'cap', 'up', 'down'].includes(sort) ? sort : 'value';
  const lim = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50);
  return memo(`us:l:${s}:${lim}`, usTtl(20, 300), async () => {
    const movers = s === 'up' || s === 'down';
    const lists = await Promise.all(US_EXCHANGES.map((ex) => naverUs.getRank(ex, s, movers ? 100 : lim).catch(() => [])));
    let rows = lists.flat();
    if (!rows.length) throw new Error('us rank empty');
    if (movers) rows = rows.filter((r) => r.price >= 1 && (r.valueUsd || 0) >= 1e7 && !/_/.test(r.code));
    const key = { value: (r) => -(r.valueUsd || 0), cap: (r) => -(r.marketCap || 0),
                  up: (r) => -(r.changeRate || 0), down: (r) => (r.changeRate || 0) }[s];
    rows.sort((a, b) => key(a) - key(b));
    return { sort: s, items: rows.slice(0, lim), source: 'naver' };
  });
}

async function handleUsQuote(code) {
  if (!isUsCode(code)) return { error: '종목코드가 올바르지 않습니다' };
  const [rows, basic, fx] = await Promise.all([
    memo(`us:q:${code}`, usTtl(3, 60), async () => ({ items: await naverUs.getQuotes([code]) })),
    memo(`us:b:${code}`, 1800, () => naverUs.getBasic(code)).catch(() => null),
    usFx().catch(() => null)
  ]);
  const r = rows.items && rows.items[0];
  if (!r) return { error: '시세를 찾을 수 없는 종목입니다' };
  const { cached: _c, ...b } = basic || {};
  return { ...r, ...(basic ? { en: b.en, industry: b.industry, isEtf: b.isEtf, prevClose: b.prevClose, high52: b.high52, low52: b.low52,
           per: b.per, pbr: b.pbr, eps: b.eps, dividendYield: b.dividendYield, marketValue: b.marketValue } : {}),
           usdKrw: fx };
}

async function handleUsCandles(code, tf) {
  if (!isUsCode(code)) return { error: '종목코드가 올바르지 않습니다' };
  const t = ['m5', 'D', 'W', 'M'].includes(tf) ? tf : 'D';
  const ttl = t === 'm5' ? usTtl(60, 600) : usTtl(600, 3600);
  return memo(`us:c:${code}:${t}`, ttl, async () => ({ code, tf: t, ...(await naverUs.getBars(code, t)), source: 'naver' }));
}

async function handleUsSearch(term) {
  const t = String(term || '').trim().slice(0, 40);
  if (!t) return { items: [] };
  return memo(`us:s:${t.toLowerCase().replace(/\s+/g, '')}`, 300, async () => ({ query: t, items: await naverUs.search(t) }));
}

/** 지수 스트립의 비트코인·이더리움 칸 — 24시간 움직인다 */
async function coinIndexCells() {
  const t = await coinTickers();
  const out = {};
  for (const [key, market, name] of [['btc', 'KRW-BTC', '비트코인'], ['eth', 'KRW-ETH', '이더리움']]) {
    const r = t.items.find((x) => x.market === market);
    if (r && r.price != null) out[key] = { name, price: r.price, change: r.change, changeRate: r.changeRate, decimals: 0 };
  }
  return out;
}
