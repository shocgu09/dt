/* ===== DT 재테크 — 시세 인프라 (Phase 3) =====
 * dt-stock 워커 클라이언트 + 폴링 스케줄러 + 차트 래퍼.
 * 화면 렌더링은 market-ui.js 담당.
 */

var MARKET_API = 'https://dt-stock.shocguna.workers.dev';

/* ===== 워커 호출 ===== */
async function marketApi(path, params) {
  if (!currentUser) throw new Error('로그인이 필요합니다');
  var token = await currentUser.getIdToken();   // SDK가 만료 임박 시 알아서 갱신
  var qs = new URLSearchParams(params || {}).toString();
  var url = MARKET_API + path + (qs ? '?' + qs : '');

  var res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401) throw new Error('인증이 만료되었습니다. 새로고침해 주세요');
  if (!res.ok) throw new Error('시세를 가져오지 못했습니다 (' + res.status + ')');
  var data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

var Market = {
  quote:   function (code) { return marketApi('/api/quote', { code: code }); },
  book:    function (code) { return marketApi('/api/book', { code: code }); },
  ohlc:    function (code, tf) { return marketApi('/api/ohlc', { code: code, tf: tf || 'D' }); },
  index:   function () { return marketApi('/api/index'); },
  search:  function (q) { return marketApi('/api/search', { q: q }); },
  rank:    function (type, market) { return marketApi('/api/rank', { type: type || 'up', market: market || 'KOSPI' }); },
  sectors: function (kind, no) {
    var p = { kind: kind || 'theme' };
    if (no) p.no = no;
    return marketApi('/api/sectors', p);
  },
  news:    function (code) { return marketApi('/api/news', { code: code }); }
};

/* ===== 장 운영시간 (KST 평일 09:00~15:30, 시간외 16:00까지) ===== */
function isMarketOpen(now) {
  var d = now || new Date();
  var kst = new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + 9 * 3600000);
  var day = kst.getDay();
  if (day === 0 || day === 6) return false;
  var m = kst.getHours() * 60 + kst.getMinutes();
  return m >= 9 * 60 && m <= 16 * 60;
}

function marketStateLabel() {
  if (!isMarketOpen()) return { cls: 'closed', text: '장 마감' };
  return { cls: 'live', text: '실시간' };
}

/* ===== 폴링 스케줄러 =====
 * - 장외에는 돌지 않는다 (네이버 트래픽 최소화)
 * - 탭이 백그라운드면 멈춘다 (모바일 배터리)
 * - 화면 전환 시 stopAll()로 확실히 정리
 */
var Poller = (function () {
  var jobs = {};          // key -> { fn, ms, timer }
  var paused = false;

  function run(key) {
    var job = jobs[key];
    if (!job) return;
    Promise.resolve()
      .then(job.fn)
      .catch(function () { /* 개별 실패는 무시 — 다음 주기에 재시도 */ })
      .then(function () {
        if (jobs[key] && !paused) job.timer = setTimeout(function () { run(key); }, job.ms);
      });
  }

  return {
    add: function (key, fn, ms) {
      this.remove(key);
      jobs[key] = { fn: fn, ms: ms || 5000, timer: null };
      run(key);                        // 즉시 1회 실행
    },
    remove: function (key) {
      if (jobs[key]) { clearTimeout(jobs[key].timer); delete jobs[key]; }
    },
    stopAll: function () {
      Object.keys(jobs).forEach(function (k) { clearTimeout(jobs[k].timer); });
      jobs = {};
    },
    pause: function () {
      paused = true;
      Object.keys(jobs).forEach(function (k) { clearTimeout(jobs[k].timer); });
    },
    resume: function () {
      if (!paused) return;
      paused = false;
      Object.keys(jobs).forEach(function (k) { run(k); });
    },
    activeKeys: function () { return Object.keys(jobs); }
  };
})();

document.addEventListener('visibilitychange', function () {
  if (document.hidden) Poller.pause();
  else Poller.resume();
});

/* ===== 최근 본 종목 (localStorage — 서버 비용 0) ===== */
var RECENT_KEY = 'dt-invest-recent';

function pushRecent(code, name) {
  try {
    var list = getRecent().filter(function (r) { return r.code !== code; });
    list.unshift({ code: code, name: name });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  } catch (e) { /* 사파리 프라이빗 등 — 무시 */ }
}

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch (e) { return []; }
}

function clearRecent() {
  try { localStorage.removeItem(RECENT_KEY); } catch (e) {}
}

/* ===== 관심종목 (Firestore stock_watchlist/{uid}) ===== */
var watchlist = [];

async function loadWatchlist() {
  if (!db || !currentUser) return [];
  try {
    var doc = await db.collection('stock_watchlist').doc(currentUser.uid).get();
    watchlist = (doc.exists && Array.isArray(doc.data().codes)) ? doc.data().codes : [];
  } catch (e) { watchlist = []; }
  return watchlist;
}

async function toggleWatch(code) {
  if (!db || !currentUser) return false;
  var on = watchlist.indexOf(code) === -1;
  watchlist = on ? watchlist.concat([code]) : watchlist.filter(function (c) { return c !== code; });
  try {
    await db.collection('stock_watchlist').doc(currentUser.uid).set({
      codes: watchlist,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    // 실패하면 로컬 상태를 되돌린다
    watchlist = on ? watchlist.filter(function (c) { return c !== code; }) : watchlist.concat([code]);
    throw e;
  }
  return on;
}

/* ===== 차트 (lightweight-charts) ===== */
var CHART_SRC = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';
var _chartLibPromise = null;

function ensureChartLib() {
  if (window.LightweightCharts) return Promise.resolve();
  if (_chartLibPromise) return _chartLibPromise;
  _chartLibPromise = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = CHART_SRC;
    s.onload = resolve;
    s.onerror = function () { _chartLibPromise = null; reject(new Error('차트를 불러오지 못했습니다')); };
    document.head.appendChild(s);
  });
  return _chartLibPromise;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 네이버 캔들 t("20260921" | "20260921121500") → lightweight-charts 시간값 */
function toChartTime(t, tf) {
  var s = String(t);
  if (s.length >= 12) {
    // 분봉: lightweight-charts는 타임스탬프를 UTC로 표시한다.
    // KST 벽시계 시각을 그대로 UTC인 척 넘겨야 축에 09:00~15:30이 제대로 찍힌다.
    // (진짜 UTC로 변환하면 09:00이 00:00으로 표시됨)
    var d = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
    return Math.floor(d / 1000);
  }
  return { year: +s.slice(0, 4), month: +s.slice(4, 6), day: +s.slice(6, 8) };
}

/** 일봉 → 주봉/월봉 집계 (네이버는 일봉만 주므로 클라이언트에서 묶는다) */
function aggregateCandles(bars, unit) {
  var buckets = {};
  var order = [];
  bars.forEach(function (b) {
    var s = String(b.t);
    var key = unit === 'W'
      ? isoWeekKey(s)
      : s.slice(0, 6);            // 월봉: YYYYMM
    if (!buckets[key]) { buckets[key] = { t: s, o: b.o, h: b.h, l: b.l, c: b.c, v: 0 }; order.push(key); }
    var k = buckets[key];
    k.h = Math.max(k.h, b.h);
    k.l = Math.min(k.l, b.l);
    k.c = b.c;
    k.t = s;                       // 버킷의 마지막 거래일
    k.v += (b.v || 0);
  });
  return order.map(function (k) { return buckets[k]; });
}

function isoWeekKey(ymd) {
  var d = new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
  var day = (d.getDay() + 6) % 7;            // 월=0
  d.setDate(d.getDate() - day);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/** 차트를 그린다. 반환값은 dispose 함수 */
async function renderChart(container, bars, tf) {
  await ensureChartLib();
  container.innerHTML = '';

  var up = cssVar('--stock-up') || '#f0616d';
  var down = cssVar('--stock-down') || '#4d8bff';
  var text = cssVar('--text2') || '#9aa5b8';
  var grid = cssVar('--border') || '#2b3242';
  var bg = cssVar('--bg') || '#12151c';

  var chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 260,
    layout: { background: { color: bg }, textColor: text, fontSize: 11 },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.1, bottom: 0.28 } },
    timeScale: { borderColor: grid, timeVisible: tf === 'm' || tf === 'm5', secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScale: { axisPressedMouseMove: false },
    localization: {
      locale: 'ko-KR',
      priceFormatter: function (p) { return Math.round(p).toLocaleString('ko-KR'); }
    }
  });

  var candleSeries = chart.addCandlestickSeries({
    upColor: up, downColor: down, borderUpColor: up, borderDownColor: down,
    wickUpColor: up, wickDownColor: down,
    priceFormat: { type: 'price', precision: 0, minMove: 1 }
  });
  var volSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
    color: grid
  });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

  var candles = bars.map(function (b) {
    return { time: toChartTime(b.t, tf), open: b.o, high: b.h, low: b.l, close: b.c };
  });
  var vols = bars.map(function (b) {
    return { time: toChartTime(b.t, tf), value: b.v || 0, color: b.c >= b.o ? up + '55' : down + '55' };
  });

  candleSeries.setData(candles);
  volSeries.setData(vols);
  chart.timeScale().fitContent();

  var onResize = function () { chart.applyOptions({ width: container.clientWidth }); };
  window.addEventListener('resize', onResize);

  return function dispose() {
    window.removeEventListener('resize', onResize);
    try { chart.remove(); } catch (e) {}
  };
}

/* ===== 숫자 포맷 ===== */
function fmtNum(n) {
  return (n === null || n === undefined || isNaN(n)) ? '-' : Number(n).toLocaleString('ko-KR');
}

function fmtRate(r) {
  if (r === null || r === undefined || isNaN(r)) return '-';
  return (r > 0 ? '+' : '') + Number(r).toFixed(2) + '%';
}

/** 거래량/금액을 만·억·조 단위로 */
function fmtCompact(n) {
  if (!n && n !== 0) return '-';
  var a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(1) + '조';
  if (a >= 1e8) return (n / 1e8).toFixed(0) + '억';
  if (a >= 1e4) return (n / 1e4).toFixed(0) + '만';
  return fmtNum(n);
}

function signClass(v) {
  if (v > 0) return 'up';
  if (v < 0) return 'down';
  return 'flat';
}

function signMark(v) {
  if (v > 0) return '▲';
  if (v < 0) return '▼';
  return '–';
}
