// 계좌 AI 평가 — 지표 계산
// 숫자는 전부 여기서 만든다. AI 에게는 계산된 지표만 넘기고 체결 원본은 주지 않는다.
//  - LLM 에 숫자 계산을 맡기면 틀리고, 같은 계좌를 두 번 평가할 때 값이 달라진다.
//  - 화면에 찍히는 숫자도 여기 값을 그대로 쓴다.
import { naver } from '../providers/naver.js';

const round2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const DAY = 86400000;

/**
 * 체결 이력을 순서대로 재생해 매도 건별 실현손익과 보유기간을 복원한다.
 * 엔진과 같은 이동평균 원가법을 쓴다 — fills 에 매도 시점 평단이 남지 않아 여기서 되살린다.
 * 보유기간은 매수 시각의 금액가중 평균을 기준으로 잰다.
 */
function replayFills(fills, corp = []) {
  // code -> { qty, cost(매입금액 합), amt(매수금액 합 — 보유기간 가중용), wAt(매수금액×시각 합) }
  //
  // 엔진(engine.js)과 규칙을 글자 그대로 맞춘다. 하나라도 어긋나면 실현손익이 장부와 달라진다.
  //   매수: positions.cost += price*qty        ← 수수료는 원가에 넣지 않는다 (현금에서만 빠진다)
  //   매도: 매도분 원가 = ROUND(cost * qty / 보유수량)  ← 정수 반올림까지 동일하게
  //         실현손익 = (매도대금 − 수수료 − 세금) − 매도분 원가
  // 그래서 이건 추정이 아니라 재계산이다. 합계가 accounts.realized_pnl 과 일치해야 맞다.
  const book = {};
  const sells = [];
  // 권리 변동(분할·병합·증자·폐지) 반영도 시각순으로 끼워 넣는다 — 반영 뒤 수량·매입금액을 장부 값 그대로 덮어쓴다
  const events = fills.map((f) => ({ ...f, _k: 'fill' }))
    .concat(corp.map((c) => ({ ...c, _k: 'corp' })))
    .sort((a, b) => (a.at - b.at) || (a._k === b._k ? 0 : a._k === 'fill' ? -1 : 1));
  for (const f of events) {
    if (f._k === 'corp') {
      const b = book[f.code] || (book[f.code] = { qty: 0, cost: 0, amt: 0, wAt: 0 });
      // 평균 매수시각(보유기간 가중치)은 그대로 둔다 — 분할은 매수 시점을 바꾸지 않는다
      b.qty = f.qty_after; b.cost = f.cost_after;
      if (b.qty <= 0) { b.qty = 0; b.cost = 0; b.amt = 0; b.wAt = 0; }
      continue;
    }
    const amount = f.price * f.qty;
    const b = book[f.code] || (book[f.code] = { qty: 0, cost: 0, amt: 0, wAt: 0 });
    if (f.side === 'buy') {
      b.qty += f.qty;
      b.cost += amount;                 // 수수료 제외 — 엔진과 같다
      b.amt += amount;
      b.wAt += amount * f.at;
      continue;
    }
    if (b.qty <= 0) continue;           // 장부가 어긋나도 죽지 않게
    const qty = Math.min(f.qty, b.qty);
    const soldCost = Math.round(b.cost * qty / b.qty);        // 엔진의 CAST(ROUND(...)) 와 동일
    const proceeds = f.price * qty - (f.fee || 0) - (f.tax || 0);
    const avgBuyAt = b.amt > 0 ? b.wAt / b.amt : f.at;        // 금액가중 평균 매수시각
    sells.push({
      code: f.code, name: f.name, at: f.at, qty,
      pnl: proceeds - soldCost,
      heldDays: Math.max(0, (f.at - avgBuyAt) / DAY)
    });
    // 원가는 엔진과 같이 매도분만 덜어내고, 보유기간 가중치는 남은 수량 비율로 줄인다
    // (wAt 와 amt 가 같은 비율로 줄어 평균 매수시각은 그대로 유지된다)
    const ratio = (b.qty - qty) / b.qty;
    b.cost -= soldCost;
    b.amt *= ratio; b.wAt *= ratio; b.qty -= qty;
    if (b.qty <= 0) { b.qty = 0; b.cost = 0; b.amt = 0; b.wAt = 0; }
  }
  return sells;
}

/** 코스피·코스닥의 같은 기간 수익률 — 내 성과가 시장 덕인지 가르는 기준 */
/**
 * 지수 수익률 — 회원과 같은 출발선에서 잰다.
 * 기준은 참가한 시점 직전의 종가: 15:30 전에 참가했으면 전 거래일 종가, 그 뒤면 그날 종가.
 * (예전에는 시즌 시작일 종가를 기준으로 삼아, 중도 참가자의 "시장 대비"가 엉뚱한 기간과 비교됐다)
 */
async function benchmarkReturn(code, joinedAt, now) {
  const p = (n) => String(n).padStart(2, '0');
  const kst = (ms) => new Date(ms + 9 * 3600e3);
  const ymdOf = (d) => `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  if (!joinedAt) return null;
  const j = kst(joinedAt);
  const joinYmd = ymdOf(j);
  const afterClose = j.getUTCHours() * 60 + j.getUTCMinutes() >= 15 * 60 + 30;
  try {
    const rows = await naver.indexDailyCloses(code, ymdOf(kst(joinedAt - 14 * 86400e3)), ymdOf(kst(now)), true);
    const base = rows.filter((r) => (afterClose ? r.d <= joinYmd : r.d < joinYmd)).pop();
    const last = rows[rows.length - 1];
    if (!base || !last || !base.c || last === base) return null;
    return round2((last.c - base.c) / base.c * 100);
  } catch (e) { return null; }
}

/**
 * 계좌 지표 한 벌.
 * @param view accountView() 결과 (수익률·보유종목·현금이 이미 계산돼 있다)
 */
export async function buildMetrics(db, season, account, view, now) {
  const uid = account.uid;
  const [fillRes, snapRes, corpRes] = await Promise.all([
    db.prepare(`SELECT code, name, side, qty, price, fee, tax, at FROM fills WHERE season_id=? AND uid=? ORDER BY at`).bind(season.id, uid).all(),
    db.prepare(`SELECT date, equity FROM daily_snapshots WHERE season_id=? AND uid=? ORDER BY date`).bind(season.id, uid).all(),
    db.prepare(`SELECT code, qty_after, cost_after, realized_delta, at FROM ca_applications WHERE season_id=? AND uid=? ORDER BY at`).bind(season.id, uid).all()
  ]);
  const fills = fillRes.results || [];
  const corp = corpRes.results || [];
  const snaps = snapRes.results || [];

  // ── 매매 습관 ──
  const sells = replayFills(fills, corp);
  const wins = sells.filter((s) => s.pnl > 0);
  const losses = sells.filter((s) => s.pnl < 0);
  const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);
  const tradingDays = Math.max(1, Math.ceil((now - (account.joined_at || now)) / DAY));

  // ── 집중도 ──
  const positions = view.positions || [];
  const stock = view.stock || 0;
  const top = positions.slice().sort((a, b) => b.value - a.value)[0];

  // ── 변동성·최대낙폭 ──
  let mdd = null, peak = 0;
  const rets = [];
  for (let i = 0; i < snaps.length; i++) {
    const eq = snaps[i].equity;
    if (eq > peak) peak = eq;
    if (peak > 0) { const dd = (eq - peak) / peak * 100; if (mdd == null || dd < mdd) mdd = dd; }
    if (i > 0 && snaps[i - 1].equity > 0) rets.push((eq - snaps[i - 1].equity) / snaps[i - 1].equity * 100);
  }
  let vol = null;
  if (rets.length >= 2) {
    const m = rets.reduce((s, x) => s + x, 0) / rets.length;
    vol = Math.sqrt(rets.reduce((s, x) => s + (x - m) * (x - m), 0) / (rets.length - 1));
  }

  const [kospi, kosdaq] = await Promise.all([
    benchmarkReturn('KOSPI', account.joined_at, now),
    benchmarkReturn('KOSDAQ', account.joined_at, now)
  ]);
  const ret = round2(view.returnRate);

  return {
    seasonName: season.name,
    days: tradingDays,
    returnRate: ret,
    equity: view.equity,
    seed: season.seed,
    benchmark: { kospi, kosdaq },
    // 시장 덕인지 실력인지 — 이 한 줄이 평가의 중심이다
    alpha: (ret != null && kospi != null) ? round2(ret - kospi) : null,
    cashRatio: view.equity > 0 ? round2(view.cash / view.equity * 100) : null,
    positionCount: positions.length,
    topPosition: top ? { name: top.name, weight: stock > 0 ? round2(top.value / view.equity * 100) : null, pnlRate: round2(top.pnlRate) } : null,
    trades: { total: fills.length, buys: fills.filter((f) => f.side === 'buy').length, sells: sells.length,
              perWeek: round2(fills.length / tradingDays * 7) },
    winRate: sells.length ? round2(wins.length / sells.length * 100) : null,
    realizedPnl: account.realized_pnl,
    // 재생이 맞는지 스스로 검증한다 — 엔진과 규칙이 어긋나면 여기서 티가 난다.
    // 어긋나면 AI 에게 보유기간·승률을 믿지 말라고 알린다 (조용히 틀린 값을 말하는 것보다 낫다)
    replayOk: sells.reduce((t, x) => t + x.pnl, 0) + corp.reduce((t, x) => t + (x.realized_delta || 0), 0) === account.realized_pnl,
    // 처분효과 — 이익은 빨리 팔고 손실은 오래 들고 있는가
    holdDays: {
      win: round2(avg(wins, (s) => s.heldDays)),
      loss: round2(avg(losses, (s) => s.heldDays)),
      all: round2(avg(sells, (s) => s.heldDays))
    },
    mdd: round2(mdd),
    volatility: round2(vol),
    snapshotDays: snaps.length
  };
}
