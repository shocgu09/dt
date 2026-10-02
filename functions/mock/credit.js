// DT 모의투자 — 결제(T+2)·미수·신용융자·증권담보대출 규칙
//
// 기준: 키움증권 2026년 공식 설명서·영웅문 도움말·금융투자업규정 (조사 노트: dt/plans/research_notes/실제 증권사 결제 신용 규칙.md)
// 키움이 공개하지 않는 값(종목별 증거금률·신용 종목군 부여 기준, 현행 대용 사정비율)은 추측하지 않고
// 키움의 기본값 하나로 통일했다 — 아래 RULES 주석에 무엇을 골랐는지 적어 둔다.
//
// 장부 표현
//   accounts.cash / cash_short : D+2 기준 예수금을 음수가 되지 않는 두 칸으로 나눠 둔다 (예수금 = cash − cash_short).
//     cash >= 0 CHECK 는 체결 경합을 되돌리는 안전장치라 그대로 두고, 모자란 만큼은 cash_short 에 쌓는다.
//     둘 중 하나만 양수다. 결제일에 예수금이 음수면 그게 미수금이다.
//   fills.settle_ymd / cash_delta / margin : 결제일, 결제 때 예수금 증감, 증거금 계산용 값
//     매수 margin = 이 매수에 실제로 쓴 증거금(현금). (−cash_delta − margin) 만큼이 결제 전까지 외상(미수 가능분)이다.
//     매도 margin = 재사용할 수 없는 몫. 결제 전 주식을 팔면 매도대금 × 증거금률만 재사용된다 (키움 [0398]).
//   lots : 신용(credit)·담보대출(loan) 잔고. 현금 보유(positions)와 따로 둔다 — 실전 잔고 화면도 대출일별로 나뉜다.

import * as E from './engine.js';

export const RULES = {
  settleDays: 2,                       // T+2 영업일

  // 계좌 증거금률: 'cash' = 증거금 100%(현금으로만 매수), 'spectrum' = 종목 증거금률 적용(미수 가능)
  // 종목 증거금률 — 키움 "나머지 전부" 기본값 40%. 20·30·50·60% 부여 기준은 비공개라 쓰지 않는다.
  // 100%: 레버리지·인버스 ETF(2011-08-22 금투협·거래소 조치, 신용 금지), 정리매매로 보이는 종목, ETN(신용 대상 아님, 증거금률 비공개 — 보수적으로 100%)
  stockMarginRate: 0.40,

  // 미수
  misuOverdueRate: 0.097,              // 연체이자 연 9.7% (발생일 제외, 달력일)
  misuFreezeMin: 100000,               // 10만 원 초과 미수를 결제일 23:30 까지 못 갚으면 동결
  misuFreezeDays: 30,                  // 결제일 다음날부터 30일(달력일) 증거금 100%
  forcedFeeRate: 0.003,                // 반대매매(청산거래) 수수료 0.3%
  forcedLowerRate: 0.70,               // 미수 반대매매 수량은 하한가(기준가 × 0.7) 기준
  forcedCostRate: 0.005,               // 수량 산정 때 매도 비용(수수료 0.3% + 거래세 0.2%)만큼 여유

  // 신용융자 — 키움형 일반(현금 보증금). 종목군별 45/50/60% 중 45%, 기간 A·B·C군 180일로 통일
  creditDepositRate: 0.45,
  creditTermDays: 180,
  creditLimit: 2000000000,             // 계좌 한도 20억
  creditBrackets: [                    // 소급법 — 총 보유일수의 구간 이율을 기간 전체에 적용
    { upto: 7, rate: 0.054 }, { upto: 15, rate: 0.077 }, { upto: 90, rate: 0.085 }, { upto: Infinity, rate: 0.091 }
  ],

  // 증권담보대출 — 종목군 A·B·C 공통 담보인정 70%, 이율은 가운데인 B군 8.65%, 180일
  loanLtv: 0.70,
  loanRate: 0.0865,
  loanTermDays: 180,
  loanMin: 100000,                     // 종목별 최소 10만 원, 1만 원 단위
  loanUnit: 10000,
  loanLimit: 1000000000,               // 고객 한도 10억

  // 담보유지비율 — 신용·담보대출 합산
  maintRatio: 1.40,
  forcedBaseRate: 0.85,                // 담보부족 반대매매 수량 산정가 = 전일종가 −15% (호가 올림)
  substituteRate: 0.70,                // 담보비율 계산 때 담보로 잡히지 않은 현금 보유 주식의 대용 비율 (KRX 기본 70%)

  // 현금상환 가능 시간 (영업일)
  repayFrom: 8 * 60, creditRepayTo: 17 * 60 + 10, loanRepayTo: 17 * 60 + 30,
  loanFrom: 8 * 60, loanTo: 17 * 60 + 30,

  // ── 시즌 규칙 (실전에는 없다 — 2026-10-02 결정) ──
  // 시즌이 끝나면 빚은 순자산에서 빠질 뿐 갚을 일이 없어서, 막판에 빚을 끌어와 한 방을 노리거나
  // 늦게 들어와 바로 최대한 빌리는 쪽이 유리해진다. 0 이면 그 규칙을 쓰지 않는다.
  seasonCutoffDays: 10,                // 시즌 마지막 10거래일은 신용매수·담보대출·미수 매수를 새로 할 수 없다 (상환·매도는 된다)
  seasonDueDays: 3,                    // 신용·대출 만기를 시즌 종료 3거래일 전으로 당긴다 → 다음 거래일 아침 자동상환, 마지막 3거래일은 현금만
  unlockDays: 5                        // 참가 후 5거래일이 지나야 신용매수·담보대출·미수 매수를 쓸 수 있다
};

// ── 달력 ──────────────────────────────────────────────────────
const ymdToMs = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
const msToYmd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/** 영업일 n일 뒤 (YYYYMMDD) — 휴장일 목록은 E.setHolidays 로 이미 들어와 있다 */
export function addTradingDays(ymd, n) {
  let d = ymdToMs(ymd);
  let left = n;
  for (let i = 0; i < 60 && left > 0; i++) {
    d += 86400e3;
    const x = new Date(d);
    if (E.isTradingDay({ dow: x.getUTCDay(), ymd: msToYmd(d) })) left--;
  }
  return msToYmd(d);
}
/** 직전 영업일 */
export function prevTradingDay(ymd) {
  let d = ymdToMs(ymd);
  for (let i = 0; i < 30; i++) {
    d -= 86400e3;
    const x = new Date(d);
    if (E.isTradingDay({ dow: x.getUTCDay(), ymd: msToYmd(d) })) return msToYmd(d);
  }
  return ymd;
}
/** 영업일 n일 전 */
export function subTradingDays(ymd, n) {
  let d = ymd;
  for (let i = 0; i < n; i++) d = prevTradingDay(d);
  return d;
}
/** 달력일 차이 — 이자 일수 '한편빼기'(기산일 제외, 끝나는 날 포함) */
export function daysBetween(fromYmd, toYmd) { return Math.round((ymdToMs(toYmd) - ymdToMs(fromYmd)) / 86400e3); }
export function addCalendarDays(ymd, n) { return msToYmd(ymdToMs(ymd) + n * 86400e3); }
/** 그 날짜가 속한 해의 일수 (윤년 366) */
function yearDays(ymd) { const y = +ymd.slice(0, 4); return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365; }
/** 전달 말일 */
export function prevMonthEnd(ymd) { return msToYmd(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, 1) - 86400e3); }

// ── 시즌 규칙 ────────────────────────────────────────────────
const mdTxt = (ymd) => `${+ymd.slice(4, 6)}/${+ymd.slice(6, 8)}`;

/** 시즌 마지막 거래일 (종료일이 휴장일이면 그 전 거래일) */
export function seasonLastDay(season) {
  const end = String((season && season.end_date) || '').replace(/-/g, '');
  if (!end) return null;
  return E.isTradingDay({ dow: new Date(ymdToMs(end)).getUTCDay(), ymd: end }) ? end : prevTradingDay(end);
}
/** 신규 신용이 막히는 첫날 — 마지막 거래일을 포함해 seasonCutoffDays 거래일 */
export function creditCutoffYmd(season) {
  const last = seasonLastDay(season);
  return last && RULES.seasonCutoffDays > 0 ? subTradingDays(last, RULES.seasonCutoffDays - 1) : null;
}
/** 신용·대출 만기 상한 — 마지막 거래일의 seasonDueDays 거래일 전 */
export function seasonDueCap(season) {
  const last = seasonLastDay(season);
  return last && RULES.seasonDueDays > 0 ? subTradingDays(last, RULES.seasonDueDays) : null;
}
/** 실제로 적용할 만기일 — 180일 만기와 시즌 상한 중 이른 날. 이미 있는 잔고도 이걸로 판정한다 (시즌 종료일을 바꿔도 따라간다) */
export function dueFor(season, dueYmd) {
  const cap = seasonDueCap(season);
  return cap && cap < dueYmd ? cap : dueYmd;
}
/** 신용이 열리는 날 — 참가일(시즌 시작 전 참가는 시작일)부터 unlockDays 거래일 뒤 */
export function unlockYmd(season, account) {
  if (!(RULES.unlockDays > 0) || !account || !account.joined_at) return null;
  const start = String(season.start_date || '').replace(/-/g, '');
  let j = E.kstNow(account.joined_at).ymd;
  if (start && j < start) j = start;
  return addTradingDays(j, RULES.unlockDays);
}
/**
 * 신규 신용(신용매수·담보대출·미수 매수) 제한 — 없으면 null.
 * 상환·매도·현금상환·증거금률 설정 바꾸기는 막지 않는다.
 */
export function creditGate(season, account, today) {
  const cut = creditCutoffYmd(season);
  if (cut && today >= cut) {
    return { code: 'credit_closing', from: cut,
      msg: `시즌 마지막 ${RULES.seasonCutoffDays}거래일(${mdTxt(cut)}부터)에는 신용매수 · 담보대출 · 미수 매수를 새로 할 수 없습니다` };
  }
  const u = unlockYmd(season, account);
  if (u && today < u) {
    return { code: 'credit_locked', until: u,
      msg: `신용매수 · 담보대출 · 미수 매수는 참가 ${RULES.unlockDays}거래일 뒤인 ${mdTxt(u)}부터 쓸 수 있습니다` };
  }
  return null;
}

// ── 종목 조건 ────────────────────────────────────────────────
const LEVERAGED = /레버리지|인버스|2X|곱버스|울트라|\bBULL\b|\bBEAR\b/i;

/**
 * 종목 증거금률·신용 가능 여부
 * @param kind 'stock' | 'etf' | 'etn'
 * @param quote 시세 (정리매매 추정용 — 가격제한폭 밖으로 움직였으면 정리매매로 본다)
 */
export function stockTerms(kind, name, quote) {
  const leveraged = kind !== 'stock' && LEVERAGED.test(String(name || ''));
  const prev = quote && quote.krx && quote.krx.prevClose;
  const px = quote && quote.krx && quote.krx.price;
  const liquidation = !!(prev && px != null && Math.abs(px / prev - 1) > 0.3);
  let reason = null;
  if (leveraged) reason = '레버리지·인버스 상품은 증거금 100%·신용 불가입니다';
  else if (kind === 'etn') reason = 'ETN 은 신용거래 대상이 아닙니다';
  else if (liquidation) reason = '정리매매 종목은 증거금 100%·신용 불가입니다';
  else if (quote && quote.halted) reason = '거래정지 종목입니다';
  const full = leveraged || kind === 'etn' || liquidation;
  return {
    marginRate: full ? 1 : RULES.stockMarginRate,
    creditOk: !reason,                         // 신용·담보대출 가능 (주권·ETF, 100% 종목 제외)
    reason
  };
}

// ── 이자 ──────────────────────────────────────────────────────
export function creditRate(days) {
  for (const b of RULES.creditBrackets) if (days <= b.upto) return b.rate;
  return RULES.creditBrackets[RULES.creditBrackets.length - 1].rate;
}
/**
 * 기산일(start)부터 끝나는 날(end)까지의 총이자 (소급법, 원 미만 절사). 이미 낸 이자는 호출하는 쪽이 뺀다.
 * lot.kind: credit(구간 이율) | loan(고정 이율)
 */
export function interestTotal(lot, principal, endYmd) {
  const days = Math.max(0, daysBetween(lot.start_ymd, endYmd));
  if (!days || principal <= 0) return 0;
  const rate = lot.kind === 'credit' ? creditRate(days) : (lot.rate || RULES.loanRate);
  return Math.floor(principal * rate * days / yearDays(endYmd) + 1e-6);
}
/** 지금까지 쌓였지만 아직 내지 않은 이자 */
export function interestAccrued(lot, endYmd) {
  return Math.max(0, interestTotal(lot, lot.principal, endYmd) - (lot.interest_paid || 0));
}
/**
 * 대출 일부(qty/lot.qty) 상환 — 상환 원금·이자와 남는 대출의 이미 낸 이자
 * 소급법: 상환분의 총이자 − 상환분에 해당하는 기징수 이자
 */
export function repayPortion(lot, qty, endYmd) {
  const all = qty >= lot.qty;
  const principal = all ? lot.principal : Math.round(lot.principal * qty / lot.qty);
  const paidPart = all ? (lot.interest_paid || 0) : Math.round((lot.interest_paid || 0) * qty / lot.qty);
  const interest = Math.max(0, interestTotal(lot, principal, endYmd) - paidPart);
  const cost = all ? lot.cost : Math.round(lot.cost * qty / lot.qty);
  return { principal, interest, paidPart, cost };
}

// ── 호가 ──────────────────────────────────────────────────────
export function tickCeil(p, taxFree) { const t = E.tickSize(p, taxFree); return Math.ceil(p / t) * t; }
export function tickFloor(p, taxFree) { const t = E.tickSize(p, taxFree); return Math.floor(p / t) * t; }
/** 하한가 = 기준가 × 0.7 을 호가단위로 올림 (engine.acceptOrder 의 가격제한폭 경계와 같다) */
export function lowerLimit(base, taxFree) { return tickCeil(base * RULES.forcedLowerRate, taxFree); }

/**
 * 담보부족 반대매매 수량 (키움 공식 산식, 1주 올림)
 *   ceil{ (담보평가 − 융자 × 1.4) ÷ (전일종가 − 반대매매기준가 × 1.4) },  반대매매기준가 = 전일종가 × 0.85 호가 올림
 */
export function collateralSellQty(value, debt, prevClose, taxFree) {
  const base = tickCeil(prevClose * RULES.forcedBaseRate, taxFree);
  const num = value - debt * RULES.maintRatio;
  const den = prevClose - base * RULES.maintRatio;
  if (num >= 0) return 0;
  if (den >= 0) return Infinity;                 // 이 종목을 팔아서는 비율이 오르지 않는다 (전량 대상)
  return Math.ceil(num / den - 1e-9);
}

/** 결제일 이전 매수 증거금 — 종목 증거금률만큼 현금, 수수료는 전액 (키움 문서에 수수료 포함 여부가 없어 보수적으로 넣는다) */
export function marginFor(amount, fee, rate) { return rate >= 1 ? amount + fee : Math.ceil(amount * rate) + fee; }

/**
 * 예수금 증감을 cash / cash_short 두 칸에 나눠 적용하는 SQL 조각. 금액을 두 번 bind 한다.
 * SQLite 는 SET 의 오른쪽을 모두 바뀌기 전 값으로 계산하므로 두 칸이 같은 옛 값을 본다.
 *   출금 x: cash 에서 먼저 빼고 모자란 만큼 cash_short 에 쌓는다
 *   입금 x: cash_short 를 먼저 갚고 남는 만큼 cash 에 더한다
 */
export const SQL_DEBIT = `cash = MAX(cash - ?, 0), cash_short = cash_short + MAX(? - cash, 0)`;
export const SQL_CREDIT = `cash_short = MAX(cash_short - ?, 0), cash = cash + MAX(? - cash_short, 0)`;
/** 부호 있는 증감 d 를 적용하는 SET 조각과 bind 값 */
export function cashSet(d) {
  return d >= 0 ? { sql: SQL_CREDIT, args: [d, d] } : { sql: SQL_DEBIT, args: [-d, -d] };
}
