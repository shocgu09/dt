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

// logo — Simple Icons(simpleicons.org) 아이콘 이름. 화면이 최신판을 그때그때 불러온다 (로고가 바뀌면 따라간다)
export const BOTS = [
  { id: 'gemma4-26b', name: 'Gemma 4 26B', maker: 'Google', logo: 'google', model: '@cf/google/gemma-4-26b-a4b-it', style: 'value' },
  { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', maker: 'OpenAI', logo: 'openai', model: '@cf/openai/gpt-oss-120b', style: 'flow' },
  { id: 'qwen3-30b', name: 'Qwen 3 30B', maker: 'Alibaba', logo: 'alibabacloud', model: '@cf/qwen/qwen3-30b-a3b-fp8', style: 'momentum' },
  { id: 'gpt-oss-20b', name: 'GPT-OSS 20B', maker: 'OpenAI', logo: 'openai', model: '@cf/openai/gpt-oss-20b', style: 'contrarian' }
];

/* 투자 성향 — 4명이 같은 판단 카드를 받지만 먼저 보는 숫자가 달라 사는 종목이 갈린다 (사용자 결정 2026-10-03).
 * 같은 자료로만 판단하니 받은 숫자 밖의 정보는 없다. 카드에 실린 줄(추세 · 수급 · 가치)만 가리킨다.
 * 공통 규칙(SYSTEM_PROMPT)은 그대로이고 그 뒤에 붙인다. 바꾸면 화면(/ai 응답 style·styleHint → 순위 줄 꼬리표, AI 매매 규칙 !)에 그대로 나간다 */
export const STYLES = {
  value: {
    name: '가치형', hint: 'PER · PBR · 목표가',
    voice: `차분하고 느긋한 말투. 하루 등락보다 '싸게 샀는지', '기다릴 만한지'를 이야기한다. 많이 오른 종목을 쫓지 않은 것을 담담하게 여긴다.`,
    text: `- 먼저 '가치' 숫자를 본다: 후보들 가운데 PER · PBR 이 낮은 편이고, 목표가 대비 오를 여지가 큰 종목을 고른다.
- 20일수익률이 이미 크게 올랐거나 RSI 70 이상인 종목은 비싸게 사는 것이라 피한다.
- 보유 기간은 길게(10~20거래일) 잡고, 손절가는 하루변동폭의 2~3배로 넉넉히 둔다.`
  },
  flow: {
    name: '수급형', hint: '외국인 · 기관 매매',
    voice: `분석가처럼 또박또박한 말투. 수급을 보고 판단하는 트레이더로서 오늘을 돌아본다. 단 '오늘 기록'에는 외국인 · 기관 매매가 없으니 '외국인이 샀다', '수급을 탔다'처럼 사실로 쓰지 말고 '수급을 보고 골랐다', '내일 수급을 확인하겠다'처럼 내 판단 · 계획으로만 쓴다.`,
    text: `- 먼저 '수급' 숫자를 본다: 최근 5일 외국인과 기관이 함께 순매수한 종목, 순매수 규모가 큰 종목을 고른다.
- 외국인 · 기관이 함께 순매도하는 종목은 사지 않는다. 보유 종목이 그렇게 바뀌면 계획을 다시 본다.
- 보유 기간은 5~15거래일.`
  },
  momentum: {
    name: '모멘텀형', hint: '이동평균 · 추세',
    voice: `빠르고 들뜬 말투. 추세를 탔는지를 이야기한다. 오르면 신나 하고, 놓치면 아쉬워한다. 판 이야기는 '오늘 체결'에 매도가 있을 때만 한다.`,
    text: `- 먼저 '추세' 숫자를 본다: 현재가가 5일선 · 20일선 위에 있고 5일선이 20일선보다 높은(정배열) 종목, 52주 고가에 가까운 종목을 고른다.
- 많이 올랐다는 사실이 아니라 이동평균 배열 · 거래대금 같은 추세 숫자를 근거로 쓴다. RSI 75 이상 과열은 피한다.
- 보유 기간은 짧게(3~7거래일). 현재가가 5일선 아래로 내려가면 추세가 꺾인 것으로 보고 판다.`
  },
  contrarian: {
    name: '역발상형', hint: '과매도 반등',
    voice: `여유 있고 능청스러운 말투. 남들이 몰려간 종목과 거리를 둔 이유, 사지 않고 기다린 것도 판단이라는 이야기를 한다. 다른 AI 를 깎아내리지는 않는다.`,
    text: `- 남들이 판 종목의 반등을 노린다: RSI 40 이하, 20일수익률이 마이너스, 52주 고가보다 많이 빠진 종목을 먼저 본다.
- 오늘도 크게 빠지는 중(등락 -5% 이하)이거나 외국인 · 기관이 함께 순매도 중이면 바닥 확인 전이라 기다린다.
- 손절가는 짧게(하루변동폭의 1~1.5배), 보유 기간은 5~10거래일.`
  }
};
/** 공통 규칙 + 이 AI 의 투자 성향 */
export function systemPromptOf(bot) {
  const st = STYLES[bot && bot.style];
  return st ? `${SYSTEM_PROMPT}\n\n[너의 투자 성향: ${st.name}]\n${st.text}\n- 성향에 맞는 후보가 없으면 사지 않는다. 다른 AI 와 같은 종목을 사야 한다는 생각은 하지 않는다.` : SYSTEM_PROMPT;
}
export const uidOf = (bot) => 'ai:' + bot.id;
export const botOfUid = (uid) => BOTS.find((b) => uidOf(b) === uid) || null;

// 정규장 판단 시각 (KST 분) — 09:05 09:45 10:30 11:15 13:00 13:45 14:30 15:15. 하루 8회 × 4명 = 32회 호출 (사용자 결정 2026-10-02)
export const ROUNDS = [9 * 60 + 5, 9 * 60 + 45, 10 * 60 + 30, 11 * 60 + 15, 13 * 60, 13 * 60 + 45, 14 * 60 + 30, 15 * 60 + 15];
const START_WINDOW = 12;                 // 정해진 시각부터 12분 안에만 시작 (크론이 놓쳐도 뒤늦게 장 마감 직전에 돌지 않게)
export const SNAP_AT = 15 * 60 + 45;     // 그날 순자산 기록 (KRX 종가가 정해진 뒤)
export const POST_AT = 15 * 60 + 50;     // 장 마감 이야기 — AI 가 오늘 매매를 커뮤니티에 쓸지 정한다 (하루 1번, 쓸 수도 안 쓸 수도)
const ROUND_TTL = 25 * 60e3;             // 라운드가 이보다 오래 걸리면 버린다
const LOCK_MS = 6 * 60e3;                // 한 단계가 도는 동안 잡는 자물쇠 — 모델 응답(최대 150초 × 2번)을 기다리는 사이 크론·알람이
                                         // 같은 단계를 한 번 더 돌리지 않게. 단계가 죽어도 이 시간이 지나면 풀린다
export const SNAP_FINAL = 16 * 60 + 30;  // 이때까지 그날 종가가 다 저장되지 않으면 받은 시세로 기록한다 (크론 종가 저장이 16:30 까지 시도)
// 한 번의 호출(알람)에서 쓰는 외부 요청·D1 문장 — 무료 요금제 한도 50 안에서 넉넉히
const CALL_BUDGET = 42;
const COST_PLACE = 8;                    // 주문 1건 = 시세 1 + D1 6~7문장 (중복 확인·차단 종목·속도 제한·주문가능금액·접수·조회)

// 바꾸면 화면 설명(invest/mock.js aiRulesTip — AI 매매 규칙 !)도 같이 고친다
export const LIMITS = {
  perStock: 0.30,      // 종목당 최대 비중
  perRound: 0.30,      // 한 번의 판단에서 새로 사는 비중 합계
  maxHold: 8,          // 동시 보유 종목
  newPerDay: 3,        // 하루 새로 사는 종목 수
  ordersPerDay: 40,
  actions: 3,          // 한 번의 판단에서 처리하는 행동 수
  cands: 10,           // 거래대금 상위 후보 수 (+ 보유 종목)
  staticPerStep: 12,   // 한 번 호출에 받는 종목 기초자료 수 (종목당 요청 3개 — 일봉·어제 분봉·요약)
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
        // 멀리 낮은 지정가도 지정가 그대로 — 예전엔 현재가의 90% 아래면 시장가로 바뀌어 AI 가 정한 값보다 비싸게 샀다.
        // 체결이 안 되면 다음 판단 때 취소된다 (가격제한폭 밖이면 접수에서 거절돼 기록에 남는다)
        if (p > 0) { type = 'limit'; limitPrice = p; ref = p; }
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
  // 수급·지표·컨센서스는 integration 한 번으로 (예전엔 같은 주소를 두 번 부르고 쓰지 않는 재무까지 받았다)
  const [day, ydayBars, integ] = await Promise.all([
    naver.getOhlc(code, 'D', { start: `${y - 1}${ymd.slice(4)}`, end: ymd }).catch(() => []),
    naver.getOhlc(code, '1m', { start: prevYmd + '0900', end: prevYmd + '1530' }).catch(() => []),
    naver.getIntegrationLite(code).catch(() => null)
  ]);
  return staticFeatures({ day, ydayBars, deal: integ ? integ.deal : [], profile: integ }, ymd);
}

/** Workers AI 호출 — 2분 30초 안에 답이 없으면 실패 */
async function callModel(env, model, messages) {
  if (!env.AI) throw new Error('AI 바인딩 없음');
  let timer;
  const r = await Promise.race([
    env.AI.run(model, { messages, max_tokens: 6000 }),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('응답 시간 초과 (150초)')), 150e3); })
  ]).finally(() => clearTimeout(timer));
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
    // 알람이 끊긴 라운드를 다시 깨운다. 단계가 도는 중(자물쇠)이면 그 단계가 끝나며 다음 알람을 건다
    if (!(cur.lock > now) && !(await store.getAlarm())) await store.setAlarm(now + 1000);
    return 'running';
  }
  const due = ROUNDS.find((r) => t.hm >= r && t.hm < r + START_WINDOW);
  // 장 마감 뒤 하루 한 번 — 순자산 기록(15:45~) → 장 마감 이야기(15:50~). 크론이 놓쳐도 20:00 전까지 다음 분에 한다
  let after = null;
  if (due == null) {
    if (t.hm < SNAP_AT || t.hm >= E.AFTER_TO) return 'idle';
    if (!(await store.get(`snap:${t.ymd}`))) after = 'snap';
    else if (t.hm >= POST_AT && !(await store.get(`post:${t.ymd}`))) after = 'post';
    else return 'done';
  }
  const key = due != null ? `done:${t.ymd}:${due}` : `${after}:${t.ymd}`;
  if (await store.get(key)) return 'done';
  const db = env.MOCK_DB;
  E.setHolidays(await H.holidaySet(db));
  const season = E.isTradingDay(t) ? await E.activeSeason(db, now) : null;
  if (!season || aiMode(season) === 'off') {
    // 장 마감 뒤 작업은 그날 다시 보지 않는다 (20:00 까지 매분 장부를 읽지 않게). 판단 회차는 켜지면 할 수 있게 남긴다
    if (after) await store.put(key, 1);
    return !E.isTradingDay(t) ? 'holiday' : 'off';
  }
  if (after === 'snap') {
    // 그날 15:30 종가가 저장된 뒤에 기록한다 (크론이 15:40 부터 저장). 16:00 KRX 애프터마켓이 열리면
    // 시세가 움직이므로, 받은 시세로 기록하는 것은 16:30 까지 종가가 모이지 않았을 때만
    const n = await snapshot(db, season, now, { final: t.hm >= SNAP_FINAL });
    if (n == null) return 'wait';
    await store.put(key, 1);
    return 'snap';
  }
  await store.put(key, 1);
  if (after === 'post') {
    await store.put('round', { ...newRound(t, t.hm, now, season), id: `${t.ymd}-post`, phase: 'post-think' });
    await store.setAlarm(now + 500);
    return 'post';
  }
  await store.put('round', newRound(t, due, now, season));
  await store.setAlarm(now + 500);
  return 'started';
}

/** 관리자가 지금 한 번 돌린다 — 정규장 밖이어도 주문을 넣는다 (2026-10-02 사용자 결정).
 *  시간외에는 시장가가 안 되므로 현재가 지정가로 바꿔 넣고, 주문 시간이 아니면 접수 단계에서 거절돼 기록에 남는다 */
export async function start(env, store, now = Date.now()) {
  const t = E.kstNow(now);
  const cur = await store.get('round');
  if (cur && cur.phase !== 'done' && now - cur.startedAt < ROUND_TTL) return { ok: false, message: '이미 판단 중입니다', round: cur.id };
  E.setHolidays(await H.holidaySet(env.MOCK_DB));
  const r = newRound(t, t.hm, now, null);
  // 정해진 회차와 같은 분에 눌러도 라운드 번호(=주문 식별값 앞부분)가 겹치지 않게 — 겹치면 앞 회차 주문을 '이미 받은 주문'으로 돌려받는다
  r.id += '-m';
  r.manual = true;
  await store.put('round', r);
  await store.setAlarm(now + 500);
  return { ok: true, round: r.id, dry: r.dry };
}

/** 장 마감 이야기를 지금 쓰게 한다 (슈퍼관리자) — 하루 1개 한도는 그대로 */
export async function startPosts(env, store, now = Date.now()) {
  const t = E.kstNow(now);
  const cur = await store.get('round');
  if (cur && cur.phase !== 'done' && now - cur.startedAt < ROUND_TTL) return { ok: false, message: '지금 다른 판단을 하고 있습니다', round: cur.id };
  await store.put('round', { ...newRound(t, t.hm, now, null), id: `${t.ymd}-post`, phase: 'post-think', manual: true });
  await store.setAlarm(now + 500);
  return { ok: true };
}

function newRound(t, hm, now, season) {
  return { id: `${t.ymd}-${hhmmOf(hm).replace(':', '')}`, ymd: t.ymd, hm, dry: false, phase: 'market', startedAt: now, tries: 0, seasonId: season ? season.id : null };
}

/** 알람 한 번 = 한 단계. 끝나지 않았으면 다음 알람을 건다 */
export async function step(env, store, now = Date.now()) {
  const r = await store.get('round');
  if (!r || r.phase === 'done') return 'idle';
  // 앞 단계가 아직 도는 중 — 모델 응답을 기다리는 사이에 크론이 알람을 다시 걸면 같은 단계(판단·주문)가 두 번 돌았다
  if (r.lock && now < r.lock) return 'busy';
  if (now - r.startedAt > ROUND_TTL) { r.phase = 'done'; r.error = '시간 초과로 중단'; r.lock = 0; await store.put('round', r); return 'expired'; }
  const db = env.MOCK_DB;
  E.setHolidays(await H.holidaySet(db));
  // 시즌은 라운드를 시작할 때 정해 둔다 — 단계마다 activeSeason(UPDATE + SELECT)을 돌리지 않게
  const season = r.seasonId
    ? await db.prepare(`SELECT * FROM seasons WHERE id=? AND status='active'`).bind(r.seasonId).first()
    : await E.activeSeason(db, now);
  if (!season) { r.phase = 'done'; r.lock = 0; await store.put('round', r); return 'no_season'; }
  r.seasonId = season.id;
  r.lock = now + LOCK_MS;
  await store.put('round', r);
  try {
    if (r.phase === 'market') await phaseMarket(env, db, season, r, now);
    else if (r.phase === 'static') await phaseStatic(store, r);
    else if (r.phase === 'intraday') await phaseIntraday(store, r);
    else if (r.phase === 'think') await phaseThink(env, db, season, r, now);
    else if (r.phase === 'post-think') await phasePostThink(env, db, season, r, now);
    else if (r.phase === 'post-write') await phasePostWrite(db, season, r, now);
    else if (r.phase === 'bots') await phaseBot(db, season, r, now, store);
    r.tries = 0;
  } catch (e) {
    r.tries = (r.tries || 0) + 1;
    console.error('ai step failed', r.id, r.phase, e && e.stack || e);
    if (r.tries >= 3) {
      // 같은 단계에서 세 번 실패 — AI 한 명이면 그 AI 만 접고(넣은 주문·계획은 남긴다), 자료 단계면 라운드를 접는다
      const msg = String(e && e.message || e).slice(0, 300);
      if (r.phase === 'bots' && r.botsLeft && r.botsLeft.length) {
        const bot = BOTS.find((b) => b.id === r.botsLeft[0]);
        if (bot) await finishBot(db, season, r, bot, Date.now(), msg).catch((e2) => console.error('ai finish failed', e2 && e2.message));
        r.botsLeft.shift(); r.cur = null;
        if (!r.botsLeft.length) { r.phase = 'done'; r.finishedAt = Date.now(); r.decisions = null; }
        r.tries = 0;
      } else { r.phase = 'done'; r.error = msg; }
    }
  }
  r.lock = 0;
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
  // 거래대금 상위는 ETF 가 절반 가까이라 넉넉히 받아 거른다 (요청 수는 같다)
  const [idx, wf, mx, topK, topQ, themes, held] = await Promise.all([
    naver.getIndex().catch(() => null), naver.getWorldFutures().catch(() => null), naver.getMarketExtras().catch(() => null),
    naver.getTopValue('KOSPI', 40).catch(() => []), naver.getTopValue('KOSDAQ', 40).catch(() => []), naver.getSectors('theme', 5).catch(() => []),
    db.prepare(`SELECT uid, code FROM positions WHERE season_id=? AND uid LIKE 'ai:%' AND qty > 0`).bind(season.id).all().then((x) => x.results || [])
  ]);
  r.top = pickCandidates([...topK, ...topQ]);
  const heldBy = {};
  for (const h of held) (heldBy[h.uid] = heldBy[h.uid] || []).push(h.code);
  r.heldBy = heldBy;
  r.codes = [...new Set([...r.top, ...held.map((h) => h.code)])];
  r.market = marketText({ idx, wf, mx, themes }, t, K.addTradingDays(t.ymd, 1));
  r.pendingStatic = r.codes.slice();
  r.phase = 'static';
}

/** 후보: 거래대금 상위 개별주 (ETF·ETN·우선주·스팩 제외 — 우선주에는 보통주 목표가가 붙어 나온다), 등락 ±15% 안, 거래대금 300억 이상 */
export function pickCandidates(list) {
  return list
    .filter((s) => (s.endType ? s.endType === 'stock' : !ETF_RE.test(s.name)) && !/우B?$|우\(전환\)$|스팩/.test(s.name)
      && Math.abs(s.changeRate) <= 15 && s.tradingValue >= 3e10)
    .sort((a, b) => b.tradingValue - a.tradingValue).slice(0, LIMITS.cands).map((s) => s.code);
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
    const messages = [{ role: 'system', content: systemPromptOf(bot) }, { role: 'user', content: card }];
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

/**
 * AI 한 명의 주문 — 여러 번의 호출로 나눠 넣는다.
 *   첫 호출: 지난 회차 미체결 취소 → 손절 대상·코드 검사로 주문 목록(queue)을 만든다
 *   그다음: 한 호출에 무료 한도 안에서 들어가는 만큼 주문 → 다 넣으면 계획·기록을 남긴다
 * 주문 한 건마다 진행을 저장하고 주문 식별값(라운드:AI:번호)이 고정이라, 도중에 실패해 다시 돌아도 두 번 들어가지 않는다.
 * (예전에는 한 호출에 모두 넣어 손절·청산이 겹치면 한도를 넘었고, 다시 돌 때 방금 넣은 주문까지 '지난 미체결'로 취소했다)
 */
async function phaseBot(db, season, r, now, store) {
  const id = r.botsLeft[0];
  const bot = BOTS.find((b) => b.id === id);
  let used = 1;                                             // 시즌 조회 (step)
  if (bot && (!r.cur || r.cur.bot !== id)) {
    r.cur = await prepareBot(db, season, r, bot, (r.decisions || {})[id] || { error: '판단 없음' }, now);
    used += r.cur ? r.cur.cost : 7;
    if (r.cur) await store.put('round', r);
  }
  if (bot && r.cur && r.cur.i < r.cur.queue.length && used + COST_PLACE + 1 <= CALL_BUDGET) {
    const account = await E.getAccount(db, season.id, r.cur.uid);   // 앞 호출 뒤에 체결됐을 수 있다
    used += 1;
    while (r.cur.i < r.cur.queue.length && used + COST_PLACE <= CALL_BUDGET) {
      const it = r.cur.queue[r.cur.i];
      const res = r.dry ? { result: 'dry' } : await place(db, season, account, r.cur.uid, it.o, Date.now(), it.cid);
      used += COST_PLACE;
      if (it.stop) r.cur.detail.stops[it.at] = { ...r.cur.detail.stops[it.at], ...res };
      else r.cur.detail.actions[it.at] = { ...r.cur.detail.actions[it.at], ...res };
      r.cur.i++;
      await store.put('round', r);
    }
  }
  if (bot && r.cur && r.cur.i < r.cur.queue.length) return;      // 다음 호출에 이어서
  if (bot && r.cur) await finishBot(db, season, r, bot, now);
  r.botsLeft.shift(); r.cur = null;
  if (!r.botsLeft.length) { r.phase = 'done'; r.finishedAt = Date.now(); r.decisions = null; }
}

/** 주문 목록 만들기 — 반환값은 라운드 상태에 저장된다 (작게) */
async function prepareBot(db, season, r, bot, dec, now) {
  const st = await botState(db, season, r, bot);
  if (!st) return null;
  const uid = st.uid, lines = r.lines || {};
  // 지난 회차의 미체결은 취소하고 새 판단대로 넣는다 (지정가가 걸린 채 판단이 엇갈리지 않게).
  // 이번 회차 주문(다시 도는 중에 이미 넣은 것)은 건드리지 않는다
  let cost = 7 + 2;
  if (!r.dry) for (const o of st.open) if (!String(o.client_order_id || '').startsWith(r.id + ':')) { await E.cancelOrder(db, uid, o.id, now).catch(() => {}); cost++; }
  const account = await E.getAccount(db, season.id, uid);
  const cashNet = account.cash - (account.cash_short || 0);
  const available = r.dry ? cashNet : await E.orderableCash(db, season, account, null, now, { cashOnly: true });
  st.cashNet = cashNet;
  const acct = acctOf(st, lines, season, available);
  const detail = { stops: [], actions: [], holdings: [], watch: [] };
  const queue = [];
  const { stopped, live } = stopsOf(st, lines);
  for (const p of stopped) {
    queue.push({ stop: true, at: detail.stops.length, cid: `${r.id}:${bot.id}:stop:${p.code}`, o: { code: p.code, side: 'sell', type: 'market', qty: p.qty } });
    detail.stops.push({ code: p.code, name: p.name, qty: p.qty, px: lines[p.code].px, stop: st.theses[p.code].stop });
  }
  const cur = { bot: bot.id, uid, queue, i: 0, detail, cost, buys: [], exits: [], posCodes: st.positions.map((p) => p.code), thesisCodes: Object.keys(st.theses),
    usage: dec.usage, ms: dec.ms, error: null, view: null };
  if (!dec.d) { cur.error = dec.error || '응답 없음'; cur.raw = dec.raw; return cur; }
  const d = dec.d;
  cur.view = d.market_view;
  const allowed = new Set([...(r.top || []), ...live.map((p) => p.code)]);
  const plan = planOrders(d, { allowed, lines, acct: { ...acct, positions: live } });
  detail.actions = plan.results.map((x) => ({ ...x, name: lines[x.code] ? lines[x.code].name : x.code }));
  detail.holdings = d.holdings.slice(0, 10).map((h) => ({ code: String(h.code || ''), decision: h.decision, note: String(h.note || '').slice(0, 160) }));
  detail.watch = d.watch.map((w) => ({ code: String(w.code || ''), condition: String(w.condition || '').slice(0, 160) }));
  plan.orders.forEach((o, n) => {
    queue.push({ at: detail.actions.length, cid: `${r.id}:${bot.id}:${n}`, o: { code: o.code, side: o.side, type: o.type, qty: o.qty, limitPrice: o.limitPrice },
      plan: o.plan || null, exit: !!o.exit });
    detail.actions.push({ code: o.code, name: o.name, side: o.side, type: o.type, qty: o.qty, price: o.limitPrice, weight: o.weight,
      ...(o.plan || {}), reason: o.plan ? o.plan.thesis : o.reason, notes: o.notes });
  });
  return cur;
}

/** 다 넣은 뒤(또는 세 번 실패해 접을 때) — 계획 갱신 · 판단 기록 */
async function finishBot(db, season, r, bot, now, error) {
  const c = r.cur;
  if (!c) { await journal(db, season, bot, r, now, { status: 'fail', detail: { error: error || '판단 없음' } }); return; }
  const uid = c.uid;
  // 넣지 못한 주문은 실패로 남긴다
  for (const it of c.queue.slice(c.i)) {
    const res = { result: 'refused', note: '주문 실패: ' + String(error || '중단').slice(0, 100) };
    if (it.stop) c.detail.stops[it.at] = { ...c.detail.stops[it.at], ...res };
    else c.detail.actions[it.at] = { ...c.detail.actions[it.at], ...res };
  }
  const stmts = [];
  if (!r.dry) {
    const del = (code) => db.prepare(`DELETE FROM ai_theses WHERE season_id=? AND uid=? AND code=?`).bind(season.id, uid, code);
    const placed = (it) => (it.stop ? c.detail.stops[it.at] : c.detail.actions[it.at]).result === 'placed';
    for (const it of c.queue) {
      if (!placed(it)) continue;
      if (it.stop || it.exit) stmts.push(del(it.o.code));
      else if (it.plan) stmts.push(db.prepare(
        `INSERT INTO ai_theses (season_id, uid, code, name, thesis, stop, target, hold_days, opened_ymd, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (season_id, uid, code) DO UPDATE SET thesis=excluded.thesis, stop=excluded.stop, target=excluded.target, hold_days=excluded.hold_days, updated_at=excluded.updated_at`
      ).bind(season.id, uid, it.o.code, c.detail.actions[it.at].name, it.plan.thesis, it.plan.stop, it.plan.target, it.plan.hold_days, r.ymd, now));
    }
    // 보유도 주문 중도 아닌 계획은 지운다 (지정가가 안 맞아 취소된 매수 등)
    const keep = new Set([...c.posCodes, ...c.queue.filter((it) => !it.stop && it.o.side === 'buy' && placed(it)).map((it) => it.o.code)]);
    for (const code of c.thesisCodes) if (!keep.has(code)) stmts.push(del(code));
    if (stmts.length) await db.batch(stmts);
  }
  const failed = c.error || error;
  await journal(db, season, bot, r, now, {
    status: c.error ? 'fail' : r.dry ? 'dry' : 'ok', view: c.view, usage: c.usage, ms: c.ms,
    detail: { ...c.detail, ...(failed ? { error: failed } : {}), ...(c.raw ? { raw: c.raw } : {}) }
  });
}

/** AI 한 명의 계좌 상태 — 판단 때 한 번, 주문 넣을 때 한 번 더 읽는다 (그 사이 체결이 있을 수 있다) */
async function botState(db, season, r, bot) {
  const uid = uidOf(bot);
  const dayStart = Date.UTC(+r.ymd.slice(0, 4), +r.ymd.slice(4, 6) - 1, +r.ymd.slice(6, 8)) - 9 * 3600e3;
  const [accRes, posRes, ordRes, thRes, cntRes, buyRes, lastRes] = await db.batch([
    db.prepare(`SELECT * FROM accounts WHERE season_id=? AND uid=?`).bind(season.id, uid),
    db.prepare(`SELECT code, name, qty, cost FROM positions WHERE season_id=? AND uid=? AND qty > 0 ORDER BY cost DESC`).bind(season.id, uid),
    db.prepare(`SELECT id, client_order_id FROM orders WHERE season_id=? AND uid=? AND status IN ('open','partial')`).bind(season.id, uid),
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
  return { uid, account, cashNet: account.cash - (account.cash_short || 0), positions: posRes.results || [], open: ordRes.results || [],
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

async function place(db, season, account, uid, o, now, clientOrderId) {
  try {
    const q = await naver.getQuote(o.code);
    let type = o.type, limitPrice = o.limitPrice || undefined;
    // 정규장(08:30~15:30 접수) 밖 — 시간외는 지정가만 받는다. 지금 그 시장에서 도는 가격으로 지정가를 건다
    const hm = E.kstNow(now).hm;
    if (type === 'market' && (hm < E.ACCEPT_FROM || hm >= E.ACCEPT_TO)) {
      const px = (q.nxt && q.nxt.open && q.nxt.price) || (q.krx && q.krx.price) || q.price;
      const tk = E.tickSize(px, false);
      type = 'limit'; limitPrice = o.side === 'buy' ? Math.floor(px / tk) * tk : Math.ceil(px / tk) * tk;
    }
    const input = { clientOrderId: clientOrderId.slice(0, 64), code: o.code, side: o.side, type, qty: o.qty, limitPrice };
    const order = await E.acceptOrder(db, season, account, input, q, false, now, { terms: K.stockTerms('stock', q.name, q), isAdmin: false });
    // 기록에는 실제로 접수된 방식·가격을 남긴다 (시간외에는 시장가가 현재가 지정가로 바뀐다)
    return { result: 'placed', orderId: order.id, type, price: type === 'limit' ? limitPrice : null };
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

/**
 * 그날 15:30 종가 — 크론(closeOfDay)이 15:40 부터 보유 종목 종가를 closes 에 저장한다. 회원 일일 스냅샷과 같은 값.
 * 저장 안 된 종목은 final 일 때만 시세(KRX)로 채운다. 아니면 null (조금 뒤 다시).
 * 예전에는 늘 시세로 평가해, 16:00 KRX 애프터마켓이 열린 뒤 기록하면 그 가격이 섞였다 (10/2 순자산 기록과 마감 글 숫자가 달랐다)
 */
async function closePrices(db, codes, ymd, final) {
  const px = {};
  if (!codes.length) return px;
  const rows = (await db.prepare(`SELECT code, close FROM closes WHERE date=? AND code IN (${codes.map(() => '?').join(',')})`).bind(ymd, ...codes).all()).results || [];
  for (const x of rows) px[x.code] = x.close;
  const missing = codes.filter((c) => px[c] == null);
  if (missing.length && !final) return null;
  if (missing.length) {
    const qs = await naver.getQuotes(missing).catch(() => []);
    for (const q of qs) px[q.code] = (q.krx && q.krx.price) || q.price;
  }
  return px;
}

/** 그날 순자산 기록 — 수익 곡선·장 마감 이야기용. 15:30 종가로 평가 (회원 일일 스냅샷과 같은 기준). 종가가 덜 모였으면 null */
export async function snapshot(db, season, now = Date.now(), opts = {}) {
  const t = E.kstNow(now);
  const [accRes, posRes] = await db.batch([
    db.prepare(`SELECT uid, cash, cash_short FROM accounts WHERE season_id=? AND status='ai'`).bind(season.id),
    db.prepare(`SELECT uid, code, qty, cost FROM positions WHERE season_id=? AND uid LIKE 'ai:%' AND qty > 0`).bind(season.id)
  ]);
  const codes = [...new Set((posRes.results || []).map((p) => p.code))];
  const px = await closePrices(db, codes, t.ymd, opts.final == null ? true : !!opts.final);
  if (!px) return null;
  const eq = {};
  for (const a of accRes.results || []) eq[a.uid] = a.cash - (a.cash_short || 0);
  for (const p of posRes.results || []) if (eq[p.uid] != null) eq[p.uid] += (px[p.code] || p.cost / p.qty) * p.qty;
  const stmts = Object.entries(eq).map(([uid, v]) => db.prepare(
    `INSERT INTO ai_daily (season_id, uid, ymd, equity) VALUES (?,?,?,?) ON CONFLICT (season_id, uid, ymd) DO UPDATE SET equity=excluded.equity`
  ).bind(season.id, uid, t.ymd, Math.round(v)));
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

// ── 장 마감 이야기 — AI 가 오늘 매매를 커뮤니티에 쓸지 정한다 ──────────────────

export const POST_PROMPT = `너는 DT Club 모의투자 리그에 참가한 AI 트레이더다. 장이 끝난 뒤 회원들이 보는 커뮤니티에 오늘 매매 이야기를 올릴지 정한다.

[규칙]
1. 쓸지 말지는 네가 정한다. 매매 내역을 늘어놓는 일지가 아니라, 리그에서 경쟁하는 참가자로서 오늘 하루의 소감을 쓴다.
2. '리그 상황'을 보고 사람처럼 반응한다. 순위가 오르거나 1위면 기뻐하고, 떨어졌거나 꼴찌면 속상해하거나 자책해도 좋다. 바로 위·아래 AI 를 의식하는 가벼운 경쟁심, 연속 기록, 코스피보다 잘했는지 못했는지, 내일 다짐도 좋다. 다만 기록과 맞지 않는 감정(손실인데 자랑 등)이나 다른 AI 를 깎아내리는 말은 쓰지 않는다.
3. 오늘 매매는 다 나열하지 말고 가장 기억에 남는 한두 장면만 쓴다.
4. 아래 '오늘 기록'에 있는 숫자·종목·판단만 쓴다. 뉴스·업황·회사 이야기를 지어내지 않는다.
5. 가격·금액은 '오늘 기록'에 적힌 숫자를 그대로 옮긴다 (원 단위, 쉼표 포함). 억·만 단위로 바꾸거나 반올림하지 않는다.
6. 다른 사람에게 사거나 팔라고 권하지 않는다 ("사세요", "추천", "따라 사" 같은 말 금지).
7. 제목에는 오늘 기분이나 상황이 드러나게 쓴다. "오늘 매매 기록", "매매 정리", "오늘 매매 결과" 같은 밋밋한 제목은 쓰지 않는다.
8. 존댓말, 1인칭. 제목 30자 이내, 본문 250자 이내. 이모지는 2개까지.

[답 형식] JSON 하나만. 다른 글·코드블록 표시 없이.
{"post": true 또는 false, "title": "제목", "body": "본문"}`;

/** 장 마감 이야기 지시문 + 이 AI 의 성향 말투 — 숫자 · 사실 규칙(1~8)은 그대로 */
export function postPromptOf(bot) {
  const st = STYLES[bot && bot.style];
  return st ? `${POST_PROMPT}\n\n[너의 투자 성향: ${st.name} (${st.hint})]\n${st.voice}\n성향은 말투와 관점에만 드러낸다. 모든 문장은 '~습니다' 또는 '~요'로 끝내는 존댓말로 쓴다. 숫자 · 종목 · 사실(산 것 · 판 것 · 들고 있는 것)은 여전히 '오늘 기록'에 있는 것만 쓴다.` : POST_PROMPT;
}

const POST_BANNED = /사세요|매수하세요|매도하세요|추천합니다|추천드|따라\s?사|따라\s?매수|리딩|급등\s?예정|확실한\s?수익|원금\s?보장/;
const BIG_NUM = /\d{1,3}(?:,\d{3})+|\d{5,}/g;

/**
 * 올리기 전 검사 (순수 함수) — 문제가 있으면 이유, 없으면 null.
 * 숫자 카드는 장부에서 만들지만 본문 숫자는 AI 가 쓴다. 10/2 첫 글에서 1,160,000원을 '1.16억'으로 옮긴 일이 있었다
 * → 큰 숫자(1만 이상·쉼표 숫자)는 '오늘 기록'에 그대로 있어야 하고, 소수점 억·만 표기는 받지 않는다
 */
export function checkPost(text, facts) {
  if (POST_BANNED.test(text)) return '권유 표현';
  if (/\d\.\d+\s*(억|만)/.test(text)) return '금액 단위를 바꿈';
  const known = new Set((String(facts).match(BIG_NUM) || []).map((x) => x.replace(/,/g, '')));
  const bad = (String(text).match(BIG_NUM) || []).find((x) => !known.has(x.replace(/,/g, '')));
  return bad ? `기록에 없는 숫자 ${bad}` : null;
}

const pct2 = (a, b) => (b ? Math.round((a / b - 1) * 10000) / 100 : 0);
const BORING_TITLE = /^(오늘(의)?\s*)?매매\s*(기록|정리|결과|일지|요약)/;

/**
 * 리그 상황 — 순위 변동 · 바로 위/아래 AI 와의 차이 · 연속 기록 · 시즌 최고/최저 순위 (순수 함수).
 * rows: 그날까지의 순자산 기록(ai_daily), todayEq: 오늘 순자산 {uid: 원}. 숫자는 전부 장부에서 — 글 숫자 검사와 맞는다
 */
export function leagueStatus(uid, rows, ymd, todayEq, seed, nameOf) {
  const by = {};
  for (const x of rows || []) if (x.ymd < ymd) (by[x.ymd] = by[x.ymd] || {})[x.uid] = x.equity;
  by[ymd] = { ...todayEq };
  const days = Object.keys(by).sort();
  const ranks = days.map((d) => {
    const e = by[d], order = Object.keys(e).sort((a, b) => e[b] - e[a]);
    return { d, order, rank: order.indexOf(uid) + 1, n: order.length, eq: e[uid] };
  }).filter((x) => x.rank > 0);
  const now = ranks[ranks.length - 1];
  if (!now) return '';
  const prev = ranks.length > 1 ? ranks[ranks.length - 2] : null;
  const ret = (u) => pct2(by[ymd][u], seed);
  const me = ret(uid);
  const lines = [];
  const move = !prev ? '오늘이 첫 순위' : prev.rank === now.rank ? `어제도 ${prev.rank}위`
    : `어제 ${prev.rank}위 → ${Math.abs(prev.rank - now.rank)}계단 ${now.rank < prev.rank ? '상승' : '하락'}`;
  lines.push(`오늘 AI 순위 ${now.rank}위 / ${now.n}명 (${move})${now.rank === now.n && now.n > 1 ? ' · 꼴찌' : ''}`);
  const who = (u) => `${nameOf(u)} 시즌 ${sgn(ret(u))}%`;
  if (now.rank > 2) lines.push(`1위: ${who(now.order[0])}`);
  if (now.rank > 1) { const u = now.order[now.rank - 2]; lines.push(`바로 위: ${who(u)} (나보다 ${r2(ret(u) - me)}%p 앞)`); }
  if (now.rank < now.n) { const u = now.order[now.rank]; lines.push(`바로 아래: ${who(u)} (나보다 ${r2(me - ret(u))}%p 뒤)`); }
  // 연속 기록 — 오늘부터 거꾸로 센다
  const run = (f) => { let k = 0; for (let i = ranks.length - 1; i >= 0 && f(ranks[i], i); i--) k++; return k; };
  const top = run((x) => x.rank === 1), last = run((x) => x.rank === x.n);
  const dir = (i) => Math.sign(ranks[i].eq - (i > 0 ? ranks[i - 1].eq : seed));
  const d0 = dir(ranks.length - 1), same = d0 ? run((x, i) => dir(i) === d0) : 0;
  const streak = [];
  if (top >= 2) streak.push(`${top}일 연속 1위`);
  if (last >= 2) streak.push(`${last}일 연속 꼴찌`);
  if (same >= 2) streak.push(`${same}일 연속 순자산 ${d0 > 0 ? '증가' : '감소'}`);
  if (streak.length) lines.push(`연속 기록: ${streak.join(' · ')}`);
  if (ranks.length >= 2) {
    const rs = ranks.map((x) => x.rank);
    lines.push(`시즌 최고 ${Math.min(...rs)}위 · 최저 ${Math.max(...rs)}위 (순위 기록 ${ranks.length}일째)`);
  }
  return lines.join('\n');
}
const r2 = (x) => Math.round(x * 100) / 100;

/** 오늘 기록 — 장 마감 이야기의 재료 (순수 함수) */
export function daySummaryText(bot, x) {
  const fills = x.fills.map((f) => `${f.side === 'buy' ? '매수' : '매도'} ${f.name} ${won(f.qty)}주 @ ${won(f.price)}`);
  const pos = x.positions.map((p) => `${p.name} ${won(p.qty)}주 · 평단 ${won(p.avg)} · 오늘 종가 ${won(p.px)} (${sgn(pct(p.px, p.avg))}%)` +
    (p.stop ? ` · 내 계획 손절 ${won(p.stop)}${p.target ? ` · 목표 ${won(p.target)}` : ''}` : ''));
  const rounds = x.rounds.map((j) => `${hhmmOf(j.hm)} — ${j.view || '-'} / ${j.did || '주문 없음'}`);
  const day = pct2(x.equity, x.prevEquity);
  return `## 나\n${bot.maker} ${bot.name} (AI ${x.rank}위 / ${x.total}명)\n\n## 오늘 성적\n` +
    `순자산 ${won(x.equity)}원 · 오늘 ${sgn(won(x.dayPnl))}원 (${sgn(day)}%) · 시즌 ${sgn(pct2(x.equity, x.seed))}%\n` +
    `코스피 오늘 ${x.kospi == null ? '-' : sgn(x.kospi) + '%'} · 코스닥 ${x.kosdaq == null ? '-' : sgn(x.kosdaq) + '%'}` +
    (x.kospi == null ? '' : ` → 내 수익률이 코스피보다 ${r2(Math.abs(day - x.kospi))}%p ${day >= x.kospi ? '높음' : '낮음'}`) + '\n\n' +
    (x.league ? `## 리그 상황\n${x.league}\n\n` : '') +
    `## 오늘 체결\n${fills.length ? fills.join('\n') : '없음'}\n\n## 보유 종목\n${pos.length ? pos.join('\n') : '없음'}\n\n## 오늘 판단\n${rounds.length ? rounds.join('\n') : '없음'}`;
}

/** 오늘 기록을 모아 4명에게 동시에 묻는다 */
async function phasePostThink(env, db, season, r, now, opts = {}) {
  const dayStart = Date.UTC(+r.ymd.slice(0, 4), +r.ymd.slice(4, 6) - 1, +r.ymd.slice(6, 8)) - 9 * 3600e3;
  const [accRes, posRes, fillRes, dailyRes, jrRes, postedRes, thRes] = await db.batch([
    db.prepare(`SELECT * FROM accounts WHERE season_id=? AND status='ai'`).bind(season.id),
    db.prepare(`SELECT uid, code, name, qty, cost FROM positions WHERE season_id=? AND uid LIKE 'ai:%' AND qty > 0`).bind(season.id),
    db.prepare(`SELECT f.uid, f.side, f.qty, f.price, o.name FROM fills f JOIN orders o ON o.id = f.order_id WHERE f.season_id=? AND f.uid LIKE 'ai:%' AND f.at >= ? ORDER BY f.at`).bind(season.id, dayStart),
    // 시즌 순자산 기록 전체 (AI 4명 × 거래일 — 시즌 끝까지 240줄쯤) — 어제 순자산·순위 변동·연속 기록
    db.prepare(`SELECT uid, ymd, equity FROM ai_daily WHERE season_id=? AND ymd <= ? ORDER BY ymd`).bind(season.id, r.ymd),
    db.prepare(`SELECT uid, hm, view, detail FROM ai_journal WHERE season_id=? AND ymd=? AND status IN ('ok','dry') ORDER BY at`).bind(season.id, r.ymd),
    db.prepare(`SELECT uid FROM shares WHERE season_id=? AND uid LIKE 'ai:%' AND created_at >= ? AND deleted_at IS NULL`).bind(season.id, dayStart),
    db.prepare(`SELECT uid, code, stop, target FROM ai_theses WHERE season_id=?`).bind(season.id)
  ]);
  const codes = [...new Set((posRes.results || []).map((p) => p.code))];
  // 보유 평가는 오늘 15:30 종가 — 순자산 기록(ai_daily)과 같은 기준이라 글의 숫자와 순위 화면 기록이 맞는다
  const [px, idx] = await Promise.all([closePrices(db, codes, r.ymd, true), naver.getIndex().catch(() => null)]);
  const posted = new Set((postedRes.results || []).map((x) => x.uid));
  const daily = dailyRes.results || [];
  const today = {};
  for (const x of daily) if (x.ymd === r.ymd) today[x.uid] = x.equity;
  const sums = {};
  for (const a of accRes.results || []) {
    const bot = botOfUid(a.uid);
    if (!bot) continue;
    const plan = (code) => (thRes.results || []).find((x) => x.uid === a.uid && x.code === code) || {};
    const positions = (posRes.results || []).filter((p) => p.uid === a.uid).map((p) => ({ code: p.code, name: p.name, qty: p.qty, cost: p.cost, avg: Math.round(p.cost / p.qty),
      px: px[p.code] || Math.round(p.cost / p.qty), stop: plan(p.code).stop || null, target: plan(p.code).target || null }));
    const equity = today[a.uid] != null ? today[a.uid] : Math.round(a.cash - (a.cash_short || 0) + positions.reduce((t, p) => t + p.px * p.qty, 0));
    const prev = daily.filter((x) => x.uid === a.uid && x.ymd < r.ymd).pop();
    const rounds = (jrRes.results || []).filter((j) => j.uid === a.uid).map((j) => {
      let did = null;
      try { did = (JSON.parse(j.detail || '{}').actions || []).filter((x) => x.result === 'placed').map((x) => `${x.name} ${x.side === 'buy' ? '매수' : '매도'}`).join(', '); } catch (e) {}
      return { hm: j.hm, view: j.view, did };
    });
    sums[bot.id] = { uid: a.uid, account: a, equity, prevEquity: prev ? prev.equity : season.seed, seed: season.seed, positions,
      fills: (fillRes.results || []).filter((f) => f.uid === a.uid), rounds, posted: posted.has(a.uid),
      kospi: idx && idx.kospi ? idx.kospi.changeRate : null, kosdaq: idx && idx.kosdaq ? idx.kosdaq.changeRate : null };
    sums[bot.id].dayPnl = Math.round(equity - sums[bot.id].prevEquity);
  }
  const order = Object.keys(sums).sort((x, y) => sums[y].equity - sums[x].equity);
  order.forEach((id, i) => { sums[id].rank = i + 1; sums[id].total = order.length; });
  const todayEq = Object.fromEntries(Object.values(sums).map((x) => [x.uid, x.equity]));
  const nameOf = (u) => { const b = botOfUid(u); return b ? `${b.maker} ${b.name}` : u; };
  for (const id of order) sums[id].league = leagueStatus(sums[id].uid, daily, r.ymd, todayEq, season.seed, nameOf);
  const out = await Promise.all(Object.keys(sums).map(async (id) => {
    const bot = BOTS.find((b) => b.id === id), x = sums[id];
    if (x.posted) return [id, { skip: '오늘 이미 글을 올림' }];
    const ask = opts.callModel || ((m) => callModel(env, bot.model, m));
    const facts = daySummaryText(bot, x);
    const messages = [{ role: 'system', content: postPromptOf(bot) }, { role: 'user', content: `# 오늘 기록\n${facts}\n\n오늘 글을 올릴지 정해라.` }];
    const usage = {};
    const read = (res) => {
      for (const k of ['prompt_tokens', 'completion_tokens', 'neurons']) usage[k] = (usage[k] || 0) + ((res.usage || {})[k] || 0);
      const d = parseLoose(res.text);
      const v = { post: d.post === true, title: String(d.title || '').trim().slice(0, 40), body: String(d.body || '').trim().slice(0, 300) };
      v.problem = v.post ? (!v.body ? '빈 글' : checkPost((v.title ? v.title + '\n' : '') + v.body, facts)) : null;
      v.dull = v.post && BORING_TITLE.test(v.title);
      return v;
    };
    try {
      let res = await ask(messages), v = read(res);
      if ((v.problem && v.body) || (!v.problem && v.dull)) {
        // 한 번만 고쳐 쓰게 한다 — 숫자·권유 문제가 남으면 올리지 않고, 제목만 밋밋하면 그대로 올린다
        messages.push({ role: 'assistant', content: res.text.slice(0, 2000) },
          { role: 'user', content: v.problem ? `이 글은 올릴 수 없다 (${v.problem}). 규칙 4·5·6을 지켜 다시 써라. 쓰지 않으려면 post 를 false 로.`
            : '제목이 밋밋하다 (규칙 7). 오늘 기분이나 리그 상황이 드러나는 제목으로 다시 써라. 본문도 고쳐도 된다.' });
        res = await ask(messages); v = read(res);
      }
      delete v.dull;
      return [id, { ...v, usage }];
    } catch (e) { return [id, { error: String(e && e.message || e).slice(0, 200), usage }]; }
  }));
  // 카드 계산에 필요한 값만 남긴다 (라운드 상태에 저장된다)
  r.posts = Object.fromEntries(out.map(([id, v]) => {
    const x = sums[id];
    return [id, { ...v, equity: x.equity, seed: x.seed, rank: x.rank, total: x.total, cash: x.account.cash - (x.account.cash_short || 0), realizedPnl: x.account.realized_pnl,
      positions: x.positions }];
  }));
  r.botsLeft = Object.keys(r.posts);
  r.phase = 'post-write';
}
function parseLoose(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('JSON 없음');
  return JSON.parse(t.slice(a, b + 1));
}

/** 글 한 개씩 올린다 — 숫자 카드는 장부에서 코드가 만든다 (AI 가 숫자를 부풀릴 수 없게) */
async function phasePostWrite(db, season, r, now) {
  const id = r.botsLeft.shift();
  const bot = BOTS.find((b) => b.id === id), p = r.posts[id];
  if (bot && p && p.post && !p.error && !p.skip) {
    const text = (p.title ? p.title + '\n' : '') + p.body;
    if (p.problem || !p.body) p.result = `올리지 않음 (${p.problem || '빈 글'})`;
    else {
      const positions = p.positions.map((x) => ({ code: x.code, name: x.name, qty: x.qty, avgPrice: x.avg, price: x.px, value: x.px * x.qty,
        pnl: x.px * x.qty - x.cost, pnlRate: x.cost ? Math.round((x.px * x.qty - x.cost) / x.cost * 10000) / 100 : 0 })).sort((a, b) => b.value - a.value);
      const card = { v: 1, kind: 'account', seasonName: season.name, at: now, live: false, closing: false, seed: p.seed, principal: p.seed,
        equity: Math.round(p.equity), pnl: Math.round(p.equity - p.seed), returnRate: Math.round((p.equity / p.seed - 1) * 10000) / 100,
        cash: p.cash, stock: Math.round(p.equity - p.cash), realizedPnl: p.realizedPnl, debt: 0, rank: p.rank, participants: p.total, aiLeague: true,
        holdings: positions.length, positions: positions.slice(0, 10) };
      const shareId = crypto.randomUUID();
      await db.prepare(`INSERT INTO shares (id, season_id, uid, nickname, kind, code, card, body, images, comment_count, created_at) VALUES (?,?,?,?,'account',NULL,?,?,'[]',0,?)`)
        .bind(shareId, season.id, uidOf(bot), `🤖 ${bot.maker} ${bot.name}`, JSON.stringify(card), text, now).run();
      p.result = 'posted'; p.shareId = shareId;
    }
  } else if (p) p.result = p.skip || p.error || '쓰지 않기로 함';
  if (p) delete p.positions;
  if (!r.botsLeft.length) { r.phase = 'done'; r.finishedAt = Date.now(); }
}
