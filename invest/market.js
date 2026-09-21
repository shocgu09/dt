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
  news:    function (code) { return marketApi('/api/news', { code: code }); },
  // 스파크라인 전용 경량 엔드포인트 — 분봉 전체 대신 40포인트만 내려온다
  spark:   function (code) { return marketApi('/api/spark', { code: code }); }
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
/* 같은 기기를 여러 회원이 쓰면 최근 본 종목이 섞이므로 uid로 분리한다.
 * 로그인 전에는 아예 읽고 쓰지 않는다. */
var RECENT_PREFIX = 'dt-invest-recent:';
var RECENT_LEGACY = 'dt-invest-recent';   // uid 구분 없던 구버전 키

function recentKey() {
  return (currentUser && currentUser.uid) ? RECENT_PREFIX + currentUser.uid : null;
}

function pushRecent(code, name) {
  var key = recentKey();
  if (!key) return;
  try {
    var list = getRecent().filter(function (r) { return r.code !== code; });
    list.unshift({ code: code, name: name });
    localStorage.setItem(key, JSON.stringify(list.slice(0, 10)));
  } catch (e) { /* 사파리 프라이빗 등 — 무시 */ }
}

function getRecent() {
  var key = recentKey();
  if (!key) return [];
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch (e) { return []; }
}

function clearRecent() {
  var key = recentKey();
  try { if (key) localStorage.removeItem(key); } catch (e) {}
}

/** 회원 구분 없이 저장돼 공유되던 구버전 기록을 제거한다 (1회성 정리) */
function purgeLegacyRecent() {
  try { localStorage.removeItem(RECENT_LEGACY); } catch (e) {}
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

var MA_DEFS = [[5, '#4ade80'], [20, '#fbbf24'], [60, '#a09aff']];

/** 이동평균선 (자세히 보기용) */
function movingAverage(bars, n) {
  var out = [], sum = 0;
  for (var i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= n) sum -= bars[i - n].c;
    if (i >= n - 1) out.push({ time: bars[i]._t, value: sum / n });
  }
  return out;
}

/**
 * 차트를 그린다.
 * @param mode 'simple' = 라인 + 최고/최저 (토스 기본) · 'detail' = 캔들 + 거래량 + 이동평균
 * 반환: { dispose, updateLast }
 */
async function renderChart(container, bars, tf, mode) {
  await ensureChartLib();
  container.innerHTML = '';
  mode = mode === 'detail' ? 'detail' : 'simple';

  var up = cssVar('--stock-up') || '#f0616d';
  var down = cssVar('--stock-down') || '#4d8bff';
  var text = cssVar('--text2') || '#9aa5b8';
  var grid = cssVar('--border') || '#2b3242';
  var bg = cssVar('--bg') || '#12151c';

  var chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: mode === 'detail' ? 300 : 240,
    layout: { background: { color: bg }, textColor: text, fontSize: 11, attributionLogo: false },
    grid: {
      vertLines: { color: mode === 'detail' ? grid : 'transparent' },
      horzLines: { color: grid }
    },
    rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.14, bottom: mode === 'detail' ? 0.28 : 0.1 } },
    timeScale: { borderColor: grid, timeVisible: tf === 'm' || tf === 'm5', secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScale: { axisPressedMouseMove: false },
    localization: {
      locale: 'ko-KR',
      priceFormatter: function (p) { return Math.round(p).toLocaleString('ko-KR'); }
    }
  });

  bars.forEach(function (b) { b._t = toChartTime(b.t, tf); });

  // 기간 전체가 오르면 빨강 / 내리면 파랑 (간단 보기 라인 색)
  var first = bars[0], last = bars[bars.length - 1];
  var rising = last && first ? last.c >= first.c : true;
  var lineColor = rising ? up : down;

  var mainSeries, volSeries = null, maSeries = [];

  if (mode === 'simple') {
    mainSeries = chart.addAreaSeries({
      lineColor: lineColor, lineWidth: 2,
      topColor: lineColor + '44', bottomColor: lineColor + '05',
      priceLineVisible: true, priceFormat: { type: 'price', precision: 0, minMove: 1 }
    });
    mainSeries.setData(bars.map(function (b) { return { time: b._t, value: b.c }; }));

    // 최고·최저 지점 표시 (토스 차용) — 고가/저가가 발생한 봉에 찍고 그 값을 쓴다.
    // 마커의 Y위치는 종가 선 위지만, 표시 숫자는 실제 고가/저가여야 상단 라벨과 일치한다.
    var hiIdx = 0, loIdx = 0;
    bars.forEach(function (b, i) {
      if (b.h > bars[hiIdx].h) hiIdx = i;
      if (b.l < bars[loIdx].l) loIdx = i;
    });
    if (bars.length > 2 && hiIdx !== loIdx) {
      mainSeries.setMarkers([
        { time: bars[hiIdx]._t, position: 'aboveBar', color: up, shape: 'circle',
          text: '최고 ' + Math.round(bars[hiIdx].h).toLocaleString('ko-KR') },
        { time: bars[loIdx]._t, position: 'belowBar', color: down, shape: 'circle',
          text: '최저 ' + Math.round(bars[loIdx].l).toLocaleString('ko-KR') }
      ].sort(function (a, b) {
        var av = (a.time && a.time.day) ? Date.UTC(a.time.year, a.time.month - 1, a.time.day) / 1000 : a.time;
        var bv = (b.time && b.time.day) ? Date.UTC(b.time.year, b.time.month - 1, b.time.day) / 1000 : b.time;
        return av - bv;
      }));
    }
  } else {
    mainSeries = chart.addCandlestickSeries({
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down,
      wickUpColor: up, wickDownColor: down,
      priceFormat: { type: 'price', precision: 0, minMove: 1 }
    });
    mainSeries.setData(bars.map(function (b) {
      return { time: b._t, open: b.o, high: b.h, low: b.l, close: b.c };
    }));

    volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    volSeries.setData(bars.map(function (b) {
      return { time: b._t, value: b.v || 0, color: (b.c >= b.o ? up : down) + '55' };
    }));

    // 이동평균선 5·20·60
    MA_DEFS.forEach(function (cfg) {
      if (bars.length < cfg[0]) return;
      var ls = chart.addLineSeries({
        color: cfg[1], lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      ls.setData(movingAverage(bars, cfg[0]));
      maSeries.push(ls);
    });
  }

  chart.timeScale().fitContent();

  var onResize = function () { chart.applyOptions({ width: container.clientWidth }); };
  window.addEventListener('resize', onResize);

  // 최고/최저는 언제나 고가·저가 기준.
  // 종가 기준으로 잡으면 주봉·월봉에서 주/월 마지막 종가만 남아 중간 고점이 사라지고,
  // 기간을 넓혔는데 최고가가 내려가는 모순이 생긴다.
  var periodHigh = bars.length ? Math.max.apply(null, bars.map(function (b) { return b.h; })) : null;
  var periodLow = bars.length ? Math.min.apply(null, bars.map(function (b) { return b.l; })) : null;

  var lastBar = last ? { time: last._t, open: last.o, high: last.h, low: last.l, close: last.c } : null;
  var lastVolV = last ? (last.v || 0) : 0;

  return {
    mode: mode,
    periodHigh: periodHigh,
    periodLow: periodLow,
    dispose: function () {
      window.removeEventListener('resize', onResize);
      try { chart.remove(); } catch (e) {}
    },
    /** 틱이 올 때마다 마지막 봉만 갱신 (O(1)) */
    updateLast: function (price, bucketTime, volume) {
      if (price == null || !isFinite(price)) return;
      var same = lastBar && JSON.stringify(lastBar.time) === JSON.stringify(bucketTime);
      if (!lastBar || !same) {
        lastBar = { time: bucketTime, open: price, high: price, low: price, close: price };
        lastVolV = volume || 0;
      } else {
        lastBar.high = Math.max(lastBar.high, price);
        lastBar.low = Math.min(lastBar.low, price);
        lastBar.close = price;
        if (volume != null) lastVolV = volume;
      }
      try {
        if (mode === 'simple') mainSeries.update({ time: lastBar.time, value: lastBar.close });
        else {
          mainSeries.update(lastBar);
          if (volSeries) volSeries.update({
            time: lastBar.time, value: lastVolV,
            color: (lastBar.close >= lastBar.open ? up : down) + '55'
          });
        }
      } catch (e) { /* 시간 역행 등은 무시 */ }
    }
  };
}

/* ===== 미니 스파크라인 (관심종목 카드용) =====
 * 종가 배열만으로 작은 SVG를 직접 그린다. 차트 라이브러리를 쓸 필요가 없다.
 */
function sparklineSvg(values, rising, w, h) {
  w = w || 260; h = h || 56;
  var vals = (values || []).filter(function (v) { return v != null && isFinite(v); });
  if (vals.length < 2) return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '"></svg>';

  var min = Math.min.apply(null, vals);
  var max = Math.max.apply(null, vals);
  var span = (max - min) || 1;
  var pad = 4;
  var stepX = w / (vals.length - 1);
  var y = function (v) { return pad + (h - pad * 2) * (1 - (v - min) / span); };

  var pts = vals.map(function (v, i) { return (i * stepX).toFixed(1) + ',' + y(v).toFixed(1); });
  var line = pts.join(' ');
  var area = '0,' + h + ' ' + line + ' ' + w + ',' + h;
  var cls = rising ? 'up' : 'down';

  return '<svg class="spark ' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">'
    + '<polygon class="spark-area" points="' + area + '"/>'
    + '<polyline class="spark-line" points="' + line + '"/>'
    + '</svg>';
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

/* ===== 값 변동 플래시 =====
 * innerHTML을 통째로 갈아끼우면 애니메이션이 끊기므로,
 * 텍스트만 바꾸고 이 함수로 배경을 짧게 번쩍인다.
 */
function setTextFlash(el, text, dir) {
  if (!el) return;
  var prev = el.textContent;
  if (prev === text) return;
  el.textContent = text;
  if (!dir) return;
  el.classList.remove('flash-up', 'flash-down');
  // 리플로우를 강제해야 같은 클래스를 연속으로 줘도 애니메이션이 다시 돈다
  void el.offsetWidth;
  el.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
}

/** 이전 값과 비교해 방향을 낸다 (+1 상승 / -1 하락 / 0 변화없음) */
var _prevVals = {};
function dirOf(key, v) {
  var p = _prevVals[key];
  _prevVals[key] = v;
  if (p === undefined || p === v || v == null) return 0;
  return v > p ? 1 : -1;
}

function resetDirs(prefix) {
  Object.keys(_prevVals).forEach(function (k) {
    if (!prefix || k.indexOf(prefix) === 0) delete _prevVals[k];
  });
}
