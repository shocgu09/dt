// 코인 시세 프로바이더 — 업비트 공개(Quotation) API, 키 불필요
// 요청 제한은 IP 기준 초당 10회(그룹별: market·ticker·orderbook·trades·candles) — 워커에서 캐시로 묶어 부른다.
// 원화(KRW) 마켓만 다룬다. "전일 대비"와 일봉은 KST 09:00(UTC 0시)에 끊긴다.

const BASE = 'https://api.upbit.com/v1';
const FETCH_MS = 8000;

async function getJson(path) {
  const r = await fetch(BASE + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_MS) });
  if (!r.ok) throw new Error(`upbit ${r.status} ${path}`);
  return r.json();
}

export const isCoinMarket = (m) => /^KRW-[A-Z0-9]{1,15}$/.test(m || '');

const n = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

// "2026-09-24T14:15:00" → "20260924141500" (분봉) / "20260924" (일·주·월봉) — 네이버 봉과 같은 t 형식
function barTime(kst, daily) {
  const s = String(kst || '').replace(/\D/g, '');
  return daily ? s.slice(0, 8) : s.slice(0, 14);
}

// 캔들 단위 — 화면 tf → 업비트 경로
const CANDLE_PATH = { m: 'minutes/1', m5: 'minutes/5', m15: 'minutes/15', m60: 'minutes/60', D: 'days', W: 'weeks', M: 'months' };

export const upbit = {
  name: 'upbit',

  /** 원화 마켓 목록 + 시장경보 (유의 warning, 주의 caution 5종) */
  async getMarkets() {
    const arr = await getJson('/market/all?is_details=true');
    return arr.filter((m) => isCoinMarket(m.market)).map((m) => {
      const ev = m.market_event || {};
      const caution = ev.caution ? Object.keys(ev.caution).filter((k) => ev.caution[k] === true) : [];
      return { market: m.market, name: m.korean_name, en: m.english_name, warning: !!ev.warning, caution };
    });
  },

  /** 원화 마켓 전 종목 현재가 — 한 번 호출에 전부 온다 */
  async getTickers() {
    const arr = await getJson('/ticker/all?quote_currencies=KRW');
    return arr.filter((t) => isCoinMarket(t.market)).map(mapTicker);
  },

  /** 호가 30단계 */
  async getOrderBook(market) {
    const [b] = await getJson('/orderbook?markets=' + encodeURIComponent(market));
    if (!b) throw new Error('upbit orderbook empty');
    const units = b.orderbook_units || [];
    return {
      market,
      ask: units.map((u) => ({ price: n(u.ask_price), qty: n(u.ask_size) })),
      bid: units.map((u) => ({ price: n(u.bid_price), qty: n(u.bid_size) })),
      askTotal: n(b.total_ask_size), bidTotal: n(b.total_bid_size),
      asOf: b.timestamp ? new Date(b.timestamp).toISOString() : null,
      source: 'upbit'
    };
  },

  /** 최근 체결 (최신 순) */
  async getTrades(market, count = 40) {
    const arr = await getJson('/trades/ticks?market=' + encodeURIComponent(market) + '&count=' + count);
    return arr.map((t) => ({
      at: t.timestamp,                          // ms
      price: n(t.trade_price),
      qty: n(t.trade_volume),
      side: t.ask_bid === 'BID' ? 'buy' : 'sell',  // BID = 매수 체결(매수자가 걸려 있던 매도 호가를 산 것)
      seq: String(t.sequential_id)
    }));
  },

  /** 캔들 — 오래된 것부터 (업비트는 최신 순으로 준다). 최대 200개 */
  async getCandles(market, tf) {
    const p = CANDLE_PATH[tf];
    if (!p) throw new Error('bad tf');
    const arr = await getJson(`/candles/${p}?market=${encodeURIComponent(market)}&count=200`);
    const daily = tf === 'D' || tf === 'W' || tf === 'M';
    return arr.map((c) => ({
      t: barTime(c.candle_date_time_kst, daily),
      o: n(c.opening_price), h: n(c.high_price), l: n(c.low_price), c: n(c.trade_price),
      v: n(c.candle_acc_trade_volume)
    })).reverse();
  }
};

function mapTicker(t) {
  return {
    market: t.market,
    price: n(t.trade_price),
    change: n(t.signed_change_price),          // 오늘 09:00 가격 대비
    changeRate: t.signed_change_rate == null ? null : Number(t.signed_change_rate) * 100,
    prevClose: n(t.prev_closing_price),         // 오늘 09:00 가격 (= 어제 일봉 종가)
    open: n(t.opening_price), high: n(t.high_price), low: n(t.low_price),
    value24h: n(t.acc_trade_price_24h),         // 최근 24시간 거래대금 (원)
    volume24h: n(t.acc_trade_volume_24h),       // 최근 24시간 거래량 (코인 수)
    high52: n(t.highest_52_week_price), high52Date: t.highest_52_week_date || null,
    low52: n(t.lowest_52_week_price), low52Date: t.lowest_52_week_date || null,
    asOf: t.trade_timestamp ? new Date(t.trade_timestamp).toISOString() : null
  };
}
