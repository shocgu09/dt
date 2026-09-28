// 미국 주식 시세 프로바이더 — 네이버 증권 해외주식 (무인증). 시세 표시만 한다(모의투자 없음).
// 코드는 네이버 reuters 코드를 그대로 쓴다: 나스닥 AAPL.O, 뉴욕 NVST.K 또는 접미사 없음(JPM·TSM), 버크셔 B 는 BRKb.
// 네이버가 나스닥에서 실시간 시세 사용권을 받아 delayTime 0 으로 내려 준다 (프리·애프터마켓 포함).

import { getJson, num, signOf } from './naver.js';

const BASE = 'https://api.stock.naver.com';
const POLL = 'https://polling.finance.naver.com/api/realtime/worldstock/stock/';

// 국내 6자리 코드와 섞이지 않게 라우트·주소 파라미터를 따로 쓴다. 여기서는 모양만 본다.
export const isUsCode = (c) => /^[A-Za-z0-9]{1,8}(_[a-z])?(\.[A-Z])?$/.test(c || '');

export const US_EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX'];

/* 미국 동부 서머타임 — 3월 둘째 일요일 02:00 ~ 11월 첫째 일요일 02:00 (현지) */
function nthSunday(y, m, nth) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (nth - 1) * 7;
}
export function isUsDst(y, m, d, h = 12) {
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  if (m === 3) { const s = nthSunday(y, 3, 2); return d > s || (d === s && h >= 2); }
  const e = nthSunday(y, 11, 1); return d < e || (d === e && h < 2);
}
/** 뉴욕 벽시계 "YYYYMMDDHHmmss" → 한국 벽시계 같은 형식 (차트 축을 한국 시각으로 그린다) */
export function etToKst(s) {
  const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8), h = +s.slice(8, 10), mi = +s.slice(10, 12);
  const off = isUsDst(y, mo, d, h) ? 13 : 14;
  const k = new Date(Date.UTC(y, mo - 1, d, h + off, mi));
  const p = (n) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}${p(k.getUTCHours())}${p(k.getUTCMinutes())}00`;
}

const signed = (cmp, v) => { const n = num(v); if (n == null) return null; const s = signOf(cmp && cmp.code); return s ? s * Math.abs(n) : n; };

/** 프리·애프터마켓 가격 (없으면 null) */
function mapOver(o) {
  if (!o || !o.overPrice) return null;
  return {
    session: o.tradingSessionType === 'PRE_MARKET' ? 'pre' : o.tradingSessionType === 'AFTER_MARKET' ? 'after' : 'other',
    open: o.overMarketStatus === 'OPEN',
    price: num(o.overPrice),
    change: signed(o.compareToPreviousPrice, o.compareToPreviousClosePrice),
    changeRate: signed(o.compareToPreviousPrice, o.fluctuationsRatio),
    asOf: o.localTradedAt || null
  };
}

const exchangeOf = (x) => (x && x.stockExchangeType && x.stockExchangeType.name) || null;

// polling · 순위 목록의 종목 1건 → 공통 형태
function mapRow(s) {
  const cmp = s.compareToPreviousPrice;
  return {
    code: s.reutersCode,
    symbol: s.symbolCode || String(s.reutersCode || '').split('.')[0],
    name: s.stockName,
    exchange: exchangeOf(s),
    price: num(s.closePriceRaw != null ? s.closePriceRaw : s.closePrice),
    change: signed(cmp, s.compareToPreviousClosePriceRaw != null ? s.compareToPreviousClosePriceRaw : s.compareToPreviousClosePrice),
    changeRate: signed(cmp, s.fluctuationsRatioRaw != null ? s.fluctuationsRatioRaw : s.fluctuationsRatio),
    open: num(s.openPriceRaw != null ? s.openPriceRaw : s.openPrice),
    high: num(s.highPriceRaw != null ? s.highPriceRaw : s.highPrice),
    low: num(s.lowPriceRaw != null ? s.lowPriceRaw : s.lowPrice),
    volume: num(s.accumulatedTradingVolumeRaw != null ? s.accumulatedTradingVolumeRaw : s.accumulatedTradingVolume),
    valueUsd: num(s.accumulatedTradingValueRaw),
    marketCap: num(s.marketValueRaw != null ? s.marketValueRaw : s.marketValueFullRaw),   // 순위 목록은 천 달러 단위
    marketCapKrw: num(s.marketValueKrwRaw),
    status: s.marketStatus || null,                        // OPEN | CLOSE (정규장 기준)
    halted: !!(s.tradeStopType && s.tradeStopType.code && s.tradeStopType.code !== '1'),
    asOf: s.localTradedAt || null,
    over: mapOver(s.overMarketPriceInfo),
    kind: s.stockEndType || null,                          // stock | etf
    source: 'naver'
  };
}

// 화면 정렬 → 네이버 순위 경로
const RANK_PATH = { value: 'priceTop', cap: 'marketValue', up: 'up', down: 'down' };

export const naverUs = {
  name: 'naver-us',

  /** 여러 종목 현재가 한 번에 (콤마 연결) */
  async getQuotes(codes) {
    const d = await getJson(POLL + codes.map(encodeURIComponent).join(','));
    return ((d && d.datas) || []).map(mapRow);
  },

  /** 종목 기본 정보 — 52주 범위·PER·배당 등 (자주 바뀌지 않는다) */
  async getBasic(code) {
    const d = await getJson(`${BASE}/stock/${encodeURIComponent(code)}/basic`);
    const info = {};
    (d.stockItemTotalInfos || []).forEach((x) => { info[x.code] = x.value; });
    return {
      code,
      en: d.stockNameEng || null,
      industry: (d.industryCodeType && d.industryCodeType.industryGroupKor) || info.industryGroupKor || null,
      isEtf: !!d.isEtf,
      prevClose: num(info.basePrice),
      high52: num(info.highPriceOf52Weeks),
      low52: num(info.lowPriceOf52Weeks),
      per: info.per || null, pbr: info.pbr || null, eps: info.eps || null,
      dividendYield: info.dividendYieldRatio || null,
      marketValue: info.marketValue || null,
      hours: d.marketOperatingTimeInfo || null
    };
  },

  /** 거래소 하나의 순위 */
  async getRank(exchange, sort, size) {
    const path = RANK_PATH[sort] || 'priceTop';
    const d = await getJson(`${BASE}/stock/exchange/${exchange}/${path}?page=1&pageSize=${size}`);
    return ((d && d.stocks) || []).map(mapRow);
  },

  /** 자동완성에서 미국 종목만 */
  async search(q) {
    const d = await getJson(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`);
    return (d.items || [])
      .filter((i) => i.nationCode === 'USA' && isUsCode(i.reutersCode))
      .map((i) => ({ code: i.reutersCode, symbol: i.code, name: i.name, exchange: i.typeCode || null }));
  },

  /**
   * 봉 — m5: 오늘(최근 거래일) 5분봉, D·W·M: 일·주·월봉.
   * 분봉은 네이버가 1분 체결가 점(가격·누적거래량)만 준다 → 5분 단위로 묶어 시가·고가·저가·종가를 만든다.
   * 분봉 시각은 한국 시각으로 바꾼다(차트 축을 한국 시각으로). 일봉 날짜는 미국 현지 날짜 그대로.
   */
  async getBars(code, tf) {
    const c = encodeURIComponent(code);
    if (tf === 'm5') {
      const d = await getJson(`${BASE}/chart/foreign/item/${c}?periodType=day`);
      const pts = (d && d.priceInfos) || [];
      const out = [];
      let cur = null, prevVol = null;
      for (const p of pts) {
        const s = String(p.localDateTime || '');
        const px = num(p.currentPrice);
        if (s.length < 12 || px == null) continue;
        const mm = Math.floor(+s.slice(10, 12) / 5) * 5;
        const key = s.slice(0, 10) + String(mm).padStart(2, '0') + '00';
        const vol = num(p.accumulatedTradingVolume);
        if (!cur || cur.key !== key) {
          if (cur) out.push(cur);
          cur = { key, t: etToKst(key), o: px, h: px, l: px, c: px, v: 0, _v0: prevVol };
        }
        cur.h = Math.max(cur.h, px); cur.l = Math.min(cur.l, px); cur.c = px;
        if (vol != null) { cur.v = cur._v0 == null ? vol : Math.max(0, vol - cur._v0); prevVol = vol; }
      }
      if (cur) out.push(cur);
      return {
        bars: out.map(({ t, o, h, l, c: cl, v }) => ({ t, o, h, l, c: cl, v })),
        prevClose: num(d && d.lastClosePrice),
        tradeDate: (d && d.tradeBaseAt) || null
      };
    }
    const unit = tf === 'W' ? 'week' : tf === 'M' ? 'month' : 'day';
    const now = new Date();
    const back = tf === 'M' ? 10 : tf === 'W' ? 3 : 1;          // 일봉 1년 · 주봉 3년 · 월봉 10년
    const p = (n) => String(n).padStart(2, '0');
    const end = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}2359`;
    const start = `${now.getUTCFullYear() - back}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}0000`;
    const arr = await getJson(`${BASE}/chart/foreign/item/${c}/${unit}?startDateTime=${start}&endDateTime=${end}`);
    return {
      bars: (Array.isArray(arr) ? arr : []).map((b) => ({
        t: String(b.localDate), o: num(b.openPrice), h: num(b.highPrice), l: num(b.lowPrice), c: num(b.closePrice),
        v: num(b.accumulatedTradingVolume)
      })).filter((b) => b.c != null)
    };
  },

  /** 원/달러 (하나은행 고시) */
  async getUsdKrw() {
    const d = await getJson(`${BASE}/marketindex/exchange/FX_USDKRW`);
    const x = d && d.exchangeInfo;
    return x ? num(x.closePrice) : null;
  }
};
