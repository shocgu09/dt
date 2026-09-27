// 한국투자증권 KIS Open API 프로바이더 — 코스피200 선물(주간·야간) 시세
// Secrets: KIS_APP_KEY, KIS_APP_SECRET (실전 앱키, 조회만 한다)
// 접근 토큰은 24시간 유효하고 재발급이 분당 1회로 묶여 있다 → KV 에 저장해 모든 아이솔레이트가 같이 쓴다.
// KIS 는 9443 포트를 쓴다.

const BASE = 'https://openapi.koreainvestment.com:9443';
const FETCH_MS = 8000;
const TOKEN_KEY = 'kis:token';

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

async function getJson(env, path, trId, params) {
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

export const kis = {
  name: 'kis',
  enabled: (env) => !!(env.KIS_APP_KEY && env.KIS_APP_SECRET),
  getToken,
  rawGet: getJson,

  /** 선물옵션 시세 원본 — mrkt: F(지수선물 주간) 등 */
  async futuresRaw(env, mrkt, code) {
    return getJson(env, '/uapi/domestic-futureoption/v1/quotations/inquire-price', 'FHMIF10000000',
      { FID_COND_MRKT_DIV_CODE: mrkt, FID_INPUT_ISCD: code });
  },

  async getFutures(env, mrkt, session, code = frontMonthCode()) {
    const j = await this.futuresRaw(env, mrkt, code);
    return mapFutures(j.output1 || {}, code, session);
  }
};
