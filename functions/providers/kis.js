// 한국투자증권 KIS Open API 프로바이더 — 코스피200 선물(주간·야간) 시세
// Secrets: KIS_APP_KEY, KIS_APP_SECRET (실전 앱키, 조회만 한다)
// 접근 토큰은 24시간 유효하고 재발급이 분당 1회로 묶여 있다 → KV 에 저장해 모든 아이솔레이트가 같이 쓴다.
// KIS 는 9443 포트를 쓴다.

const BASE = 'https://openapi.koreainvestment.com:9443';
const FETCH_MS = 8000;
const TOKEN_KEY = 'kis:token';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 1100;          // 연달아 부를 때 간격

let memToken = null;          // { token, exp(ms) } — KV 왕복을 줄이는 아이솔레이트 캐시
let tokenInflight = null;

async function issueToken(env) {
  const r = await fetch(BASE + '/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: env.KIS_APP_KEY, appsecret: env.KIS_APP_SECRET }),
    signal: AbortSignal.timeout(FETCH_MS)
  });
  const j = await r.json().catch(() => ({}));
  // 실패 응답에 키가 섞여 오지는 않지만, 메시지만 짧게 남긴다
  if (!j.access_token) throw new Error(`kis token ${r.status} ${String(j.error_description || j.msg1 || '').slice(0, 80)}`);
  // 만료 1시간 전에 갈아 끼운다
  const exp = Date.now() + (Number(j.expires_in) || 86400) * 1000 - 3600 * 1000;
  return { token: j.access_token, exp };
}

async function getToken(env) {
  if (memToken && memToken.exp > Date.now()) return memToken.token;
  if (tokenInflight) return tokenInflight;
  tokenInflight = (async () => {
    try {
      if (env.STOCK_KV) {
        const hit = await env.STOCK_KV.get(TOKEN_KEY, 'json').catch(() => null);
        if (hit && hit.exp > Date.now()) { memToken = hit; return hit.token; }
      }
      const t = await issueToken(env);
      memToken = t;
      if (env.STOCK_KV) {
        const ttl = Math.max(60, Math.floor((t.exp - Date.now()) / 1000));
        await env.STOCK_KV.put(TOKEN_KEY, JSON.stringify(t), { expirationTtl: ttl }).catch(() => {});
      }
      return t.token;
    } finally { tokenInflight = null; }
  })();
  return tokenInflight;
}

// 신규 계정은 초당 호출 한도가 낮다(EGW00201). 한도에 걸리면 한 번만 쉬었다 다시 부른다.
async function getJson(env, path, trId, params, retry = true) {
  const token = await getToken(env);
  const r = await fetch(BASE + path + '?' + new URLSearchParams(params), {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      authorization: 'Bearer ' + token,
      appkey: env.KIS_APP_KEY,
      appsecret: env.KIS_APP_SECRET,
      tr_id: trId,
      custtype: 'P'
    },
    signal: AbortSignal.timeout(FETCH_MS)
  });
  const j = await r.json().catch(() => ({}));
  // 토큰이 서버에서 먼저 무효가 된 경우 — 다음 호출에서 새로 받게 비운다
  if (j.msg_cd === 'EGW00123' || j.msg_cd === 'EGW00121') { memToken = null; env.STOCK_KV && env.STOCK_KV.delete(TOKEN_KEY).catch(() => {}); }
  if (retry && j.msg_cd === 'EGW00201') { await sleep(1200); return getJson(env, path, trId, params, false); }
  if (!r.ok || j.rt_cd !== '0') throw new Error(`kis ${r.status} ${j.msg_cd || ''} ${String(j.msg1 || '').slice(0, 80)}`);
  return j;
}

const n = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/* 코스피200 선물 최근월물 단축코드 — "A01" + 연도 끝자리 + 만기월 (예: 2026-12 → A01612).
 * 만기는 3·6·9·12월 둘째 목요일. 만기일 야간장부터는 다음 월물이 최근월이다. */
export function frontMonthCode(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  let y = k.getUTCFullYear(), m = k.getUTCMonth() + 1;
  const day = k.getUTCDate();
  let qm = Math.ceil(m / 3) * 3;
  if (qm === m && day >= secondThursday(y, m)) qm += 3;
  if (qm > 12) { qm -= 12; y += 1; }
  return `A01${y % 10}${String(qm).padStart(2, '0')}`;
}
function secondThursday(y, m) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();   // 0=일
  return 1 + ((4 - first + 7) % 7) + 7;
}

function mapFutures(o, code, session) {
  return {
    code,
    session,                                   // 'day' | 'night'
    price: n(o.futs_prpr),
    change: n(o.futs_prdy_vrss),
    rate: n(o.futs_prdy_ctrt),
    open: n(o.futs_oprc), high: n(o.futs_hgpr), low: n(o.futs_lwpr),
    volume: n(o.acml_vol),
    source: 'kis'
  };
}

const CHART_PATH = '/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice';

function kstNow(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return { ymd: `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}`, ms: k.getTime() };
}
// "20260922" + "300000" → KST 기준 ms (야간 분봉은 자정 이후를 24~30시로 적는다)
function barMs(ymd, hms) {
  const h = Number(hms.slice(0, 2)), m = Number(hms.slice(2, 4));
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)), h, m);
}

/** 가장 최근 1분봉 하나 — 과거 포함(Y)으로 불러 세션이 끝난 뒤에도 마지막 봉이 온다 */
async function lastBar(env, mrkt, code, ymd) {
  const j = await getJson(env, CHART_PATH, 'FHKIF03020200', {
    FID_COND_MRKT_DIV_CODE: mrkt, FID_INPUT_ISCD: code, FID_HOUR_CLS_CODE: '60',
    FID_PW_DATA_INCU_YN: 'Y', FID_FAKE_TICK_INCU_YN: 'N', FID_INPUT_DATE_1: ymd, FID_INPUT_HOUR_1: '300000'
  });
  const b = (j.output2 || [])[0];
  if (!b || !b.stck_bsop_date || !n(b.futs_prpr)) return null;
  return { date: b.stck_bsop_date, hour: b.stck_cntg_hour, price: n(b.futs_prpr) };
}

/* 코스피200 야간선물 지수 스트립 칸.
 * KIS 시세 API 의 "당일/전일" 값은 언제 다음 세션으로 넘어가는지 알 수 없어서, 날짜가 찍혀 오는 분봉으로 판단한다.
 *   - 야간장은 주간장이 끝난 날 18:00 에 시작해 다음 날 06:00 에 끝난다. 분봉 날짜는 시작한 날이다.
 *   - 야간 분봉 날짜 == 최근 주간 분봉 날짜 → 그 주간장 뒤의 야간장이다. 기준가는 그 주간장 종가.
 *   - 주간 날짜가 더 늦으면 야간장 이후 주간장이 이미 열렸다 → 지난 값이라 숫자를 보이지 않는다.
 * 주말·연휴에는 금요일(연휴 전) 야간장 종가가 남는다 — 다음 시초가를 가늠하는 값이다. */
async function nightCell(env) {
  const code = frontMonthCode();
  const now = kstNow();
  const day = await lastBar(env, 'F', code, now.ymd);
  await sleep(GAP_MS);
  const bar = await lastBar(env, 'CM', code, now.ymd);
  const base = { code, name: '코스피 200 야간선물', decimals: 2, source: 'kis' };
  const pre = { ...base, price: null, change: null, changeRate: null, tag: '개장 전', state: 'pre' };
  if (!day) return pre;

  let price = null, live = false;
  if (bar && bar.date === day.date) {
    price = bar.price;
    live = now.ms < barMs(bar.date, '300000') && bar.hour < '300000';
  } else {
    // 진행 중인 세션이 분봉(과거 포함)에 아직 안 잡히는 경우 — 시세 API 로 받는다.
    // 거래가 있고 기준가가 최근 주간 종가와 같을 때만 그 주간장 뒤의 야간장이다.
    await sleep(GAP_MS);
    const o = (await kis.futuresRaw(env, 'CM', code)).output1 || {};
    if (!(n(o.acml_vol) > 0) || n(o.futs_sdpr) !== day.price || !n(o.futs_prpr)) return pre;
    price = n(o.futs_prpr);
    const hm = new Date(now.ms).getUTCHours() * 100 + new Date(now.ms).getUTCMinutes();
    live = hm >= 1800 || hm < 600;
  }
  const change = Math.round((price - day.price) * 100) / 100;
  return {
    ...base,
    price,
    change,
    changeRate: Math.round((change / day.price) * 10000) / 100,
    basePrice: day.price,
    tag: live ? '' : '마감',
    state: live ? 'live' : 'closed',
    session: day.date
  };
}

export const kis = {
  nightCell,
  name: 'kis',
  enabled: (env) => !!(env.KIS_APP_KEY && env.KIS_APP_SECRET),
  getToken,
  rawGet: getJson,

  /** 선물옵션 시세 원본 — mrkt: F(지수선물 주간) 등 */
  async futuresRaw(env, mrkt, code) {
    return getJson(env, '/uapi/domestic-futureoption/v1/quotations/inquire-price', 'FHMIF10000000',
      { FID_COND_MRKT_DIV_CODE: mrkt, FID_INPUT_ISCD: code });
  },

  /** 주식 호가·예상체결 원본 (FHKST01010200) — output2 에 동시호가 예상체결가가 온다 */
  async askingExpRaw(env, code) {
    return getJson(env, '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn', 'FHKST01010200',
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code });
  },

  /** 동시호가 예상체결가 { price, change, changeRate, volume } — 예상가가 없으면(장중·휴장) null */
  async expected(env, code) {
    const o = (await this.askingExpRaw(env, code)).output2 || {};
    const price = n(o.antc_cnpr);
    if (!(price > 0)) return null;
    // 부호코드: 1 상한 2 상승 3 보합 4 하한 5 하락 (네이버와 같다)
    const s = o.antc_cntg_vrss_sign, sign = s === '1' || s === '2' ? 1 : (s === '4' || s === '5' ? -1 : 0);
    return {
      price,
      change: sign * Math.abs(n(o.antc_cntg_vrss) || 0),
      changeRate: sign * Math.abs(n(o.antc_cntg_prdy_ctrt) || 0),
      volume: n(o.antc_vol),
      source: 'kis'
    };
  },

  async getFutures(env, mrkt, session, code = frontMonthCode()) {
    const j = await this.futuresRaw(env, mrkt, code);
    return mapFutures(j.output1 || {}, code, session);
  }
};
