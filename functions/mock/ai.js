// DT 모의투자 — AI 리그 (공개 AI 참가자)
//
// 기획: dt/plans/house-ai-plan-v1.md · 입력 설계: dt/plans/house-ai-input-design.md
// AI 들은 회원과 같은 장부·같은 주문 접수(engine.acceptOrder)·같은 체결(크론)을 쓴다. 다른 점은 셋:
//   ① 계좌 status 가 'ai' — 회원 순위표·최종 순위·통계(status='active' 만 센다)에 들어가지 않는다
//   ② 판단은 정규장 정해진 시각(ROUNDS)에만, 코드가 만든 '판단 카드'를 보고 한다 — 계산·한도·수량은 전부 코드
//   ③ 현금만 쓴다 (미수·신용·대출 없음 — 계좌 margin_mode 기본값 'cash')
//
// 한 라운드는 Durable Object(HouseAI) 알람으로 여러 번에 나눠 돈다. 무료 요금제는 호출 한 번에
// 외부 요청·D1 문장을 합쳐 50개까지라, 시장 → 종목 기초자료(하루 캐시) → 장중 자료 → AI 한 명씩 순서로 쪼갠다.

import { naver } from '../providers/naver.js';
import * as E from './engine.js';
import * as K from './credit.js';
import * as H from './holidays.js';

export const BOTS = [
  { id: 'gemma4-26b', name: 'Gemma 4 26B', maker: 'Google', model: '@cf/google/gemma-4-26b-a4b-it' },
  { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', maker: 'OpenAI', model: '@cf/openai/gpt-oss-120b' },
  { id: 'qwen3-30b', name: 'Qwen 3 30B', maker: 'Alibaba', model: '@cf/qwen/qwen3-30b-a3b-fp8' },
  { id: 'gpt-oss-20b', name: 'GPT-OSS 20B', maker: 'OpenAI', model: '@cf/openai/gpt-oss-20b' }
];
export const uidOf = (bot) => 'ai:' + bot.id;
export const botOfUid = (uid) => BOTS.find((b) => uidOf(b) === uid) || null;

// 정규장 판단 시각 (KST 분) — 09:05 09:45 10:30 11:15 13:00 13:45 14:30 15:15. 하루 8회 × 4명 = 32회 호출 (사용자 결정 2026-10-02)
export const ROUNDS = [9 * 60 + 5, 9 * 60 + 45, 10 * 60 + 30, 11 * 60 + 15, 13 * 60, 13 * 60 + 45, 14 * 60 + 30, 15 * 60 + 15];
const START_WINDOW = 12;                 // 정해진 시각부터 15분 안에만 시작 (크론이 놓쳐도 뒤늦게 장 마감 직전에 돌지 않게)
export const SNAP_AT = 15 * 60 + 45;     // 그날 순자산 기록 (KRX 종가가 정해진 뒤)
const ROUND_TTL = 25 * 60e3;             // 라운드가 이보다 오래 걸리면 버린다

export const LIMITS = {
  perStock: 0.30,      // 종목당 최대 비중
  perRound: 0.30,      // 한 번의 판단에서 새로 사는 비중 합계
  maxHold: 8,          // 동시 보유 종목
  newPerDay: 3,        // 하루 새로 사는 종목 수
  ordersPerDay: 40,
  actions: 3,          // 한 번의 판단에서 처리하는 행동 수
  cands: 10,           // 거래대금 상위 후보 수 (+ 보유 종목)
  staticPerStep: 6,    // 한 번 호출에 받는 종목 기초자료 수 (종목당 요청 4개)
  intraPerStep: 12     // 한 번 호출에 받는 장중 자료 수 (종목당 요청 2개)
};
const FEE_PAD = 1.001;

/** 시즌의 AI 리그 모드: off | admin(관리자에게만 보임 — 시험) | on(전체 공개) */
export function aiMode(season) { return (season && season.ai_mode) || 'off'; }
export function aiVisible(season, isAdmin) { const m = aiMode(season); return m === 'on' || (m === 'admin' && !!isAdmin); }

// ── 숫자 표기 ─────────────────────────────────────────────────
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (a, b) => (b ? r1((a / b - 1) * 100) : 0);
const sgn = (x) => (x > 0 ? '+' : '') + x;
const eok = (won) => Math.round(won / 1e8);
const won = (x) => Math.round(x).toLocaleString('en-US');
const hhmmOf = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mdOf = (ymd) => `${+ymd.slice(4, 6)}/${+ymd.slice(6, 8)}`;
const ETF_RE = /KODEX|TIGER|KBSTAR|ACE|SOL|RISE|HANARO|PLUS|ARIRANG|KOSEF|TIMEFOLIO|KIWOOM|1Q|ETN/;

// ── 판단 카드: 계산 (순수 함수 — 시험에서 그대로 부른다) ────────────

/**
 * 종목 기초자료 — 하루 한 번 받아 캐시한다 (어제까지의 일봉·수급·지표·어제 분봉)
 * @returns 카드 한 줄을 만드는 데 필요한 값만 (작게)
 */
export function staticFeatures({ day, ydayBars, deal, profile }, ymd) {
  const past = (day || []).filter((b) => String(b.t) < ymd);
  const closes = past.map((b) => b.c);
  const ma = (n) => { const s = closes.slice(-n); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
  const atr = past.length ? past.slice(-14).reduce((a, b) => a + (b.h - b.l) / b.c, 0) / Math.min(14, past.length) * 100 : null;
  const d5 = (deal || []).slice(0, 5);
  const ind = (profile && profile.indicators) || {};
  const perN = Number(String(ind.per || '').replace(/[^0-9.-]/g, ''));
  // 어제 분봉 누적 거래대금 (HHMM → 원) — 장중 거래대금을 '어제 같은 시각'과 비교한다
  const ycum = {}; let acc = 0;
  for (const b of ydayBars || []) { acc += b.c * b.v; ycum[String(b.t).slice(8, 12)] = acc; }
  return {
    ma5: ma(5), ma20: ma(20), ma60: ma(60),
    rsiCloses: closes.slice(-15),
    close20: closes.length >= 20 ? closes[closes.length - 20] : closes[0] || null,
    hi52: (day || []).length ? Math.max(...day.map((b) => b.h)) : null,
    atr: atr == null ? null : r1(atr),
    fx5: eok(d5.reduce((a, r) => a + r.foreign * r.close, 0)),
    ins5: eok(d5.reduce((a, r) => a + r.organ * r.close, 0)),
    per: !ind.per || !(perN > 0) ? '적자·없음' : perN > 200 ? '200배 초과' : ind.per,
    pbr: ind.pbr || '-',
    target: (profile && profile.consensus && profile.consensus.targetMean) || null,
    ycum
  };
}

/** 장중 자료로 카드 한 줄(5~6줄)을 만든다 */
export function cardLine(code, st, q, bars, news) {
  const px = q.price;
  const cs = [...(st.rsiCloses || []), px]; let g = 0, l = 0;
  for (let i = 1; i < cs.length; i++) { const d = cs[i] - cs[i - 1]; if (d > 0) g += d; else l -= d; }
  const rsi = l === 0 ? 100 : Math.round(100 - 100 / (1 + g / l));
  let pv = 0, vv = 0, val = 0;
  for (const b of bars || []) { pv += b.c * b.v; vv += b.v; val += b.c * b.v; }
  const vwap = vv ? pv / vv : px;
  const hm = bars && bars.length ? String(bars[bars.length - 1].t).slice(8, 12) : null;
  let yval = 0;
  if (hm && st.ycum) for (const k of Object.keys(st.ycum)) if (k <= hm && st.ycum[k] > yval) yval = st.ycum[k];
  const range = q.high - q.low, pos = range ? Math.round((px - q.low) / range * 100) : 50;
  const m30 = bars && bars.length > 30 ? pct(px, bars[bars.length - 31].c) : 0;
  const r20 = st.close20 ? pct(px, st.close20) : 0;
  const flags = [];
  if (rsi >= 75) flags.push('과열(RSI 75 이상)');
  if (r20 >= 50) flags.push('20일 50% 이상 급등 후');
  if (q.changeRate >= 20) flags.push('상한가 근접');
  if (st.fx5 < 0 && st.ins5 < 0) flags.push('외국인·기관 동반 순매도');
  const short = String(q.name || '').slice(0, 4);
  const rel = (news || []).filter((n) => short && n.title.includes(short)).slice(0, 2).map((n) => n.title.replace(/\s+/g, ' '));
  const ma = (v) => (v ? sgn(pct(px, v)) + '%' : '-');
  const line =
    `[${code} ${q.name}] ${q.market || ''} | 현재 ${won(px)}원 (${sgn(q.changeRate)}%) | 거래대금 ${won(eok(val))}억 (어제 같은 시각 대비 ${yval ? r1(val / yval) + '배' : '-'})\n` +
    `  장중: 시가대비 ${sgn(pct(px, q.open))}% · VWAP대비 ${sgn(pct(px, vwap))}% · 당일범위 위치 ${pos}% · 최근30분 ${sgn(m30)}%\n` +
    `  추세: 5일선 ${ma(st.ma5)} · 20일선 ${ma(st.ma20)} · 60일선 ${ma(st.ma60)} · RSI14 ${rsi} · 20일수익률 ${sgn(r20)}% · 52주고가대비 ${st.hi52 ? sgn(pct(px, st.hi52)) + '%' : '-'} · 하루변동폭(14일평균) ${st.atr == null ? '-' : st.atr + '%'}\n` +
    `  수급(최근5일): 외국인 ${sgn(st.fx5)}억 · 기관 ${sgn(st.ins5)}억 | 가치: PER ${st.per} · PBR ${st.pbr} · 목표가 대비 ${st.target ? sgn(pct(st.target, px)) + '%' : '-'}\n` +
    `  뉴스: ${rel.length ? rel.join(' / ') : '관련 뉴스 없음'}` + (flags.length ? `\n  ⚠ ${flags.join(' · ')}` : '');
  return { name: q.name, px, flags, atr: st.atr, line };
}

export function marketText({ idx, wf, mx, themes }, t, nextDay) {
  const ix = (o) => (o ? `${o.name} ${won(o.price)} (${sgn(o.changeRate)}%)` : '-');
  const left = Math.max(0, E.ACCEPT_TO - t.hm);
  return `## 시각\n${t.iso} ${hhmmOf(t.hm)} · 정규장 · 마감까지 ${left}분 (15:20부터 종가 단일가)${nextDay ? ` · 다음 거래일 ${mdOf(nextDay)}` : ''}\n\n## 시장\n` +
    `국내: ${ix(idx && idx.kospi)} · ${ix(idx && idx.kosdaq)} · ${ix(idx && idx.fut)}\n` +
    `해외(선물, 10분 지연): ${ix(wf && wf.nasdaq)} · ${ix(wf && wf.sp500)} | 전일 미국: ${ix(mx && mx.sox)} · VIX ${mx && mx.vix ? mx.vix.price : '-'}\n` +
    `환율·금리: 원/달러 ${mx && mx.usd ? mx.usd.price + ` (${sgn(mx.usd.changeRate)}%)` : '-'} · 미국10년 ${mx && mx.us10y ? mx.us10y.price + '%' : '-'}\n` +
    `강한 테마: ${(themes || []).map((x) => `${x.name} ${sgn(x.changeRate)}% (${x.rise}/${x.total} 상승)`).join(' · ') || '-'}`;
}

export const SYSTEM_PROMPT = `너는 DT Club 모의투자 리그의 AI 트레이더다. 회원과 똑같은 규칙(시드 1억, 수수료 0.015%, 매도세 0.20%, 실제 거래량 기준 체결)으로 매매하고, 다른 AI 트레이더들과 수익률로 경쟁한다.

[판단 원칙]
1. 스윙 매매: 보유 기간 1~20거래일. 오늘 산 종목은 오늘 팔 수 없다(손절은 코드가 자동 처리).
2. 근거는 '판단 카드'에 적힌 숫자·뉴스 제목만 쓴다. 회사 사업 내용, 업종 전망, 카드에 없는 소식을 지어내지 않는다. 최근에 많이 올랐다는 사실만으로는 매수 근거가 아니다.
3. 주문은 '후보 종목' 목록 안에서만 한다.
4. 이번 판단에서 새로 사는 비중 합계는 운용금의 30% 이하. 종목당 최대 30%, 동시 보유 최대 8종목, 하루 신규 종목 최대 3개.
5. 매수마다 손절가(stop)와 목표가(target), 예상 보유일을 정한다. 손절가는 현재가보다 낮게, '하루변동폭'을 참고해 정한다. 목표가는 예상 보유일 안에 닿을 만한 가격으로 정한다(증권사 목표가를 그대로 쓰지 않는다).
6. ⚠ 경고가 붙은 종목을 사려면 reason 에 그 경고를 감수하는 이유를 쓴다.
7. 살 근거가 약하면 사지 않는다. 관망도 좋은 판단이다.
8. 보유 종목이 있으면 holdings 에 종목마다 keep/trim/exit 를 정한다. '내 계획'의 논리가 깨졌을 때만 바꾼다.

[답 형식] JSON 하나만. 다른 글·코드블록 표시 없이.
{"market_view":"시장 한 문장",
 "actions":[{"code":"6자리","side":"buy|sell","order":"limit|market","price":지정가(정수, 시장가면 0),"weight":0~0.3,"stop":손절가,"target":목표가,"hold_days":정수,"reason":"카드의 숫자를 인용한 한두 문장"}],
 "holdings":[{"code":"6자리","decision":"keep|trim|exit","note":"한 문장"}],
 "watch":[{"code":"6자리","condition":"이런 조건이 되면 산다/판다"}]}`;

/** 모델 답에서 JSON 을 꺼낸다 — 생각 태그·코드블록 표시·앞뒤 글을 벗긴다 */
export function parseDecision(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('JSON 없음');
  const d = JSON.parse(t.slice(a, b + 1));
  if (!d || typeof d !== 'object') throw new Error('JSON 형식 아님');
  return { market_view: String(d.market_view || '').slice(0, 200), actions: Array.isArray(d.actions) ? d.actions : [],
    holdings: Array.isArray(d.holdings) ? d.holdings : [], watch: Array.isArray(d.watch) ? d.watch.slice(0, 5) : [] };
}

/** 계좌 부분 — 보유 종목마다 지난번에 쓴 계획(논리·손절·목표)을 다시 보여 준다 */
export function accountText(bot, acct, lines, ymd, last) {
  const rows = acct.positions.map((p) => {
    const px = lines[p.code] ? lines[p.code].px : Math.round(p.cost / p.qty);
    const avg = Math.round(p.cost / p.qty), th = acct.theses[p.code];
    return `- [${p.code} ${p.name}] ${won(p.qty)}주 · 평단 ${won(avg)} · 현재 ${won(px)} (${sgn(pct(px, avg))}%) · 비중 ${Math.round(px * p.qty / acct.equity * 100)}% · ${acct.boughtToday.has(p.code) ? '오늘 매수(오늘은 팔 수 없음, 손절 제외)' : '보유 중'}\n` +
      (th ? `  내 계획: 손절 ${won(th.stop)} (지금보다 ${sgn(pct(th.stop, px))}%) · 목표 ${th.target ? won(th.target) : '-'} · 예정 ${th.hold_days || '-'}일 (${mdOf(th.opened_ymd)} 매수) | 논리: ${th.thesis}`
          : '  내 계획: 없음');
  });
  return `## 내 계좌 (${bot.name})\n순자산 ${won(acct.equity)}원 (시즌 ${sgn(pct(acct.equity, acct.seed))}%) · 주문가능 ${won(acct.available)}원 · 오늘 주문 ${acct.ordersToday}건 / ${LIMITS.ordersPerDay}건 · 오늘 새로 산 종목 ${acct.boughtToday.size} / ${LIMITS.newPerDay}${acct.boughtToday.size >= LIMITS.newPerDay ? ' — 오늘은 새 종목을 살 수 없다 (보유 종목 추가 매수·매도만 가능)' : ''}\n` +
    `보유 종목: ${rows.length ? '\n' + rows.join('\n') : '없음'}\n미수·신용·대출: 쓰지 않음 (현금만)\n\n## 직전 판단\n${last ? `${last.hm} — ${last.view || '-'} / 행동: ${last.did || '없음'}` : '없음'}`;
}

/**
 * 코드 검사 — AI 의 행동을 주문 계획으로 바꾼다. 수량·호가·한도·손절가는 여기서 정한다.
 * @returns { orders: [{code, name, side, type, qty, limitPrice, plan}], notes: [] , results: [] }
 */
export function planOrders(d, { allowed, lines, acct }) {
  const out = { orders: [], results: [] };
  const reject = (a, why) => out.results.push({ code: String(a.code || ''), side: a.side, reason: a.reason, result: 'rejected', note: why });
  let roundBuy = 0, newNames = acct.boughtToday.size, holdN = acct.positions.length;
  const sold = new Set();
  const acts = (d.actions || []).slice(0, LIMITS.actions);
  // holdings 의 trim/exit 도 매도 행동으로 바꾼다 (actions 에 같은 종목 매도가 없을 때)
  for (const h of d.holdings || []) {
    if ((h.decision === 'trim' || h.decision === 'exit') && !acts.some((a) => a.code === h.code && a.side === 'sell')) {
      acts.push({ code: h.code, side: 'sell', order: 'market', weight: h.decision === 'trim' ? 0.5 : 1, reason: h.note, fromHold: h.decision });
    }
  }
  for (const a of acts) {
    const code = String(a.code || '');
    const it = lines[code];
    if (!allowed.has(code) || !it) { reject(a, '후보 목록 밖'); continue; }
    if (acct.ordersToday + out.orders.length >= LIMITS.ordersPerDay) { reject(a, '하루 주문 한도'); continue; }
    if (a.side === 'buy') {
      const held = acct.positions.find((p) => p.code === code);
      if (!held && holdN >= LIMITS.maxHold) { reject(a, `동시 보유 ${LIMITS.maxHold}종목 초과`); continue; }
      if (!held && !acct.boughtToday.has(code) && newNames >= LIMITS.newPerDay) { reject(a, `오늘 신규 ${LIMITS.newPerDay}종목 초과`); continue; }
      if (it.flags.length && !/과열|급등|상한가|순매도|경고|감수|위험/.test(String(a.reason || ''))) { reject(a, '⚠ 경고 종목인데 감수 이유 없음'); continue; }
      let w = Math.min(Math.max(Number(a.weight) || 0, 0), LIMITS.perStock);
      const have = held ? held.qty * it.px / acct.equity : 0;
      w = Math.min(w, LIMITS.perStock - have, LIMITS.perRound - roundBuy);
      if (!(w > 0.005)) { reject(a, '비중 한도'); continue; }
      let type = 'market', limitPrice = null, ref = it.px;
      if (a.order === 'limit' && Number(a.price) > 0) {
        let p = Math.min(Number(a.price), it.px);                   // 현재가보다 비싸게 사지 않는다
        p = Math.floor(p / E.tickSize(p, false)) * E.tickSize(p, false);
        if (p >= it.px * 0.9) { type = 'limit'; limitPrice = p; ref = p; }
      }
      const budget = Math.min(w * acct.equity, acct.available - out.orders.reduce((s, o) => s + (o.side === 'buy' ? o.qty * (o.limitPrice || lines[o.code].px) * FEE_PAD : 0), 0));
      const qty = Math.floor(budget / (ref * FEE_PAD));
      if (qty <= 0) { reject(a, '현금 부족'); continue; }
      const notes = [];
      let stop = Math.round(Number(a.stop));
      if (!(stop < ref && stop > ref * 0.7)) {
        stop = Math.round(ref * (1 - Math.max(2 * (it.atr || 3) / 100, 0.05)));
        notes.push('손절가 기본값(하루변동폭 2배)');
      }
      const hold = Math.min(Math.max(Math.round(Number(a.hold_days) || 10), 1), 20);
      let target = Number(a.target) > ref ? Math.round(Number(a.target)) : null;
      if (target && target > ref * (1 + 0.02 * hold + 0.05)) { notes.push(`목표가 ${won(target)}는 ${hold}일 안에 닿기 어려워 기록하지 않음`); target = null; }
      roundBuy += w;
      if (!held && !acct.boughtToday.has(code)) newNames++;
      if (!held) holdN++;
      out.orders.push({ code, name: it.name, side: 'buy', type, qty, limitPrice,
        plan: { thesis: String(a.reason || '').slice(0, 200), stop, target, hold_days: hold }, weight: r1(w * 100) / 100, notes });
    } else if (a.side === 'sell') {
      const held = acct.positions.find((p) => p.code === code);
      if (!held) { reject(a, '보유하지 않은 종목'); continue; }
      if (acct.boughtToday.has(code)) { reject(a, '오늘 산 종목은 팔 수 없음'); continue; }
      if (sold.has(code)) continue;
      const frac = Math.min(Math.max(Number(a.weight) || 1, 0), 1);
      const qty = a.fromHold === 'trim' ? Math.max(1, Math.floor(held.qty / 2))
        : frac >= held.qty * it.px / acct.equity - 0.005 || frac >= 1 ? held.qty : Math.max(1, Math.floor(held.qty * frac * acct.equity / (held.qty * it.px)));
      sold.add(code);
      out.orders.push({ code, name: it.name, side: 'sell', type: 'market', qty: Math.min(qty, held.qty), limitPrice: null,
        plan: null, exit: qty >= held.qty, reason: String(a.reason || '').slice(0, 200), notes: a.fromHold ? [`holdings: ${a.fromHold}`] : [] });
    } else reject(a, '매수·매도 구분 오류');
  }
  return out;
}

// ── 바깥 자료 ─────────────────────────────────────────────────

async function fetchStatic(code, ymd, prevYmd) {
  const y = Number(ymd.slice(0, 4));
  const [day, ydayBars, deal, profile] = await Promise.all([
    naver.getOhlc(code, 'D', { start: `${y - 1}${ymd.slice(4)}`, end: ymd }).catch(() => []),
    naver.getOhlc(code, '1m', { start: prevYmd + '0900', end: prevYmd + '1530' }).catch(() => []),
    naver.getDealTrend(code).catch(() => []),
    naver.getProfile(code).catch(() => null)
  ]);
  return staticFeatures({ day, ydayBars, deal, profile }, ymd);
}

/** Workers AI 호출 — 2분 30초 안에 답이 없으면 실패 */
async function callModel(env, model, messages) {
  if (!env.AI) throw new Error('AI 바인딩 없음');
  const r = await Promise.race([
    env.AI.run(model, { messages, max_tokens: 6000 }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('응답 시간 초과 (150초)')), 150e3))
  ]);
  const c = r && r.choices && r.choices[0];
  const text = (c && c.message && c.message.content) || (r && r.response) || '';
  return { text: String(text), usage: (r && r.usage) || {} };
}

// ── 라운드 진행 (HouseAI Durable Object 가 부른다) ─────────────────

/** 크론이 매분 부른다 — 정해진 시각이면 라운드를 시작한다. D1 은 시각이 맞을 때만 본다 */
export async function tick(env, store, now = Date.now()) {
  const t = E.kstNow(now);
  const cur = await store.get('round');
  if (cur && cur.phase !== 'done' && now - cur.startedAt < ROUND_TTL) {
    if (!(await store.getAlarm())) await store.setAlarm(now + 1000);
    return 'running';
  }
  const due = ROUNDS.find((r) => t.hm >= r && t.hm < r + START_WINDOW);
  const snapDue = t.hm >= SNAP_AT && t.hm < SNAP_AT + 30;
  if (due == null && !snapDue) return 'idle';
  const key = due != null ? `done:${t.ymd}:${due}` : `snap:${t.ymd}`;
  if (await store.get(key)) return 'done';
  const db = env.MOCK_DB;
  E.setHolidays(await H.holidaySet(db));
  if (!E.isTradingDay(t)) return 'holiday';
  const season = await E.activeSeason(db, now);
  if (!season || aiMode(season) === 'off') return 'off';
  await store.put(key, 1);
  if (due == null) { await snapshot(db, season, now); return 'snap'; }
  await store.put('round', newRound(t, due, false, now));
  await store.setAlarm(now + 500);
  return 'started';
}

/** 관리자가 지금 한 번 돌린다 — 정규장 밖이면 판단만 하고 주문은 넣지 않는다 (dry) */
export async function start(env, store, now = Date.now()) {
  const t = E.kstNow(now);
  const cur = await store.get('round');
  if (cur && cur.phase !== 'done' && now - cur.startedAt < ROUND_TTL) return { ok: false, message: '이미 판단 중입니다', round: cur.id };
  E.setHolidays(await H.holidaySet(env.MOCK_DB));
  const live = E.isTradingDay(t) && t.hm >= E.OPEN_AT && t.hm < 15 * 60 + 20;
  const r = newRound(t, t.hm, !live, now);
  r.manual = true;
  await store.put('round', r);
  await store.setAlarm(now + 500);
  return { ok: true, round: r.id, dry: r.dry };
}

function newRound(t, hm, dry, now) {
  return { id: `${t.ymd}-${hhmmOf(hm).replace(':', '')}${dry ? '-dry' : ''}`, ymd: t.ymd, hm, dry, phase: 'market', startedAt: now, tries: 0 };
}

/** 알람 한 번 = 한 단계. 끝나지 않았으면 다음 알람을 건다 */
export async function step(env, store, now = Date.now()) {
  const r = await store.get('round');
  if (!r || r.phase === 'done') return 'idle';
  if (now - r.startedAt > ROUND_TTL) { r.phase = 'done'; r.error = '시간 초과로 중단'; await store.put('round', r); return 'expired'; }
  const db = env.MOCK_DB;
  E.setHolidays(await H.holidaySet(db));
  const season = await E.activeSeason(db, now);
  if (!season) { r.phase = 'done'; await store.put('round', r); return 'no_season'; }
  try {
    if (r.phase === 'market') await phaseMarket(env, db, season, r, now);
    else if (r.phase === 'static') await phaseStatic(store, r);
    else if (r.phase === 'intraday') await phaseIntraday(store, r);
    else if (r.phase === 'think') await phaseThink(env, db, season, r, now);
    else if (r.phase === 'bots') await phaseBot(env, db, season, r, now);
    r.tries = 0;
  } catch (e) {
    r.tries = (r.tries || 0) + 1;
    console.error('ai step failed', r.id, r.phase, e && e.stack || e);
    if (r.tries >= 3) {
      // 같은 단계에서 세 번 실패 — AI 한 명이면 그 AI 만 건너뛰고, 자료 단계면 라운드를 접는다
      if (r.phase === 'bots' && r.botsLeft && r.botsLeft.length) {
        const id = r.botsLeft.shift();
        await journal(db, season, BOTS.find((b) => b.id === id), r, now, { status: 'fail', detail: { error: String(e && e.message || e).slice(0, 300) } }).catch(() => {});
        r.tries = 0;
      } else { r.phase = 'done'; r.error = String(e && e.message || e).slice(0, 300); }
    }
  }
  await store.put('round', r);
  if (r.phase !== 'done') await store.setAlarm(Date.now() + 1000);
  return r.phase;
}

async function phaseMarket(env, db, season, r, now) {
  const t = E.kstNow(now);
  // AI 계좌 — 처음이면 만든다 (status 'ai' 라 회원 순위·통계에 들어가지 않는다)
  await db.batch(BOTS.map((b) => db.prepare(
    `INSERT OR IGNORE INTO accounts (season_id, uid, nickname, cash, joined_at, status) VALUES (?,?,?,?,?, 'ai')`
  ).bind(season.id, uidOf(b), '🤖 ' + b.name, season.seed, now)));
  const [idx, wf, mx, topK, topQ, themes, held] = await Promise.all([
    naver.getIndex().catch(() => null), naver.getWorldFutures().catch(() => null), naver.getMarketExtras().catch(() => null),
    naver.getTopValue('KOSPI', 15).catch(() => []), naver.getTopValue('KOSDAQ', 15).catch(() => []), naver.getSectors('theme', 5).catch(() => []),
    db.prepare(`SELECT uid, code FROM positions WHERE season_id=? AND uid LIKE 'ai:%' AND qty > 0`).bind(season.id).all().then((x) => x.results || [])
  ]);
  // 후보: 거래대금 상위 중 개별주(ETF·우선주 제외 — 우선주에는 보통주 목표가가 붙어 나온다), 등락 ±15% 안, 거래대금 300억 이상
  const top = [...topK, ...topQ]
    .filter((s) => !ETF_RE.test(s.name) && !/우B?$/.test(s.name) && Math.abs(s.changeRate) <= 15 && s.tradingValue >= 3e10)
    .sort((a, b) => b.tradingValue - a.tradingValue).slice(0, LIMITS.cands).map((s) => s.code);
  const heldBy = {};
  for (const h of held) (heldBy[h.uid] = heldBy[h.uid] || []).push(h.code);
  r.top = top;
  r.heldBy = heldBy;
  r.codes = [...new Set([...top, ...held.map((h) => h.code)])];
  r.market = marketText({ idx, wf, mx, themes }, t, K.addTradingDays(t.ymd, 1));
  r.pendingStatic = r.codes.slice();
  r.phase = 'static';
}

async function phaseStatic(store, r) {
  const prev = K.prevTradingDay(r.ymd);
  const todo = [];
  while (r.pendingStatic.length && todo.length < LIMITS.staticPerStep) {
    const code = r.pendingStatic.shift();
    if (!(await store.get(`st:${r.ymd}:${code}`))) todo.push(code);
  }
  const got = await Promise.all(todo.map((c) => fetchStatic(c, r.ymd, prev).then((v) => [c, v])));
  for (const [c, v] of got) await store.put(`st:${r.ymd}:${c}`, v);
  if (!r.pendingStatic.length) { r.phase = 'intraday'; r.pendingIntra = r.codes.slice(); r.lines = {}; r.quotes = null; }
}

async function phaseIntraday(store, r) {
  if (!r.quotes) {
    const qs = r.codes.length ? await naver.getQuotes(r.codes) : [];
    r.quotes = {};
    for (const q of qs) r.quotes[q.code] = { name: q.name, market: q.market, price: q.price, changeRate: q.changeRate, open: q.open, high: q.high, low: q.low, halted: q.halted };
  }
  const chunk = r.pendingIntra.splice(0, LIMITS.intraPerStep);
  const now = Date.now(), t = E.kstNow(now);
  const end = `${r.ymd}${hhmmOf(Math.min(t.hm, 15 * 60 + 30)).replace(':', '')}`;
  const got = await Promise.all(chunk.map(async (code) => {
    const [bars, news] = await Promise.all([
      naver.getOhlc(code, '1m', { start: r.ymd + '0900', end }).catch(() => []),
      naver.getNews(code, 10).catch(() => [])
    ]);
    return [code, bars, news];
  }));
  for (const [code, bars, news] of got) {
    const q = r.quotes[code], st = await store.get(`st:${r.ymd}:${code}`);
    if (!q || !st || q.price == null || q.halted) continue;            // 시세가 없거나 거래정지면 후보에서 뺀다
    r.lines[code] = cardLine(code, st, q, bars, news);
  }
  if (!r.pendingIntra.length) { r.quotes = null; r.phase = 'think'; }
}

/** 4명 동시 판단 — 같은 시각의 같은 카드로 한꺼번에 묻는다. 주문은 다음 단계에서 한 명씩 넣는다 */
async function phaseThink(env, db, season, r, now, opts = {}) {
  const lines = r.lines || {};
  const states = await Promise.all(BOTS.map((b) => botState(db, season, r, b)));
  const t0 = Date.now();
  const out = await Promise.all(BOTS.map(async (bot, i) => {
    const st = states[i];
    if (!st) return [bot.id, { error: '계좌 없음' }];
    const { live } = stopsOf(st, lines);
    const acct = acctOf(st, lines, season, st.cashNet);
    const allowed = new Set([...(r.top || []), ...live.map((p) => p.code)]);
    const card = `# 판단 카드\n${r.market}\n\n${accountText(bot, { ...acct, positions: live }, lines, r.ymd, st.last)}\n\n` +
      `## 후보 종목 (코드가 고름 — 이 목록 밖 종목은 주문할 수 없다)\n${[...allowed].filter((c) => lines[c]).map((c) => lines[c].line).join('\n')}\n\n지금 무엇을 할지 정해라.`;
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: card }];
    const ask = opts.callModel || ((m) => callModel(env, bot.model, m));
    let usage = {};
    const add = (u) => { for (const k of ['prompt_tokens', 'completion_tokens', 'neurons']) usage[k] = (usage[k] || 0) + ((u || {})[k] || 0); };
    try {
      let res = await ask(messages); add(res.usage);
      try { return [bot.id, { d: parseDecision(res.text), usage, ms: Date.now() - t0 }]; }
      catch (e) {
        // JSON 이 깨지면 한 번 더 묻는다
        messages.push({ role: 'assistant', content: res.text.slice(0, 2000) }, { role: 'user', content: `답이 JSON 형식이 아니다 (${e.message}). 정해진 JSON 하나만 다시 답해라.` });
        res = await ask(messages); add(res.usage);
        try { return [bot.id, { d: parseDecision(res.text), usage, ms: Date.now() - t0 }]; }
        catch (e2) { return [bot.id, { error: '답 형식 오류: ' + e2.message, raw: res.text.slice(0, 500), usage, ms: Date.now() - t0 }]; }
      }
    } catch (e) { return [bot.id, { error: String(e && e.message || e).slice(0, 200), usage, ms: Date.now() - t0 }]; }
  }));
  r.decisions = Object.fromEntries(out);
  // 주문 넣는 순서는 라운드마다 섞는다 (라운드 id 로 정해서 다시 돌려도 같은 순서)
  let h = 0; for (const ch of r.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  r.botsLeft = BOTS.map((b) => b.id);
  for (let i = r.botsLeft.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [r.botsLeft[i], r.botsLeft[j]] = [r.botsLeft[j], r.botsLeft[i]]; }
  r.phase = 'bots';
}

async function phaseBot(env, db, season, r, now) {
  const id = r.botsLeft[0];
  const bot = BOTS.find((b) => b.id === id);
  if (bot) await applyBot(db, season, r, bot, (r.decisions || {})[id] || { error: '판단 없음' }, now);
  r.botsLeft.shift();
  if (!r.botsLeft.length) { r.phase = 'done'; r.finishedAt = Date.now(); r.decisions = null; }
}

/** AI 한 명의 계좌 상태 — 판단 때 한 번, 주문 넣을 때 한 번 더 읽는다 (그 사이 체결이 있을 수 있다) */
async function botState(db, season, r, bot) {
  const uid = uidOf(bot);
  const dayStart = Date.UTC(+r.ymd.slice(0, 4), +r.ymd.slice(4, 6) - 1, +r.ymd.slice(6, 8)) - 9 * 3600e3;
  const [accRes, posRes, ordRes, thRes, cntRes, buyRes, lastRes] = await db.batch([
    db.prepare(`SELECT * FROM accounts WHERE season_id=? AND uid=?`).bind(season.id, uid),
    db.prepare(`SELECT code, name, qty, cost FROM positions WHERE season_id=? AND uid=? AND qty > 0 ORDER BY cost DESC`).bind(season.id, uid),
    db.prepare(`SELECT id FROM orders WHERE season_id=? AND uid=? AND status IN ('open','partial')`).bind(season.id, uid),
    db.prepare(`SELECT * FROM ai_theses WHERE season_id=? AND uid=?`).bind(season.id, uid),
    db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE season_id=? AND uid=? AND trade_date=?`).bind(season.id, uid, r.ymd),
    db.prepare(`SELECT DISTINCT code FROM fills WHERE season_id=? AND uid=? AND side='buy' AND at >= ?`).bind(season.id, uid, dayStart),
    db.prepare(`SELECT hm, view, detail FROM ai_journal WHERE season_id=? AND uid=? AND status IN ('ok','dry') ORDER BY at DESC LIMIT 1`).bind(season.id, uid)
  ]);
  const account = accRes.results[0];
  if (!account) return null;
  const theses = {};
  for (const x of thRes.results || []) theses[x.code] = x;
  const l = lastRes.results[0];
  let last = null;
  if (l) {
    let did = null;
    try { did = (JSON.parse(l.detail || '{}').actions || []).filter((a) => a.result === 'placed' || a.result === 'dry').map((a) => `${a.name} ${a.side === 'buy' ? '매수' : '매도'}`).join(', '); } catch (e) {}
    last = { hm: hhmmOf(l.hm), view: l.view, did };
  }
  return { uid, account, cashNet: account.cash - (account.cash_short || 0), positions: posRes.results || [], openIds: (ordRes.results || []).map((o) => o.id),
    theses, boughtToday: new Set((buyRes.results || []).map((x) => x.code)), ordersToday: cntRes.results[0].n, last };
}
function acctOf(st, lines, season, available) {
  let stock = 0;
  for (const p of st.positions) stock += (lines[p.code] ? lines[p.code].px : p.cost / p.qty) * p.qty;
  return { equity: st.cashNet + stock, seed: season.seed, available, positions: st.positions, theses: st.theses, boughtToday: st.boughtToday, ordersToday: st.ordersToday };
}
/** 계획한 손절가 아래로 내려간 보유 종목 — AI 에게 묻지 않고 코드가 판다 (오늘 산 종목도) */
function stopsOf(st, lines) {
  const stopped = st.positions.filter((p) => { const th = st.theses[p.code], ln = lines[p.code]; return th && ln && ln.px <= th.stop; });
  const set = new Set(stopped.map((p) => p.code));
  return { stopped, live: st.positions.filter((p) => !set.has(p.code)) };
}

/** AI 한 명의 주문 — 미체결 취소 → 손절 → 코드 검사 → 주문 → 계획·기록 */
async function applyBot(db, season, r, bot, dec, now) {
  const st = await botState(db, season, r, bot);
  if (!st) return;
  const uid = st.uid, lines = r.lines || {};
  // 지난 라운드의 미체결은 모두 취소하고 새 판단대로 넣는다 (지정가가 걸린 채 판단이 엇갈리지 않게)
  if (!r.dry) for (const id of st.openIds) await E.cancelOrder(db, uid, id, now).catch(() => {});
  const account = await E.getAccount(db, season.id, uid);
  const cashNet = account.cash - (account.cash_short || 0);
  const available = r.dry ? cashNet : await E.orderableCash(db, season, account, null, now, { cashOnly: true });
  st.cashNet = cashNet;
  const acct = acctOf(st, lines, season, available);
  const detail = { stops: [], actions: [], holdings: [], watch: [] };
  const { stopped, live } = stopsOf(st, lines);
  for (const p of stopped) {
    const th = st.theses[p.code];
    const res = r.dry ? { result: 'dry' } : await place(db, season, account, r, uid, { code: p.code, side: 'sell', type: 'market', qty: p.qty }, now, `${r.id}:${bot.id}:stop:${p.code}`);
    detail.stops.push({ code: p.code, name: p.name, qty: p.qty, px: lines[p.code].px, stop: th.stop, ...res });
  }
  if (!dec.d) {
    await journal(db, season, bot, r, now, { status: 'fail', usage: dec.usage, ms: dec.ms, detail: { ...detail, error: dec.error || '응답 없음', raw: dec.raw } });
    return;
  }
  const d = dec.d;
  const accView = { ...acct, positions: live };
  const allowed = new Set([...(r.top || []), ...live.map((p) => p.code)]);
  const plan = planOrders(d, { allowed, lines, acct: accView });
  detail.actions = plan.results.map((x) => ({ ...x, name: lines[x.code] ? lines[x.code].name : x.code }));
  detail.holdings = d.holdings.slice(0, 10).map((h) => ({ code: String(h.code || ''), decision: h.decision, note: String(h.note || '').slice(0, 160) }));
  detail.watch = d.watch.map((w) => ({ code: String(w.code || ''), condition: String(w.condition || '').slice(0, 160) }));
  const thesisStmts = [];
  let i = 0;
  for (const o of plan.orders) {
    const res2 = r.dry ? { result: 'dry' } : await place(db, season, account, r, uid, o, now, `${r.id}:${bot.id}:${i++}`);
    detail.actions.push({ code: o.code, name: o.name, side: o.side, type: o.type, qty: o.qty, price: o.limitPrice, weight: o.weight,
      ...(o.plan || {}), reason: o.plan ? o.plan.thesis : o.reason, notes: o.notes, ...res2 });
    if (res2.result === 'placed') {
      if (o.side === 'buy') {
        thesisStmts.push(db.prepare(
          `INSERT INTO ai_theses (season_id, uid, code, name, thesis, stop, target, hold_days, opened_ymd, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT (season_id, uid, code) DO UPDATE SET thesis=excluded.thesis, stop=excluded.stop, target=excluded.target, hold_days=excluded.hold_days, updated_at=excluded.updated_at`
        ).bind(season.id, uid, o.code, o.name, o.plan.thesis, o.plan.stop, o.plan.target, o.plan.hold_days, r.ymd, now));
      } else if (o.exit) {
        thesisStmts.push(db.prepare(`DELETE FROM ai_theses WHERE season_id=? AND uid=? AND code=?`).bind(season.id, uid, o.code));
      }
    }
  }
  if (!r.dry) {
    for (const s2 of detail.stops) if (s2.result === 'placed') thesisStmts.push(db.prepare(`DELETE FROM ai_theses WHERE season_id=? AND uid=? AND code=?`).bind(season.id, uid, s2.code));
    // 보유도 주문 중도 아닌 계획은 지운다 (지정가가 안 맞아 취소된 매수 등)
    const keep = new Set([...st.positions.map((p) => p.code), ...plan.orders.filter((o) => o.side === 'buy').map((o) => o.code)]);
    for (const c of Object.keys(st.theses)) if (!keep.has(c)) thesisStmts.push(db.prepare(`DELETE FROM ai_theses WHERE season_id=? AND uid=? AND code=?`).bind(season.id, uid, c));
    if (thesisStmts.length) await db.batch(thesisStmts);
  }
  await journal(db, season, bot, r, now, { status: r.dry ? 'dry' : 'ok', view: d.market_view, usage: dec.usage, ms: dec.ms, detail });
}

async function place(db, season, account, r, uid, o, now, clientOrderId) {
  try {
    const q = await naver.getQuote(o.code);
    const input = { clientOrderId: clientOrderId.slice(0, 64), code: o.code, side: o.side, type: o.type, qty: o.qty, limitPrice: o.limitPrice || undefined };
    const order = await E.acceptOrder(db, season, account, input, q, false, now, { terms: K.stockTerms('stock', q.name, q), isAdmin: false });
    return { result: 'placed', orderId: order.id };
  } catch (e) {
    return { result: 'refused', note: e instanceof E.OrderError ? e.message : '주문 실패: ' + String(e && e.message || e).slice(0, 120) };
  }
}

async function journal(db, season, bot, r, now, { status, view, usage, ms, detail }) {
  const u = usage || {};
  await db.prepare(
    `INSERT INTO ai_journal (id, season_id, uid, ymd, hm, round_id, status, view, detail, tokens_in, tokens_out, neurons, ms, at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), season.id, uidOf(bot), r.ymd, r.hm, r.id, status, view || null, JSON.stringify(detail || {}),
    u.prompt_tokens || null, u.completion_tokens || null, u.neurons != null ? Math.round(u.neurons) : null, ms || null, now).run();
}

/** 그날 순자산 기록 (15:45) — 수익 곡선용. KRX 정규장 종가(15:40~16:00 시간외 종가 시간에는 종가 그대로)로 평가 */
export async function snapshot(db, season, now = Date.now()) {
  const t = E.kstNow(now);
  const [accRes, posRes] = await db.batch([
    db.prepare(`SELECT uid, cash, cash_short FROM accounts WHERE season_id=? AND status='ai'`).bind(season.id),
    db.prepare(`SELECT uid, code, qty, cost FROM positions WHERE season_id=? AND uid LIKE 'ai:%' AND qty > 0`).bind(season.id)
  ]);
  const codes = [...new Set((posRes.results || []).map((p) => p.code))];
  const qs = codes.length ? await naver.getQuotes(codes).catch(() => []) : [];
  const px = {};
  for (const q of qs) px[q.code] = (q.krx && q.krx.price) || q.price;
  const eq = {};
  for (const a of accRes.results || []) eq[a.uid] = a.cash - (a.cash_short || 0);
  for (const p of posRes.results || []) if (eq[p.uid] != null) eq[p.uid] += (px[p.code] || p.cost / p.qty) * p.qty;
  const stmts = Object.entries(eq).map(([uid, v]) => db.prepare(
    `INSERT INTO ai_daily (season_id, uid, ymd, equity) VALUES (?,?,?,?) ON CONFLICT (season_id, uid, ymd) DO UPDATE SET equity=excluded.equity`
  ).bind(season.id, uid, t.ymd, Math.round(v)));
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}
