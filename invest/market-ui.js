/* ===== DT 재테크 — 시세 화면 (Phase 3) =====
 * 토스증권 구조를 DT 스타일로 옮긴 시세 홈 + 종목 상세.
 * 인프라(API·폴링·차트)는 market.js.
 */

var marketLoaded = false;
var curStock = null;        // { code, name }
var curTf = 'D';
var bookOpen = false;
var chartHandle = null;
var searchTimer = null;
var rankType = 'value';
var rankMarket = 'KOSPI';
var watchView = 'card';          // 'card' | 'list'
var chartMode = 'simple';        // 'simple' | 'detail'
var sparkCache = {};             // code -> { values, at }
var _homeScrollY = 0;            // 종목 상세로 들어가기 전 시세 홈 스크롤 위치
var _detailFrom = null;          // 상세를 열기 전 보던 탭 — 뒤로 가기로 닫으면 그 탭으로 돌아간다
var _backToHome = false;         // "← 시세" 로 닫는 중 (다른 탭에서 왔어도 시세 홈으로)

// 뒤로 가기 때 브라우저가 스크롤을 제멋대로 옮기지 않게 한다 — 시세 홈 위치는 직접 되돌린다
try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}

/** 종목 또는 코인 상세를 보는 중인가 (시세 홈이 가려져 있는가) */
function detailOpen() {
  return !!curStock || !!(window.Coin && Coin.current());
}

/* ===== 시세 탭 진입 ===== */
async function enterMarketTab() {
  // 종목 상세 보는 중이면 화면은 유지하되, 탭을 떠날 때 멈춘 폴링은 다시 돌린다
  if (curStock) { startStockPolling(); return; }
  if (window.Coin && Coin.current()) { Coin.startPolling(); return; }
  document.getElementById('stockDetail').style.display = 'none';
  document.getElementById('marketHome').style.display = '';

  await initMarketHome();
  if (detailOpen() || currentTab !== 'market') return;   // 기다리는 사이 화면이 바뀌었으면 중단
  startHomePolling();
}

/** 시세 홈 1회 초기화 — 브리핑 종목 칩으로 상세에 먼저 들어온 경우 '← 시세'에서도 불린다.
 * 랭킹·테마는 여기서 부르지 않는다 — 바로 뒤의 startHomePolling 이 즉시 1회 실행하므로 두 번 받게 된다. */
async function initMarketHome() {
  if (marketLoaded) return;
  marketLoaded = true;
  await ensureWatchlist();
  renderRecent();
}

function leaveMarketTab() {
  Poller.stopAll();
}

function startHomePolling() {
  Poller.stopAll();
  // 국장이 닫혀도 나스닥 선물·VIX·SOX 는 계속 움직인다.
  // 그 항목을 켜 뒀으면 밤에도 30초로 돈다 (안 켰으면 예전대로 2분).
  Poller.add('index', loadIndex, function () {
    if (isMarketOpen()) return 15000;
    return watchingNightLive() ? 30000 : 120000;
  });
  // 워커 캐시가 랭킹 60초·테마 120초라 그보다 자주 불러도 같은 값이 온다
  Poller.add('rank', loadRank, pollMs(60000, 600000));
  Poller.add('sectors', loadSectors, pollMs(120000, 600000));
  // DT 회원 픽 — 모의투자 집계라 자주 바뀌지 않는다. 5분에 한 번
  Poller.add('crowdTop', loadCrowdTop, 300000);
  // 관심종목·랭킹·테마·회원 픽 종목의 가격은 한 번의 /api/quotes 로 함께 받는다 (관심종목이 비어 있어도 1회는 그린다)
  Poller.add('quotes', refreshListQuotes, pollMs(5000, 120000));
  // 코인은 24시간 — 장 시간과 무관하게 5초 (전체 목록을 펼쳤을 때는 10초)
  if (window.Coin) Poller.add('coins', Coin.loadList, Coin.pollMs);
}

/* ===== 지수 스트립 ===== */
// 표시 순서 — 워커가 내려준 것만 그린다 (구버전 캐시 응답에는 뒤의 것이 없을 수 있다)
// 뒤쪽 셋은 CME 해외 지수선물 — 국내 장중에도 돌아가서 "지금 미국이 어디로 가는지"를 보여준다
var INDEX_KEYS = [
  'kospi', 'kosdaq', 'kpi200', 'fut', 'kq150',
  'usd', 'nasdaq', 'sp500', 'dow', 'vix', 'sox', 'gold', 'oil', 'us10y', 'kr10y', 'kr3y',
  'btc', 'eth'
];
// 국내 지수가 아닌 것들 — 스트립에서 선 하나로 갈라 놓는다 (분봉이 없어 스파크라인도 없다)
var FUT_KEYS = {
  usd: 1, nasdaq: 1, sp500: 1, dow: 1, vix: 1, sox: 1,
  gold: 1, oil: 1, us10y: 1, kr10y: 1, kr3y: 1, btc: 1, eth: 1
};
// 누르면 코인 상세로 가는 칸 (업비트 원화 마켓)
var COIN_CELL = { btc: 'KRW-BTC', eth: 'KRW-ETH' };

// 국장이 닫힌 뒤에도 계속 움직이는 항목 (CME 선물·미국 지표).
// 원/달러는 하나은행 고시라, 한국 국채는 국내 장이라 밤에는 멈춘다 — 여기 넣지 않는다.
var NIGHT_LIVE = { nasdaq: 1, sp500: 1, dow: 1, vix: 1, sox: 1, gold: 1, oil: 1, us10y: 1, btc: 1, eth: 1 };

/* 항목 아이콘 — 인라인 SVG 로 그린다.
 * 네이버 로고는 국채가 전부 같은 아이콘이고 금·유가·환율·국내지수는 아예 없어서 쓸 수 없다.
 * 국기 이모지(🇰🇷)는 윈도우 크롬에서 글자로 깨지므로 쓰지 않는다. */
var IX_ICON = {
  kr: '<rect width="16" height="11" rx="1.5" fill="#fff"/>'
    + '<circle cx="8" cy="5.5" r="3" fill="#0047a0"/>'
    + '<path d="M5 5.5a3 3 0 0 1 6 0 1.5 1.5 0 0 0-3 0 1.5 1.5 0 0 1-3 0z" fill="#cd2e3a"/>',
  us: '<rect width="16" height="11" rx="1.5" fill="#fff"/>'
    + '<g fill="#b22234"><rect y="0" width="16" height="1.57"/><rect y="3.14" width="16" height="1.57"/>'
    +   '<rect y="6.28" width="16" height="1.57"/><rect y="9.42" width="16" height="1.57"/></g>'
    + '<rect width="7" height="6.28" fill="#3c3b6e"/>',
  gold: '<rect x="1" y="3.2" width="14" height="5.6" rx="1" fill="#d9a441"/>'
    + '<rect x="1" y="3.2" width="14" height="2" rx="1" fill="#f0c978"/>',
  oil: '<path d="M8 1.4c2.2 2.7 3.4 4.4 3.4 5.8A3.4 3.4 0 0 1 8 10.6 3.4 3.4 0 0 1 4.6 7.2c0-1.4 1.2-3.1 3.4-5.8z" fill="#4a8fd4"/>',
  btc: '<circle cx="8" cy="5.5" r="5.2" fill="#f7931a"/>'
    + '<text x="8" y="8.1" text-anchor="middle" font-size="7.2" font-weight="800" fill="#fff" font-family="Arial,sans-serif">B</text>',
  eth: '<circle cx="8" cy="5.5" r="5.2" fill="#627eea"/>'
    + '<path d="M8 1.9 5.6 5.7 8 7.1l2.4-1.4zM5.6 6.2 8 9.2l2.4-3L8 7.6z" fill="#fff"/>'
};

// 어느 나라·무엇인지
var IX_ICON_OF = {
  kospi: 'kr', kosdaq: 'kr', kpi200: 'kr', fut: 'kr', kq150: 'kr', kr10y: 'kr', kr3y: 'kr',
  usd: 'us', nasdaq: 'us', sp500: 'us', dow: 'us', vix: 'us', sox: 'us', us10y: 'us',
  gold: 'gold', oil: 'oil', btc: 'btc', eth: 'eth'
};

function indexIconHtml(key) {
  var g = IX_ICON[IX_ICON_OF[key]];
  if (!g) return '';
  return '<svg class="ix-ico" viewBox="0 0 16 11" aria-hidden="true">' + g
    + '<rect width="16" height="11" rx="1.5" fill="none" stroke="rgba(128,128,128,.28)" stroke-width=".6"/></svg>';
}

/** 밤에도 움직이는 항목을 보고 있는가 — 폴링 주기를 그쪽에 맞추기 위해 */
function watchingNightLive() {
  return indexPick().some(function (k) { return NIGHT_LIVE[k]; });
}

// 열 개를 다 켜면 가로로 너무 길다 — 처음엔 다섯 개만 보이고, 회원이 체크리스트로 고른다
var INDEX_DEFAULT = ['kospi', 'kosdaq', 'fut', 'usd', 'nasdaq', 'sp500', 'btc'];
var INDEX_PICK_KEY = 'dt-invest-index-pick';
var _indexPick = null;
var _indexSpark = null;      // key -> 당일 분봉 종가 배열
var _indexSparkLoading = false;
var _indexSparkAt = 0;          // 마지막으로 받은 시각 — 분봉이라 주기적으로 다시 받는다
var _indexPanelOpen = false;

/** 회원이 고른 표시 목록 — 저장이 막혀 있어도(사파리 사생활 모드) 기본값으로 돈다 */
function indexPick() {
  if (_indexPick) return _indexPick;
  try {
    var raw = localStorage.getItem(INDEX_PICK_KEY);
    var arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) _indexPick = arr.filter(function (k) { return INDEX_KEYS.indexOf(k) !== -1; });
  } catch (e) { /* 무시 */ }
  if (!_indexPick || !_indexPick.length) _indexPick = INDEX_DEFAULT.slice();
  return _indexPick;
}

function toggleIndexKey(key) {
  var pick = indexPick().slice();
  var i = pick.indexOf(key);
  if (i === -1) pick.push(key);
  else if (pick.length > 1) pick.splice(i, 1);     // 하나는 남긴다 (빈 스트립 방지)
  else return;
  _indexPick = pick;
  try { localStorage.setItem(INDEX_PICK_KEY, JSON.stringify(pick)); } catch (e) { /* 무시 */ }
  var el = document.getElementById('indexStrip');
  if (el) el.dataset.built = '';        // 구성이 바뀌었으니 뼈대를 다시 그린다
  loadIndex();
  renderIndexPanel();
}

function toggleIndexPanel() {
  _indexPanelOpen = !_indexPanelOpen;
  renderIndexPanel();
}

function renderIndexPanel() {
  var box = document.getElementById('ixPanel');
  if (!box) return;
  box.style.display = _indexPanelOpen ? '' : 'none';
  if (!_indexPanelOpen) return;
  var pick = indexPick();
  box.innerHTML = '<div class="ix-pick-head">스트립에 보여 줄 항목</div>'
    + '<div class="ix-pick-list">' + INDEX_KEYS.map(function (k) {
        var on = pick.indexOf(k) !== -1;
        return '<button class="ix-pick' + (on ? ' on' : '') + '" onclick="toggleIndexKey(\'' + k + '\')" aria-pressed="' + on + '">'
          + '<span class="ix-pick-box">' + (on ? '✓' : '') + '</span>'
          + indexIconHtml(k) + escapeHtml(INDEX_LABEL[k] || k) + '</button>';
      }).join('') + '</div>';
}

// 네이버 이름이 길어 좁은 셀에서 두 줄이 된다 ("나스닥 100 선물")
var INDEX_NAME = { nasdaq: '나스닥 선물', sp500: 'S&P 선물', dow: '다우 선물', sox: '필라델피아 반도체' };
// 체크리스트용 이름 (셀 이름은 네이버 값을 쓰지만 목록에서는 항상 같은 말로 보인다)
var INDEX_LABEL = {
  kospi: '코스피', kosdaq: '코스닥', kpi200: '코스피 200', fut: '코스피 200 선물', kq150: '코스닥 150',
  usd: '원/달러 환율', nasdaq: '나스닥 선물', sp500: 'S&P 선물', dow: '다우 선물',
  vix: 'VIX (공포지수)', sox: '필라델피아 반도체', gold: '금', oil: 'WTI 유가',
  us10y: '미국 국채 10년', kr10y: '한국 국채 10년', kr3y: '한국 국채 3년',
  btc: '비트코인', eth: '이더리움'
};

async function loadIndex() {
  var el = document.getElementById('indexStrip');
  if (!el) return;
  try {
    var d = await Market.index();
    if (d.marketStatus) setMarketStatus(d.marketStatus);   // 워커가 대표 종목 기준으로 실어 준다
    setHolidays(d.holidays);                              // 휴장일도 워커 목록을 쓴다 (D1 단일 출처)

    // 뼈대는 구성이 바뀔 때만 다시 만들고 평소엔 값만 갈아끼운다 (플래시 애니메이션 유지)
    var pick = indexPick();
    var have = INDEX_KEYS.filter(function (k) { return d[k] && pick.indexOf(k) !== -1; });
    if (el.dataset.built !== have.join(',')) {
      // 지수 셀만 가로로 밀리고(idx-scroll) 상태 배지는 그 밖에 고정 — 좁은 화면에서 배지가 숫자를 가리지 않는다
      el.innerHTML = '<div class="idx-scroll">' + have.map(function (k) {
        var x = d[k];
        if (!x) return '';
        // 국내 지수와 해외 선물 사이에 선을 하나 둬서 다른 묶음임을 보인다
        var first = FUT_KEYS[k] && !FUT_KEYS[have[have.indexOf(k) - 1]];
        var coinM = COIN_CELL[k];
        return '<div class="idx-cell' + (FUT_KEYS[k] ? ' fut' : '') + (first ? ' fut-first' : '') + (coinM ? ' coin' : '') + '"'
          + (coinM ? ' role="button" tabindex="0" onclick="Coin.open(\'' + coinM + '\',\'' + escapeJsArg(INDEX_LABEL[k]) + '\')"' : '') + '>'
          + '<div class="idx-name">' + indexIconHtml(k) + escapeHtml(INDEX_NAME[k] || x.name)
          +   (x.delayMin ? '<span class="idx-delay">' + x.delayMin + '분 지연</span>' : '')
          + '</div>'
          + '<div class="idx-price" id="ixp-' + k + '"></div>'
          + '<div class="idx-chg" id="ixc-' + k + '"></div>'
          + '<div class="idx-spark" id="ixs-' + k + '"></div>'
          + '</div>';
      }).join('') + '</div>'
      + '<div class="idx-side">'
      +   '<div class="idx-state" id="ixState"></div>'
      +   '<button class="ix-gear" onclick="toggleIndexPanel()" aria-label="표시 항목 고르기">⚙</button>'
      + '</div>'
      + '<div class="ix-panel" id="ixPanel" style="display:none"></div>';
      el.dataset.built = have.join(',');
      renderIndexPanel();
    }

    have.forEach(function (k) {
      var x = d[k];
      var pEl = document.getElementById('ixp-' + k);
      var cEl = document.getElementById('ixc-' + k);
      if (!pEl || !cEl) return;
      var cls = signClass(x.change);
      // 지수는 소수 둘째 자리까지, 국채 금리는 셋째 자리까지 (4.955%). 단위는 항목이 알려 준다.
      var dg = x.decimals == null ? 2 : x.decimals;
      var pTxt = x.price == null ? '-'
        : Number(x.price).toLocaleString('ko-KR', { minimumFractionDigits: dg, maximumFractionDigits: dg })
          + (x.unit || '');
      setTextFlash(pEl, pTxt, dirOf('ix:' + k, x.price));
      pEl.className = 'idx-price ' + cls;
      cEl.textContent = signMark(x.change) + ' ' + fmtRate(x.changeRate);
      cEl.className = 'idx-chg ' + cls;
    });

    paintIndexSparks(have, d);
    paintStateBadges();
  } catch (e) {
    if (!el.dataset.built) el.innerHTML = '<div class="idx-err">지수를 불러오지 못했습니다</div>';
    paintStateBadges();          // 실패가 이어지면 '실시간' 대신 '연결 끊김'으로 바꾼다
  }
}

/**
 * 장 상태 배지 (지수 스트립 · 종목 상세 기준 시각 옆).
 * 요청이 연달아 실패하거나 오프라인이면 '연결 끊김' — 숫자가 멈춰 있는데 '실시간'이라고 쓰지 않는다.
 */
function paintStateBadges() {
  var st = marketStateLabel();
  var sEl = document.getElementById('ixState');
  // 이 배지는 국장 기준이다. 옆의 나스닥 선물·금·유가는 국장이 닫혀 있어도 돌아간다.
  if (sEl) { sEl.textContent = st.cls === 'stale' ? st.text : '국내 ' + st.text; sEl.className = 'idx-state ' + st.cls; }
  document.querySelectorAll('#pxAsOf .state-dot').forEach(function (d) {
    d.textContent = st.text;
    d.className = 'state-dot ' + st.cls;
  });
}
window.addEventListener('online', paintStateBadges);
window.addEventListener('offline', paintStateBadges);

/**
 * 지수 셀의 스파크라인.
 * 국내 지수만 당일 분봉이 있다 — 해외 선물은 네이버가 분봉을 주지 않으므로 선을 그리지 않고
 * 숫자만 둔다 (네이버 자기 화면도 같은 방식이다).
 * 데이터는 하루치라 자주 받을 이유가 없다 — 한 번 받아 두고 재사용한다.
 */
function paintIndexSparks(have, d) {
  // 워커 캐시가 장중 60초다 — 그보다 자주 불러도 같은 값이 온다
  var stale = Date.now() - _indexSparkAt > (isMarketOpen() ? 60000 : 600000);
  if ((!_indexSpark || stale) && !_indexSparkLoading) {
    _indexSparkLoading = true;
    Market.indexSpark().then(function (r) {
      _indexSpark = r.series || {};
      _indexSparkAt = Date.now();
      _indexSparkLoading = false;
      if (currentTab === 'market' && !detailOpen()) paintIndexSparks(have, d);
    }).catch(function () {
      _indexSparkLoading = false;      // 다음 폴링에서 다시 — 선 없이 숫자만 보인다
    });
    if (!_indexSpark) return;          // 처음이면 그릴 게 없다. 갱신 중이면 기존 선을 유지한다
  }
  have.forEach(function (k) {
    var box = document.getElementById('ixs-' + k);
    if (!box) return;
    var pts = _indexSpark[k];
    if (!pts || pts.length < 3) { box.innerHTML = ''; box.classList.add('none'); return; }
    box.classList.remove('none');
    var x = d[k];
    box.innerHTML = sparklineSvg(pts, !(x && x.change < 0), 96, 22);
  });
}

/* ===== 종목 검색 (초성 지원) ===== */
function onSearchInput(v) {
  clearTimeout(searchTimer);
  var q = (v || '').trim();
  var box = document.getElementById('searchResults');
  if (!q) { box.innerHTML = ''; box.style.display = 'none'; return; }
  searchTimer = setTimeout(function () { doSearch(q); }, 250);
}

/** 서버·외부 응답의 종목코드는 화면에 넣기 전에 형식을 확인한다 (onclick 인자·속성에 그대로 들어간다) */
function isStockCode(c) { return /^[0-9A-Z]{6}$/.test(String(c || '')); }

var _searchSeq = 0;
async function doSearch(q) {
  var box = document.getElementById('searchResults');
  var seq = ++_searchSeq;             // 느린 이전 검색 응답이 최신 입력의 결과를 덮지 않게
  box.style.display = '';
  box.innerHTML = '<div class="sr-empty">검색 중...</div>';
  box.setAttribute('aria-busy', 'true');
  var paint = function (d) {
    if (seq !== _searchSeq) return;
    var items = (d.items || []).filter(function (i) { return isStockCode(i.code); });
    // 코인(업비트 원화 마켓)은 이름·심볼·초성으로 화면에서 찾아 맨 위에 붙인다
    var coinHtml = window.Coin ? Coin.searchHtml(q) : '';
    if (!items.length && !coinHtml) { box.innerHTML = '<div class="sr-empty">검색 결과가 없습니다</div>'; return; }
    box.innerHTML = coinHtml + items.map(function (i) {
      return '<button class="sr-item" role="option" onclick="openStock(\'' + i.code + '\',\'' + escapeJsArg(i.name) + '\')">'
        + stockLogoHtml(i.code, i.name, null, 'sm')
        + '<span class="sr-name">' + escapeHtml(i.name) + '</span>'
        + '<span class="sr-meta">' + escapeHtml(i.market || '') + ' · ' + i.code + '</span>'
        + '</button>';
    }).join('');
  };
  try {
    // 마스터 결과는 즉시, 서버 보강 결과는 도착하면 다시 그린다
    paint(await Market.search(q, paint));
  } catch (e) {
    if (seq !== _searchSeq) return;
    box.innerHTML = '<div class="sr-empty">' + escapeHtml(e.message) + '</div>';
  } finally {
    if (seq === _searchSeq) box.removeAttribute('aria-busy');
  }
}

function clearSearch() {
  document.getElementById('stockSearch').value = '';
  var box = document.getElementById('searchResults');
  box.innerHTML = ''; box.style.display = 'none';
}

/* ===== 관심종목 ===== */
function setWatchView(v) {
  watchView = (v === 'list') ? 'list' : 'card';
  try { localStorage.setItem('dt-invest-watchview', watchView); } catch (e) {}
  document.querySelectorAll('.vt-btn').forEach(function (b) {
    b.classList.toggle('on', b.dataset.view === watchView);
  });
  var el = document.getElementById('watchList');
  if (el) { el.dataset.key = ''; el.dataset.built = ''; }   // 뼈대 재생성 강제
  paintWatch();                 // 받아 둔 시세로 바로 다시 그린다 (새로 부르지 않는다)
}

(function initWatchView() {
  try { watchView = localStorage.getItem('dt-invest-watchview') || 'card'; } catch (e) {}
})();

/** 스파크라인 — 전용 경량 엔드포인트(40포인트). 장 시작 전에는 워커가 일봉으로 대체해 준다. */
async function ensureSparkline(code) {
  var hit = sparkCache[code];
  if (hit && Date.now() - hit.at < 60000) return hit.values;
  try {
    var d = await Market.spark(code);
    var vals = Array.isArray(d.points) ? d.points : [];
    sparkCache[code] = { values: vals, at: Date.now() };
    return vals;
  } catch (e) {
    sparkCache[code] = { values: [], at: Date.now() };
    return [];
  }
}

/* ===== 목록 시세 (관심종목 · 랭킹 · 테마 종목) =====
 * 목록 화면의 가격은 /api/quotes 에서만 받는다 (원칙). 랭킹·테마 API 의 가격은 워커 캐시 때문에 1~2분 늦어서
 * 같은 종목이 목록마다 다른 값으로 보였고, 랭킹을 다시 그릴 때마다 옛 가격이 잠깐 비쳤다.
 * 받은 값은 _quoteMap 에 모아 두고 모든 목록이 여기서 그린다. 요청도 한 주기에 한 번(50종목씩 나눔)만 보낸다.
 */
var _quoteMap = {};              // code -> 마지막으로 받은 /api/quotes 한 줄 (+ _at 받은 시각)
var _rankCodes = [];             // 지금 랭킹에 보이는 종목
var _sectorCodes = [];           // 열어 둔 테마의 종목
var _crowdCodes = [];            // DT 회원 픽에 보이는 종목
var _listQuotesTried = false;    // 한 번이라도 받아 봤는가 ("불러오는 중"과 "못 불러옴"을 가른다)
var _listQuotesBusy = false, _listQuotesAgain = false;

/** 목록에 그대로 써도 될 만큼 최근 값인가 — 오래된 값은 '–' 로 두고 새로 받는다 */
function freshQuote(code) {
  var q = _quoteMap[code];
  if (!q) return null;
  return Date.now() - q._at < (isMarketOpen() ? 20000 : 300000) ? q : null;
}

function listQuoteCodes() {
  var seen = {}, out = [];
  watchlist.concat(_rankCodes, _sectorCodes, _crowdCodes).forEach(function (c) {
    if (isStockCode(c) && !seen[c]) { seen[c] = 1; out.push(c); }
  });
  return out;
}

async function fetchQuotesInto(codes) {
  var chunks = [];
  for (var i = 0; i < codes.length; i += 50) chunks.push(codes.slice(i, i + 50));
  var got = await Promise.all(chunks.map(function (c) {
    return Market.quotes(c).catch(function () { return null; });
  }));
  var now = Date.now(), first = null;
  got.forEach(function (d) {
    ((d && d.items) || []).forEach(function (q) {
      if (!q || !isStockCode(q.code)) return;
      q._at = now;
      _quoteMap[q.code] = q;
      if (!first) first = q;
    });
  });
  if (first) setMarketStatus(first.marketStatus);
}

/**
 * 관심종목·랭킹·테마 종목의 시세를 한 번에 받아 세 목록을 모두 칠한다 (폴러 'quotes').
 * 받는 중에 또 불리면(랭킹이 새로 그려졌다 등) 끝난 뒤 아직 값이 없는 종목만 한 번 더 받는다.
 */
async function refreshListQuotes() {
  if (_listQuotesBusy) { _listQuotesAgain = true; return; }
  _listQuotesBusy = true;
  try {
    var codes = listQuoteCodes();
    while (true) {
      _listQuotesAgain = false;
      if (codes.length) await fetchQuotesInto(codes);
      _listQuotesTried = true;
      paintListQuotes();
      if (!_listQuotesAgain) break;
      codes = listQuoteCodes().filter(function (c) { return !freshQuote(c); });
      if (!codes.length) break;
    }
  } finally {
    _listQuotesBusy = false;
  }
}

function paintListQuotes() {
  paintWatch();
  paintQuotes(_rankCodes.map(freshQuote).filter(Boolean), 'rk');
  paintQuotes(_sectorCodes.map(freshQuote).filter(Boolean), 'sk');
  paintQuotes(_crowdCodes.map(freshQuote).filter(Boolean), 'ck');
}

/** 목록의 가격·등락 칸 첫 값 — 받아 둔 최근 시세가 없으면 '–' 로 두고 받은 뒤 채운다 */
function listPriceCells(prefix, code) {
  var q = freshQuote(code);
  return '<span class="q-price" id="' + prefix + 'p-' + code + '">' + (q ? fmtNum(q.price) : '–') + '</span>'
    + '<span class="q-chg ' + (q ? signClass(q.change) : 'flat') + '" id="' + prefix + 'c-' + code + '">'
    + (q ? fmtRate(q.changeRate) : '–') + '</span>';
}

/** 관심종목 — 가격은 _quoteMap(= /api/quotes)에서만 그린다. 새로 부르지 않는다 */
function paintWatch() {
  var el = document.getElementById('watchList');
  if (!el) return;

  document.querySelectorAll('.vt-btn').forEach(function (b) {
    b.classList.toggle('on', b.dataset.view === watchView);
  });

  if (!watchlist.length) {
    el.dataset.built = ''; el.dataset.key = '';
    el.className = '';
    el.innerHTML = '<div class="empty">관심종목이 없습니다.<br>종목을 검색해 ⭐를 눌러보세요.</div>';
    return;
  }
  var rows = watchlist.map(function (c) { return _quoteMap[c]; }).filter(function (q) { return q && isStockCode(q.code); });
  if (!rows.length) {
    if (!el.dataset.built && _listQuotesTried) el.innerHTML = '<div class="empty">시세를 불러오지 못했습니다</div>';
    return;
  }

  var key = watchView + '|' + rows.map(function (q) { return q.code; }).join(',');
  if (el.dataset.key !== key) {
    el.className = watchView === 'card' ? 'watch-cards' : '';
    el.innerHTML = rows.map(function (q) {
      var open = 'openStock(\'' + q.code + '\',\'' + escapeJsArg(q.name) + '\')';
      // 관심종목에서 바로 뺄 수 있도록 하트를 단다 — 랭킹에도 같은 종목의 하트가 있어 id 대신 data-fav 로 찾는다
      var fav = '<button class="fav-btn on" data-fav="' + q.code + '"'
              + ' onclick="onFavToggle(\'' + q.code + '\')" aria-label="관심종목에서 빼기">♥</button>';

      if (watchView === 'list') {
        return '<div class="q-row rank-row">'
          + '<button class="rank-main" onclick="' + open + '">'
          +   stockLogoHtml(q.code, q.name, q.logo)
          +   '<span class="q-name">' + escapeHtml(q.name) + '</span>'
          +   '<span class="rank-nums">'
          +     '<span class="q-price" id="wqp-' + q.code + '"></span>'
          +     '<span class="q-chg" id="wqc-' + q.code + '"></span>'
          +   '</span>'
          + '</button>' + fav + '</div>';
      }
      return '<div class="w-card">'
        + '<button class="w-card-main" onclick="' + open + '">'
        +   '<div class="w-card-head">'
        +     stockLogoHtml(q.code, q.name, q.logo, 'sm')
        +     '<span class="w-card-name">' + escapeHtml(q.name) + '</span>'
        +     '<span class="w-card-code">' + q.code + '</span>'
        +   '</div>'
        +   '<div class="w-card-row">'
        +     '<span class="q-price" id="wqp-' + q.code + '"></span>'
        +     '<span class="q-chg" id="wqc-' + q.code + '"></span>'
        +   '</div>'
        +   '<div class="w-card-spark" id="wqs-' + q.code + '"></div>'
        + '</button>' + fav + '</div>';
    }).join('');
    el.dataset.key = key;
    el.dataset.built = '1';
  }

  rows.forEach(function (q) {
    var pEl = document.getElementById('wqp-' + q.code);
    var cEl = document.getElementById('wqc-' + q.code);
    if (!pEl || !cEl) return;
    setTextFlash(pEl, fmtNum(q.price), dirOf('w:' + q.code, q.price));
    cEl.textContent = signMark(q.change) + ' ' + fmtRate(q.changeRate);
    cEl.className = 'q-chg ' + signClass(q.change);

    if (watchView === 'card' && document.getElementById('wqs-' + q.code)) {
      ensureSparkline(q.code).then(function (vals) {
        var cur = document.getElementById('wqs-' + q.code);
        if (!cur) return;
        // 5초마다 SVG 를 통째로 새로 만들지 않는다 — 선 데이터(1분 캐시)나 색이 바뀔 때만 다시 그린다
        var hit = sparkCache[q.code];
        var sk = (hit ? hit.at : 0) + ':' + (q.change >= 0 ? 'u' : 'd');
        if (cur.dataset.sk === sk) return;
        cur.dataset.sk = sk;
        cur.innerHTML = sparklineSvg(vals, q.change >= 0);
      });
    }
  });
}

/* ===== 최근 본 종목 ===== */
function renderRecent() {
  var el = document.getElementById('recentList');
  var wrap = document.getElementById('recentSection');
  if (!el || !wrap) return;
  var list = getRecent().filter(function (r) { return r && isStockCode(r.code); });
  wrap.style.display = list.length ? '' : 'none';
  el.innerHTML = list.map(function (r) {
    return '<button class="chip" onclick="openStock(\'' + r.code + '\',\'' + escapeJsArg(r.name) + '\')">'
      + stockLogoHtml(r.code, r.name, null, 'sm') + escapeHtml(r.name) + '</button>';
  }).join('');
}

function onClearRecent() {
  clearRecent();
  renderRecent();
}

/* ===== 지금 뜨는 테마 ===== */
var _sectorSeq = 0;              // 느리게 온 응답이 그 사이 연 화면(테마 목록 ↔ 테마 종목)을 덮지 않게

/** 목록 위에 작은 안내 한 줄 — 이미 그린 내용은 그대로 둔다 (일시적 실패로 목록을 지우지 않는다) */
function setListNote(el, text) {
  var n = el.querySelector('.list-note');
  if (!text) { if (n) n.remove(); return; }
  if (!n) {
    n = document.createElement('div');
    n.className = 'list-note';
    n.setAttribute('role', 'status');
    el.insertBefore(n, el.firstChild);
  }
  n.textContent = text;
}

async function loadSectors(force) {
  var el = document.getElementById('themeList');
  if (!el) return;
  // 테마 상세(종목 목록)를 열어 둔 동안에는 주기 갱신이 그 화면을 덮지 않게 한다
  if (!force && el.querySelector('.sector-head')) return;
  var seq = ++_sectorSeq;
  if (force) _sectorCodes = [];          // 테마 목록으로 돌아간다 — 테마 종목 시세는 더 받지 않는다
  try {
    var d = await Market.sectors('theme');
    if (seq !== _sectorSeq) return;
    var top = (d.groups || []).filter(function (g) { return /^\d{1,8}$/.test(String(g.no)); }).slice(0, 8);
    _sectorCodes = [];
    el.innerHTML = top.map(function (g) {
      var c = signClass(g.changeRate);
      return '<button class="theme-row" onclick="openSector(\'' + String(g.no) + '\',\'' + escapeJsArg(g.name) + '\')">'
        + '<span class="theme-name">' + escapeHtml(g.name) + '</span>'
        + '<span class="theme-sub">↑' + fmtNum(g.rise) + ' ↓' + fmtNum(g.fall) + ' / ' + fmtNum(g.total) + '</span>'
        + '<span class="theme-rate ' + c + '">' + fmtRate(g.changeRate) + '</span>'
        + '</button>';
    }).join('');
  } catch (e) {
    if (seq !== _sectorSeq) return;
    if (!force && el.querySelector('.theme-row')) {
      setListNote(el, '테마를 새로 받지 못했습니다 · 잠시 후 다시 시도합니다');
      return;
    }
    el.innerHTML = '<div class="empty">테마를 불러오지 못했습니다<br>'
      + '<button class="mini-btn" style="margin-top:8px" onclick="loadSectors(true)">다시 시도</button></div>';
  }
}

async function openSector(no, name) {
  if (!/^\d{1,8}$/.test(String(no))) return;
  var el = document.getElementById('themeList');
  var seq = ++_sectorSeq;
  var head = '<div class="sector-head">'
    + '<strong>' + escapeHtml(name) + '</strong>'
    + '<button class="mini-btn" onclick="loadSectors(true)">← 테마 목록</button></div>';
  el.innerHTML = head + '<div class="loading">' + escapeHtml(name) + ' 종목 불러오는 중...</div>';
  try {
    var d = await Market.sectors('theme', no);
    if (seq !== _sectorSeq) return;
    var items = (d.items || []).filter(function (s) { return isStockCode(s.code); });
    // 가격은 테마 API(2분 캐시) 값을 쓰지 않는다 — 받아 둔 /api/quotes 값이 없으면 '–' 로 두고 곧 채운다
    _sectorCodes = items.map(function (s) { return s.code; });
    resetDirs('sk:');
    el.innerHTML = head + items.map(function (s) {
      return '<button class="q-row" onclick="openStock(\'' + s.code + '\',\'' + escapeJsArg(s.name) + '\')">'
        + stockLogoHtml(s.code, s.name, s.logo, 'sm')
        + '<span class="q-name">' + escapeHtml(s.name) + '</span>'
        + listPriceCells('sk', s.code)
        + '</button>';
    }).join('');
    // 열어 둔 동안에는 'quotes' 폴러가 같은 주기로 갱신한다
    if (_sectorCodes.some(function (c) { return !freshQuote(c); })) refreshListQuotes();
  } catch (e) {
    if (seq !== _sectorSeq) return;
    el.innerHTML = head + '<div class="empty">종목을 불러오지 못했습니다<br>'
      + '<button class="mini-btn" style="margin-top:8px" onclick="openSector(\'' + String(no) + '\',\'' + escapeJsArg(name) + '\')">다시 시도</button></div>';
  }
}

/* ===== 급등락 랭킹 ===== */
function setRank(type, market) {
  if (type) rankType = type;
  if (market) rankMarket = market;
  document.querySelectorAll('[data-rank]').forEach(function (b) {
    b.classList.toggle('on', b.dataset.rank === rankType);
  });
  document.querySelectorAll('[data-rmkt]').forEach(function (b) {
    b.classList.toggle('on', b.dataset.rmkt === rankMarket);
  });
  loadRank();
}

async function loadRank() {
  var el = document.getElementById('rankList');
  if (!el) return;
  // 주기 갱신에서는 자리를 비우지 않는다 — 탭을 바꿨거나 아직 아무것도 못 그렸을 때만 로딩을 보인다
  var key = rankType + ':' + rankMarket;
  if (el.dataset.key !== key || !el.querySelector('.rank-row')) {
    el.innerHTML = '<div class="loading">불러오는 중...</div>';
    _rankCodes = [];
  }
  try {
    var d = await Market.rank(rankType, rankMarket);
    // 기다리는 사이 다른 세그먼트를 눌렀으면 늦게 온 응답은 버린다
    if (key !== rankType + ':' + rankMarket) return;
    var items = (d.items || []).filter(function (s) { return isStockCode(s.code); }).slice(0, 15);
    if (!items.length) { _rankCodes = []; el.innerHTML = '<div class="empty">데이터가 없습니다</div>'; return; }

    // 순위·거래대금만 랭킹 API 값을 쓰고, 가격·등락률은 /api/quotes 로 받아 둔 값(_quoteMap)으로 그린다.
    // 랭킹 API 가격은 워커 캐시로 최대 1분 늦어 1분마다 다시 그릴 때 옛 가격이 잠깐 비쳤다.
    _rankCodes = items.map(function (s) { return s.code; });
    el.innerHTML = items.map(function (s, i) {
      var watched = watchlist.indexOf(s.code) !== -1;
      // 거래대금·거래량을 함께 보여주되, 거래량 탭에서는 거래량을 위(주 지표)로 올린다
      var tvTxt = s.tradingValueText || (s.tradingValue != null ? fmtCompact(s.tradingValue) + '원' : '');
      var volTxt = s.volume != null ? fmtCompact(s.volume) + '주' : '';
      var main = rankType === 'volume' ? volTxt : tvTxt;
      var sub = rankType === 'volume' ? tvTxt : volTxt;
      return '<div class="q-row rank-row">'
        + '<button class="rank-main" onclick="openStock(\'' + s.code + '\',\'' + escapeJsArg(s.name) + '\')">'
        +   '<span class="q-rank">' + (i + 1) + '</span>'
        +   stockLogoHtml(s.code, s.name, s.logo)
        +   '<span class="rank-names">'
        +     '<span class="q-name">' + escapeHtml(s.name) + '</span>'
        +     '<span class="rank-code">' + s.code + '</span>'
        +   '</span>'
        +   '<span class="rank-nums">' + listPriceCells('rk', s.code) + '</span>'
        +   (main || sub
              ? '<span class="rank-tv"><span>' + escapeHtml(main || sub) + '</span>'
                + (main && sub ? '<span class="rank-tv-sub">' + escapeHtml(sub) + '</span>' : '') + '</span>'
              : '')
        + '</button>'
        + '<button class="fav-btn' + (watched ? ' on' : '') + '" data-fav="' + s.code + '"'
        +   ' onclick="onFavToggle(\'' + s.code + '\')" aria-label="' + (watched ? '관심종목에서 빼기' : '관심종목에 담기') + '">'
        +   (watched ? '♥' : '♡') + '</button>'
        + '</div>';
    }).join('')
    + rankNoteHtml(items, d.approx);
    el.dataset.key = key;
    resetDirs('rk:');
    // 받아 둔 값이 없거나 오래된 종목만 바로 받는다 — 나머지는 'quotes' 폴러가 같은 주기로 갱신한다
    if (_rankCodes.some(function (c) { return !freshQuote(c); })) refreshListQuotes();
  } catch (e) {
    if (!el.querySelector('.rank-row')) el.innerHTML = '<div class="empty">랭킹을 불러오지 못했습니다</div>';
  }
}

/** 목록 하단 안내 — 기준 시각(있으면)과 거래대금 근사 안내 */
function rankNoteHtml(items, approx) {
  var at = rankAsOf(items);
  var parts = [];
  if (at) parts.push('순위·거래대금은 ' + escapeHtml(at) + ' 기준 · 가격은 실시간');
  if (approx) parts.push('거래대금 순위는 시총·급등락 상위 300종목을 합쳐 계산한 근사치입니다');
  return parts.length ? '<div class="rank-note">' + parts.join(' · ') + '</div>' : '';
}

/** 랭킹 행들이 담고 있는 체결 시각 중 가장 늦은 것 — 목록이 언제 기준인지 밝힌다 */
function rankAsOf(items) {
  var latest = null;
  items.forEach(function (s) {
    if (s.asOf && (!latest || s.asOf > latest)) latest = s.asOf;
  });
  return latest ? shortTime(latest) : '';
}

/**
 * 목록의 가격·등락 칸을 현재가로 덮는다.
 * 가격 칸 id 는 '<prefix>p-<종목코드>', 등락 칸은 '<prefix>c-<종목코드>' 규칙.
 * 가격에는 색을 입히지 않는다 — 목록에서는 등락률 칸만 색을 쓴다.
 */
function paintQuotes(items, prefix) {
  (items || []).forEach(function (q) {
    var pEl = document.getElementById(prefix + 'p-' + q.code);
    var cEl = document.getElementById(prefix + 'c-' + q.code);
    if (!pEl || !cEl || q.price == null) return;
    setTextFlash(pEl, fmtNum(q.price), dirOf(prefix + ':' + q.code, q.price));
    cEl.textContent = fmtRate(q.changeRate);
    cEl.className = 'q-chg ' + signClass(q.change);
  });
}

/* ===== 관심종목 하트 =====
 * 같은 종목의 하트가 관심종목·랭킹·종목 상세에 동시에 있을 수 있다 — data-fav 로 모두 찾아 함께 바꾼다.
 */
var _favBusy = {};               // code -> 저장 중 (두 번 눌러 켰다 꺼지는 것 방지)

function favButtons(code) {
  return isStockCode(code) ? [].slice.call(document.querySelectorAll('.fav-btn[data-fav="' + code + '"]')) : [];
}

function syncFavButtons(code, on) {
  favButtons(code).forEach(function (b) {
    b.classList.toggle('on', on);
    b.textContent = on ? '♥' : '♡';
    b.setAttribute('aria-label', on ? '관심종목에서 빼기' : '관심종목에 담기');
  });
  var sd = document.getElementById('starBtn');
  if (sd && curStock && curStock.code === code) {
    sd.classList.toggle('on', on);
    sd.textContent = on ? '♥' : '♡';
  }
  // 관심종목 섹션은 다음에 칠할 때 뼈대부터 다시 만든다
  var wl = document.getElementById('watchList');
  if (wl) wl.dataset.key = '';
}

/** 관심종목·랭킹 목록에서 바로 관심종목 토글 */
async function onFavToggle(code) {
  if (!isStockCode(code) || _favBusy[code]) return;
  _favBusy[code] = true;
  favButtons(code).forEach(function (b) { b.disabled = true; });
  try {
    var on = await toggleWatch(code);
    syncFavButtons(code, on);
    // 시세 홈에 있을 때만 다시 칠한다. 폴러는 다시 만들지 않는다 — 5개를 한꺼번에 즉시 재실행하게 된다
    if (!detailOpen() && currentTab === 'market') {
      paintWatch();                           // 뺀 종목은 바로 사라진다
      if (on && !freshQuote(code)) refreshListQuotes();    // 새로 담은 종목은 시세를 받아야 그릴 수 있다
    }
  } catch (e) {
    alert(e && e.message ? e.message : '관심종목 저장에 실패했습니다.');
  } finally {
    _favBusy[code] = false;
    favButtons(code).forEach(function (b) { b.disabled = false; });
  }
}

/* ===== 종목 상세 ===== */
/**
 * @param opts.fromPop  뒤로/앞으로 가기로 열 때 — 주소 기록을 새로 쌓지 않는다
 * @param opts.replace  딥링크로 처음 열 때 — 지금 기록을 바꿔 쓴다 (뒤로 가기로 빈 화면이 나오지 않게)
 */
async function openStock(code, name, opts) {
  if (!isStockCode(code)) return;
  opts = opts || {};
  var nameKnown = !!name;
  name = String(name || code);
  // 시세 홈에서 들어가면 스크롤 위치를 기억해 둔다 — 돌아올 때 그 자리로
  if (!detailOpen()) {
    _detailFrom = currentTab;
    if (currentTab === 'market') _homeScrollY = window.pageYOffset || 0;
  }
  var same = !!(curStock && curStock.code === code);
  curStock = { code: code, name: name };
  if (window.Community) Community.reset();
  curTf = 'D';
  bookOpen = false;
  if (nameKnown) pushRecent(code, name);       // 이름을 모르면(딥링크) 시세를 받은 뒤에 넣는다
  resetDirs('px:');
  resetDirs('bk:');
  _trendLoadedFor = null;
  _profileLoadedFor = null;
  _discLoadedFor = null;
  newsMode = 'news';
  // 이전 종목의 시세·일봉이 남아 있으면 범위 바가 잠깐 엉뚱한 값으로 그려진다
  _dayBars = null;
  _lastQuote = null;

  if (window.Coin) Coin.reset();              // 코인 상세에서 넘어왔으면 그쪽 폴러·차트를 정리한다
  Poller.stopAll();
  if (chartHandle) { chartHandle.dispose(); chartHandle = null; }

  document.getElementById('marketHome').style.display = 'none';
  var el = document.getElementById('stockDetail');
  el.style.display = '';
  el.innerHTML = stockShellHtml(code, name);
  window.scrollTo(0, 0);
  clearSearch();
  if (!opts.fromPop) setStockUrl(code, name, opts.replace || same);

  // 뼈대를 그린 뒤에 탭을 전환한다 — enterMarketTab 이 startStockPolling 을 돌린다
  switchTab('market');
  loadStockChart();
  if (window.Mock) Mock.renderTradeBar();      // 모의투자 모드면 하단에 매수·매도
  // 시세 홈을 거치지 않고 들어오면 휴장일 목록이 비어 있다 — 봉 갱신·장 상태 판단 전에 한 번 받아 둔다
  ensureHolidays();
  if (typeof renderStockBriefings === 'function') renderStockBriefings(code);

  // 시세 홈을 거치지 않고(브리핑 종목 칩) 들어오면 관심종목이 아직 없다 — 불러온 뒤 하트를 맞춘다
  ensureWatchlist().then(function () {
    var btn = document.getElementById('starBtn');
    if (!btn || !curStock || curStock.code !== code) return;
    var on = watchlist.indexOf(code) !== -1;
    btn.classList.toggle('on', on);
    btn.textContent = on ? '♥' : '♡';
  });
}

/* ===== 주소 (?code=) · 뒤로 가기 =====
 * 종목 상세를 열면 ?code=XXXXXX 를 기록에 쌓는다. 다른 파라미터는 그대로 둔다 (공유 링크의 ?briefing 만 지운다).
 * 안드로이드 뒤로 가기·스와이프로 상세가 닫히고, 링크를 그대로 공유·새로고침할 수 있다.
 */
function stockUrl(code) {
  var u = new URL(location.href);
  if (code) u.searchParams.set('code', code);
  else u.searchParams.delete('code');
  u.searchParams.delete('briefing');
  u.searchParams.delete('coin');
  return u.pathname + u.search + u.hash;
}

function setStockUrl(code, name, replace) {
  try {
    var st = { dtStock: code, dtName: name, dtPushed: true };
    if (replace) {
      st.dtPushed = !!(history.state && history.state.dtPushed);
      history.replaceState(st, '', stockUrl(code));
    } else {
      history.pushState(st, '', stockUrl(code));
    }
  } catch (e) { /* 기록 API 가 막힌 환경 — 주소만 안 바뀐다 */ }
}

window.addEventListener('popstate', function (e) {
  if (typeof isMember === 'undefined' || !isMember) return;
  var st = e.state || {};
  var sp = new URLSearchParams(location.search);
  var code = st.dtStock || sp.get('code');
  var coin = st.dtCoin || sp.get('coin');
  var isCoin = !!(window.Coin && Coin.isMarket(coin));
  if (_backToHome) {
    // "← 시세" 로 돌아왔는데 앞 기록도 종목이면(상세에서 다른 종목으로 건너간 경우) 그 기록을 홈으로 바꿔 쓴다
    _backToHome = false;
    if (isStockCode(code) || isCoin) { try { history.replaceState(null, '', stockUrl(null)); } catch (x) {} }
    closeDetail(true);
    return;
  }
  if (isStockCode(code)) {
    if (!curStock || curStock.code !== code) openStock(code, st.dtName || '', { fromPop: true });
    else if (currentTab !== 'market') switchTab('market');
  } else if (isCoin) {
    if (Coin.current() !== coin) Coin.open(coin, st.dtName || '', { fromPop: true });
    else if (currentTab !== 'market') switchTab('market');
  } else if (detailOpen()) {
    closeDetail(false);
  }
});

/** 종목 상세 폴링 시작/재개 (즉시 1회 실행됨) */
function startStockPolling() {
  Poller.add('quote', loadStockQuote, pollMs(3000, 60000));
  // 봉은 장외에는 바뀌지 않는다 — 10분에 한 번이면 충분하다 (워커·KV 호출 절약)
  Poller.add('bars', refreshChartBars, pollMs(60000, 600000));
  if (bookOpen) Poller.add('book', loadBook, pollMs(3000, 60000));
  // DT 회원 보유 현황 — 장중 1분, 장외 5분 (집계라 자주 부를 필요가 없다)
  Poller.add('crowd', loadStockCrowd, pollMs(60000, 300000));
}

/**
 * 시세 틱으로 차트 마지막 봉을 갱신할 때 새 봉을 만들어도 되는가.
 *  - 분봉: 장중에만 (장외에 '지금' 버킷으로 유령 봉이 생기지 않게)
 *  - 일봉: 거래일 개장 직후 네이버 일봉에 오늘 봉이 아직 없을 때 전 거래일 봉을 오늘 값으로 덧씌우지 않도록 오늘 봉을 새로 연다
 *  - 주봉·월봉: 버킷의 마지막 거래일이 오늘과 달라도 같은 주·달이면 그 봉을 갱신하는 게 맞으므로 새 봉은 만들지 않는다
 */
function allowNewBarNow() {
  if (curTf === 'm' || curTf === 'm5') return isMarketOpen();
  if (curTf === 'D') return isTradingDayKst() && isMarketOpen();
  return false;
}

/** "← 시세" — 쌓아 둔 기록이 있으면 뒤로 가기와 똑같이 닫는다 (기록이 두 갈래로 갈라지지 않게) */
function backToMarket() {
  if (history.state && history.state.dtStock && history.state.dtPushed) {
    _backToHome = true;
    history.back();                // popstate 가 closeDetail 을 부른다
    return;
  }
  // 딥링크로 바로 들어와 되돌아갈 기록이 없다 — 주소에서 code 만 지우고 닫는다
  try { history.replaceState(null, '', stockUrl(null)); } catch (e) {}
  closeDetail(true);
}

/**
 * 종목 상세를 닫는다.
 * @param toHome true 면 시세 홈으로, false(뒤로 가기)면 상세를 열기 전에 보던 탭으로 돌아간다
 */
function closeDetail(toHome) {
  var from = _detailFrom;
  _detailFrom = null;
  curStock = null;
  if (window.Coin) Coin.reset();
  Poller.remove('quote'); Poller.remove('bars'); Poller.remove('book'); Poller.remove('crowd');
  if (chartHandle) { chartHandle.dispose(); chartHandle = null; }
  var tb = document.getElementById('mkTradeBar');
  if (tb) tb.remove();
  document.getElementById('stockDetail').style.display = 'none';
  document.getElementById('marketHome').style.display = '';
  // 브리핑 종목 칩처럼 다른 탭에서 들어왔으면 뒤로 가기는 그 탭으로
  if (!toHome && from && from !== 'market' && currentTab === 'market') {
    var tabBtn = document.querySelector('.tab-btn[data-tab="' + from + '"]');
    if (tabBtn && tabBtn.style.display !== 'none') { switchTab(from); return; }
  }
  if (currentTab !== 'market') return;         // 다른 탭을 보는 중 — 상세만 닫아 둔다
  Poller.stopAll();
  window.scrollTo(0, _homeScrollY || 0);
  initMarketHome().then(function () {
    if (detailOpen() || currentTab !== 'market') return;
    renderRecent();
    startHomePolling();
  });
}

function stockShellHtml(code, name) {
  var watched = watchlist.indexOf(code) !== -1;
  return ''
    + '<div class="sd-head">'
    +   '<button class="mini-btn sd-back" onclick="backToMarket()">← 시세</button>'
    +   stockLogoHtml(code, name, null, 'lg')
    +   '<span class="sd-title" id="sdTitle">' + escapeHtml(name) + '</span>'
    +   '<button class="share-btn sd-share" onclick="shareStock()" aria-label="종목 공유">↗</button>'
    +   '<button class="fav-btn sd-fav' + (watched ? ' on' : '') + '" id="starBtn" onclick="onToggleWatch()"'
    +     ' aria-label="관심종목">' + (watched ? '♥' : '♡') + '</button>'
    + '</div>'
    + '<div class="sd-sub" id="sdSub">' + code + '</div>'
    + '<div class="sd-price-block" id="sdPrice"><div class="loading">시세 불러오는 중...</div></div>'
    + '<div id="sdRange"></div>'
    + '<div class="sd-stats" id="sdStats"></div>'
    + '<div class="cw-card" id="sdCrowd" style="display:none"></div>'
    + '<div class="sd-tabs">'
    +   '<button class="sd-tab on" data-sdtab="chart" onclick="sdSwitch(\'chart\')">차트</button>'
    +   '<button class="sd-tab" data-sdtab="info" onclick="sdSwitch(\'info\')">정보</button>'
    +   '<button class="sd-tab" data-sdtab="trend" onclick="sdSwitch(\'trend\')">수급</button>'
    +   '<button class="sd-tab" data-sdtab="news" onclick="sdSwitch(\'news\')">뉴스·공시</button>'
    +   '<button class="sd-tab" data-sdtab="community" onclick="sdSwitch(\'community\')">커뮤니티</button>'
    + '</div>'
    + '<div class="sd-panel" id="sdChart">'
    +   '<button type="button" class="cm-toggle" id="cmToggle" onclick="toggleChartMode()" aria-pressed="false">'
    +     '<span class="cm-check" aria-hidden="true">✓</span>자세히 보기'
    +   '</button>'
    +   '<div class="tf-row">'
    +     ['m:1분', 'm5:5분', 'D:일', 'W:주', 'M:월'].map(function (x) {
            var v = x.split(':')[0], label = x.split(':')[1];
            return '<button class="tf-btn' + (v === 'D' ? ' on' : '') + '" data-tf="' + v + '" onclick="setTf(\'' + v + '\')">' + label + '</button>';
          }).join('')
    +   '</div>'
    +   '<div class="chart-hilo" id="chartHiLo" style="display:none"></div>'
    +   '<div class="ma-legend" id="maLegend" style="display:none"></div>'
    +   '<div class="chart-box" id="chartBox"><div class="loading">차트 불러오는 중...</div></div>'
    +   '<button class="book-toggle" id="bookToggle" onclick="toggleBook()">▾ 호가 보기 (20분 지연)</button>'
    +   '<div class="book-wrap" id="bookWrap" style="display:none"></div>'
    +   '<div class="sd-briefings" id="sdBriefings" style="display:none"></div>'
    +   '<a class="ext-link" href="https://m.stock.naver.com/domestic/stock/' + code + '/total" target="_blank" rel="noopener noreferrer">네이버 증권에서 보기 →</a>'
    + '</div>'
    + '<div class="sd-panel" id="sdInfo" style="display:none"></div>'
    + '<div class="sd-panel" id="sdTrend" style="display:none"></div>'
    + '<div class="sd-panel" id="sdNews" style="display:none">'
    +   '<div class="seg-row nd-seg">'
    +     '<button class="seg on" data-nd="news" onclick="setNewsMode(\'news\')">📰 뉴스</button>'
    +     '<button class="seg" data-nd="disc" onclick="setNewsMode(\'disc\')">📄 공시</button>'
    +   '</div>'
    +   '<div id="ndNews"></div>'
    +   '<div id="ndDisc" style="display:none"></div>'
    + '</div>'
    + '<div class="sd-panel" id="sdCommunity" style="display:none"><div class="loading">불러오는 중...</div></div>'
    + '<div class="disclaimer" id="sdDisclaimer">⚠️ 시세는 참고용이며 지연·오류가 있을 수 있습니다. 실제 매매는 증권사 앱에서 확인하세요.</div>';
}

function sdSwitch(tab) {
  document.querySelectorAll('.sd-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.sdtab === tab); });
  document.getElementById('sdChart').style.display = tab === 'chart' ? '' : 'none';
  document.getElementById('sdInfo').style.display = tab === 'info' ? '' : 'none';
  document.getElementById('sdTrend').style.display = tab === 'trend' ? '' : 'none';
  document.getElementById('sdNews').style.display = tab === 'news' ? '' : 'none';
  document.getElementById('sdCommunity').style.display = tab === 'community' ? '' : 'none';
  // 커뮤니티 탭에는 글쓰기 칸 아래 안내 한 줄만 둔다 — 시세 면책까지 겹쳐 쌓이지 않게
  var disc = document.getElementById('sdDisclaimer');
  if (disc) disc.style.display = tab === 'community' ? 'none' : '';
  if (tab === 'info') loadStockProfile();
  if (tab === 'trend') loadDealTrend();
  if (tab === 'news') setNewsMode(newsMode);
  if (tab === 'community' && window.Community && curStock) Community.open(curStock.code, curStock.name);
}

async function onToggleWatch() {
  if (!curStock) return;
  var code = curStock.code;
  if (_favBusy[code]) return;                // 저장 중에 또 누르면 켰다 꺼진다
  _favBusy[code] = true;
  var btn = document.getElementById('starBtn');
  if (btn) btn.disabled = true;
  try {
    var on = await toggleWatch(code);
    syncFavButtons(code, on);      // 숨어 있는 시세 홈의 하트(관심종목·랭킹)도 함께 맞춘다
  } catch (e) {
    alert(e && e.message ? e.message : '관심종목 저장에 실패했습니다.');
  } finally {
    _favBusy[code] = false;
    if (btn) btn.disabled = false;
  }
}

/** 지금 시각이 속한 봉의 시간값 (차트 마지막 봉 갱신용) */
function currentBucketTime() {
  var now = new Date();
  var kst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
  if (curTf === 'm' || curTf === 'm5') {
    var step = curTf === 'm5' ? 5 : 1;
    var mins = Math.floor(kst.getMinutes() / step) * step;
    return Math.floor(Date.UTC(kst.getFullYear(), kst.getMonth(), kst.getDate(), kst.getHours(), mins) / 1000);
  }
  // 일·주·월봉은 "오늘"이 마지막 봉이므로 오늘 날짜로 갱신한다
  return { year: kst.getFullYear(), month: kst.getMonth() + 1, day: kst.getDate() };
}

async function loadStockQuote() {
  if (!curStock) return;
  var box = document.getElementById('sdPrice');
  if (!box) return;
  var code = curStock.code;
  try {
    var q = await Market.quote(code);
    // 기다리는 사이 다른 종목으로 넘어갔으면 늦게 온 응답은 버린다
    if (!curStock || curStock.code !== code) return;
    box = document.getElementById('sdPrice');
    if (!box) return;
    setMarketStatus(q.marketStatus);        // 시계 대신 서버 상태를 신뢰
    // 딥링크로 코드만 알고 들어왔으면 이름을 시세 응답으로 채운다 (제목·최근 본 종목·공유 문구)
    if (q.name && curStock.name === code) {
      curStock.name = String(q.name);
      var tEl = document.getElementById('sdTitle');
      if (tEl) tEl.textContent = curStock.name;
      pushRecent(code, curStock.name);
      try {
        if (history.state && history.state.dtStock === code) {
          history.replaceState(Object.assign({}, history.state, { dtName: curStock.name }), '', location.href);
        }
      } catch (e) {}
    }
    var cls = signClass(q.change);
    var st = marketStateLabel();

    // 뼈대는 1회만 — 이후엔 텍스트만 갈아끼워야 플래시 애니메이션이 산다
    if (!box.dataset.built) {
      box.innerHTML =
          '<div class="sd-price" id="pxVal"></div>'
        + '<div class="sd-chg" id="pxChg"></div>'
        + '<div class="sd-asof" id="pxAsOf"></div>';
      box.dataset.built = '1';
    }

    var vEl = document.getElementById('pxVal');
    var cEl = document.getElementById('pxChg');
    var aEl = document.getElementById('pxAsOf');

    setTextFlash(vEl, fmtNum(q.price), dirOf('px:' + q.code, q.price));
    vEl.className = 'sd-price ' + cls;
    cEl.innerHTML = signMark(q.change) + ' ' + fmtNum(Math.abs(q.change))
      + ' (' + fmtRate(q.changeRate) + ') <span class="vs">어제보다</span>';
    cEl.className = 'sd-chg ' + cls;
    // 프리/애프터마켓에는 KRX 가 닫혀 있어 넥스트레이드(NXT) 체결가를 보여준다 — 어느 시장 값인지 밝힌다
    var sess = q.session === 'AFTER_MARKET' ? '애프터마켓(NXT)' : (q.session === 'PRE_MARKET' ? '프리마켓(NXT)' : '');
    aEl.innerHTML = escapeHtml(shortTime(q.asOf)) + ' 기준 · 네이버 ' + (sess ? '· ' + sess + ' ' : '')
      + '<span class="state-dot ' + st.cls + '">' + st.text + '</span>';

    document.getElementById('sdSub').textContent =
      q.code + ' · ' + (q.market || '') + (q.halted ? ' · 거래정지' : '')
      + (q.limitState === 'upper' ? ' · 상한가' : (q.limitState === 'lower' ? ' · 하한가' : ''));

    document.getElementById('sdStats').innerHTML = [
      [q.integrated ? '거래량(통합)' : '거래량', fmtCompact(q.volume)],
      ['시가', fmtNum(q.open)],
      ['고가', fmtNum(q.high)],
      ['저가', fmtNum(q.low)]
    ].map(function (r) {
      return '<div class="stat"><span class="stat-k">' + r[0] + '</span><span class="stat-v">' + r[1] + '</span></div>';
    }).join('');

    renderRange(q);
    syncTargetUpside();          // 목표가 카드가 열려 있으면 상승여력을 현재가에 맞춘다

    // ★ 차트 마지막 봉을 새로고침 없이 갱신.
    // 장 마감 후에도 한 번은 맞춰야 종가가 차트에 반영된다 (상단 시세와 끝점 불일치 방지).
    if (chartHandle) chartHandle.updateLast(q.price, currentBucketTime(), q.volume, allowNewBarNow());
  } catch (e) {
    if (!box.dataset.built) box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
    paintStateBadges();          // 실패가 이어지면 '실시간' 대신 '연결 끊김'
  }
}

/** 오늘 범위 / 52주 범위 바 (토스 차용) */
var _dayBars = null;
var _lastQuote = null;
function renderRange(q) {
  _lastQuote = q || _lastQuote;
  q = _lastQuote;
  if (!q) return;
  var el = document.getElementById('sdRange');
  if (!el) return;
  var rows = [];
  if (q.low != null && q.high != null && q.high > q.low) {
    rows.push(rangeRowHtml('오늘 범위', q.low, q.high, q.price));
  }
  if (_dayBars && _dayBars.length) {
    var win = _dayBars.slice(-250);
    var lo = Math.min.apply(null, win.map(function (b) { return b.l; }));
    var hi = Math.max.apply(null, win.map(function (b) { return b.h; }));
    if (hi > lo) rows.push(rangeRowHtml('52주 범위', lo, hi, q.price));
  }
  el.innerHTML = rows.join('');
}

function rangeRowHtml(label, lo, hi, cur) {
  // 현재가가 없으면 마커를 찍지 않는다 (left:NaN% 방지)
  var pct = (cur != null && isFinite(cur) && hi > lo) ? Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100)) : null;
  return '<div class="range-row">'
    + '<div class="range-label">' + label + '</div>'
    + '<div class="range-bar-wrap">'
    +   '<span class="range-lo">' + fmtNum(lo) + '</span>'
    +   '<span class="range-bar">' + (pct == null ? '' : '<i style="left:' + pct.toFixed(1) + '%"></i>') + '</span>'
    +   '<span class="range-hi">' + fmtNum(hi) + '</span>'
    + '</div></div>';
}

function setTf(tf) {
  curTf = tf;
  document.querySelectorAll('.tf-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.tf === tf); });
  loadStockChart();
}

function syncChartModeBtn() {
  var btn = document.getElementById('cmToggle');
  if (!btn) return;
  var on = chartMode === 'detail';
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function setChartMode(m) {
  chartMode = (m === 'detail') ? 'detail' : 'simple';
  try { localStorage.setItem('dt-invest-chartmode', chartMode); } catch (e) {}
  syncChartModeBtn();
  loadStockChart();
}

function toggleChartMode() {
  setChartMode(chartMode === 'detail' ? 'simple' : 'detail');
}

(function initChartMode() {
  try { chartMode = localStorage.getItem('dt-invest-chartmode') || 'simple'; } catch (e) {}
})();

var _chartSeq = 0;
var _chartBars = null;      // 마지막으로 그린 봉 — 테마 전환 시 재요청 없이 다시 그리는 데 쓴다

/**
 * 주간/야간 전환 — 차트는 canvas 라 CSS 변수를 따라가지 못하고, 그릴 때 읽은 색이 굳어 있다.
 * 배경·격자·글자뿐 아니라 상승/하락 색도 테마마다 달라서 옵션만 바꾸지 않고 통째로 다시 그린다.
 */
async function onThemeChanged() {
  if (window.Coin) Coin.onThemeChanged();
  if (!curStock || !chartHandle || !_chartBars) return;
  var box = document.getElementById('chartBox');
  if (!box) return;
  var seq = ++_chartSeq;
  chartHandle.dispose(); chartHandle = null;
  try {
    var handle = await renderChart(box, _chartBars, curTf, chartMode);
    if (seq !== _chartSeq) { handle.dispose(); return; }
    chartHandle = handle;
    updateHiLoLabel();
    // 다시 그린 봉의 끝점을 현재가에 맞춘다 (다음 시세 폴링까지 어긋나 보이지 않게)
    if (_lastQuote) chartHandle.updateLast(_lastQuote.price, currentBucketTime(), _lastQuote.volume, allowNewBarNow());
  } catch (e) { if (seq === _chartSeq) loadStockChart(); }
}

async function loadStockChart() {
  if (!curStock) return;
  var box = document.getElementById('chartBox');
  if (!box) return;
  // 기간 버튼 연타·종목 전환 시 마지막 요청만 그린다 (차트가 겹쳐 생성·누수되는 것 방지)
  var seq = ++_chartSeq;
  syncChartModeBtn();
  box.innerHTML = '<div class="loading">차트 불러오는 중...</div>';
  if (chartHandle) { chartHandle.dispose(); chartHandle = null; }
  try {
    var isMin = (curTf === 'm' || curTf === 'm5');
    var d = await Market.ohlc(curStock.code, isMin ? '1m' : 'D');
    if (seq !== _chartSeq) return;
    var bars = d.bars || d.candles || [];
    if (!bars.length) { box.innerHTML = '<div class="empty">차트 데이터가 없습니다</div>'; return; }

    if (!isMin) { _dayBars = bars; if (_lastQuote) renderRange(_lastQuote); }

    var use = bars;
    if (curTf === 'm5') use = groupMinutes(bars, 5);
    else if (curTf === 'W') use = aggregateCandles(bars, 'W');
    else if (curTf === 'M') use = aggregateCandles(bars, 'M');
    else if (curTf === 'D') use = bars.slice(-120);

    var handle = await renderChart(box, use, curTf, chartMode);
    if (seq !== _chartSeq) { handle.dispose(); return; }
    chartHandle = handle;
    _chartBars = use;

    // 기간 최고/최저를 차트 위에 텍스트로 — 가장자리 마커가 잘려도 값은 보인다
    updateHiLoLabel();

    var legend = document.getElementById('maLegend');
    if (legend) {
      if (chartMode === 'detail' && typeof MA_DEFS !== 'undefined') {
        legend.style.display = '';
        legend.innerHTML = '<span class="ma-label">이동평균선</span>' + MA_DEFS.map(function (m) {
          return '<span class="ma-item" style="color:' + m[1] + '">' + m[0] + '</span>';
        }).join('');
      } else {
        legend.style.display = 'none';
      }
    }
  } catch (e) {
    if (seq !== _chartSeq) return;
    box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
  }
}

/** 봉 데이터만 다시 받아 교체한다 (차트를 재생성하지 않아 줌/스크롤이 유지됨) */
async function refreshChartBars() {
  if (!curStock || !chartHandle || !chartHandle.replaceData) return;
  try {
    var isMin = (curTf === 'm' || curTf === 'm5');
    var seq = _chartSeq, handle = chartHandle;
    var d = await Market.ohlc(curStock.code, isMin ? '1m' : 'D');
    // 받는 사이 종목·기간·차트가 바뀌었으면 버린다
    if (seq !== _chartSeq || handle !== chartHandle) return;
    var bars = d.bars || d.candles || [];
    if (!bars.length) return;
    if (!isMin) _dayBars = bars;

    var use = bars;
    if (curTf === 'm5') use = groupMinutes(bars, 5);
    else if (curTf === 'W') use = aggregateCandles(bars, 'W');
    else if (curTf === 'M') use = aggregateCandles(bars, 'M');
    else if (curTf === 'D') use = bars.slice(-120);

    chartHandle.replaceData(use);
    _chartBars = use;
    updateHiLoLabel();
    // 교체한 봉은 워커 캐시(최대 3분) 시점의 값이라 상단 현재가보다 늦다 — 끝점을 현재가에 다시 맞춘다
    if (_lastQuote && _lastQuote.code === curStock.code) {
      chartHandle.updateLast(_lastQuote.price, currentBucketTime(), _lastQuote.volume, allowNewBarNow());
      renderRange(_lastQuote);
    }
  } catch (e) { /* 다음 주기에 재시도 */ }
}

/** 차트 위 최고/최저 라벨 갱신 */
function updateHiLoLabel() {
  var hl = document.getElementById('chartHiLo');
  if (!hl || !chartHandle) return;
  if (chartHandle.periodHigh != null && chartHandle.periodLow != null) {
    hl.style.display = '';
    hl.innerHTML = '<span class="hl-hi">최고 ' + fmtNum(chartHandle.periodHigh) + '</span>'
                 + '<span class="hl-lo">최저 ' + fmtNum(chartHandle.periodLow) + '</span>';
  } else hl.style.display = 'none';
}

/**
 * 1분봉 → N분봉. 개수가 아니라 시각으로 묶는다 — 거래가 없어 빠진 분이 있어도 09:00·09:05 … 경계가
 * 유지되고, currentBucketTime() 이 만드는 버킷 시각과 같은 봉을 가리킨다.
 * 봉의 t 는 버킷 시작 시각(HHMM 을 N 분 단위로 내림)으로 둔다.
 */
function groupMinutes(bars, n) {
  var out = [], cur = null, curKey = null;
  bars.forEach(function (b) {
    var s = String(b.t);
    var hh = +s.slice(8, 10), mm = +s.slice(10, 12);
    var bm = Math.floor(mm / n) * n;
    var key = s.slice(0, 8) + String(hh).padStart(2, '0') + String(bm).padStart(2, '0') + '00';
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 };
      curKey = key;
    } else {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l);
      cur.c = b.c; cur.v += (b.v || 0);
    }
  });
  if (cur) out.push(cur);
  return out;
}

/* ===== 호가 (기본 접힘 — 점진적 공개) ===== */
function toggleBook() {
  bookOpen = !bookOpen;
  var wrap = document.getElementById('bookWrap');
  var btn = document.getElementById('bookToggle');
  wrap.style.display = bookOpen ? '' : 'none';
  if (!bookOpen) { wrap.dataset.built = ''; resetDirs('bk:'); }
  btn.textContent = bookOpen ? '▴ 호가 접기' : '▾ 호가 보기 (20분 지연)';
  if (bookOpen) {
    loadBook();
    Poller.add('book', loadBook, pollMs(3000, 60000));
  } else {
    Poller.remove('book');
  }
}

async function loadBook() {
  if (!curStock || !bookOpen) return;
  var wrap = document.getElementById('bookWrap');
  if (!wrap) return;
  try {
    var code = curStock.code;
    var b = await Market.book(code);
    if (!curStock || curStock.code !== code || !bookOpen) return;
    wrap = document.getElementById('bookWrap');
    if (!wrap) return;
    // 워커는 네이버 호가가 막히면 에러 대신 unavailable 을 내려준다
    if (b.unavailable) {
      wrap.dataset.built = '';
      wrap.innerHTML = '<div class="empty">' + escapeHtml(b.reason || '호가를 불러오지 못했습니다') + '</div>';
      return;
    }
    var ask = b.ask || [], bid = b.bid || [];
    var qtyOf = function (a) { return (a.count !== undefined && a.count !== null) ? a.count : a.qty; };
    var total = (b.askTotal || 0) + (b.bidTotal || 0);
    var askPct = total ? Math.round((b.askTotal / total) * 100) : 50;

    // 뼈대는 1회만 (5단계 고정이라 구조가 바뀌지 않는다)
    if (!wrap.dataset.built) {
      var h = '<div class="bk-head"><span>매도잔량</span><span>호가</span><span>매수잔량</span></div>';
      h += ask.map(function (a, i) {
        return '<div class="bk-row">'
          + '<span class="bk-qty ask"><i id="bka-bar-' + i + '"></i><b id="bka-q-' + i + '"></b></span>'
          + '<span class="bk-price" id="bka-p-' + i + '"></span>'
          + '<span class="bk-qty"></span></div>';
      }).join('');
      h += '<div class="bk-mid" id="bkMid"></div>';
      h += bid.map(function (a, i) {
        return '<div class="bk-row">'
          + '<span class="bk-qty"></span>'
          + '<span class="bk-price" id="bkb-p-' + i + '"></span>'
          + '<span class="bk-qty bid"><i id="bkb-bar-' + i + '"></i><b id="bkb-q-' + i + '"></b></span></div>';
      }).join('');
      h += '<div class="bk-ratio"><span class="bk-ratio-bar"><i id="bkRatio"></i></span>'
         + '<span class="bk-ratio-txt" id="bkRatioTxt"></span></div>'
         + '<div class="bk-note">5단계 · <b>20분 지연</b> — 네이버가 제공하는 호가는 실시간이 아닙니다 (현재가는 실시간).<br>'
         + '실시간 10단계 호가는 증권사 앱에서 확인하세요</div>';
      wrap.innerHTML = h;
      wrap.dataset.built = '1';
    }

    var paint = function (side, arr) {
      arr.forEach(function (a, i) {
        var qEl = document.getElementById('bk' + side + '-q-' + i);
        var pEl = document.getElementById('bk' + side + '-p-' + i);
        var bar = document.getElementById('bk' + side + '-bar-' + i);
        if (!qEl || !pEl || !bar) return;
        var qty = qtyOf(a);
        setTextFlash(qEl, fmtNum(qty), dirOf('bk:' + side + i, qty));
        pEl.textContent = fmtNum(a.price);
        bar.style.width = (a.rate || 0) + '%';
      });
    };
    paint('a', ask);
    paint('b', bid);

    document.getElementById('bkMid').textContent =
      '매도 ' + fmtNum(b.askTotal) + ' · 매수 ' + fmtNum(b.bidTotal);
    document.getElementById('bkRatio').style.width = askPct + '%';
    document.getElementById('bkRatioTxt').textContent =
      '매도 ' + askPct + '% : 매수 ' + (100 - askPct) + '%';
  } catch (e) {
    if (!wrap.dataset.built) {
      wrap.innerHTML = '<div class="empty">호가를 불러오지 못했습니다<br><span style="font-size:.74rem">'
        + escapeHtml(e.message) + '</span></div>';
    }
  }
}

/* ===== DT 회원 보유 현황 (모의투자 참가자 집계) =====
 * 부가 정보라 실패하면 조용히 숨긴다. 시즌이 없으면 아무것도 그리지 않는다.
 *  - 종목 상세: 가격·지표 아래 한 장 (폴러 'crowd')
 *  - 시세 홈: 👥 DT 회원 픽 (폴러 'crowdTop', 가격은 _quoteMap = /api/quotes 에서만)
 */
var _crowdSeq = 0;               // 종목 상세 — 느리게 온 응답이 그 사이 연 종목을 덮지 않게
var _crowdDrawn = '';            // 종목 상세에 마지막으로 그린 '코드|내용' — 같으면 다시 그리지 않는다
var _crowdTopSeq = 0;
var crowdType = 'held';          // 'held' | 'bought'

function crowdCount(v) {
  var n = Number(v);
  return v != null && isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** 종목 상세 카드 내용 — 그릴 것이 없으면 '' */
function crowdCardHtml(d) {
  if (!d || !d.season) return '';
  if (d.few) {
    return '<span class="cw-icon" aria-hidden="true">👥</span>'
      + '<div class="cw-body"><div class="cw-main">모의투자 보유 회원 3명 미만</div></div>';
  }
  var holders = crowdCount(d.holders);
  if (holders == null) return '';
  var main = ['<span>DT 회원 <b>' + fmtNum(holders) + '명</b> 보유</span>'];
  var avg = d.avgReturn == null ? NaN : Number(d.avgReturn);
  if (isFinite(avg)) {
    main.push('<span>평균 수익률 <b class="' + signClass(avg) + '">' + (avg > 0 ? '+' : '') + avg.toFixed(1) + '%</b></span>');
  }
  var winners = crowdCount(d.winners);
  if (winners != null) main.push('<span>수익 중 ' + fmtNum(winners) + '명</span>');

  var bought = crowdCount(d.boughtToday), sold = crowdCount(d.soldToday);
  var today = [];
  if (bought != null) today.push('오늘 산 회원 ' + fmtNum(bought) + '명');
  if (sold != null) today.push((bought != null ? '판 회원 ' : '오늘 판 회원 ') + fmtNum(sold) + '명');

  var sep = '<span class="cw-sep" aria-hidden="true">·</span>';
  return '<span class="cw-icon" aria-hidden="true">👥</span>'
    + '<div class="cw-body">'
    +   '<div class="cw-main">' + main.join(sep) + '</div>'
    +   (today.length ? '<div class="cw-sub">' + today.map(function (t) { return '<span>' + t + '</span>'; }).join(sep) + '</div>' : '')
    + '</div>';
}

/** 종목 상세의 회원 보유 현황 (폴러 'crowd') */
async function loadStockCrowd() {
  if (!curStock) return;
  var code = curStock.code;
  var seq = ++_crowdSeq;
  var d = null, failed = null;
  try { d = await Market.crowd(code); } catch (e) { failed = e || {}; }
  if (seq !== _crowdSeq || !curStock || curStock.code !== code) return;
  var el = document.getElementById('sdCrowd');
  if (!el) return;

  if (failed) {
    // 4xx(아직 없는 API·권한)는 이 종목을 보는 동안 다시 부르지 않는다.
    // 일시적 실패는 이미 그린 카드를 그대로 두고 다음 주기에 다시 받는다.
    if (failed.status >= 400 && failed.status < 500) Poller.remove('crowd');
    if (failed.status < 500 || _crowdDrawn.indexOf(code + '|') !== 0) { el.style.display = 'none'; el.innerHTML = ''; _crowdDrawn = ''; }
    return;
  }
  var html = crowdCardHtml(d);
  if (!d.season) Poller.remove('crowd');        // 시즌이 없다 — 다시 열 때 확인한다
  if (!html) { el.style.display = 'none'; el.innerHTML = ''; _crowdDrawn = ''; return; }
  el.classList.toggle('few', !!d.few);
  // 종목을 새로 열면 뼈대가 새로 그려져 카드가 비어 있다 — 그때도 다시 채운다
  if (_crowdDrawn !== code + '|' + html || !el.firstChild) {
    el.innerHTML = html;
    _crowdDrawn = code + '|' + html;
  }
  el.style.display = '';
}

/* ----- 시세 홈: 👥 DT 회원 픽 ----- */
function setCrowdType(t) {
  if (t !== 'held' && t !== 'bought') return;
  crowdType = t;
  document.querySelectorAll('[data-crowd]').forEach(function (b) {
    b.classList.toggle('on', b.dataset.crowd === crowdType);
  });
  loadCrowdTop();
}

function hideCrowdSection() {
  var sec = document.getElementById('crowdSection');
  var el = document.getElementById('crowdList');
  if (sec) sec.style.display = 'none';
  if (el) { el.innerHTML = ''; el.dataset.key = ''; }
  _crowdCodes = [];
  // 다시 나타날 때는 '많이 보유'부터 — 숨은 채로 '오늘 많이 산'에 머물면 섹션을 띄울지 판단이 어긋난다
  crowdType = 'held';
  document.querySelectorAll('[data-crowd]').forEach(function (b) { b.classList.toggle('on', b.dataset.crowd === 'held'); });
}

/** 많이 보유 / 오늘 많이 산 상위 종목 (폴러 'crowdTop') */
async function loadCrowdTop() {
  var sec = document.getElementById('crowdSection');
  var el = document.getElementById('crowdList');
  if (!sec || !el) return;
  var type = crowdType;
  var seq = ++_crowdTopSeq;
  var switching = el.dataset.type !== type;
  if (switching && sec.style.display !== 'none') {
    el.innerHTML = '<div class="loading">불러오는 중...</div>';
    el.dataset.key = '';
    _crowdCodes = [];
  }
  var d;
  try { d = await Market.crowdTop(type); }
  catch (e) {
    if (seq !== _crowdTopSeq) return;
    if (e && e.status >= 400 && e.status < 500) Poller.remove('crowdTop');   // 시세 홈에 다시 들어올 때 확인한다
    // 일시적 실패는 이미 그린 목록을 그대로 둔다
    if ((e && e.status < 500) || switching || !el.querySelector('.cw-row')) hideCrowdSection();
    return;
  }
  if (seq !== _crowdTopSeq || type !== crowdType) return;

  var seen = {};
  var items = (d.items || []).filter(function (s) {
    if (!s || !isStockCode(s.code) || seen[s.code] || crowdCount(s.count) == null) return false;
    seen[s.code] = 1;
    return true;
  }).slice(0, 10);

  // 시즌이 없거나 '많이 보유'가 3종목 미만이면 섹션을 통째로 숨긴다.
  // '오늘 많이 산'만 적으면 섹션은 두고 안내 한 줄 — 누른 버튼이 사라지지 않게
  if (!d.season || (type === 'held' && items.length < 3)) { hideCrowdSection(); el.dataset.type = 'held'; return; }
  var hint = document.getElementById('crowdHint');
  if (hint) hint.textContent = String(d.season.name || '모의투자') + ' 기준';
  sec.style.display = '';
  el.dataset.type = type;

  if (items.length < 3) {
    _crowdCodes = [];
    el.dataset.key = '';
    el.innerHTML = '<div class="empty">오늘은 아직 집계할 만큼 산 회원이 없습니다</div>';
    return;
  }

  var key = type + '|' + items.map(function (s) { return s.code + ':' + crowdCount(s.count); }).join(',');
  _crowdCodes = items.map(function (s) { return s.code; });
  if (el.dataset.key !== key) {
    resetDirs('ck:');
    el.innerHTML = items.map(function (s, i) {
      var name = String(s.name || s.code);
      var watched = watchlist.indexOf(s.code) !== -1;
      return '<div class="q-row rank-row cw-row">'
        + '<button class="rank-main" onclick="openStock(\'' + s.code + '\',\'' + escapeJsArg(name) + '\')">'
        +   '<span class="q-rank">' + (i + 1) + '</span>'
        +   stockLogoHtml(s.code, name, null)
        +   '<span class="rank-names">'
        +     '<span class="q-name">' + escapeHtml(name) + '</span>'
        +     '<span class="rank-code">' + s.code + '</span>'
        +   '</span>'
        +   '<span class="rank-nums">' + listPriceCells('ck', s.code) + '</span>'
        +   '<span class="cw-count">' + fmtNum(crowdCount(s.count)) + '명</span>'
        + '</button>'
        + '<button class="fav-btn' + (watched ? ' on' : '') + '" data-fav="' + s.code + '"'
        +   ' onclick="onFavToggle(\'' + s.code + '\')" aria-label="' + (watched ? '관심종목에서 빼기' : '관심종목에 담기') + '">'
        +   (watched ? '♥' : '♡') + '</button>'
        + '</div>';
    }).join('');
    el.dataset.key = key;
  }
  // 받아 둔 시세가 없는 종목만 바로 받는다 — 나머지는 'quotes' 폴러가 같은 주기로 갱신한다
  if (!detailOpen() && _crowdCodes.some(function (c) { return !freshQuote(c); })) refreshListQuotes();
}

/* ===== 투자자별 매매동향 ===== */
var _trendLoadedFor = null;
var _trendAt = 0;

async function loadDealTrend() {
  if (!curStock) return;
  var el = document.getElementById('sdTrend');
  if (!el) return;
  // 매매동향은 장 마감 후 집계되는 일별 확정 데이터라 장중에는 바뀌지 않는다.
  // 다만 마감 뒤 오늘 치가 생기므로, 10분 지난 값이면 다시 받는다 (워커 캐시도 10분이다).
  if (_trendLoadedFor === curStock.code && el.innerHTML && Date.now() - _trendAt < 600000) return;
  el.innerHTML = '<div class="loading">매매동향 불러오는 중...</div>';
  try {
    var d = await Market.trend(curStock.code);
    var rows = d.rows || [];
    if (!rows.length) { el.innerHTML = '<div class="empty">매매동향 데이터가 없습니다</div>'; return; }

    // 순매수 절대값 최대치를 기준으로 막대 길이를 잡는다
    var maxAbs = 1;
    rows.forEach(function (r) {
      ['individual', 'foreign', 'organ'].forEach(function (k) {
        if (r[k] != null) maxAbs = Math.max(maxAbs, Math.abs(r[k]));
      });
    });

    var cell = function (v) {
      if (v == null) return '<span class="dt-v">-</span>';
      var cls = v > 0 ? 'up' : (v < 0 ? 'down' : 'flat');
      var w = Math.round(Math.abs(v) / maxAbs * 100);
      return '<span class="dt-cell"><i class="dt-bar ' + cls + '" style="width:' + w + '%"></i>'
        + '<b class="dt-v ' + cls + '">' + (v > 0 ? '+' : '') + fmtCompact(v) + '</b></span>';
    };

    el.innerHTML =
        '<div class="dt-head"><span>일자</span><span>개인</span><span>외국인</span><span>기관</span></div>'
      + rows.map(function (r) {
          return '<div class="dt-row">'
            + '<span class="dt-date">' + r.date.slice(4, 6) + '.' + r.date.slice(6, 8) + '</span>'
            + cell(r.individual) + cell(r.foreign) + cell(r.organ)
            + '</div>';
        }).join('')
      + (rows[0].foreignHoldRate
          ? '<div class="dt-foot">외국인 보유율 ' + escapeHtml(rows[0].foreignHoldRate) + '</div>'
          : '')
      + '<div class="dt-note">순매수 수량(주) 기준 · 최근 5거래일 · 출처 네이버<br>'
      +   '장 마감 후 집계되는 값이라 장중에는 바뀌지 않습니다. 오늘 수급은 내일 반영됩니다.</div>';
    _trendLoadedFor = curStock.code;
    _trendAt = Date.now();
  } catch (e) {
    el.innerHTML = '<div class="empty">매매동향을 불러오지 못했습니다</div>';
  }
}

/* ===== 종목 정보 (투자지표 · 실적 · 컨센서스 목표가) =====
 * 하루 단위로만 바뀌는 값이라 폴링하지 않고 탭을 열 때 한 번만 받는다.
 * 목표가의 상승여력만 현재가가 움직일 때마다 다시 계산한다(syncTargetUpside).
 */
var _profileLoadedFor = null;
var _targetMean = null;      // 평균 목표가 — 시세 틱마다 상승여력을 다시 그리는 데 쓴다

async function loadStockProfile() {
  if (!curStock) return;
  var el = document.getElementById('sdInfo');
  if (!el) return;
  if (_profileLoadedFor === curStock.code && el.innerHTML) return;
  el.innerHTML = '<div class="loading">종목정보 불러오는 중...</div>';
  var code = curStock.code;
  try {
    var p = await Market.profile(code);
    if (!curStock || curStock.code !== code) return;      // 기다리는 사이 다른 종목으로 넘어갔다
    el = document.getElementById('sdInfo');
    if (!el) return;
    _targetMean = p.consensus ? p.consensus.targetMean : null;
    el.innerHTML = (p.type === 'etf' ? etfInfoCardHtml(p) : stockInfoCardHtml(p))
      + revenueCardHtml(p.finance)
      + targetCardHtml(p)
      + summaryCardHtml(p)
      + researchCardHtml(p)
      + '<div class="pf-source">투자지표 · 실적 · 컨센서스 · 기업개요는 네이버 증권을 통해 받은 '
      +   'FnGuide 제공 자료입니다. 지연·오류가 있을 수 있습니다.</div>';
    syncTargetUpside();
    _profileLoadedFor = code;
  } catch (e) {
    el = document.getElementById('sdInfo');
    if (el) el.innerHTML = '<div class="empty">종목정보를 불러오지 못했습니다</div>';
  }
}

/** 지표 한 칸 — 값이 없으면 아예 만들지 않는다 (빈칸이 늘어서면 오히려 어수선하다) */
function infoCell(label, value, sub, subCls) {
  if (value == null || value === '') return '';
  return '<div class="pf-cell">'
    + '<div class="pf-k">' + escapeHtml(label) + '</div>'
    + '<div class="pf-v">' + escapeHtml(value) + '</div>'
    + (sub ? '<div class="pf-s' + (subCls ? ' ' + subCls : '') + '">' + escapeHtml(sub) + '</div>' : '')
    + '</div>';
}

/** 2열 격자 — 칸이 홀수면 마지막 줄이 절반만 칠해져 어색하다. 빈 칸으로 줄을 맞춘다 */
function pfGrid(cells) {
  var list = cells.filter(Boolean);
  if (!list.length) return '';
  if (list.length % 2) list.push('<div class="pf-cell"></div>');
  return '<div class="pf-grid">' + list.join('') + '</div>';
}

function pfCardHead(title, hint) {
  return '<div class="pf-head"><h4>' + escapeHtml(title) + '</h4>'
    + (hint ? '<span class="pf-hint">' + escapeHtml(hint) + '</span>' : '') + '</div>';
}

function stockInfoCardHtml(p) {
  var i = p.indicators || {};
  var grid = pfGrid([
    infoCell('PER', i.per, i.cnsPer ? '추정 ' + i.cnsPer : ''),
    infoCell('EPS', i.eps, i.cnsEps ? '추정 ' + i.cnsEps : ''),
    infoCell('PBR', i.pbr, i.bps ? 'BPS ' + i.bps : ''),
    infoCell('배당수익률', i.dividendYieldRatio, i.dividend ? '주당 ' + i.dividend : ''),
    infoCell('시가총액', i.marketValue),
    infoCell('외인소진율', i.foreignRate)
  ]);
  if (!grid) return '';
  return '<section class="pf-card">' + pfCardHead('종목정보', '투자지표')
    + grid
    + '<div class="pf-note">PER·EPS 는 최근 4분기 실적 기준 · 추정치는 증권사 컨센서스</div>'
    + '</section>';
}

function etfInfoCardHtml(p) {
  var e = p.etf || {};
  var pct = function (v) { return v == null ? null : (v > 0 ? '+' : '') + v.toFixed(2) + '%'; };
  var grid = pfGrid([
    infoCell('기초지수', e.baseIndex),
    infoCell('운용사', (e.issuer || '').replace(/\(ETF\)$/, '')),
    infoCell('총보수', e.totalFee == null ? null : e.totalFee.toFixed(2) + '%'),
    infoCell('순자산가치', e.nav == null ? null : fmtNum(Math.round(e.nav)) + '원'),
    infoCell('괴리율', pct(e.deviationRate)),
    infoCell('분배율', e.dividendYieldTtm == null ? null : e.dividendYieldTtm.toFixed(2) + '%'),
    infoCell('시가총액', e.marketValue)
  ]);
  var rates = [['1개월', e.returnRate1m], ['3개월', e.returnRate3m], ['1년', e.returnRate1y]]
    .filter(function (r) { return r[1] != null; });
  var rateHtml = rates.length
    ? '<div class="pf-sub-head">기간 수익률</div>' + pfGrid(rates.map(function (r) {
        return '<div class="pf-cell"><div class="pf-k">' + r[0] + '</div>'
          + '<div class="pf-v ' + signClass(r[1]) + '">' + (r[1] > 0 ? '+' : '') + r[1].toFixed(2) + '%</div></div>';
      }))
    : '';
  if (!grid && !rateHtml) return '';
  return '<section class="pf-card">' + pfCardHead('ETF 정보', '기초지수 · 보수')
    + grid
    + rateHtml
    + '<div class="pf-note">괴리율은 시장가와 순자산가치(NAV)의 차이 · 기간 수익률은 분배금 포함</div>'
    + '</section>';
}

/** 억원 → "204.9조" / "1,714억" */
function fmtEok(v) {
  if (v == null) return '-';
  var a = Math.abs(v), s;
  if (a >= 10000) { var jo = a / 10000; s = (jo >= 1000 ? fmtNum(Math.round(jo)) : jo.toFixed(1)) + '조'; }
  else s = fmtNum(Math.round(a)) + '억';
  return (v < 0 ? '-' : '') + s;
}

/** 분기 매출 추이 — 마지막 칸이 컨센서스 추정치면 점선 막대로 구분한다 */
function revenueCardHtml(f) {
  if (!f || !f.revenue || !f.cols) return '';
  var vals = f.revenue, cols = f.cols;
  var last = -1;
  for (var i = vals.length - 1; i >= 0; i--) { if (vals[i] != null) { last = i; break; } }
  if (last < 0) return '';

  var max = Math.max.apply(null, vals.filter(function (v) { return v != null; }).map(Math.abs));
  if (!(max > 0)) return '';

  var yoy = (last >= 4 && vals[last - 4]) ? (vals[last] - vals[last - 4]) / Math.abs(vals[last - 4]) * 100 : null;
  var op = f.operatingProfit ? f.operatingProfit[last] : null;
  var margin = f.opMargin ? f.opMargin[last] : null;

  var bars = cols.map(function (c, idx) {
    var v = vals[idx];
    var h = v == null ? 0 : Math.max(3, Math.round(Math.abs(v) / max * 100));
    return '<div class="rv-col' + (idx === last ? ' on' : '') + (c.estimate ? ' est' : '') + (v == null ? ' none' : '') + '">'
      + '<div class="rv-bar-wrap">' + (v == null ? '' : '<i class="rv-bar" style="height:' + h + '%"></i>') + '</div>'
      + '<div class="rv-x">' + escapeHtml(c.title.slice(2)) + (c.estimate ? 'E' : '') + '</div>'
      + '</div>';
  }).join('');

  return '<section class="pf-card">' + pfCardHead('매출 추이', '최근 ' + cols.length + '분기')
    + '<div class="rv-top">'
    +   '<div class="rv-now">' + fmtEok(vals[last]) + '<span class="rv-q">' + escapeHtml(cols[last].title) + (cols[last].estimate ? ' 추정' : '') + '</span></div>'
    +   (yoy == null ? '' : '<div class="rv-yoy ' + signClass(yoy) + '">' + (yoy > 0 ? '+' : '') + yoy.toFixed(1) + '% YoY</div>')
    + '</div>'
    + '<div class="rv-chart">' + bars + '</div>'
    + (op == null ? '' : '<div class="pf-foot">영업이익 ' + fmtEok(op)
        + (margin == null ? '' : ' · 영업이익률 ' + margin + '%') + '</div>')
    + '<div class="pf-note">연결 기준 · 단위 원 · E 는 증권사 추정치</div>'
    + '</section>';
}

/** 투자의견 평균(1~5) → 사람이 읽는 말 */
function recommLabel(v) {
  if (v == null) return null;
  if (v >= 4.5) return { text: '적극 매수', cls: 'up' };
  if (v >= 3.5) return { text: '매수 우세', cls: 'up' };
  if (v >= 2.5) return { text: '중립', cls: 'flat' };
  if (v >= 1.5) return { text: '매도 우세', cls: 'down' };
  return { text: '적극 매도', cls: 'down' };
}

/*
 * 목표가 카드 — 컨센서스 "평균"만 보여준다.
 * 토스처럼 증권사별 목표가 목록을 붙이려면 소스가 없다 (2026-09-23 조사):
 *   - 네이버 API 는 priceTargetMean / recommMean 평균값만 준다
 *   - 네이버 리서치 상세 페이지에도 구조화된 목표주가가 없다 (PDF 본문에만)
 *   - 리포트 미리보기 텍스트 파싱은 80건 중 22건(28%)만 성공해 표로 쓸 수 없다
 *   - 증권사별 값이 있는 곳은 한경컨센서스뿐인데, 증권사 리서치 산출물을 재게시하는
 *     성격이라 쓰지 않기로 했다 (회원 결정, 2026-09-23)
 * 다시 조사하기 전에 이 주석을 볼 것.
 */
function targetCardHtml(p) {
  var c = p.consensus;
  if (!c || !c.targetMean) return '';
  var rec = recommLabel(c.recommMean);
  var gauge = c.recommMean == null ? '' :
      '<div class="tg-op">'
    +   '<div class="tg-op-row"><span class="pf-k">투자의견 평균</span>'
    +     '<span class="tg-op-v">' + c.recommMean.toFixed(2) + '<small> / 5</small>'
    +     (rec ? ' <b class="tg-badge ' + rec.cls + '">' + rec.text + '</b>' : '') + '</span></div>'
    +   '<div class="tg-gauge"><i style="width:' + Math.max(0, Math.min(100, (c.recommMean - 1) / 4 * 100)).toFixed(1) + '%"></i></div>'
    +   '<div class="tg-gauge-x"><span>매도</span><span>중립</span><span>매수</span></div>'
    + '</div>';

  return '<section class="pf-card">' + pfCardHead('목표가', '증권사 컨센서스')
    + gauge
    + '<div class="tg-main">'
    +   '<div class="tg-col"><div class="pf-k">평균 목표가</div><div class="tg-target">' + fmtNum(Math.round(c.targetMean)) + '</div></div>'
    +   '<div class="tg-col right"><div class="pf-k">현재가</div><div class="tg-now" id="tgNow">-</div></div>'
    + '</div>'
    + '<div class="tg-bar" id="tgBar"><i style="width:0%"></i><span class="tg-mark" style="left:0%"></span></div>'
    + '<div class="tg-gap" id="tgGap"></div>'
    + '<div class="pf-note">' + (c.date ? escapeHtml(c.date) + ' 기준 · ' : '')
    +   '증권사 추정치이며 실제 주가와 다를 수 있습니다</div>'
    + '</section>';
}

/**
 * 목표가 대비 현재가 — 시세가 움직일 때마다 다시 그린다.
 * 카드가 그려지기 전이거나 목표가가 없으면 아무 일도 하지 않는다.
 */
function syncTargetUpside() {
  var bar = document.getElementById('tgBar');
  if (!bar || _targetMean == null) return;
  var price = _lastQuote ? _lastQuote.price : null;
  var nowEl = document.getElementById('tgNow');
  var gapEl = document.getElementById('tgGap');
  if (price == null || !isFinite(price) || price <= 0) {
    if (nowEl) nowEl.textContent = '-';
    if (gapEl) gapEl.innerHTML = '';
    return;
  }
  if (nowEl) nowEl.textContent = fmtNum(price);

  var gap = (_targetMean - price) / price * 100;
  // 막대는 현재가와 목표가 중 큰 쪽을 100% 로 두고 작은 쪽의 비율만큼 채운다
  var lo = Math.min(price, _targetMean), hi = Math.max(price, _targetMean);
  bar.querySelector('i').style.width = (hi > 0 ? (lo / hi * 100).toFixed(1) : '0') + '%';
  bar.classList.toggle('over', _targetMean < price);
  if (gapEl) {
    gapEl.className = 'tg-gap ' + signClass(gap);
    gapEl.innerHTML = (gap >= 0 ? '상승 여력 <b>+' + gap.toFixed(1) + '%</b>'
                                : '현재가가 목표가를 <b>' + Math.abs(gap).toFixed(1) + '%</b> 웃돕니다');
  }
}

function summaryCardHtml(p) {
  if (!p.summary || !p.summary.length) return '';
  return '<section class="pf-card">' + pfCardHead('기업 개요', 'FnGuide')
    + '<ul class="pf-summary">'
    + p.summary.map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('')
    + '</ul></section>';
}

function researchCardHtml(p) {
  if (!p.researches || !p.researches.length) return '';
  return '<section class="pf-card">' + pfCardHead('최근 리포트', '네이버 증권')
    + p.researches.map(function (r) {
        return '<a class="rs-item" target="_blank" rel="noopener noreferrer"'
          + ' href="https://m.stock.naver.com/investment/research/company/' + encodeURIComponent(r.id) + '">'
          + '<div class="rs-title">' + escapeHtml(r.title) + '</div>'
          + '<div class="rs-meta">' + escapeHtml(r.broker) + (r.date ? ' · ' + escapeHtml(researchDate(r.date)) : '') + '</div>'
          + '</a>';
      }).join('')
    + '</section>';
}

/** "20260923" → "26.09.23" */
function researchDate(s) {
  var t = String(s || '');
  if (!/^\d{8}$/.test(t)) return t;
  return t.slice(2, 4) + '.' + t.slice(4, 6) + '.' + t.slice(6, 8);
}

/* ===== 종목 뉴스 ===== */
var _newsLoadedFor = null;
async function loadStockNews() {
  if (!curStock) return;
  var el = document.getElementById('ndNews');
  if (!el) return;
  if (_newsLoadedFor === curStock.code && el.innerHTML) return;
  el.innerHTML = '<div class="loading">뉴스 불러오는 중...</div>';
  try {
    var d = await Market.news(curStock.code);
    if (!d.items || !d.items.length) { el.innerHTML = '<div class="empty">관련 뉴스가 없습니다</div>'; return; }
    el.innerHTML = d.items.map(function (n) {
      return '<a class="news-item" href="' + escapeAttr(safeUrl(n.url)) + '" target="_blank" rel="noopener noreferrer">'
        + '<div class="news-title">' + escapeHtml(n.title) + '</div>'
        + '<div class="news-meta">' + escapeHtml(n.office || '') + ' · ' + newsTime(n.datetime) + '</div>'
        + '</a>';
    }).join('');
    _newsLoadedFor = curStock.code;
  } catch (e) {
    el.innerHTML = '<div class="empty">뉴스를 불러오지 못했습니다</div>';
  }
}


/* ===== 종목 공시 (KOSCOM — 네이버 종목 화면과 같은 것) =====
 * 네이버에는 공시 하나만 가리키는 웹 주소가 없다(상세 URL 이 종목 화면으로 302).
 * 그래서 링크로 내보내지 않고 목록에서 바로 펼친다. 본문은 워커가 텍스트로 바꿔 내려준다.
 */
var _discLoadedFor = null;
var newsMode = 'news';

function setNewsMode(m) {
  newsMode = m;
  document.querySelectorAll('[data-nd]').forEach(function (b) { b.classList.toggle('on', b.dataset.nd === m); });
  document.getElementById('ndNews').style.display = m === 'news' ? '' : 'none';
  document.getElementById('ndDisc').style.display = m === 'disc' ? '' : 'none';
  if (m === 'disc') loadDisclosures();
  else loadStockNews();
}

async function loadDisclosures() {
  if (!curStock) return;
  var el = document.getElementById('ndDisc');
  if (!el) return;
  if (_discLoadedFor === curStock.code && el.innerHTML) return;
  el.innerHTML = '<div class="loading">공시 불러오는 중...</div>';
  var code = curStock.code;
  try {
    var d = await Market.disclosure(code);
    if (!curStock || curStock.code !== code) return;
    el = document.getElementById('ndDisc');
    if (!el) return;
    if (!d.items || !d.items.length) { el.innerHTML = '<div class="empty">공시가 없습니다</div>'; return; }
    el.innerHTML = d.items.map(function (x) {
      return '<div class="dc-item">'
        + '<button class="dc-head" onclick="toggleDisclosure(\'' + escapeJsArg(x.id) + '\')" aria-expanded="false">'
        +   '<span class="dc-title">' + escapeHtml(x.title) + '</span>'
        +   '<span class="dc-meta">' + escapeHtml(discTime(x.datetime))
        +     (x.author ? ' · ' + escapeHtml(x.author) : '') + '</span>'
        +   '<span class="dc-caret" id="dcCaret-' + escapeAttr(x.id) + '">▾</span>'
        + '</button>'
        + '<div class="dc-body" id="dcBody-' + escapeAttr(x.id) + '" style="display:none"></div>'
        + '</div>';
    }).join('')
    + '<div class="dc-note">한국거래소·금융감독원 공시를 네이버를 통해 받아옵니다</div>';
    _discLoadedFor = code;
  } catch (e) {
    el = document.getElementById('ndDisc');
    if (el) el.innerHTML = '<div class="empty">공시를 불러오지 못했습니다</div>';
  }
}

/** 공시 펼치기 — 본문은 처음 펼칠 때 한 번만 받는다 */
async function toggleDisclosure(id) {
  if (!curStock) return;
  var body = document.getElementById('dcBody-' + id);
  var caret = document.getElementById('dcCaret-' + id);
  if (!body) return;
  var open = body.style.display !== 'none';
  if (open) {
    body.style.display = 'none';
    if (caret) caret.textContent = '▾';
    return;
  }
  body.style.display = '';
  if (caret) caret.textContent = '▴';
  if (body.dataset.loaded) return;

  body.innerHTML = '<div class="loading">본문 불러오는 중...</div>';
  var code = curStock.code;
  try {
    var d = await Market.disclosure(code, id);
    if (!curStock || curStock.code !== code) return;
    body = document.getElementById('dcBody-' + id);
    if (!body) return;
    var text = d.item && d.item.text;
    if (!text) { body.innerHTML = '<div class="empty">본문을 가져오지 못했습니다</div>'; return; }
    // 워커가 이미 태그를 걷어낸 텍스트를 준다 — 여기서 escape 만 하면 안전하다
    body.innerHTML = '<pre class="dc-text">' + escapeHtml(text) + '</pre>';
    body.dataset.loaded = '1';
  } catch (e) {
    body = document.getElementById('dcBody-' + id);
    if (body) body.innerHTML = '<div class="empty">본문을 가져오지 못했습니다</div>';
  }
}

/** "2026-08-21T06:52:22" → "08.21 06:52" */
function discTime(s) {
  var t = String(s || '');
  if (t.length < 16) return t;
  return t.slice(5, 7) + '.' + t.slice(8, 10) + ' ' + t.slice(11, 16);
}

/* ===== 유틸 ===== */
/** HTML 속성값용 — escapeHtml 은 따옴표를 건드리지 않으므로 여기서 막는다 */
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * onclick="fn('...')" 안의 JS 문자열 인자용.
 * 속성값은 브라우저가 먼저 HTML 디코드한 뒤 JS 로 읽으므로 &#39; 만으로는 문자열이 깨진다.
 * JS 이스케이프(\\ , \')를 먼저 하고 그 결과를 속성용으로 한 번 더 감싼다.
 */
function escapeJsArg(s) {
  return escapeAttr(String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' '));
}

/** 외부에서 받은 링크는 http(s) 만 허용 (javascript: 등 차단) */
function safeUrl(u) {
  return /^https?:\/\//i.test(String(u || '')) ? String(u) : '#';
}

/** 시세 기준 시각 — 기기 시간대와 무관하게 KST 로 표시한다 (해외에서 보면 시각이 어긋났다) */
function shortTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 16).replace('T', ' ');
  try {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
  } catch (e) {
    var k = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 9 * 3600000);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(k.getHours()) + ':' + p(k.getMinutes());
  }
}

function newsTime(s) {
  if (!s || String(s).length < 12) return '';
  var t = String(s);
  return t.slice(4, 6) + '.' + t.slice(6, 8) + ' ' + t.slice(8, 10) + ':' + t.slice(10, 12);
}
