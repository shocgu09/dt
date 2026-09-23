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

  // 워커가 응답을 붙들면 화면이 "불러오는 중"에 갇힌다 — 15초에 끊어 오류로 돌리고 다음 폴링이 다시 부른다
  var init = { headers: { Authorization: 'Bearer ' + token } };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(15000);
  var res;
  try { res = await fetch(url, init); }
  catch (e) { throw new Error(e && e.name === 'TimeoutError' ? '시세 서버 응답이 늦습니다. 잠시 후 다시 시도합니다' : '네트워크 오류로 시세를 가져오지 못했습니다'); }
  if (res.status === 401) throw new Error('인증이 만료되었습니다. 새로고침해 주세요');
  if (!res.ok) throw new Error('시세를 가져오지 못했습니다 (' + res.status + ')');
  var data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

var Market = {
  quote:   function (code) { return marketApi('/api/quote', { code: code }); },
  // 여러 종목을 한 번에 (최대 50) — 관심종목을 종목 수만큼 따로 부르지 않는다
  quotes:  function (codes) { return marketApi('/api/quotes', { codes: codes.join(',') }); },
  book:    function (code) { return marketApi('/api/book', { code: code }); },
  ohlc:    function (code, tf) { return marketApi('/api/ohlc', { code: code, tf: tf || 'D' }); },
  index:   function () { return marketApi('/api/index'); },
  // 서버 자동완성(앞부분 일치) + 종목 마스터의 초성·키워드 검색을 합친다 — 아래 searchStocks 참조
  search:  function (q, onUpdate) { return searchStocks(q, onUpdate); },
  rank:    function (type, market) { return marketApi('/api/rank', { type: type || 'up', market: market || 'KOSPI' }); },
  sectors: function (kind, no) {
    var p = { kind: kind || 'theme' };
    if (no) p.no = no;
    return marketApi('/api/sectors', p);
  },
  news:    function (code) { return marketApi('/api/news', { code: code }); },
  // 스파크라인 전용 경량 엔드포인트 — 분봉 전체 대신 40포인트만 내려온다
  spark:   function (code) { return marketApi('/api/spark', { code: code }); },
  // 투자자별 매매동향 (개인·외국인·기관) — 최근 5거래일
  trend:   function (code) { return marketApi('/api/trend', { code: code }); },
  // 투자지표·컨센서스 목표가·분기 실적 (하루 단위로만 바뀐다 — 폴링하지 않는다)
  profile: function (code) { return marketApi('/api/profile', { code: code }); },
  // 공시 — id 를 주면 그 공시의 본문 (워커가 HTML 을 텍스트로 바꿔 준다)
  disclosure: function (code, id) {
    var p = { code: code };
    if (id) p.id = id;
    return marketApi('/api/disclosure', p);
  }
};

/* ===== 종목 검색 =====
 * 네이버 자동완성은 이름의 앞부분만 맞춘다. 초성도 그래서 "SKㅎㅇㄴㅅ"은 되고 "ㅎㅇㄴㅅ"은 안 되며,
 * "레버리지"·"인버스" 같은 중간 단어로는 ETF 가 나오지 않는다.
 * 전 종목 목록(stock-master.json — scripts/build-stock-master.mjs 로 생성, 시가총액 순)을 처음 검색할 때
 * 한 번 받아 두고 화면에서 직접 찾는다. 마스터에 아직 없는 신규 상장 종목은 서버 결과로 메운다.
 */
var MASTER_VER = '20260921';
var _master = null, _masterLoading = null;
var CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

/** "SK하이닉스" → "skㅎㅇㄴㅅ" (한글은 초성만, 나머지는 소문자 그대로, 공백 제거) */
function chosungOf(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xAC00 && c <= 0xD7A3) out += CHO[Math.floor((c - 0xAC00) / 588)];
    else if (s[i] !== ' ') out += s[i].toLowerCase();
  }
  return out;
}

function loadMaster() {
  if (_master) return Promise.resolve(_master);
  if (_masterLoading) return _masterLoading;
  _masterLoading = fetch('stock-master.json?v=' + MASTER_VER)
    .then(function (r) { if (!r.ok) throw new Error('master ' + r.status); return r.json(); })
    .then(function (d) {
      _master = (d.items || []).map(function (x) {
        var key = String(x[1]).toLowerCase().replace(/\s+/g, '');
        return { code: x[0], name: x[1], market: x[2], key: key, cho: chosungOf(String(x[1])) };
      });
      return _master;
    })
    .catch(function () { _masterLoading = null; return []; });
  return _masterLoading;
}

function localSearch(list, q) {
  var key = q.toLowerCase().replace(/\s+/g, '');
  if (!key) return [];
  var byCho = /[ㄱ-ㅎ]/.test(key);
  var needle = byCho ? chosungOf(key) : key;
  var head = [], rest = [];
  for (var i = 0; i < list.length && head.length < 20; i++) {
    var it = list[i];
    var at = byCho ? it.cho.indexOf(needle) : it.key.indexOf(needle);
    if (at === -1 && !byCho && it.code.toLowerCase().indexOf(key) === 0) at = 0;
    if (at === 0) head.push(it);
    else if (at > 0 && rest.length < 20) rest.push(it);
  }
  // 앞부분이 맞는 종목 먼저, 그 안에서는 마스터 순서(시가총액 순)
  return head.concat(rest).slice(0, 20);
}

/**
 * 종목 검색. 종목 마스터에서 찾은 결과는 기다리지 않고 바로 돌려주고, 서버 자동완성(신규 상장 종목 보강)은
 * 도착하면 onUpdate 로 다시 넘긴다 — 서버가 느린 콜로에 걸려도 화면은 즉시 뜬다.
 * 마스터가 없거나(로드 실패) 마스터에서 못 찾았을 때만 서버를 기다린다 (최대 6초).
 */
async function searchStocks(q, onUpdate) {
  var term = (q || '').trim();
  if (!term) return { items: [] };
  var merge = function (server, local) {
    // 초성 검색은 네이버가 앞부분만 맞추므로 자체 결과를 앞에, 그 밖에는 서버 결과를 앞에 둔다
    var first = /[ㄱ-ㅎ]/.test(term) ? local : server, second = first === local ? server : local;
    var seen = {}, items = [];
    first.concat(second).forEach(function (i) {
      if (seen[i.code] || items.length >= 20) return;
      seen[i.code] = true;
      items.push({ code: i.code, name: i.name, market: i.market });
    });
    return { query: term, items: items };
  };
  var serverP = marketApi('/api/search', { q: term }).catch(function () { return null; });
  var local = localSearch(await loadMaster(), term);
  if (local.length) {
    if (onUpdate) serverP.then(function (r) {
      if (r && r.items && r.items.length) onUpdate(merge(r.items, local));
    });
    return merge([], local);
  }
  var r = await Promise.race([serverP, new Promise(function (res) { setTimeout(function () { res(null); }, 6000); })]);
  if (!r) throw new Error('검색하지 못했습니다. 잠시 후 다시 시도해 주세요');
  return merge(r.items || [], local);
}

/* ===== 장 운영시간 (KRX 정규장 09:00~15:30 · NXT/KRX 애프터마켓 ~20:00) ===== */
/* 네이버가 내려주는 종목의 marketStatus 를 우선 신뢰한다.
 * 시계로만 판단하면 휴장일을 "실시간"으로, 애프터마켓을 "장 마감"으로 잘못 본다.
 * (지수의 marketStatus 는 15:30 에 CLOSE 가 되므로 쓰지 않는다 — 워커가 종목 기준 값을 실어 준다) */
var _serverMarketStatus = null;   // 'OPEN' | 'CLOSE' | null(모름)
var _serverStatusAt = 0;

// KRX 휴장일 (주말 제외, KST YYYYMMDD) — functions/mock/engine.js 의 HOLIDAYS 와 같은 표. 둘을 함께 고친다.
var KRX_HOLIDAYS = {
  '20260924': 1, '20260925': 1, '20261005': 1, '20261009': 1, '20261225': 1, '20261231': 1,
  '20270101': 1, '20270205': 1, '20270208': 1, '20270209': 1, '20270301': 1, '20270505': 1, '20270513': 1, '20270816': 1,
  '20270914': 1, '20270915': 1, '20270916': 1, '20271004': 1, '20271011': 1, '20271227': 1, '20271231': 1
};

/** KST 기준 날짜·시각 분해 */
function kstParts(d) {
  var k = new Date((d || new Date()).getTime() + (d || new Date()).getTimezoneOffset() * 60000 + 9 * 3600000);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return { ymd: '' + k.getFullYear() + p(k.getMonth() + 1) + p(k.getDate()), day: k.getDay(), hm: k.getHours() * 60 + k.getMinutes(), date: k };
}

/** 오늘(KST)이 거래일인가 — 평일이고 휴장일이 아닌 날 */
function isTradingDayKst(d) {
  var k = kstParts(d);
  return k.day >= 1 && k.day <= 5 && !KRX_HOLIDAYS[k.ymd];
}

function setMarketStatus(st) {
  if (!st) return;
  _serverMarketStatus = st;
  _serverStatusAt = Date.now();
}

function isMarketOpen(now) {
  // 서버 응답이 5분 이내면 그걸 따른다
  if (_serverMarketStatus && Date.now() - _serverStatusAt < 300000) {
    return _serverMarketStatus === 'OPEN';
  }
  var k = kstParts(now);
  if (!isTradingDayKst(now)) return false;            // 주말·휴장일
  // 넥스트레이드(NXT) 출범으로 거래시간이 08:00~20:00 으로 연장됐다.
  //   프리마켓 08:00~08:50 / 메인마켓 09:00~15:20 / 애프터마켓 15:40~20:00
  //   (KRX 정규장은 09:00~15:30 그대로)
  // 어차피 네이버 marketStatus 가 우선이고 이건 폴백이므로 넉넉히 잡는다.
  return k.hm >= 8 * 60 && k.hm <= 20 * 60 + 10;
}

/** 서버 상태 없이 시계로만 판정 중인가 (배지 문구를 약하게 쓰기 위해) */
function isMarketStateGuessed() {
  return !(_serverMarketStatus && Date.now() - _serverStatusAt < 300000);
}

function marketStateLabel() {
  if (!isMarketOpen()) return { cls: 'closed', text: '장 마감' };
  return { cls: 'live', text: isMarketStateGuessed() ? '장중(추정)' : '실시간' };
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
        // 실행 중에 같은 키로 remove+add 가 됐으면 이 체인은 옛것이다 — 여기서 끊어야 폴링이 2중·3중으로 늘지 않는다
        if (jobs[key] !== job || paused) return;
        // 주기는 매번 다시 계산한다 — 개장 전에 들어온 화면이 개장 후에도 느린 주기로 남지 않게
        var ms = typeof job.ms === 'function' ? job.ms() : job.ms;
        job.timer = setTimeout(function () { run(key); }, ms);
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
      // 멈춰 있던 동안 끝난 실행이 타이머를 다시 걸지 못하도록 여기서만 재개한다
      Object.keys(jobs).forEach(function (k) { clearTimeout(jobs[k].timer); run(k); });
    },
    activeKeys: function () { return Object.keys(jobs); }
  };
})();

/** 장중/장외에 따라 달라지는 폴링 주기 — Poller.add 의 ms 자리에 넘긴다 */
function pollMs(openMs, closedMs) {
  return function () { return isMarketOpen() ? openMs : closedMs; };
}

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
var _watchlistReady = null;

/** 관심종목을 1회만 불러온다 — 시세 홈을 거치지 않고 종목 상세로 바로 들어와도 하트가 맞도록 */
function ensureWatchlist() {
  if (!_watchlistReady) _watchlistReady = loadWatchlist();
  return _watchlistReady;
}

async function loadWatchlist() {
  if (!db || !currentUser) return [];
  try {
    var doc = await db.collection('stock_watchlist').doc(currentUser.uid).get();
    watchlist = (doc.exists && Array.isArray(doc.data().codes)) ? doc.data().codes : [];
  } catch (e) { watchlist = []; }
  return watchlist;
}

var WATCHLIST_MAX = 50;      // firestore.rules 의 stock_watchlist 상한과 같다

async function toggleWatch(code) {
  if (!db || !currentUser) return false;
  if (!/^[0-9A-Z]{6}$/.test(String(code || ''))) throw new Error('종목코드가 올바르지 않습니다');
  await ensureWatchlist();
  var on = watchlist.indexOf(code) === -1;
  if (on && watchlist.length >= WATCHLIST_MAX) throw new Error('관심종목은 ' + WATCHLIST_MAX + '개까지 담을 수 있습니다');
  watchlist = on ? watchlist.concat([code]) : watchlist.filter(function (c) { return c !== code; });
  var FV = firebase.firestore.FieldValue;
  try {
    // 배열을 통째로 덮어쓰지 않는다 — 로컬 목록이 비어 있거나(로드 실패) 다른 기기에서
    // 바뀐 상태여도 서버의 기존 관심종목이 날아가지 않게 원소 단위로만 넣고 뺀다.
    await db.collection('stock_watchlist').doc(currentUser.uid).set({
      codes: on ? FV.arrayUnion(code) : FV.arrayRemove(code),
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
 * 최고·최저 지점 표시 (간단 보기 전용).
 * 점은 해당 봉의 종가 선 위에 찍고, 글자는 그 봉의 실제 고가/저가를 쓴다 (상단 "최고/최저" 라벨과 일치).
 * 글자는 차트 그리는 영역 안으로 밀어 넣는다 — 첫 봉·마지막 봉에 걸려도 "129,000"이 "29,000"으로 잘리지 않는다.
 */
function makeHiLoOverlay(container, chart, series, upColor, downColor) {
  var bars = [], hiIdx = -1, loIdx = -1, raf = 0, dead = false;

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  var layer = document.createElement('div');
  layer.className = 'hilo-layer';
  layer.setAttribute('aria-hidden', 'true');       // 같은 값이 차트 위 텍스트(#chartHiLo)에 있다

  function part(cls, color) {
    var dot = document.createElement('i');
    dot.className = 'hilo-dot';
    dot.style.background = color;
    var tag = document.createElement('span');
    tag.className = 'hilo-tag ' + cls;
    tag.style.color = color;
    layer.appendChild(dot); layer.appendChild(tag);
    return { dot: dot, tag: tag };
  }
  var hi = part('hi', upColor), lo = part('lo', downColor);
  container.appendChild(layer);

  function place(p, idx, above, plotW, plotH) {
    var b = bars[idx], x = null, y = null;
    if (b) {
      x = chart.timeScale().timeToCoordinate(b._t);
      var d = series.dataByIndex ? series.dataByIndex(idx) : null;
      y = series.priceToCoordinate(d && d.value != null ? d.value : b.c);
    }
    // 스크롤·줌으로 그 봉이 화면 밖이면 숨긴다
    if (x == null || y == null || x < 0 || x > plotW || y < 0 || y > plotH) {
      p.dot.style.display = 'none'; p.tag.style.display = 'none';
      return;
    }
    p.dot.style.display = ''; p.tag.style.display = '';
    p.dot.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 4) + 'px)';

    var w = p.tag.offsetWidth, h = p.tag.offsetHeight, gap = 7;
    var tx = Math.max(2, Math.min(plotW - w - 2, x - w / 2));           // ← 가장자리에서 안쪽으로
    var ty = above ? y - gap - h : y + gap;
    ty = Math.max(1, Math.min(plotH - h - 1, ty));
    p.tag.style.transform = 'translate(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px)';
  }

  function draw() {
    raf = 0;
    if (dead) return;
    var ts = chart.timeScale();
    var plotW = ts.width(), plotH = container.clientHeight - ts.height();
    layer.style.width = plotW + 'px';
    layer.style.height = Math.max(0, plotH) + 'px';
    var show = bars.length > 2 && hiIdx !== loIdx;
    layer.style.display = show ? '' : 'none';
    if (!show) return;
    place(hi, hiIdx, true, plotW, plotH);
    place(lo, loIdx, false, plotW, plotH);
  }

  function refresh() { if (!raf && !dead) raf = requestAnimationFrame(draw); }

  chart.timeScale().subscribeVisibleLogicalRangeChange(refresh);
  if (chart.timeScale().subscribeSizeChange) chart.timeScale().subscribeSizeChange(refresh);

  return {
    setBars: function (list) {
      bars = list || [];
      hiIdx = 0; loIdx = 0;
      bars.forEach(function (b, i) {
        if (b.h > bars[hiIdx].h) hiIdx = i;
        if (b.l < bars[loIdx].l) loIdx = i;
      });
      if (bars.length) {
        hi.tag.textContent = '최고 ' + Math.round(bars[hiIdx].h).toLocaleString('ko-KR');
        lo.tag.textContent = '최저 ' + Math.round(bars[loIdx].l).toLocaleString('ko-KR');
      }
      refresh();
    },
    refresh: refresh,
    dispose: function () {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
    }
  };
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
  var text = cssVar('--text2') || '#a0a0b8';
  var grid = cssVar('--border') || '#333355';
  var bg = cssVar('--bg') || '#1a1a2e';

  var chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: mode === 'detail' ? 300 : 240,
    layout: { background: { color: bg }, textColor: text, fontSize: 11, attributionLogo: false },
    grid: {
      vertLines: { color: mode === 'detail' ? grid : 'transparent' },
      horzLines: { color: grid }
    },
    rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.14, bottom: mode === 'detail' ? 0.28 : 0.14 } },
    timeScale: { borderColor: grid, timeVisible: tf === 'm' || tf === 'm5', secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScale: { axisPressedMouseMove: false },
    localization: {
      locale: 'ko-KR',
      // 여백 때문에 축이 0 아래로 내려가도 음수 가격은 찍지 않는다 (주가에 음수는 없다)
      priceFormatter: function (p) { return p < 0 ? '' : Math.round(p).toLocaleString('ko-KR'); }
    }
  });

  bars.forEach(function (b) { b._t = toChartTime(b.t, tf); });

  // 기간 전체가 오르면 빨강 / 내리면 파랑 (간단 보기 라인 색)
  var first = bars[0], last = bars[bars.length - 1];
  var rising = last && first ? last.c >= first.c : true;
  var lineColor = rising ? up : down;

  var mainSeries, volSeries = null, maSeries = [], hiloOverlay = null;

  if (mode === 'simple') {
    mainSeries = chart.addAreaSeries({
      lineColor: lineColor, lineWidth: 2,
      topColor: lineColor + '44', bottomColor: lineColor + '05',
      priceLineVisible: true, priceFormat: { type: 'price', precision: 0, minMove: 1 }
    });
    mainSeries.setData(bars.map(function (b) { return { time: b._t, value: b.c }; }));

    // 최고·최저 지점 표시 (토스 차용)는 아래 hiloOverlay 가 직접 그린다.
    // 라이브러리 마커는 글자를 봉 중앙에 고정해서, 첫 봉·마지막 봉에 걸리면 차트 밖으로 잘린다.
    hiloOverlay = makeHiLoOverlay(container, chart, mainSeries, up, down);
    hiloOverlay.setBars(bars);
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
      maSeries.push({ series: ls, period: cfg[0] });
    });
  }

  chart.timeScale().fitContent();

  var onResize = function () {
    chart.applyOptions({ width: container.clientWidth });
    if (hiloOverlay) hiloOverlay.refresh();
  };
  window.addEventListener('resize', onResize);

  // 최고/최저는 언제나 고가·저가 기준.
  // 종가 기준으로 잡으면 주봉·월봉에서 주/월 마지막 종가만 남아 중간 고점이 사라지고,
  // 기간을 넓혔는데 최고가가 내려가는 모순이 생긴다.
  var periodHigh = bars.length ? Math.max.apply(null, bars.map(function (b) { return b.h; })) : null;
  var periodLow = bars.length ? Math.min.apply(null, bars.map(function (b) { return b.l; })) : null;

  var lastBar = last ? { time: last._t, open: last.o, high: last.h, low: last.l, close: last.c } : null;
  var lastVolV = last ? (last.v || 0) : 0;

  var handle = {
    mode: mode,
    periodHigh: periodHigh,
    periodLow: periodLow,
    /** 차트를 다시 만들지 않고 봉 데이터만 교체 — 줌/스크롤이 유지된다 */
    replaceData: function (newBars) {
      if (!newBars || !newBars.length) return;
      newBars.forEach(function (b) { b._t = toChartTime(b.t, tf); });
      if (mode === 'simple') {
        mainSeries.setData(newBars.map(function (b) { return { time: b._t, value: b.c }; }));
      } else {
        mainSeries.setData(newBars.map(function (b) {
          return { time: b._t, open: b.o, high: b.h, low: b.l, close: b.c };
        }));
        if (volSeries) volSeries.setData(newBars.map(function (b) {
          return { time: b._t, value: b.v || 0, color: (b.c >= b.o ? up : down) + '55' };
        }));
        maSeries.forEach(function (m) {
          if (newBars.length >= m.period) m.series.setData(movingAverage(newBars, m.period));
        });
      }
      var nl = newBars[newBars.length - 1];
      lastBar = { time: nl._t, open: nl.o, high: nl.h, low: nl.l, close: nl.c };
      lastVolV = nl.v || 0;
      handle.periodHigh = Math.max.apply(null, newBars.map(function (b) { return b.h; }));
      handle.periodLow = Math.min.apply(null, newBars.map(function (b) { return b.l; }));
      if (hiloOverlay) hiloOverlay.setBars(newBars);    // 최고·최저 봉이 바뀌었을 수 있다
    },
    dispose: function () {
      window.removeEventListener('resize', onResize);
      if (hiloOverlay) hiloOverlay.dispose();
      try { chart.remove(); } catch (e) {}
    },
    /**
     * 틱이 올 때마다 마지막 봉만 갱신 (O(1)).
     * @param allowNewBar 분봉에서만 true — 일/주/월봉은 새 봉을 만들면 안 된다.
     *   (휴장일에 '오늘' 버킷으로 유령 봉이 생기는 것을 막는다)
     */
    updateLast: function (price, bucketTime, volume, allowNewBar) {
      if (price == null || !isFinite(price) || !lastBar) return;
      var same = JSON.stringify(lastBar.time) === JSON.stringify(bucketTime);
      if (!same && allowNewBar) {
        lastBar = { time: bucketTime, open: price, high: price, low: price, close: price };
        lastVolV = volume || 0;
      } else {
        // 일/주/월봉은 버킷이 달라도 마지막 봉(= 최근 거래일)의 종가를 현재가로 맞춘다.
        // 이게 없으면 상단 현재가와 차트 끝점이 어긋나 보인다.
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
      if (hiloOverlay) hiloOverlay.refresh();            // 끝점이 움직이면 세로축이 다시 잡힐 수 있다
    }
  };
  return handle;
}

/* ===== 종목 로고 (네이버 증권 이미지 CDN) =====
 * 랭킹 API 는 로고 URL 을 직접 주지만 시세·검색·테마 응답에는 없다.
 * 없을 때는 URL 규칙으로 유추하고, 실패하면 다음 후보 → 끝내 없으면 종목명 첫 글자로 대체한다.
 *   일반 종목  logo/stock/Stock{코드}.svg
 *   ETF       logo/etf/StockKRETF{브랜드}.svg   (KODEX·TIGER·ACE·RISE·SOL …  이름 첫 단어)
 */
var LOGO_BASE = 'https://ssl.pstatic.net/imgstock/fn/real/logo/';
var _logoBad = {};        // url -> true  (404 난 주소는 세션 동안 다시 요청하지 않는다)
var _logoGood = {};       // code -> url  (한 번 성공한 주소는 바로 쓴다)

function logoCandidates(code, name, apiUrl) {
  if (_logoGood[code]) return [_logoGood[code]];
  var list = [];
  if (apiUrl && /^https:\/\/ssl\.pstatic\.net\//.test(apiUrl)) list.push(apiUrl);
  // "KODEX 200" 처럼 영문 대문자 브랜드 + 공백으로 시작하면 ETF 로 보고 브랜드 로고를 먼저 시도
  var m = /^([A-Z0-9]{2,12}) /.exec(String(name || ''));
  if (m) list.push(LOGO_BASE + 'etf/StockKRETF' + m[1] + '.svg');
  if (/^\d{6}$/.test(code)) list.push(LOGO_BASE + 'stock/Stock' + code + '.svg');
  return list.filter(function (u, i) { return !_logoBad[u] && list.indexOf(u) === i; });
}

/** @param size '' | 'sm' | 'lg' */
function stockLogoHtml(code, name, apiUrl, size) {
  var urls = logoCandidates(code, name, apiUrl);
  var ch = String(name || '').trim().charAt(0) || '·';
  var h = '<span class="s-logo' + (size ? ' ' + size : '') + '" aria-hidden="true">'
        + '<span class="s-logo-fb">' + escapeHtml(ch) + '</span>';
  if (urls.length) {
    h += '<img src="' + escapeAttr(urls[0]) + '" data-code="' + escapeAttr(code) + '"'
       + ' data-next="' + escapeAttr(urls.slice(1).join('|')) + '" alt="" loading="lazy" decoding="async"'
       + ' onload="onLogoLoad(this)" onerror="onLogoError(this)">';
  }
  return h + '</span>';
}

function onLogoLoad(img) {
  _logoGood[img.getAttribute('data-code')] = img.getAttribute('src');
  if (img.parentNode) img.parentNode.classList.add('ok');
}

function onLogoError(img) {
  _logoBad[img.getAttribute('src')] = true;
  var rest = (img.getAttribute('data-next') || '').split('|').filter(function (u) { return u && !_logoBad[u]; });
  if (!rest.length) { img.remove(); return; }       // 후보 소진 — 첫 글자 대체 표시가 남는다
  img.setAttribute('data-next', rest.slice(1).join('|'));
  img.src = rest[0];
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
