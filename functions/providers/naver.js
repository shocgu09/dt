// 시세 프로바이더 — 네이버 증권 (무인증)
// 인터페이스: getQuote / getOrderBook / getOhlc / getIndex / search
// KIS로 전환할 때는 같은 형태의 providers/kis.js 를 만들어 교체한다.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Referer': 'https://m.stock.naver.com/', 'Accept': 'application/json' };

// "248,000" → 248000 / null 안전
function num(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 전일대비 부호코드: 1 상한 2 상승 3 보합 4 하한 5 하락
function signOf(code) {
  if (code === '1' || code === '2') return 1;
  if (code === '4' || code === '5') return -1;
  return 0;
}

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`naver ${r.status} ${url}`);
  return r.json();
}

export const naver = {
  name: 'naver',

  // 현재가 — polling.finance.naver.com (delayTime: 0)
  async getQuote(code) {
    const d = await getJson(`https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`);
    const s = d && d.datas && d.datas[0];
    if (!s) throw new Error('naver: quote empty');
    const sign = signOf(s.compareToPreviousPrice && s.compareToPreviousPrice.code);
    return {
      code,
      name: s.stockName,
      market: (s.stockExchangeType && s.stockExchangeType.nameKor) || null,
      price: num(s.closePrice),
      change: sign * Math.abs(num(s.compareToPreviousClosePrice) || 0),
      changeRate: Number(s.fluctuationsRatio),
      open: num(s.openPrice), high: num(s.highPrice), low: num(s.lowPrice),
      volume: num(s.accumulatedTradingVolume),
      marketStatus: s.marketStatus,          // OPEN / CLOSE ...
      delayed: !(s.stockExchangeType && s.stockExchangeType.delayTime === 0),
      asOf: s.localTradedAt || new Date().toISOString(),
      source: 'naver'
    };
  },

  // 호가 — 매도 5 + 매수 5단계. rate(0~100)는 잔량 비율 바에 그대로 사용
  async getOrderBook(code) {
    const d = await getJson(`https://m.stock.naver.com/api/stock/${code}/askingPrice`);
    const map = (arr) => (arr || []).map((x) => ({
      price: num(x.price), count: num(x.count), rate: Number(x.rate) || 0
    }));
    const ask = map(d.sellInfo);   // 매도호가: 높은 가격 → 낮은 가격
    const bid = map(d.buyInfos);   // 매수호가: 높은 가격 → 낮은 가격
    if (!ask.length && !bid.length) throw new Error('naver: book empty');
    return {
      code, levels: Math.max(ask.length, bid.length),
      ask, bid,
      askTotal: num(d.totalSell), bidTotal: num(d.totalBuy),
      lastClose: num(d.lastClosePrice),
      source: 'naver'
    };
  },

  // 차트 — tf: '1m' | 'D'
  async getOhlc(code, tf, opts) {
    const o = opts || {};
    if (tf === '1m') {
      const d = await getJson(
        `https://api.stock.naver.com/chart/domestic/item/${code}/minute` +
        `?startDateTime=${o.start}&endDateTime=${o.end}`
      );
      return d.map((x) => ({
        t: x.localDateTime,                         // YYYYMMDDHHmmss
        o: x.openPrice, h: x.highPrice, l: x.lowPrice, c: x.currentPrice,
        v: x.accumulatedTradingVolume
      }));
    }
    const d = await getJson(
      `https://api.stock.naver.com/chart/domestic/item/${code}/day` +
      `?startDateTime=${o.start}&endDateTime=${o.end}`
    );
    return d.map((x) => ({
      t: x.localDate,                               // YYYYMMDD
      o: x.openPrice, h: x.highPrice, l: x.lowPrice, c: x.closePrice,
      v: x.accumulatedTradingVolume,
      foreignRate: x.foreignRetentionRate
    }));
  },

  // 지수 — KOSPI / KOSDAQ
  async getIndex() {
    const one = async (key) => {
      const d = await getJson(`https://polling.finance.naver.com/api/realtime/domestic/index/${key}`);
      const s = d && d.datas && d.datas[0];
      if (!s) return null;
      const sign = signOf(s.compareToPreviousPrice && s.compareToPreviousPrice.code);
      return {
        code: key, name: s.stockName,
        price: num(s.closePrice),
        change: sign * Math.abs(num(s.compareToPreviousClosePrice) || 0),
        changeRate: Number(s.fluctuationsRatio)
      };
    };
    const [kospi, kosdaq] = await Promise.all([one('KOSPI'), one('KOSDAQ')]);
    return { kospi, kosdaq, source: 'naver' };
  },

  // 종목 검색 — 초성 검색 지원 (ㅅㅅㅈㅈ → 삼성전자)
  async search(q) {
    const d = await getJson(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`);
    return (d.items || [])
      .filter((i) => i.nationCode === 'KOR' && /^\d{6}$/.test(i.code))
      .map((i) => ({ code: i.code, name: i.name, market: i.typeName }));
  },

  /**
   * 랭킹 — 토스 "실시간 차트" 대응
   * @param type 'up' | 'down' | 'marketValue'
   */
  async getRanking(type = 'up', market = 'KOSPI', size = 20) {
    const d = await getJson(`https://m.stock.naver.com/api/stocks/${type}/${market}?page=1&pageSize=${size}`);
    return (d.stocks || []).map((s) => ({
      code: s.itemCode,
      name: s.stockName,
      price: num(s.closePrice),
      changeRate: Number(s.fluctuationsRatio),
      change: signOf(s.compareToPreviousPrice && s.compareToPreviousPrice.code)
              * Math.abs(num(s.compareToPreviousClosePrice) || 0),
      volume: num(s.accumulatedTradingVolume),
      tradingValue: num(s.accumulatedTradingValue)
    }));
  },

  /** 업종 / 테마 — 토스 "지금 뜨는 산업" 대응 */
  async getSectors(kind = 'theme', size = 20) {
    const path = kind === 'industry' ? 'industry' : 'theme';
    const d = await getJson(`https://m.stock.naver.com/api/stocks/${path}?page=1&pageSize=${size}`);
    return (d.groups || []).map((g) => ({
      no: g.no,
      name: g.name,
      changeRate: Number(g.changeRate),
      total: g.totalCount,
      rise: g.riseCount,
      fall: g.fallCount,
      steady: g.steadyCount
    }));
  },

  /** 업종/테마에 속한 종목 */
  async getSectorStocks(kind, no, size = 20) {
    const path = kind === 'industry' ? 'industry' : 'theme';
    const d = await getJson(`https://m.stock.naver.com/api/stocks/${path}/${no}?page=1&pageSize=${size}`);
    return (d.stocks || []).map((s) => ({
      code: s.itemCode,
      name: s.stockName,
      price: num(s.closePrice),
      changeRate: Number(s.fluctuationsRatio)
    }));
  },

  /** 종목 뉴스 */
  async getNews(code, size = 10) {
    const d = await getJson(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=${size}&page=1`);
    const items = [];
    for (const group of (Array.isArray(d) ? d : [])) {
      for (const it of (group.items || [])) {
        items.push({
          id: it.id,
          title: (it.title || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&apos;/g, "'"),
          office: it.officeName,
          datetime: it.datetime,
          url: `https://n.news.naver.com/mnews/article/${it.officeId}/${it.articleId}`
        });
      }
    }
    return items.slice(0, size);
  }
};


// ── 폴백 프로바이더 ────────────────────────────────────────────
// 현재가만 대체 가능. 호가는 네이버에만 있어 폴백 불가(다음은 500, 야후는 미제공).

export const daum = {
  name: 'daum',
  async getQuote(code) {
    const r = await fetch(`https://finance.daum.net/api/quotes/A${code}?summary=false&changeStatistics=true`, {
      headers: { 'User-Agent': UA, 'Referer': `https://finance.daum.net/quotes/A${code}` }
    });
    if (!r.ok) throw new Error(`daum ${r.status}`);
    const d = await r.json();
    return {
      code, name: d.name, market: d.market,
      price: d.tradePrice, change: d.change === 'FALL' ? -d.changePrice : d.changePrice,
      changeRate: (d.changeRate || 0) * 100 * (d.change === 'FALL' ? -1 : 1),
      open: d.openingPrice, high: d.highPrice, low: d.lowPrice,
      volume: d.accTradeVolume, delayed: true,
      asOf: d.date || new Date().toISOString(), source: 'daum'
    };
  }
};

export const yahoo = {
  name: 'yahoo',
  async getQuote(code, market) {
    const suffix = market === 'KOSDAQ' ? 'KQ' : 'KS';
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${code}.${suffix}?interval=1d&range=1d`,
      { headers: { 'User-Agent': UA } }
    );
    if (!r.ok) throw new Error(`yahoo ${r.status}`);
    const d = await r.json();
    const m = d.chart.result[0].meta;
    const prev = m.chartPreviousClose || m.previousClose;
    return {
      code, name: m.symbol, market: m.exchangeName,
      price: m.regularMarketPrice,
      change: prev ? m.regularMarketPrice - prev : null,
      changeRate: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null,
      open: null, high: null, low: null, volume: m.regularMarketVolume ?? null,
      delayed: true, asOf: new Date().toISOString(), source: 'yahoo'
    };
  }
};
