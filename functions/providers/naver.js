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

// 외부 호출 제한 시간. 네이버가 응답을 끊지 않고 붙들면 워커의 in-flight 캐시(memo)가 그 키를 기다리는
// 모든 요청을 함께 멈춰 세운다(2026-09-22 health 가 120초 넘게 멈춘 실측). 8초면 끊고 다음 요청이 다시 시도한다.
// 해외 지수선물 — 네이버 reuters 코드 → 우리 키
const FUTURES = { NQcv1: 'nasdaq', EScv1: 'sp500', YMcv1: 'dow', GCcv1: 'gold', CLcv1: 'oil' };
// 국내 지수 — 네이버 코드 → 우리 키
const INDEX_CODES = { KOSPI: 'kospi', KOSDAQ: 'kosdaq', KPI200: 'kpi200', FUT: 'fut', KQI150: 'kq150' };

const FETCH_MS = 8000;
const withTimeout = (init) => ({ ...(init || {}), signal: AbortSignal.timeout(FETCH_MS) });

async function getJson(url) {
  const r = await fetch(url, withTimeout({ headers: HEADERS }));
  if (!r.ok) throw new Error(`naver ${r.status} ${url}`);
  return r.json();
}

// polling API 의 종목 1건 → 공통 시세 형태
function mapQuote(s) {
  const code = s.itemCode;
  // 최상위 필드는 KRX 기준이다. 넥스트레이드(NXT) 값은 overMarketPriceInfo 에,
  // KRX+NXT 합산은 integratedPriceInfo 에 따로 온다 (NXT 비대상 종목에는 둘 다 없다).
  //  - 프리/애프터마켓에는 KRX 가 닫혀 있으므로 살아 있는 NXT 가격을 현재가로 쓴다.
  //    (안 그러면 증권사 앱·분봉 차트와 현재가가 어긋난다)
  //  - 거래량·시가·고가·저가는 증권사 앱과 같게 통합 기준을 쓴다.
  const over = s.overMarketPriceInfo;
  const integ = s.integratedPriceInfo;
  const session = over && over.overMarketStatus === 'OPEN'
    && (over.tradingSessionType === 'PRE_MARKET' || over.tradingSessionType === 'AFTER_MARKET')
    && num(over.overPrice) != null
    ? over.tradingSessionType : null;
  const px = session ? over : s;

  const sign = signOf(px.compareToPreviousPrice && px.compareToPreviousPrice.code);
  return {
    code,
    name: s.stockName,
    market: (s.stockExchangeType && s.stockExchangeType.nameKor) || null,
    price: num(session ? over.overPrice : s.closePrice),
    change: sign * Math.abs(num(px.compareToPreviousClosePrice) || 0),
    changeRate: Number(px.fluctuationsRatio),
    open: num((integ || s).openPrice), high: num((integ || s).highPrice), low: num((integ || s).lowPrice),
    volume: num((integ || s).accumulatedTradingVolume),
    session,                               // 'PRE_MARKET' | 'AFTER_MARKET' | null(정규장·장외)
    integrated: !!integ,                   // 거래량 등이 KRX+NXT 통합 기준인지
    marketStatus: s.marketStatus,          // OPEN / CLOSE ...
    sessionType: s.marketSessionType || null,   // 네이버 원문 (정규장·프리·애프터 구분)
    // 거래정지 — tradeStopType 이 TRADING 이 아니거나 tradableStatus 가 tradable 이 아니면 정지로 본다
    halted: !!((s.tradeStopType && s.tradeStopType.name && s.tradeStopType.name !== 'TRADING')
      || (s.tradableStatus && s.tradableStatus !== 'tradable')),
    // 상·하한가 (KRX 기준 부호코드 1 상한 / 4 하한)
    limitState: (function (c) { return c === '1' ? 'upper' : (c === '4' ? 'lower' : null); })(
      s.compareToPreviousPrice && s.compareToPreviousPrice.code),
    marketCap: num(s.marketValueFullRaw),
    // KRX 기준 값 — NXT 값이 섞이지 않는다. 단 16:00~20:00 에는 KRX 애프터마켓 체결가가 들어오므로
    // (2026-09-14 개설, 실측) 공식 종가가 필요하면 15:30 분봉의 종가를 쓴다 — 당일 일봉도 애프터마켓을 따라 움직인다.
    krx: {
      price: num(s.closePrice),
      volume: num(s.accumulatedTradingVolume),
      open: num(s.openPrice),                   // KRX 시가 (바깥의 open 은 NXT 프리마켓이 섞인 통합 값)
      // 전일 종가 = 현재가 − 전일대비 (지정가의 상·하한가 범위 확인용)
      prevClose: (function () {
        const c = num(s.closePrice), d = num(s.compareToPreviousClosePrice);
        if (c == null || d == null) return null;
        return c - signOf(s.compareToPreviousPrice && s.compareToPreviousPrice.code) * Math.abs(d);
      })(),
      tradedAt: s.localTradedAt || null         // 주의: 마지막 체결 시각이 아니라 시세 스냅샷 시각에 가깝다 (실측)
    },
    // 넥스트레이드(NXT) 프리·애프터마켓 값. NXT 대상이 아닌 종목(ETF 등)은 null.
    // KRX 애프터마켓(16:00~20:00)은 NXT 와 별개의 시장이고 그 값은 위 krx 에 들어온다.
    nxt: over ? {
      price: num(over.overPrice),
      volume: num(over.accumulatedTradingVolumeRaw) ?? num(over.accumulatedTradingVolume),
      session: over.tradingSessionType || null,          // PRE_MARKET | AFTER_MARKET
      open: over.overMarketStatus === 'OPEN',
      limitState: (function (c) { return c === '1' ? 'upper' : (c === '4' ? 'lower' : null); })(
        over.compareToPreviousPrice && over.compareToPreviousPrice.code)
    } : null,
    delayed: !(s.stockExchangeType && s.stockExchangeType.delayTime === 0),
    asOf: px.localTradedAt || s.localTradedAt || new Date().toISOString(),
    source: 'naver'
  };
}

export const naver = {
  name: 'naver',

  // 현재가 — polling.finance.naver.com (delayTime: 0)
  async getQuote(code) {
    const d = await getJson(`https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`);
    const s = d && d.datas && d.datas[0];
    if (!s) throw new Error('naver: quote empty');
    return mapQuote(s);
  },

  /**
   * 상장 ETF 전체 목록 [{code, name}] — 키워드 검색 보강용.
   * 네이버 자동완성은 이름의 앞부분만 맞춰 주기 때문에 "레버리지"·"인버스"·"반도체" 같은 중간 단어로는
   * ETF 가 하나도 안 나온다. 목록은 EUC-KR 로 온다.
   */
  async getEtfList() {
    const r = await fetch('https://finance.naver.com/api/sise/etfItemList.nhn', withTimeout({ headers: HEADERS }));
    if (!r.ok) throw new Error(`naver etf list ${r.status}`);
    const d = JSON.parse(new TextDecoder('euc-kr').decode(await r.arrayBuffer()));
    return ((d.result && d.result.etfItemList) || [])
      .filter((x) => /^[0-9A-Z]{6}$/.test(x.itemcode))
      .map((x) => ({ code: x.itemcode, name: x.itemname }));
  },

  // 종목 종류 — 'stock' | 'etf' | 'etn' … (ETF·ETN 은 매도 시 거래세가 없다)
  async getKind(code) {
    const d = await getJson(`https://m.stock.naver.com/api/stock/${code}/basic`);
    return (d && d.stockEndType) || 'stock';
  },

  // 여러 종목 현재가를 한 번에 — polling API 는 코드를 콤마로 이어 받는다.
  // 관심종목·보유종목을 종목 수만큼 따로 부르지 않기 위한 것 (네이버 호출 1회).
  async getQuotes(codes) {
    const d = await getJson(`https://polling.finance.naver.com/api/realtime/domestic/stock/${codes.join(',')}`);
    return ((d && d.datas) || []).map(mapQuote);
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

  // 지수 — 코드 여러 개를 쉼표로 묶어 한 번에 받는다 (네이버 모바일이 쓰는 방식)
  //   KOSPI / KOSDAQ / KPI200(코스피 200) / FUT(코스피 200 선물) / KQI150(코스닥 150)
  async getIndex() {
    const KEYS = INDEX_CODES;
    const d = await getJson(`https://polling.finance.naver.com/api/realtime/domestic/index/${Object.keys(KEYS).join(',')}`);
    const out = { source: 'naver' };
    for (const x of (d && d.datas) || []) {
      const key = KEYS[x.itemCode];
      if (!key) continue;
      const sign = signOf(x.compareToPreviousPrice && x.compareToPreviousPrice.code);
      out[key] = {
        code: x.itemCode, name: x.stockName,
        price: num(x.closePrice),
        change: sign * Math.abs(num(x.compareToPreviousClosePrice) || 0),
        changeRate: Number(x.fluctuationsRatio)
      };
    }
    if (!out.kospi && !out.kosdaq) throw new Error('naver: index empty');
    return out;
  },
  /**
   * 해외 지수선물 (CME) — 나스닥100·S&P500·다우.
   * 국내 장중에도 거의 24시간 돌아가서 "지금 미국이 어디로 가는지"를 보여준다.
   * 응답 형태가 국내 지수 폴링 API 와 같아 매퍼를 공유한다 (이름 필드만 futuresName).
   * 주의: 10분 지연(stockExchangeType.delayTime) — 화면에 반드시 밝힌다.
   */
  async getWorldFutures(codes) {
    const list = (codes && codes.length ? codes : Object.keys(FUTURES)).filter((c) => FUTURES[c]);
    if (!list.length) return {};
    const d = await getJson(
      `https://polling.finance.naver.com/api/realtime/worldstock/futures/${list.join(',')}`
    );
    const out = {};
    for (const x of (d && d.datas) || []) {
      const key = FUTURES[x.reutersCode];
      if (!key) continue;
      const sign = signOf(x.compareToPreviousPrice && x.compareToPreviousPrice.code);
      out[key] = {
        code: x.reutersCode,
        name: x.futuresName,
        price: num(x.closePrice),
        change: sign * Math.abs(num(x.compareToPreviousClosePrice) || 0),
        changeRate: Number(x.fluctuationsRatio),
        delayMin: (x.stockExchangeType && x.stockExchangeType.delayTime) || 0
      };
    }
    return out;
  },


  // 종목 검색 — 초성 검색 지원 (ㅅㅅㅈㅈ → 삼성전자)
  async search(q) {
    const d = await getJson(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`);
    return (d.items || [])
      .filter((i) => i.nationCode === 'KOR' && /^[0-9A-Z]{6}$/.test(i.code))
      .map((i) => ({ code: i.code, name: i.name, market: i.typeName }));
  },

  /**
   * 랭킹 — 토스 "실시간 차트" 대응
   * @param type 'up' | 'down' | 'marketValue' | 'volume'
   *   'volume' 은 네이버의 "거래상위"(quantTop) — 거래량 순, ETF 포함
   */
  async getRanking(type = 'up', market = 'KOSPI', size = 20) {
    const path = type === 'volume' ? 'quantTop' : type;
    const d = await getJson(`https://m.stock.naver.com/api/stocks/${path}/${market}?page=1&pageSize=${size}`);
    return (d.stocks || []).map((s) => ({
      code: s.itemCode,
      name: s.stockName,
      price: num(s.closePrice),
      changeRate: Number(s.fluctuationsRatio),
      change: signOf(s.compareToPreviousPrice && s.compareToPreviousPrice.code)
              * Math.abs(num(s.compareToPreviousClosePrice) || 0),
      volume: num(s.accumulatedTradingVolumeRaw) ?? num(s.accumulatedTradingVolume),
      // accumulatedTradingValue 는 백만원 단위라 그대로 쓰면 "659억"이 "7만"으로 찍힌다 — 원 단위(Raw)를 쓴다
      tradingValue: num(s.accumulatedTradingValueRaw),
      tradingValueText: s.accumulatedTradingValueKrwHangeul || null,
      // 랭킹은 폴링 주기·캐시 때문에 관심종목보다 늦을 수 있다 — 몇 시 체결가인지 함께 넘긴다
      asOf: s.localTradedAt || null,
      logo: s.itemLogoUrl || null            // 종목 로고(SVG). ETF 는 운용사 브랜드 로고
    }));
  },

  /**
   * 거래대금 상위 — 네이버에 전용 랭킹 API가 없다.
   * 시총상위 + 상승상위 + 하락상위(각 100)를 합쳐 거래대금으로 재정렬한다.
   * 거래대금 상위는 대형주 아니면 급등락주라 이 셋의 합집합이면 실무적으로 충분하다.
   * (완전한 전수 랭킹은 아니므로 화면에 "근사" 표기를 남긴다)
   */
  async getTopValue(market = 'KOSPI', size = 20) {
    const lists = await Promise.all(['marketValue', 'up', 'down'].map((t) =>
      getJson(`https://m.stock.naver.com/api/stocks/${t}/${market}?page=1&pageSize=100`)
        .then((d) => d.stocks || [])
        .catch(() => [])
    ));
    const seen = new Map();
    for (const arr of lists) {
      for (const s of arr) {
        if (seen.has(s.itemCode)) continue;
        const tv = num(s.accumulatedTradingValueRaw) ?? num(s.accumulatedTradingValue);
        seen.set(s.itemCode, {
          code: s.itemCode,
          name: s.stockName,
          price: num(s.closePrice),
          changeRate: Number(s.fluctuationsRatio),
          change: signOf(s.compareToPreviousPrice && s.compareToPreviousPrice.code)
                  * Math.abs(num(s.compareToPreviousClosePrice) || 0),
          volume: num(s.accumulatedTradingVolume),
          tradingValue: tv,
          tradingValueText: s.accumulatedTradingValueKrwHangeul || null,
          asOf: s.localTradedAt || null,
          logo: s.itemLogoUrl || null
        });
      }
    }
    return Array.from(seen.values())
      .filter((x) => x.tradingValue != null)
      .sort((a, b) => b.tradingValue - a.tradingValue)
      .slice(0, size);
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

  /**
   * 투자자별 매매동향 (개인·외국인·기관 순매수) — 최근 5거래일
   * integration 응답의 dealTrendInfos 에 들어 있다. 별도 엔드포인트는 없다.
   */
  async getDealTrend(code) {
    const d = await getJson(`https://m.stock.naver.com/api/stock/${code}/integration`);
    const rows = Array.isArray(d.dealTrendInfos) ? d.dealTrendInfos : [];
    return rows.map((r) => ({
      date: r.bizdate,
      individual: num(r.individualPureBuyQuant),
      foreign: num(r.foreignerPureBuyQuant),
      organ: num(r.organPureBuyQuant),
      foreignHoldRate: r.foreignerHoldRatio || null,
      close: num(r.closePrice),
      changeRate: (function () {
        const c = num(r.closePrice);
        const diff = num(r.compareToPreviousClosePrice);
        const sign = signOf(r.compareToPreviousPrice && r.compareToPreviousPrice.code);
        if (c == null || diff == null || c === diff) return null;
        return Math.round((sign * Math.abs(diff)) / (c - sign * Math.abs(diff)) * 10000) / 100;
      })()
    }));
  },


  /**
   * 종목 공시 목록 (KOSCOM 제공 — 네이버 종목 화면과 같은 것)
   * 네이버에는 공시 하나만 가리키는 웹 주소가 없다(상세 URL 은 종목 화면으로 302).
   * 그래서 목록에서 바로 펼쳐 볼 수 있게 본문은 getDisclosure 로 따로 받는다.
   */
  async getDisclosures(code, size = 15) {
    const d = await getJson(
      `https://m.stock.naver.com/api/stock/${code}/disclosure?page=1&pageSize=${size}`
    );
    return (Array.isArray(d) ? d : []).map((x) => ({
      id: x.disclosureId,
      title: (x.title || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&apos;/g, "'"),
      datetime: x.datetime,
      author: x.author || null
    })).filter((x) => x.id && x.title).slice(0, size);
  },

  /**
   * 공시 본문.
   * 네이버가 KOSCOM 원문을 HTML 표로 준다. 그 HTML 을 화면에 그대로 꽂으면 XSS 통로가 되므로
   * 여기(서버)에서 텍스트로 바꿔 내려보낸다 — 화면은 받은 문자열을 escape 해서 그리기만 하면 된다.
   */
  async getDisclosure(code, id) {
    const d = await getJson(`https://m.stock.naver.com/api/stock/${code}/disclosure/${id}`);
    const x = d && d.disclosure;
    if (!x) return null;
    return {
      id: x.disclosureId,
      datetime: x.datetime,
      text: htmlToText(x.contents || '')
    };
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
          // 네이버가 정식 모바일 URL을 주면 그걸 쓴다 (직접 조립한 주소는 폴백)
          url: it.mobileNewsUrl || `https://n.news.naver.com/mnews/article/${it.officeId}/${it.articleId}`
        });
      }
    }
    return items.slice(0, size);
  },

  /**
   * 종목 기본정보 — 투자지표(PER·EPS·배당 등) + 증권사 컨센서스 + 최근 분기 실적 + 기업 개요.
   * 네이버에 전용 엔드포인트가 없어 두 곳을 합친다.
   *   integration      → totalInfos(지표), consensusInfo(목표가), researches(리포트), etfKeyIndicator
   *   finance/quarter  → 최근 6분기 매출·영업이익 (마지막 칸은 컨센서스 추정치일 수 있다)
   * 실적은 ETF·리츠 등에 없으므로 실패해도 지표만으로 화면이 서도록 각각 따로 감싼다.
   */

  /**
   * 국내 지수 5종의 당일 분봉 스파크라인. 외부 호출 5건.
   * 해외 선물은 네이버에 분봉이 없어 선을 그리지 않는다 — 숫자만 보여 준다.
   */
  async getIndexSparks() {
    const out = {};
    await Promise.all(Object.entries(INDEX_CODES).map(async ([code, key]) => {
      try {
        const pts = await indexIntraday(code, 30);
        if (pts.length >= 3) out[key] = pts;
      } catch (e) { /* 이 항목만 선이 안 그려진다 */ }
    }));
    return out;
  },


  /**
   * 시장 지표 — 환율 · VIX · 필라델피아 반도체 · 미국/한국 국채 금리.
   * 세 종류가 경로가 다르다.
   *   해외 지수(.VIX/.SOX) : polling worldstock/index  — 콤마 배치라 1건
   *   환율                 : marketindex/exchange/{code}
   *   국채 금리            : marketindex/bond/{reutersCode}  (예: US10YT=RR)
   * 환율·국채는 closePrice/fluctuations/fluctuationsRatio 로 형태가 같아 매퍼를 공유한다.
   * 하나가 실패해도 나머지는 살린다 — 스트립 전체가 비면 안 된다.
   */
  async getMarketExtras() {
    const WORLD = { '.VIX': { key: 'vix', decimals: 2 }, '.SOX': { key: 'sox', decimals: 2 } };
    const BONDS = [
      ['US10YT=RR', 'us10y'], ['KR10YT=RR', 'kr10y'], ['KR3YT=RR', 'kr3y']
    ];
    const out = {};

    const mapBox = (b, key, decimals, unit) => {
      const price = num(b.closePrice);
      if (price == null) return;
      out[key] = {
        code: b.reutersCode || key,
        name: b.name || key,
        price,
        change: num(b.fluctuations),
        changeRate: Number(b.fluctuationsRatio),
        decimals, unit: unit || null,
        delayMin: (b.delayTime != null ? b.delayTime : (b.stockExchangeType && b.stockExchangeType.delayTime)) || 0
      };
    };

    await Promise.all([
      // 해외 지수 — 한 번에
      (async () => {
        try {
          const d = await getJson(
            `https://polling.finance.naver.com/api/realtime/worldstock/index/${Object.keys(WORLD).join(',')}`
          );
          for (const x of (d && d.datas) || []) {
            const meta = WORLD[x.reutersCode];
            if (!meta) continue;
            const sign = signOf(x.compareToPreviousPrice && x.compareToPreviousPrice.code);
            const price = num(x.closePrice);
            if (price == null) continue;
            out[meta.key] = {
              code: x.reutersCode, name: x.indexName,
              price,
              change: sign * Math.abs(num(x.compareToPreviousClosePrice) || 0),
              changeRate: Number(x.fluctuationsRatio),
              decimals: meta.decimals, unit: null,
              delayMin: (x.stockExchangeType && x.stockExchangeType.delayTime) || 0
            };
          }
        } catch (e) { /* 이 묶음만 빠진다 */ }
      })(),
      // 환율 (하나은행 고시)
      (async () => {
        try {
          const d = await getJson('https://api.stock.naver.com/marketindex/exchange/FX_USDKRW');
          if (d && d.exchangeInfo) mapBox(d.exchangeInfo, 'usd', 2, '원');
        } catch (e) { /* 빠진다 */ }
      })(),
      // 국채 금리 — 종목당 1건
      ...BONDS.map(async ([code, key]) => {
        try {
          const d = await getJson(`https://api.stock.naver.com/marketindex/bond/${encodeURIComponent(code)}`);
          if (d) mapBox(d, key, 3, '%');
        } catch (e) { /* 빠진다 */ }
      })
    ]);

    return out;
  },

  /** 그날 지수 분봉이 몇 개인가 — 0 이면 휴장일이다 (거래일은 수백 개) */
  async indexMinuteCount(code, ymd) {
    const bars = await getJson(
      `https://api.stock.naver.com/chart/domestic/index/${code}/minute?startDateTime=${ymd}0900&endDateTime=${ymd}1530`
    );
    return Array.isArray(bars) ? bars.length : null;
  },

  /** 지수 일봉이 있는 날짜들 — 평일인데 없으면 휴장일이다 */
  async indexDailyDates(code, fromYmd, toYmd) {
    const bars = await getJson(
      `https://api.stock.naver.com/chart/domestic/index/${code}/day?startDateTime=${fromYmd}0000&endDateTime=${toYmd}0000`
    );
    return (Array.isArray(bars) ? bars : []).map((x) => String(x.localDate || '')).filter((d) => /^\d{8}$/.test(d));
  },

  /** 지수 일별 종가 — 시즌 기간 벤치마크 수익률 계산용 (YYYYMMDD) */
  /** 지수 일봉 종가 — withDates 면 { d: YYYYMMDD, c } 로 */
  async indexDailyCloses(code, fromYmd, toYmd, withDates) {
    const bars = await getJson(
      `https://api.stock.naver.com/chart/domestic/index/${code}/day?startDateTime=${fromYmd}0000&endDateTime=${toYmd}0000`
    );
    const rows = (Array.isArray(bars) ? bars : [])
      .map((x) => ({ d: String(x.localDate || x.localDateTime || '').slice(0, 8), c: typeof x.closePrice === 'number' ? x.closePrice : num(x.closePrice) }))
      .filter((r) => r.c != null);
    return withDates ? rows : rows.map((r) => r.c);
  },

  async getProfile(code) {
    const [integration, finance] = await Promise.all([
      getJson(`https://m.stock.naver.com/api/stock/${code}/integration`),
      getJson(`https://m.stock.naver.com/api/stock/${code}/finance/quarter`).catch(() => null)
    ]);

    // totalInfos 는 [{code,key,value}] 배열 — 값은 이미 단위가 붙은 표시용 문자열이다("12.68배")
    const info = {};
    for (const t of (integration.totalInfos || [])) {
      if (t && t.code && t.value != null && t.value !== 'N/A' && t.value !== '-') info[t.code] = String(t.value);
    }

    const cns = integration.consensusInfo;
    const consensus = cns && num(cns.priceTargetMean)
      ? { date: cns.createDate || null, recommMean: num(cns.recommMean), targetMean: num(cns.priceTargetMean) }
      : null;

    const etfKi = integration.etfKeyIndicator;
    const etf = etfKi ? {
      issuer: etfKi.issuerName || null,
      baseIndex: info.etfBaseIdx || null,
      totalFee: etfKi.totalFee != null ? Number(etfKi.totalFee) : null,
      nav: num(etfKi.nav),
      deviationRate: etfKi.deviationRate != null
        ? (etfKi.deviationSign === '-' ? -Number(etfKi.deviationRate) : Number(etfKi.deviationRate))
        : null,
      dividendYieldTtm: etfKi.dividendYieldTtm != null ? Number(etfKi.dividendYieldTtm) : null,
      returnRate1m: etfKi.returnRate1m != null ? Number(etfKi.returnRate1m) : null,
      returnRate3m: etfKi.returnRate3m != null ? Number(etfKi.returnRate3m) : null,
      returnRate1y: etfKi.returnRate1y != null ? Number(etfKi.returnRate1y) : null,
      marketValue: etfKi.marketValue || null
    } : null;

    const researches = (integration.researches || []).slice(0, 5).map((r) => ({
      id: r.id,
      broker: r.bnm || '',
      title: (r.tit || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&apos;/g, "'"),
      date: r.wdt || ''
    })).filter((r) => r.id && r.title);

    return {
      code,
      name: integration.stockName || null,
      type: integration.stockEndType === 'etf' ? 'etf' : (integration.stockEndType || 'stock'),
      summary: summaryLines(finance && finance.corporationSummary),
      indicators: info,
      etf,
      consensus,
      researches,
      finance: mapQuarterFinance(finance && finance.financeInfo)
    };
  }
};

/**
 * 공시 원문 HTML → 읽을 수 있는 텍스트.
 * 표 기반 양식이라 행/칸 경계를 살려야 뜻이 통한다 — 행은 줄바꿈, 칸은 가운뎃점으로 잇는다.
 * script·style 은 내용째로 버린다.
 */
function htmlToText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    // 원문이 이미 예쁘게 들여쓰여 있다 — 그 줄바꿈을 먼저 지워야 표 구조로만 줄을 나눌 수 있다
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/<\/(tr|p|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' · ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/(?: · )+/g, ' · ')
      .replace(/^ ?· | ?· ?$/g, '')
      .replace(/ : · /g, ' : ')          // '회 사 명 : · 삼성전자' → '회 사 명 : 삼성전자'
      .trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 6000);        // 아주 긴 공시(사업보고서 등)는 잘라 보낸다
}

/**
 * 국내 지수 당일 분봉 종가 — 스트립 스파크라인용.
 * 해외 선물·해외 지수는 네이버가 분봉을 주지 않는다 (/minute 는 200 이지만 0봉, /price 도 일별 종가).
 * 네이버 자기 화면도 그래서 해외는 선 없이 숫자만 보여 준다 — 우리도 그렇게 한다.
 * 장 시작 전이라 분봉이 아직 없으면 선을 그리지 않는다 (일봉으로 대신하면 '실시간'이 아니다).
 */
async function indexIntraday(code, points) {
  const k = new Date(Date.now() + 9 * 3600e3);
  const p2 = (n) => String(n).padStart(2, '0');
  const ymd = `${k.getUTCFullYear()}${p2(k.getUTCMonth() + 1)}${p2(k.getUTCDate())}`;
  const hm = `${p2(k.getUTCHours())}${p2(k.getUTCMinutes())}`;

  const bars = await getJson(
    `https://api.stock.naver.com/chart/domestic/index/${code}/minute?startDateTime=${ymd}0900&endDateTime=${ymd}${hm}`
  );
  const closes = (Array.isArray(bars) ? bars : [])
    .map((x) => (typeof x.currentPrice === 'number' ? x.currentPrice : num(x.currentPrice)))
    .filter((v) => v != null);
  return downsample(closes, points || 30);
}

/** 앞부분을 버리지 않고 고르게 솎는다 — 마지막 값은 항상 남긴다 */
function downsample(arr, max) {
  if (arr.length <= max) return arr;
  const out = [];
  const step = arr.length / max;
  for (let i = 0; i < max; i++) out.push(arr[Math.min(arr.length - 1, Math.floor(i * step))]);
  out[max - 1] = arr[arr.length - 1];
  return out;
}

/** corporationSummary(comment1~3) → 문장 배열 */
function summaryLines(s) {
  if (!s) return null;
  const lines = [s.comment1, s.comment2, s.comment3]
    .map((x) => String(x || '').trim()).filter(Boolean);
  return lines.length ? lines : null;
}

/**
 * finance/quarter 의 rowList(행=항목, 열=분기) → 화면이 쓰기 좋은 열 배열로 뒤집는다.
 * 금액 단위는 억원. 미발표 분기는 "-" 로 오므로 null 로 바꾼다.
 * trTitleList 의 isConsensus === 'Y' 는 증권사 추정치(아직 발표 전)라는 뜻이라 화면에서 구분해 표시한다.
 */
function mapQuarterFinance(fi) {
  if (!fi || !Array.isArray(fi.trTitleList) || !Array.isArray(fi.rowList)) return null;
  const cols = fi.trTitleList.map((t) => ({
    key: t.key,
    title: String(t.title || '').replace(/\.$/, ''),   // "2026.09." → "2026.09"
    estimate: t.isConsensus === 'Y'
  }));
  if (!cols.length) return null;

  const pick = (title) => {
    const row = fi.rowList.find((r) => r.title === title);
    if (!row || !row.columns) return null;
    const vals = cols.map((c) => num(row.columns[c.key] && row.columns[c.key].value));
    return vals.some((v) => v != null) ? vals : null;
  };

  const revenue = pick('매출액');
  if (!revenue) return null;      // 매출이 없으면 실적 카드를 그릴 이유가 없다
  return {
    unit: '억원',
    cols,
    revenue,
    operatingProfit: pick('영업이익'),
    netProfit: pick('당기순이익'),
    opMargin: pick('영업이익률')
  };
}


// ── 폴백 프로바이더 ────────────────────────────────────────────
// 현재가만 대체 가능. 호가는 네이버에만 있어 폴백 불가(다음은 500, 야후는 미제공).

export const daum = {
  name: 'daum',
  async getQuote(code) {
    const r = await fetch(`https://finance.daum.net/api/quotes/A${code}?summary=false&changeStatistics=true`, withTimeout({
      headers: { 'User-Agent': UA, 'Referer': `https://finance.daum.net/quotes/A${code}` }
    }));
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
    // 시장을 모르면 코스피(.KS) → 코스닥(.KQ) 순으로 시도한다 (코스닥 종목이 항상 실패하던 문제)
    const order = market === 'KOSDAQ' ? ['KQ', 'KS'] : ['KS', 'KQ'];
    let d = null, lastErr = null;
    for (const suffix of order) {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${code}.${suffix}?interval=1d&range=1d`,
          withTimeout({ headers: { 'User-Agent': UA } })
        );
        if (!r.ok) throw new Error(`yahoo ${r.status}`);
        const j = await r.json();
        if (j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta) { d = j; break; }
        throw new Error('yahoo: empty');
      } catch (e) { lastErr = e; }
    }
    if (!d) throw lastErr || new Error('yahoo: not found');
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
