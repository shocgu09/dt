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
var sparkCache = {};             // code -> { values, span('intraday'|'daily'), at }
var _homeScrollY = 0;            // 종목 상세로 들어가기 전 시세 홈 스크롤 위치
var _detailFrom = null;          // 상세를 열기 전 보던 탭 — 뒤로 가기로 닫으면 그 탭으로 돌아간다
var _backToHome = false;         // "← 시세" 로 닫는 중 (다른 탭에서 왔어도 시세 홈으로)

// 뒤로 가기 때 브라우저가 스크롤을 제멋대로 옮기지 않게 한다 — 시세 홈 위치는 직접 되돌린다
try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}

/** 종목·코인·미국 주식 상세를 보는 중인가 (시세 홈이 가려져 있는가) */
function detailOpen() {
  return !!curStock || !!(window.Coin && Coin.current()) || !!(window.Us && Us.current());
}

/* ===== 시세 탭 진입 ===== */
async function enterMarketTab() {
  // 종목 상세 보는 중이면 화면은 유지하되, 탭을 떠날 때 멈춘 폴링은 다시 돌린다
  if (curStock) { startStockPolling(); return; }
  if (window.Coin && Coin.current()) { Coin.startPolling(); return; }
  if (window.Us && Us.current()) { Us.startPolling(); return; }
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
  // 미국 주식 — 미국 장(프리~애프터) 중 10초, 그 밖에는 2분
  if (window.Us) Poller.add('usList', Us.loadList, Us.pollMs);
}

/* ===== 지수 스트립 ===== */
/* 가로 줄(윗줄 지수 · 아랫줄 칩) — 스크롤바를 숨겨 두어 마우스로는 옆으로 넘길 방법이 없었다 (트랙패드·터치만 됐다).
 *  - 휠: 세로 휠을 가로로 바꾼다. 끝까지 넘겼으면 페이지 스크롤로 돌려준다
 *  - 끌기: 마우스로 잡고 끌어서 넘긴다. 5px 넘게 끌었으면 놓을 때의 클릭(코인 칩 열기)은 무시한다
 * #indexStrip 은 뼈대를 다시 만들어도 남아 있으므로 거기에 한 번만 건다. */
(function initStripScroll() {
  var sel = '.idx-scroll, .idx-chips';
  function bind() {
    var strip = document.getElementById('indexStrip');
    if (!strip || strip.dataset.hs) return;
    strip.dataset.hs = '1';
    strip.addEventListener('wheel', function (e) {
      var el = e.target.closest && e.target.closest(sel);
      if (!el || el.scrollWidth <= el.clientWidth + 1) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;          // 트랙패드 가로 스와이프는 그대로
      var d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      var max = el.scrollWidth - el.clientWidth;
      if ((d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += d;
    }, { passive: false });
    var drag = null, moved = false;
    strip.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      var el = e.target.closest && e.target.closest(sel);
      if (!el || el.scrollWidth <= el.clientWidth + 1) return;
      drag = { el: el, x: e.clientX, left: el.scrollLeft };
      moved = false;
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (!moved && Math.abs(dx) > 5) { moved = true; drag.el.classList.add('dragging'); }
      if (moved) drag.el.scrollLeft = drag.left - dx;
    });
    window.addEventListener('pointerup', function () {
      if (!drag) return;
      drag.el.classList.remove('dragging');
      drag = null;
    });
    // 끌기가 끝나며 생기는 클릭은 삼킨다 (칩을 끌다 놓았는데 코인 상세가 열리지 않게)
    strip.addEventListener('click', function (e) {
      if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();

// 세 묶음 — 1행에 국내·미국 지수(큰 칸), 2행에 기타 지표(한 줄 칩). 워커가 내려준 것만 그린다.
// 미국 쪽 선물은 CME 라 국내 장중에도 돌아가서 "지금 미국이 어디로 가는지"를 보여준다.
// VIX 는 지수라기보다 공포지수라 기타로 둔다.
// 코스피200 야간선물은 미국 장 시간(18:00~05:00)에 돌아서 미국 묶음 맨 앞에 둔다 — 밤에 미국이 앞으로 오면
// 국내 묶음 뒤(마감된 코스피·코스닥 뒤)로 밀려 스크롤해야 보였고, '국내 장 마감' 배지 아래 있어 멈춘 것처럼 읽혔다.
var INDEX_GROUPS = [
  { id: 'kr', label: '국내', keys: ['kospi', 'kosdaq', 'kpi200', 'fut', 'kq150'] },
  { id: 'us', label: '미국', note: '야간선물 포함', keys: ['nightfut', 'nasdaq', 'sp500', 'dow', 'sox'] },
  { id: 'etc', label: '기타', note: '아랫줄', keys: ['usd', 'vix', 'gold', 'oil', 'us10y', 'kr10y', 'kr3y', 'btc', 'eth'] }
];
var INDEX_KEYS = [].concat.apply([], INDEX_GROUPS.map(function (g) { return g.keys; }));
var INDEX_GROUP_OF = {};
INDEX_GROUPS.forEach(function (g) { g.keys.forEach(function (k) { INDEX_GROUP_OF[k] = g.id; }); });
// 누르면 코인 상세로 가는 칸 (업비트 원화 마켓)
var COIN_CELL = { btc: 'KRW-BTC', eth: 'KRW-ETH' };

// 국장이 닫힌 뒤에도 계속 움직이는 항목 (CME 선물·미국 지표).
// 원/달러는 하나은행 고시라, 한국 국채는 국내 장이라 밤에는 멈춘다 — 여기 넣지 않는다.
var NIGHT_LIVE = { nightfut: 1, nasdaq: 1, sp500: 1, dow: 1, vix: 1, sox: 1, gold: 1, oil: 1, us10y: 1, btc: 1, eth: 1 };

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
  kospi: 'kr', kosdaq: 'kr', kpi200: 'kr', fut: 'kr', nightfut: 'kr', kq150: 'kr', kr10y: 'kr', kr3y: 'kr',
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

// 처음 보는 회원의 기본 구성 — 회원이 ⚙ 체크리스트로 바꾸면 그 기기에 저장된 목록을 쓴다
var INDEX_DEFAULT = [
  'kospi', 'kosdaq', 'fut',                              // 국내
  'nightfut', 'nasdaq', 'sox',                           // 미국 (야간선물 포함)
  'usd', 'gold', 'oil', 'us10y', 'kr10y', 'kr3y'         // 기타 (아랫줄)
];
var INDEX_PICK_KEY = 'dt-invest-index-pick';
var NIGHTFUT_ADDED_KEY = 'dt-invest-index-nightfut';
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
  // 야간선물은 나중에 생긴 항목이다 — 이미 고른 목록이 저장된 회원에게도 한 번은 켜서 보여 준다 (끄면 그대로 둔다)
  try {
    if (!localStorage.getItem(NIGHTFUT_ADDED_KEY)) {
      if (_indexPick.indexOf('nightfut') === -1) {
        var at = _indexPick.indexOf('fut');
        _indexPick.splice(at === -1 ? _indexPick.length : at + 1, 0, 'nightfut');
        localStorage.setItem(INDEX_PICK_KEY, JSON.stringify(_indexPick));
      }
      localStorage.setItem(NIGHTFUT_ADDED_KEY, '1');
    }
  } catch (e) { /* 무시 */ }
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
  // 스트립과 같은 묶음으로 보여 준다 — 국내·미국은 윗줄, 기타는 아랫줄
  box.innerHTML = '<div class="ix-pick-head">스트립에 보여 줄 항목</div>'
    + INDEX_GROUPS.map(function (g) {
        return '<div class="ix-pick-group">'
          + '<div class="ix-pick-glabel">' + g.label + (g.note ? ' <span>' + g.note + '</span>' : '') + '</div>'
          + '<div class="ix-pick-list">' + g.keys.map(function (k) {
              var on = pick.indexOf(k) !== -1;
              return '<button class="ix-pick' + (on ? ' on' : '') + '" onclick="toggleIndexKey(\'' + k + '\')" aria-pressed="' + on + '">'
                + '<span class="ix-pick-box">' + (on ? '✓' : '') + '</span>'
                + indexIconHtml(k) + escapeHtml(INDEX_LABEL[k] || k) + '</button>';
            }).join('') + '</div>'
          + '</div>';
      }).join('');
}

// 네이버 이름이 길어 좁은 셀에서 두 줄이 된다 ("나스닥 100 선물")
var INDEX_NAME = { nightfut: '야간선물', nasdaq: '나스닥 선물', sp500: 'S&P 선물', dow: '다우 선물', sox: '필라델피아 반도체' };
// 체크리스트용 이름 (셀 이름은 네이버 값을 쓰지만 목록에서는 항상 같은 말로 보인다)
var INDEX_LABEL = {
  kospi: '코스피', kosdaq: '코스닥', kpi200: '코스피 200', fut: '코스피 200 선물', nightfut: '코스피 200 야간선물', kq150: '코스닥 150',
  usd: '원/달러 환율', nasdaq: '나스닥 선물', sp500: 'S&P 선물', dow: '다우 선물',
  vix: 'VIX (공포지수)', sox: '필라델피아 반도체', gold: '금', oil: 'WTI 유가',
  us10y: '미국 국채 10년', kr10y: '한국 국채 10년', kr3y: '한국 국채 3년',
  btc: '비트코인', eth: '이더리움'
};
// 아랫줄 칩은 한 줄에 이름·값·등락이 다 들어가야 해서 더 짧게 쓴다
var CHIP_NAME = {
  usd: '원/달러', vix: 'VIX', gold: '금', oil: 'WTI', us10y: '미국 10년', kr10y: '한국 10년', kr3y: '한국 3년',
  btc: '비트코인', eth: '이더리움'
};

/* 미국 장 상태 — 워커가 네이버 QQQ 의 장 상태를 usMarket 으로 실어 준다 (휴장일까지 네이버 값 그대로) */
var _usMarket = null;
function etParts() {
  var p = {};
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
  } catch (e) { return null; }
  return { wd: p.weekday, hm: Number(p.hour) * 60 + Number(p.minute) };
}
/** 국내 배지와 같은 말을 쓴다 — 닫혀 있을 때는 휴장 / 장 시작 전 / 장 마감 으로 가른다 */
function usStateLabel() {
  var u = _usMarket;
  if (!u) return null;
  if (u.status === 'OPEN') return { cls: 'live', text: '정규장' };
  if (u.session === 'pre') return { cls: 'live', text: '프리마켓' };
  if (u.session === 'after') return { cls: 'live', text: '애프터마켓' };
  if (u.session) return { cls: 'live', text: '장외거래' };
  var et = etParts();
  if (!et) return { cls: 'closed', text: '장 마감' };
  if (et.wd === 'Sat' || et.wd === 'Sun') return { cls: 'closed', text: '휴장' };
  if (et.hm >= 570 && et.hm < 960) return { cls: 'closed', text: '휴장' };     // 평일 정규장 시간인데 닫혀 있다 = 미국 휴장일
  if (et.hm < 570) return { cls: 'closed', text: '장 시작 전' };
  return { cls: 'closed', text: '장 마감' };
}
/** 윗줄 순서 — 미국이 열려 있고 국장 정규장(09:00~15:30)이 아니면 미국을 앞에 둔다 */
function usLeads() {
  var u = usStateLabel();
  if (!u || u.cls !== 'live') return false;
  var k = kstParts();
  return !(isTradingDayKst() && k.hm >= 9 * 60 && k.hm < 15 * 60 + 30);
}
/** 줄 머리 배지가 이미 닫힘을 알리는 묶음인가 — 그러면 칸마다 '마감'을 또 달지 않는다 */
function groupClosed(g) {
  if (g === 'kr') return marketStateLabel().cls === 'closed';
  if (g === 'us') { var u = usStateLabel(); return !!u && u.cls === 'closed'; }
  return false;
}
// 스트립 오른쪽 위 ! — 칸마다 달면 복잡해서 박스 하나에 모아 둔다
var INDEX_TIP = [
  '· 10분 · 15분: 거래소 규정으로 그만큼 늦은 시세입니다. 해외 선물·금·유가는 10분, VIX 는 15분 전 값입니다.',
  '· 마감: 그 시장이 쉬는 중이라 마지막 값을 보여 줍니다.',
  '· 국내 · 미국 배지: 각 시장이 지금 열려 있는지 알려 줍니다. 밤에 미국 장이 열리면 미국 묶음이 앞으로 옵니다.',
  '· 야간선물은 18:00~05:00 에 열리는 코스피200 선물입니다.',
  '· ⚙ 에서 보여 줄 항목을 고를 수 있습니다.'
].join('\n');

/** 지금은 보여 줄 값이 없는 칸 — 야간선물은 개장 전(그날 야간장이 아직 안 열림)이면 '-' 뿐이라 칸을 뺀다 */
function hiddenIndexCell(k, x) {
  return k === 'nightfut' && (x.state === 'pre' || x.price == null);
}
/** 칸 꼬리표 — '10분 지연' 은 칸 안에서 '10분' 으로 줄인다 (전체 말은 title 로 남긴다) */
function shortIndexTag(t) { return String(t || '').replace(/분 지연$/, '분'); }

async function loadIndex() {
  var el = document.getElementById('indexStrip');
  if (!el) return;
  try {
    var d = await Market.index();
    if (d.marketStatus) setMarketStatus(d.marketStatus);   // 워커가 대표 종목 기준으로 실어 준다
    setHolidays(d.holidays);                              // 휴장일도 워커 목록을 쓴다 (D1 단일 출처)
    if (d.usMarket) _usMarket = d.usMarket;

    // 뼈대는 구성이 바뀔 때만 다시 만들고 평소엔 값만 갈아끼운다 (플래시 애니메이션 유지)
    var pick = indexPick();
    var have = INDEX_KEYS.filter(function (k) { return d[k] && pick.indexOf(k) !== -1 && !hiddenIndexCell(k, d[k]); });
    // 윗줄: 지금 움직이는 쪽을 앞에 — 한국 낮에는 국내, 미국 장중(밤)에는 미국
    var order = usLeads() ? ['us', 'kr'] : ['kr', 'us'];
    var top = [], chips = [];
    order.forEach(function (g) {
      have.forEach(function (k) { if (INDEX_GROUP_OF[k] === g) top.push(k); });
    });
    have.forEach(function (k) { if (INDEX_GROUP_OF[k] === 'etc') chips.push(k); });
    var built = top.join(',') + '|' + chips.join(',');
    if (el.dataset.built !== built) {
      var tagSpan = function (k, x) {
        // 해외 칸은 워커가 tag('마감' / 'N분 지연')를 실어 준다 — 없으면 고정 지연 분만 쓴다
        if (x.tag !== undefined) return '<span class="idx-delay" id="ixt-' + k + '"></span>';
        return x.delayMin ? '<span class="idx-delay" title="' + x.delayMin + '분 지연 시세">' + x.delayMin + '분</span>' : '';
      };
      var coinAttrs = function (k) {
        var coinM = COIN_CELL[k];
        return coinM ? ' role="button" tabindex="0" onclick="Coin.open(\'' + coinM + '\',\'' + escapeJsArg(INDEX_LABEL[k]) + '\')"'
          + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click()}"' : '';
      };
      // 줄 머리: 윗줄 순서대로 국내·미국 장 상태, 오른쪽 끝에 항목 고르기
      var heads = order.filter(function (g) { return top.some(function (k) { return INDEX_GROUP_OF[k] === g; }); });
      InfoTip.hide();          // 뼈대를 갈아 끼우면 열려 있던 설명의 기준 칸이 사라진다
      el.innerHTML = '<div class="idx-head">'
        + heads.map(function (g) { return '<div class="idx-state" id="' + (g === 'kr' ? 'ixState' : 'ixStateUs') + '"></div>'; }).join('')
        + InfoTip.btn('지수·선물 시세 안내', INDEX_TIP)
        + '<button class="ix-gear" onclick="toggleIndexPanel()" aria-label="표시 항목 고르기">⚙</button>'
        + '</div>'
        + (top.length ? '<div class="idx-scroll">' + top.map(function (k, i) {
            var x = d[k];
            // 국내와 미국 사이에 선을 하나 둬서 다른 묶음임을 보인다
            var first = i > 0 && INDEX_GROUP_OF[top[i - 1]] !== INDEX_GROUP_OF[k];
            return '<div class="idx-cell' + (first ? ' grp-first' : '') + '" data-grp="' + INDEX_GROUP_OF[k] + '">'
              + '<div class="idx-name">' + indexIconHtml(k) + escapeHtml(INDEX_NAME[k] || x.name) + tagSpan(k, x) + '</div>'
              + '<div class="idx-price" id="ixp-' + k + '"></div>'
              + '<div class="idx-chg" id="ixc-' + k + '"></div>'
              + '<div class="idx-spark" id="ixs-' + k + '"></div>'
              + '</div>';
          }).join('') + '</div>' : '')
        + (chips.length ? '<div class="idx-chips">' + chips.map(function (k) {
            var x = d[k];
            return '<div class="idx-chip' + (COIN_CELL[k] ? ' coin' : '') + '"' + coinAttrs(k) + '>'
              + indexIconHtml(k)
              + '<span class="idx-cname">' + escapeHtml(CHIP_NAME[k] || INDEX_LABEL[k] || x.name) + '</span>'
              + '<span class="idx-cprice" id="ixp-' + k + '" data-chip="1"></span>'
              + '<span class="idx-cchg" id="ixc-' + k + '"></span>'
              + tagSpan(k, x)
              + '</div>';
          }).join('') + '</div>' : '')
        + '<div class="ix-panel" id="ixPanel" style="display:none"></div>';
      el.dataset.built = built;
      renderIndexPanel();
    }

    have.forEach(function (k) { paintIndexCell(k, d[k]); });

    paintIndexSparks(top, d);
    paintStateBadges();
  } catch (e) {
    if (!el.dataset.built) el.innerHTML = '<div class="idx-err">지수를 불러오지 못했습니다</div>';
    paintStateBadges();          // 실패가 이어지면 '실시간' 대신 '연결 끊김'으로 바꾼다
  }
}

/** 지수 스트립 한 칸(또는 아랫줄 칩)의 값·등락. 코인 목록(5초)도 비트코인·이더리움 칸을 이걸로 칠해, 15~30초 도는 스트립과 목록이 어긋나지 않게 한다 */
function paintIndexCell(k, x) {
  var pEl = document.getElementById('ixp-' + k);
  var cEl = document.getElementById('ixc-' + k);
  if (!x || !pEl || !cEl) return;
  var chip = !!pEl.dataset.chip;
  var cls = signClass(x.change);
  // 지수는 소수 둘째 자리까지, 국채 금리는 셋째 자리까지 (4.955%). 단위는 항목이 알려 준다.
  var dg = x.decimals == null ? 2 : x.decimals;
  var pTxt = x.price == null ? '-'
    : Number(x.price).toLocaleString('ko-KR', { minimumFractionDigits: dg, maximumFractionDigits: dg })
      + (x.unit || '');
  setTextFlash(pEl, pTxt, dirOf('ix:' + k, x.price));
  pEl.className = (chip ? 'idx-cprice ' : 'idx-price ') + cls;
  // 값이 없는 칸(야간장 개장 전)은 등락 줄을 비운다 — "– -" 가 남지 않게
  // 금리(단위 %)는 등락률로 쓰면 '▲ +3.06%'가 금리 3%p 상승처럼 읽힌다 — 변화폭을 %p 로 쓴다
  // 칩은 폭이 좁아 화살표를 빼고 색으로만 방향을 보인다
  var mark = chip ? '' : signMark(x.change) + ' ';
  cEl.textContent = x.price == null ? ''
    : (x.unit === '%' && x.change != null
        ? mark + (x.change > 0 ? '+' : '') + Number(x.change).toFixed(dg) + '%p'
        : mark + fmtRate(x.changeRate));
  cEl.className = (chip ? 'idx-cchg ' : 'idx-chg ') + cls;
  var tEl = document.getElementById('ixt-' + k);
  if (tEl) {
    var t = x.tag || '';
    // 줄 머리가 이미 '장 마감'이면 윗줄 칸마다 '마감'을 또 달지 않는다
    if (t === '마감' && !chip && groupClosed(INDEX_GROUP_OF[k])) t = '';
    tEl.textContent = shortIndexTag(t);
    tEl.title = /분 지연$/.test(t) ? t + ' 시세' : '';
  }
}

/**
 * 장 상태 배지 (지수 스트립 · 종목 상세 기준 시각 옆).
 * 요청이 연달아 실패하거나 오프라인이면 '연결 끊김' — 숫자가 멈춰 있는데 '실시간'이라고 쓰지 않는다.
 */
function paintStateBadges() {
  var st = marketStateLabel();
  var hs = _listQuotesTried ? marketStateLabel('quotes') : st;     // 시세 홈은 관심·랭킹 목록 시세까지 본다
  var sEl = document.getElementById('ixState');
  // 이 배지는 국장 기준이다. 옆의 나스닥 선물·금·유가는 국장이 닫혀 있어도 돌아간다.
  if (sEl) { sEl.textContent = hs.cls === 'stale' ? hs.text : '국내 ' + hs.text; sEl.className = 'idx-state ' + hs.cls; }
  // 미국 배지 — 연결이 끊겼으면 국내 배지 하나로 알리고 이건 비운다
  var uEl = document.getElementById('ixStateUs');
  if (uEl) {
    var us = hs.cls === 'stale' ? null : usStateLabel();
    uEl.textContent = us ? '미국 ' + us.text : '';
    uEl.className = 'idx-state ' + (us ? us.cls : '');
  }
  // 상세에 대체 출처(다음·야후) 값이 떠 있으면 '지연 가능'을 지킨다 — 요청이 한 번 실패해 다시 칠할 때 '실시간'으로 바뀌었다
  var alt = _lastQuote && _lastQuote.source && _lastQuote.source !== 'naver';
  var ds = alt && st.cls === 'live' ? { cls: 'closed', text: '지연 가능' } : st;
  document.querySelectorAll('#pxAsOf .state-dot').forEach(function (d) {
    d.textContent = ds.text;
    d.className = 'state-dot ' + ds.cls;
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
/**
 * 국내(종목 마스터 + 서버 자동완성) · 코인(업비트 목록, 화면에서 찾음) · 미국(서버 자동완성)을 한 목록으로.
 * 코인·미국은 국내 검색을 기다리지 않고 바로 그린다 — 예전에는 국내 서버 검색이 끝나야(최대 6초) 그려서
 * '비트코인'·'AAPL' 처럼 마스터에 없는 말은 한참 '검색 중'이었고, 국내 검색이 실패하면 코인 결과까지 사라졌다.
 */
async function doSearch(q) {
  var box = document.getElementById('searchResults');
  var seq = ++_searchSeq;             // 느린 이전 검색 응답이 최신 입력의 결과를 덮지 않게
  box.style.display = '';
  box.innerHTML = '<div class="sr-empty">검색 중...</div>';
  box.setAttribute('aria-busy', 'true');
  var lastD = null, krDone = false, krErr = null;
  var paint = function (d) {
    if (seq !== _searchSeq) return;
    if (d) lastD = d;
    var items = ((lastD && lastD.items) || []).filter(function (i) { return isStockCode(i.code); });
    // 코인: 심볼·이름이 딱 맞는 것만 맨 위, 나머지는 국내 종목 아래
    var coin = window.Coin ? (Coin.searchParts ? Coin.searchParts(q) : { top: Coin.searchHtml(q), rest: '' }) : { top: '', rest: '' };
    // 미국 주식은 서버 자동완성을 따로 받는다 — 티커가 딱 맞으면 위, 아니면 아래
    var usHtml = window.Us ? Us.searchHtml(q) : '';
    var usFirst = !!usHtml && Us.exactMatch(q);
    if (!items.length && !coin.top && !coin.rest && !usHtml) {
      box.innerHTML = '<div class="sr-empty">' + (krErr ? escapeHtml(krErr) : (krDone ? '검색 결과가 없습니다' : '검색 중...')) + '</div>';
      return;
    }
    box.innerHTML = coin.top + (usFirst ? usHtml : '') + items.map(function (i) {
      return '<button class="sr-item" role="option" onclick="openStock(\'' + i.code + '\',\'' + escapeJsArg(i.name) + '\')">'
        + stockLogoHtml(i.code, i.name, null, 'sm')
        + '<span class="sr-name">' + escapeHtml(i.name) + '</span>'
        + '<span class="sr-meta">' + escapeHtml(i.market || '') + ' · ' + i.code + '</span>'
        + '</button>';
    }).join('') + coin.rest + (usFirst ? '' : usHtml)
      + (krDone ? '' : '<div class="sr-empty sr-more">국내 종목 찾는 중...</div>');
  };
  // 코인 목록이 아직 없으면(첫 검색) 받아지는 대로, 미국 결과는 도착하는 대로 다시 그린다
  if (window.Coin && Coin.ensureInfos) Coin.ensureInfos().then(function () { paint(null); });
  if (window.Us) Us.fetchSearch(q).then(function (changed) { if (changed) paint(null); });
  paint(null);
  try {
    // 마스터 결과는 즉시, 서버 보강 결과는 도착하면 다시 그린다
    var d = await Market.search(q, function (u) { paint(u); });
    krDone = true;
    paint(d);
  } catch (e) {
    krDone = true;
    krErr = e.message;               // 국내 검색만 실패 — 코인·미국 결과가 있으면 그대로 보여 준다
    paint(null);
  } finally {
    if (seq === _searchSeq) box.removeAttribute('aria-busy');
  }
}

function clearSearch() {
  // 250ms 입력 대기 중이거나 도착 전인 검색이 비운 뒤에 목록을 다시 열지 않게 끊는다
  clearTimeout(searchTimer);
  _searchSeq++;
  var input = document.getElementById('stockSearch');
  input.value = '';
  var box = document.getElementById('searchResults');
  box.innerHTML = ''; box.style.display = 'none';
  // 지운 뒤 바로 다시 칠 수 있게 입력칸으로 돌려놓는다 (✕ 버튼은 비면 사라져 포커스가 허공에 남았다)
  input.focus();
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
    sparkCache[code] = { values: vals, span: d.span || 'intraday', at: Date.now() };
    return vals;
  } catch (e) {
    sparkCache[code] = { values: [], span: '', at: Date.now() };
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
  watchlist.concat(wgCodes(), _rankCodes, _sectorCodes, _crowdCodes).forEach(function (c) {
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
  var now = Date.now(), first = null, open = false;
  got.forEach(function (d) {
    ((d && d.items) || []).forEach(function (q) {
      if (!q || !isStockCode(q.code)) return;
      q._at = now;
      _quoteMap[q.code] = q;
      if (!first) first = q;
      // NXT 세션 중인 종목이 하나라도 있으면 열림 — 지수·종목 상세와 같은 규칙 (첫 종목이 NXT 비대상 ETF 여도 뒤집히지 않게)
      if (q.session || q.marketStatus === 'OPEN') open = true;
    });
  });
  if (first) setMarketStatus(open ? 'OPEN' : first.marketStatus);
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
      paintStateBadges();          // 목록 시세가 연달아 실패하면 홈 배지를 '연결 끊김'으로
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

  renderWatchGroups();
  var grp = wgCurrent();
  var codes = wgCodes();
  if (!codes.length) {
    el.dataset.built = ''; el.dataset.key = '';
    el.className = '';
    el.innerHTML = grp
      ? '<div class="empty">' + escapeHtml(grp.name) + ' 그룹에 담긴 종목이 없습니다.<br>종목 상세나 목록의 ♡ 를 눌러 이 그룹에 담을 수 있습니다.</div>'
      : '<div class="empty">국내 관심종목이 없습니다.<br>종목 상세에서 ♡ 를 누르면 여기에 모입니다.'
        + ((coinWatchlist.length || usWatchlist.length) ? '<br><span class="cn-empty-sub">관심 코인·미국 주식은 아래 각 목록의 \'관심\'에서 볼 수 있습니다</span>' : '') + '</div>';
    return;
  }
  var rows = codes.map(function (c) { return _quoteMap[c]; }).filter(function (q) { return q && isStockCode(q.code); });
  if (!rows.length) {
    if (!el.dataset.built && _listQuotesTried) el.innerHTML = '<div class="empty">시세를 불러오지 못했습니다</div>';
    return;
  }

  var key = watchView + '|' + _wgSel + '|' + rows.map(function (q) { return q.code; }).join(',');
  if (el.dataset.key !== key) {
    el.className = watchView === 'card' ? 'watch-cards' : '';
    el.innerHTML = rows.map(function (q) {
      var open = 'openStock(\'' + q.code + '\',\'' + escapeJsArg(q.name) + '\')';
      // 하트 — 그룹이 있으면 관심 그룹 창을 연다. 랭킹에도 같은 종목의 하트가 있어 id 대신 data-fav 로 찾는다
      var fav = '<button class="fav-btn on" data-fav="' + q.code + '"'
              + ' onclick="onFavToggle(\'' + q.code + '\')" aria-label="관심종목">♥</button>';

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
        // 선 데이터는 1분 캐시라 옆의 현재가(5초)보다 1~2분 늦다 — 당일 분봉 선이면 끝점을 현재가로 바꿔 끼워 숫자와 맞춘다.
        // 장 시작 전 일봉 선(끝점이 어제 종가)에는 끼우지 않는다 — 모양이 틀어진다
        var hit = sparkCache[q.code];
        var live = hit && hit.span === 'intraday' && vals.length > 1 && q.price != null;
        if (live) { vals = vals.slice(); vals[vals.length - 1] = q.price; }
        // 5초마다 SVG 를 통째로 새로 만들지 않는다 — 선 데이터·끝점(현재가)·색이 바뀔 때만 다시 그린다
        var sk = (hit ? hit.at : 0) + ':' + (live ? q.price : '') + ':' + (q.change >= 0 ? 'u' : 'd');
        if (cur.dataset.sk === sk) return;
        cur.dataset.sk = sk;
        cur.innerHTML = sparklineSvg(vals, q.change >= 0);
      });
    }
  });
}

/* ===== 관심종목 그룹 =====
 * 기본(codes) + 회원이 만든 그룹(최대 10개). 그룹마다 따로 담고, 한 종목이 여러 그룹에 들어갈 수 있다.
 * 그룹이 하나라도 있으면 ♥ 를 눌렀을 때 '관심 그룹' 창에서 체크박스로 담고 뺀다 (없으면 예전처럼 기본에 바로).
 * 저장은 market.js (Firestore stock_watchlist.groups). 고른 그룹 탭은 이 기기에 기억한다.
 */
var _wgSel = null;
function wgKey() { return 'dt-invest-wgroup:' + (currentUser ? currentUser.uid : ''); }
function wgCurrent() {
  if (_wgSel === null) { try { _wgSel = localStorage.getItem(wgKey()) || 'all'; } catch (e) { _wgSel = 'all'; } }
  if (_wgSel === 'all') return null;
  var g = watchGroups.filter(function (x) { return x.id === _wgSel; })[0];
  if (!g) _wgSel = 'all';
  return g || null;
}
function wgCodes() { var g = wgCurrent(); return g ? g.codes : watchlist; }
/** 탭·창에 보일 순서 — 기본은 basePos 자리에 끼운다 */
function wgOrdered() {
  var list = watchGroups.map(function (g) { return { id: g.id, name: g.name, codes: g.codes }; });
  list.splice(Math.min(watchBasePos, list.length), 0, { id: 'all', name: watchBaseName, codes: watchlist, base: true });
  return list;
}

function renderWatchGroups() {
  var el = document.getElementById('watchGroups');
  if (!el) return;
  wgCurrent();
  var sig = _wgSel + '|' + watchlist.length + '|' + watchBasePos + '|' + watchBaseName + '|' + JSON.stringify(watchGroups);
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  var chip = function (id, name, n) {
    var on = _wgSel === id;
    return '<button type="button" class="wg-chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" onclick="selectWatchGroup(\'' + id + '\')">'
      + escapeHtml(name) + '<em>' + n + '</em></button>';
  };
  el.innerHTML = '<div class="wg-chips" role="group" aria-label="관심종목 그룹">'
    + wgOrdered().map(function (g) { return chip(g.id, g.name, g.codes.length); }).join('')
    + (watchGroups.length < WG_MAX ? '<button type="button" class="wg-chip add" onclick="openWatchGroupNew()">+ 그룹 추가</button>' : '')
    + '</div>'
    + (watchGroups.length ? '<button type="button" class="wg-edit" onclick="openWatchGroupEdit()">그룹 편집</button>' : '');
}

function selectWatchGroup(id) {
  _wgSel = id === 'all' || watchGroups.some(function (g) { return g.id === id; }) ? id : 'all';
  try { localStorage.setItem(wgKey(), _wgSel); } catch (e) {}
  var el = document.getElementById('watchList');
  if (el) { el.dataset.key = ''; el.dataset.built = ''; }
  paintWatch();
  if (wgCodes().some(function (c) { return !freshQuote(c); })) refreshListQuotes();
}

/** 관심 상태가 바뀐 뒤 — 하트들과 관심종목 섹션을 맞춘다 */
function afterWatchChange(code) {
  syncFavButtons(code, isWatched(code));
  var wl = document.getElementById('watchList');
  if (wl) wl.dataset.key = '';
  if (!detailOpen() && currentTab === 'market') {
    paintWatch();
    if (!freshQuote(code)) refreshListQuotes();
  }
}

/* ── 창 (관심 그룹 · 그룹 추가 · 그룹 편집) ── */
function wgSheet(title, inner, sub) {
  var el = document.getElementById('wgSheet');
  if (!el) { el = document.createElement('div'); el.id = 'wgSheet'; el.className = 'wg-sheet-wrap'; document.body.appendChild(el); }
  el.innerHTML = '<div class="wg-dim" onclick="closeWgSheet()"></div>'
    + '<div class="wg-sheet" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '">'
    + '<div class="wg-sheet-head"><b>' + escapeHtml(title) + '</b><button type="button" class="mini-btn" onclick="closeWgSheet()" aria-label="닫기">✕</button></div>'
    + (sub ? '<div class="wg-hint">' + sub + '</div>' : '')
    + inner + '<div class="wg-msg" id="wgMsg" role="alert"></div></div>';
  document.body.classList.add('wg-noscroll');
}
function wgFocus(sel) { var f = document.querySelector('#wgSheet ' + sel); if (f) try { f.focus({ preventScroll: true }); } catch (e) {} }
function closeWgSheet() {
  var el = document.getElementById('wgSheet');
  if (el) el.remove();
  document.body.classList.remove('wg-noscroll');
  _wgEd = null; _favSheet = null;
}
function wgMsg(t) { var m = document.getElementById('wgMsg'); if (m) m.textContent = t || ''; }

/* 관심 그룹 창 — ♥ 를 누르면. 체크박스를 누르는 즉시 저장한다 */
var _favSheet = null;          // { code, name, busy }
function openFavSheet(code, name) {
  _favSheet = { code: code, name: name || (_quoteMap[code] && _quoteMap[code].name) || code, busy: false };
  renderFavSheet();
}
function renderFavSheet() {
  var st = _favSheet;
  if (!st) return;
  var row = function (id, label, n, on) {
    return '<label class="wg-fav-row"><input type="checkbox"' + (on ? ' checked' : '') + (st.busy ? ' disabled' : '')
      + ' onchange="onFavGroup(\'' + id + '\', this.checked)"><span>' + escapeHtml(label) + '</span><em>' + n + '개</em></label>';
  };
  var inner = '<div class="wg-fav-list">'
    + wgOrdered().map(function (g) { return row(g.id, g.name, g.codes.length, g.codes.indexOf(st.code) !== -1); }).join('')
    + '</div>';
  if (watchGroups.length < WG_MAX) {
    inner += '<button type="button" class="wg-add-btn" onclick="openWgPage({ mode: \'add\', code: _favSheet.code })">+ 새 그룹 추가</button>';
  }
  wgSheet('관심 그룹', inner, escapeHtml(st.name) + ' — 체크박스를 눌러 관심 그룹에 넣거나 뺄 수 있습니다.');
}
async function onFavGroup(groupId, on) {
  var st = _favSheet;
  if (!st || st.busy) return;
  st.busy = true;
  try {
    await setWatchIn(groupId, st.code, on);
    afterWatchChange(st.code);
  } catch (e) { alert(e && e.message ? e.message : '관심종목 저장에 실패했습니다.'); }
  st.busy = false;
  if (_favSheet === st) renderFavSheet();
}
/* ── 그룹 이름 페이지 (추가 · 이름 변경) ──
 * 아래에서 올라오는 창 안의 입력칸은 폰에서 키보드와 겹치고, iOS 는 16px 보다 작은 입력칸을 누르면 화면을 확대해
 * 창이 잘려 보였다 → 이름 입력은 전체 화면 페이지에서 한다. [추가] 버튼은 키보드 바로 위에 붙는다(visualViewport).
 * opts: { mode: 'add' | 'rename', id (rename), code (add — 만들면서 이 종목을 담는다) }
 */
var _wgPage = null;
function openWatchGroupNew() { openWgPage({ mode: 'add' }); }
function openWgPage(opts) {
  var rename = opts.mode === 'rename';
  var g = rename ? (opts.id === 'all' ? { id: 'all', name: watchBaseName } : watchGroups.filter(function (x) { return x.id === opts.id; })[0]) : null;
  if (rename && !g) return;
  if (!rename && watchGroups.length >= WG_MAX) { alert('그룹은 ' + WG_MAX + '개까지 만들 수 있습니다'); return; }
  _wgPage = { mode: rename ? 'rename' : 'add', id: g ? g.id : null, code: opts.code || null, busy: false };
  var title = rename ? '그룹 이름 변경' : '새 그룹 추가';
  var el = document.getElementById('wgPage');
  if (!el) { el = document.createElement('div'); el.id = 'wgPage'; el.className = 'wg-page'; document.body.appendChild(el); }
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', title);
  el.innerHTML = '<div class="wg-page-head"><button type="button" class="wg-back" onclick="closeWgPage()" aria-label="뒤로">‹</button><b>' + title + '</b></div>'
    + '<label class="wg-page-lbl" for="wgPageInput">' + (rename ? '바꿀 그룹 이름을 입력하세요' : '새 그룹 이름을 입력하세요') + '</label>'
    + '<input type="text" class="wg-page-input" id="wgPageInput" maxlength="' + WG_NAME_MAX + '" placeholder="그룹 이름 입력" autocomplete="off"'
    + ' value="' + (g ? escapeHtml(g.name) : '') + '" oninput="wgPageInput()" onkeydown="if(event.key===\'Enter\'){event.preventDefault();wgPageSave()}">'
    + '<div class="wg-page-cnt" id="wgPageCnt"></div>'
    + '<div class="wg-msg" id="wgPageMsg" role="alert"></div>'
    + '<button type="button" class="btn-submit wg-page-go" id="wgPageGo" onclick="wgPageSave()" disabled>' + (rename ? '저장' : '추가') + '</button>';
  document.body.classList.add('wg-noscroll');
  wgPageInput();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', wgPageKb);
    window.visualViewport.addEventListener('scroll', wgPageKb);
  }
  wgPageKb();
  var inp = document.getElementById('wgPageInput');
  if (inp) try { inp.focus({ preventScroll: true }); var n = inp.value.length; inp.setSelectionRange(n, n); } catch (e) {}
}
/** 키보드 높이만큼 [추가] 버튼을 올린다 */
function wgPageKb() {
  var el = document.getElementById('wgPage'), vv = window.visualViewport;
  if (!el) return;
  var kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  el.style.setProperty('--kb', kb + 'px');
}
function wgPageInput() {
  var inp = document.getElementById('wgPageInput'), go = document.getElementById('wgPageGo'), cnt = document.getElementById('wgPageCnt');
  if (!inp) return;
  var v = inp.value.trim();
  if (cnt) cnt.textContent = inp.value.length + '/' + WG_NAME_MAX;
  if (go) go.disabled = !v || (_wgPage && _wgPage.busy);
  var m = document.getElementById('wgPageMsg'); if (m) m.textContent = '';
}
function closeWgPage() {
  var el = document.getElementById('wgPage');
  if (el) el.remove();
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', wgPageKb);
    window.visualViewport.removeEventListener('scroll', wgPageKb);
  }
  _wgPage = null;
  if (!document.getElementById('wgSheet')) document.body.classList.remove('wg-noscroll');
}
async function wgPageSave() {
  var st = _wgPage;
  if (!st || st.busy) return;
  var name = String((document.getElementById('wgPageInput') || {}).value || '').trim().slice(0, WG_NAME_MAX);
  var msg = function (t) { var m = document.getElementById('wgPageMsg'); if (m) m.textContent = t; };
  if (!name) return;
  var taken = (st.id !== 'all' && name === watchBaseName) || watchGroups.some(function (g) { return g.id !== st.id && g.name === name; });
  if (taken) { msg('같은 이름의 그룹이 있습니다'); return; }
  st.busy = true; wgPageInput();
  try {
    if (st.mode === 'rename' && st.id === 'all') {
      if (name !== watchBaseName) await saveWatchBaseName(name);
    } else if (st.mode === 'rename') {
      var cur = watchGroups.filter(function (g) { return g.id === st.id; })[0];
      if (cur && cur.name !== name) await saveWatchGroups(watchGroups.map(function (g) { return g.id === st.id ? { id: g.id, name: name, codes: g.codes } : g; }));
    } else {
      if (watchGroups.length >= WG_MAX) { msg('그룹은 ' + WG_MAX + '개까지 만들 수 있습니다'); st.busy = false; wgPageInput(); return; }
      var id = newGroupId();
      await saveWatchGroups(watchGroups.concat([{ id: id, name: name, codes: st.code ? [st.code] : [] }]));
      if (st.code) afterWatchChange(st.code);
    }
  } catch (e) {
    st.busy = false; wgPageInput();
    msg(e && e.message ? e.message : '저장하지 못했습니다');
    return;
  }
  closeWgPage();
  var wl = document.getElementById('watchList');
  if (wl) wl.dataset.key = '';
  // 어디서 열었는지에 따라 뒤의 창을 다시 그린다 (창이 없으면 탭에서 연 것 — 새 그룹으로 옮겨 간다)
  if (_favSheet) renderFavSheet();
  else if (_wgEd) { renderWgEdit(); selectWatchGroup(_wgSel); }
  else if (st.mode === 'add') selectWatchGroup(id);
  else selectWatchGroup(_wgSel);
}

/* 그룹 편집 — 이름 변경(✎) · 순서 변경(⠿ 끌기, 키보드 ↑↓) · 삭제(✕) · 새 그룹 추가. 누르는 즉시 저장한다 */
var _wgEd = null;              // { busy }
var WG_ICON = {
  minus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6"/><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 8.5 15.5l.7-3.5z"/></svg>',
  grip: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>'
};
function openWatchGroupEdit() { _wgEd = { busy: false }; renderWgEdit(); }
function renderWgEdit() {
  var st = _wgEd;
  if (!st) return;
  // 줄: [⊖ 삭제] 이름 [✎ 이름 변경] ……… [⋮⋮ 끌어서 순서]. 기본은 지울 수 없어 ⊖ 를 흐리게 둔다
  var rows = wgOrdered().map(function (g) {
    var id = g.id, nm = escapeHtml(g.name);
    return '<div class="wg-ed-row' + (g.base ? ' base' : '') + '" data-id="' + id + '">'
      + '<button type="button" class="wg-ed-del" ' + (g.base ? 'disabled aria-label="' + nm + ' 그룹은 지울 수 없습니다"' : 'onclick="wgRemove(\'' + id + '\')" aria-label="' + nm + ' 삭제"') + '>' + WG_ICON.minus + '</button>'
      + '<span class="wg-ed-name">' + nm + '</span>'
      + '<button type="button" class="wg-ed-pen" onclick="openWgPage({ mode: \'rename\', id: \'' + id + '\' })" aria-label="' + nm + ' 이름 변경">' + WG_ICON.pen + '</button>'
      + '<button type="button" class="wg-ed-handle" aria-label="' + nm + ' 순서 바꾸기 (위·아래 화살표)"'
      +   ' onpointerdown="wgDragStart(event, this)" onkeydown="wgKeyMove(event, \'' + id + '\')">' + WG_ICON.grip + '</button>'
      + '</div>';
  }).join('');
  var add = watchGroups.length < WG_MAX ? '<button type="button" class="wg-add-btn" onclick="openWgPage({ mode: \'add\' })">+ 새 그룹 추가</button>' : '';
  wgSheet('그룹 편집', '<div class="wg-ed-list" id="wgEdList">' + rows + '</div>' + add
    + '<button type="button" class="btn-submit wg-go" onclick="closeWgSheet()">확인</button>', '이름 변경 · 순서 변경 · 삭제할 수 있습니다');
}

/** 저장 뒤 탭·목록·창을 다시 그린다 */
async function wgPersist(groups, basePos) {
  if (!_wgEd || _wgEd.busy) return false;
  _wgEd.busy = true;
  try {
    await saveWatchGroups(groups, basePos);
    var wl = document.getElementById('watchList');
    if (wl) wl.dataset.key = '';
    selectWatchGroup(_wgSel);              // 지운 그룹을 보고 있었다면 기본으로
    return true;
  } catch (e) {
    wgMsg(e && e.message ? e.message : '저장하지 못했습니다');
    return false;
  } finally { if (_wgEd) _wgEd.busy = false; }
}

async function wgRemove(id) {
  var g = watchGroups.filter(function (x) { return x.id === id; })[0];
  if (!g || !confirm('\'' + g.name + '\' 그룹을 삭제할까요?' + (g.codes.length ? '\n이 그룹에만 담긴 종목은 관심종목에서 빠집니다.' : ''))) return;
  var idx = watchGroups.indexOf(g);
  var pos = watchBasePos > idx ? watchBasePos - 1 : watchBasePos;        // 기본 앞의 그룹이 빠지면 기본 자리도 한 칸 당긴다
  if (!await wgPersist(watchGroups.filter(function (x) { return x.id !== id; }), pos)) return;
  g.codes.forEach(function (c) { syncFavButtons(c, isWatched(c)); });
  renderWgEdit();
}

/** 화면에 놓인 순서대로 저장한다 (끌어 놓기 · 키보드 이동 뒤) */
async function wgCommitOrder(ids) {
  var byId = {};
  watchGroups.forEach(function (g) { byId[g.id] = g; });
  var groups = ids.filter(function (id) { return id !== 'all' && byId[id]; }).map(function (id) { return byId[id]; });
  var pos = ids.filter(function (id) { return id === 'all' || byId[id]; }).indexOf('all');
  var same = pos === watchBasePos && groups.every(function (g, i) { return watchGroups[i] && watchGroups[i].id === g.id; });
  if (!same) await wgPersist(groups, pos);
  renderWgEdit();
}

/* ⠿ 끌기 — 마우스·터치 모두 포인터 이벤트로. 끄는 동안 줄을 바로 옮기고, 놓으면 저장 */
function wgDragStart(e, handle) {
  if (!_wgEd || _wgEd.busy) return;
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  var row = handle.closest('.wg-ed-row'), list = row && row.parentNode;
  if (!list) return;
  row.classList.add('dragging');
  try { handle.setPointerCapture(e.pointerId); } catch (err) {}
  var moved = false;
  var move = function (ev) {
    var y = ev.clientY;
    var others = [].filter.call(list.children, function (r) { return r !== row; });
    var before = others.filter(function (r) { var b = r.getBoundingClientRect(); return y < b.top + b.height / 2; })[0] || null;
    if (before !== row.nextSibling) { list.insertBefore(row, before); moved = true; }
  };
  var up = function () {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    row.classList.remove('dragging');
    if (moved) wgCommitOrder([].map.call(list.children, function (r) { return r.dataset.id; }));
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

/** 키보드로 순서 바꾸기 — 손잡이에 초점을 두고 ↑ ↓ */
function wgKeyMove(e, id) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  var ids = wgOrdered().map(function (g) { return g.id; });
  var i = ids.indexOf(id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
  if (i < 0 || j < 0 || j >= ids.length) return;
  ids.splice(j, 0, ids.splice(i, 1)[0]);
  wgCommitOrder(ids).then(function () {
    var h = document.querySelector('#wgEdList .wg-ed-row[data-id="' + id + '"] .wg-ed-handle');
    if (h) h.focus();
  });
}

/* ===== 최근 본 종목 =====
 * 늘 한 줄 (최근 본 순, 최대 10개) — 넘치면 옆으로 넘긴다. PC 에서는 마우스 휠로도 옆으로 넘어가게 하고,
 * 오른쪽·왼쪽에 더 있으면 가장자리를 흐리게 해서 넘길 수 있다는 걸 보여 준다. */
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
  el.scrollLeft = 0;                       // 방금 본 종목이 맨 앞 — 늘 처음부터 보이게
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.addEventListener('scroll', function () { recentEdges(el); }, { passive: true });
    el.addEventListener('wheel', function (e) {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('resize', function () { recentEdges(el); });
  }
  recentEdges(el);
}
function recentEdges(el) {
  var max = el.scrollWidth - el.clientWidth;
  el.classList.toggle('more-l', max > 2 && el.scrollLeft > 2);
  el.classList.toggle('more-r', max > 2 && el.scrollLeft < max - 2);
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

/* 기본은 접힘 — 접혀 있는 동안에는 받지 않는다 (주기 갱신도 건너뛴다). 펼치면 그때 받는다 */
var _themesOpen = false;
function toggleThemes() {
  _themesOpen = !_themesOpen;
  var el = document.getElementById('themeList');
  var btn = document.getElementById('themeFold');
  if (btn) btn.setAttribute('aria-expanded', _themesOpen);
  if (!el) return;
  el.hidden = !_themesOpen;
  if (_themesOpen) {
    if (!el.querySelector('.theme-row, .sector-head')) el.innerHTML = '<div class="loading">불러오는 중...</div>';
    loadSectors(true);
  } else {
    // 테마 종목을 열어 둔 채 접으면 그 시세를 계속 받지 않게 비운다 — 다시 펴면 테마 목록부터
    ++_sectorSeq;
    _sectorCodes = [];
    el.innerHTML = '';
  }
}

async function loadSectors(force) {
  var el = document.getElementById('themeList');
  if (!el || !_themesOpen) return;
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
      var watched = isWatched(s.code);
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
  // 가격·등락률 칸은 목록 시세(3초) — 장이 닫혀 있어도 '실시간'이라 쓰지 않고, 순위와 기준이 다름만 밝힌다
  if (at) parts.push('순위·거래대금은 ' + escapeHtml(at) + ' 기준 · 가격·등락률은 현재가');
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
  if (watchGroups.length) { openFavSheet(code); return; }     // 그룹이 있으면 어느 그룹에 담을지 고른다
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
  if (window.Us) Us.reset();                  // 미국 주식 상세도 마찬가지
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
    var on = isWatched(code);
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
  u.searchParams.delete('us');
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
  var us = st.dtUs || sp.get('us');
  var isUs = !!(window.Us && Us.isCode(us)) && !isStockCode(code) && !isCoin;
  if (_backToHome) {
    // "← 시세" 로 돌아왔는데 앞 기록도 종목이면(상세에서 다른 종목으로 건너간 경우) 그 기록을 홈으로 바꿔 쓴다
    _backToHome = false;
    if (isStockCode(code) || isCoin || isUs) { try { history.replaceState(null, '', stockUrl(null)); } catch (x) {} }
    closeDetail(true);
    return;
  }
  if (isStockCode(code)) {
    if (!curStock || curStock.code !== code) openStock(code, st.dtName || '', { fromPop: true });
    else if (currentTab !== 'market') switchTab('market');
  } else if (isCoin) {
    if (Coin.current() !== coin) Coin.open(coin, st.dtName || '', { fromPop: true });
    else if (currentTab !== 'market') switchTab('market');
  } else if (isUs) {
    if (Us.current() !== us) Us.open(us, st.dtName || '', { fromPop: true });
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
/** 일·주·월봉에서 새 봉을 열 때 쓸 그날 시가·고가·저가 (상단 시세와 같은 통합 기준). 분봉은 그 분의 값이 아니라서 넘기지 않는다 */
function tickOhl(q) {
  return !q || curTf === 'm' || curTf === 'm5' ? null : { open: q.open, high: q.high, low: q.low };
}

function allowNewBarNow() {
  if (curTf === 'm' || curTf === 'm5') return isMarketOpen();
  if (curTf === 'D') return isTradingDayKst() && isMarketOpen();
  // 주·월봉: 같은 주·달이면 마지막 봉을 갱신하는 게 맞다. 월요일·월초에는 그 봉이 지난주·지난달 것이라
  // 프리마켓 틱이 지난 봉의 종가·고가·저가를 덮었다 — 기간이 바뀌었을 때만 새 봉을 연다
  if ((curTf === 'W' || curTf === 'M') && isTradingDayKst() && isMarketOpen() && _chartBars && _chartBars.length) {
    var last = String(_chartBars[_chartBars.length - 1].t), today = kstParts().ymd;
    return curTf === 'W' ? isoWeekKey(last) !== isoWeekKey(today) : last.slice(0, 6) !== today.slice(0, 6);
  }
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
  _chartSeq++;                 // 받는 중이던 차트가 닫힌 화면에 그려지지 않게
  if (window.Coin) Coin.reset();
  if (window.Us) Us.reset();
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
  var watched = isWatched(code);
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
    +   '<div class="chart-note" id="chartNote" style="display:none"></div>'
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
    + '<div class="disclaimer" id="sdDisclaimer">⚠️ 시세는 참고용이며 지연·오류가 있을 수 있습니다. 실제 매매는 증권사 앱에서 확인하세요.</div>';
}

function sdSwitch(tab) {
  document.querySelectorAll('.sd-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.sdtab === tab); });
  document.getElementById('sdChart').style.display = tab === 'chart' ? '' : 'none';
  document.getElementById('sdInfo').style.display = tab === 'info' ? '' : 'none';
  document.getElementById('sdTrend').style.display = tab === 'trend' ? '' : 'none';
  document.getElementById('sdNews').style.display = tab === 'news' ? '' : 'none';
  if (tab === 'info') loadStockProfile();
  if (tab === 'trend') loadDealTrend();
  if (tab === 'news') setNewsMode(newsMode);
}

async function onToggleWatch() {
  if (!curStock) return;
  var code = curStock.code;
  if (_favBusy[code]) return;                // 저장 중에 또 누르면 켰다 꺼진다
  if (watchGroups.length) { openFavSheet(code, curStock.name); return; }
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

/**
 * 시세 틱으로 차트 마지막 봉을 갱신할 때 넘길 거래량.
 * q.volume 은 KRX+NXT 통합 '하루 누적'이라, 1분·5분봉(그 분의 거래량)이나 주·월봉(기간 합)에 넣으면
 * 마지막 막대만 수백 배로 솟아 나머지 막대가 바닥에 깔렸다. 일봉만 네이버 일봉과 같은 기준(KRX 누적)으로 맞추고
 * 나머지는 봉 데이터 갱신(1분 주기)에 맡긴다.
 */
function tickVolume(q) {
  if (!q || curTf !== 'D') return null;
  return (q.krx && q.krx.volume != null) ? q.krx.volume : null;
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
    // 시계 대신 서버 상태를 신뢰 — 단 KRX 상태는 NXT 프리·애프터마켓(08:00~08:50 · 15:40~) 동안 CLOSE 라
    // 거래가 도는데 '장 마감'으로 보이고 폴링이 60초로 느려졌다. NXT 세션이 열려 있으면 열린 것으로 본다
    setMarketStatus(q.session ? 'OPEN' : q.marketStatus);
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
      + ' (' + fmtRate(q.changeRate) + ') <span class="vs">전일 대비</span>';
    cEl.className = 'sd-chg ' + cls;
    // 프리/애프터마켓에는 KRX 가 닫혀 있어 넥스트레이드(NXT) 체결가를 보여준다 — 어느 시장 값인지 밝힌다
    var sess = q.session === 'AFTER_MARKET' ? '애프터마켓(NXT)' : (q.session === 'PRE_MARKET' ? '프리마켓(NXT)' : '');
    // 네이버가 막혀 대체 출처(다음·야후)로 받은 값은 지연됐을 수 있다 — '네이버 · 실시간'으로 쓰지 않는다
    var alt = q.source && q.source !== 'naver';
    var src = alt ? (q.source === 'daum' ? '다음' : '야후') + '(대체)' : '네이버';
    if (alt && st.cls === 'live') st = { cls: 'closed', text: '지연 가능' };
    aEl.innerHTML = (q.asOf ? escapeHtml(shortTime(q.asOf)) + ' 기준 · ' : '') + src + ' ' + (sess ? '· ' + sess + ' ' : '')
      + '<span class="state-dot ' + st.cls + '">' + st.text + '</span>'
      // 평소(네이버 · KRX)와 다른 값을 보여 줄 때만 ! 로 이유를 밝힌다
      + (alt ? InfoTip.btn('대체 시세', '네이버 시세를 받지 못해 ' + (q.source === 'daum' ? '다음' : '야후') + ' 값을 대신 보여 줍니다. 몇 분 늦을 수 있고, 네이버 연결이 돌아오면 다시 네이버 값으로 바뀝니다.', 'sm')
        : sess ? InfoTip.btn('넥스트레이드(NXT) 시세', 'KRX 정규장(09:00~15:30) 밖이라 대체거래소 넥스트레이드의 체결가를 보여 줍니다.\n프리마켓 08:00~08:50 · 애프터마켓 15:40~20:00\n상·하한가 표시도 NXT 기준입니다.', 'sm') : '');

    // 상·하한가 — 프리·애프터마켓에는 NXT 가격을 보여 주므로 그 시장의 상태로 (KRX 값은 전날 것이 밤새 남아 있다)
    var ls = q.session ? (q.nxt && q.nxt.limitState) : q.limitState;
    document.getElementById('sdSub').textContent =
      q.code + ' · ' + (q.market || '') + (q.halted ? ' · 거래정지' : '')
      + (ls === 'upper' ? ' · 상한가' : (ls === 'lower' ? ' · 하한가' : ''));

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
    // 모의투자 — 보유 손익·주문창 계산을 지금 보이는 현재가에 맞춘다 (계좌 응답은 수십 초 간격이다)
    if (window.Mock && Mock.onQuote) Mock.onQuote(q);

    // ★ 차트 마지막 봉을 새로고침 없이 갱신.
    // 장 마감 후에도 한 번은 맞춰야 종가가 차트에 반영된다 (상단 시세와 끝점 불일치 방지).
    if (chartHandle) {
      chartHandle.updateLast(q.price, currentBucketTime(), tickVolume(q), allowNewBarNow(), tickOhl(q));
      updateHiLoLabel();         // 기간 최고·최저가 끝점을 따라 바뀌었을 수 있다
    }
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
    var lo = Math.min.apply(null, win.map(function (b) { return b.l; }).concat(q.low != null ? [q.low] : []));
    var hi = Math.max.apply(null, win.map(function (b) { return b.h; }).concat(q.high != null ? [q.high] : []));
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
  if (window.Us) Us.onThemeChanged();
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
    if (_lastQuote) chartHandle.updateLast(_lastQuote.price, currentBucketTime(), tickVolume(_lastQuote), allowNewBarNow(), tickOhl(_lastQuote));
  } catch (e) { if (seq === _chartSeq) loadStockChart(); }
}

/** @param quiet 봉 갱신 주기에 다시 시도할 때 — '불러오는 중'으로 깜빡이지 않게 지금 화면을 둔다 */
async function loadStockChart(quiet) {
  if (!curStock) return;
  var box = document.getElementById('chartBox');
  if (!box) return;
  // 기간 버튼 연타·종목 전환 시 마지막 요청만 그린다 (차트가 겹쳐 생성·누수되는 것 방지)
  var seq = ++_chartSeq;
  syncChartModeBtn();
  if (!quiet) box.innerHTML = '<div class="loading">차트 불러오는 중...</div>';
  if (chartHandle) { chartHandle.dispose(); chartHandle = null; }
  try {
    var isMin = (curTf === 'm' || curTf === 'm5');
    var d = await Market.ohlc(curStock.code, isMin ? '1m' : 'D');
    if (seq !== _chartSeq) return;
    var bars = d.bars || d.candles || [];
    syncChartNote(isMin && d);
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
    // 봉은 워커 캐시(최대 3분) 시점 값이다 — 기간·모드를 바꾼 직후에도 끝점을 상단 현재가에 맞춘다
    if (_lastQuote && _lastQuote.code === curStock.code) {
      chartHandle.updateLast(_lastQuote.price, currentBucketTime(), tickVolume(_lastQuote), allowNewBarNow(), tickOhl(_lastQuote));
      renderRange(_lastQuote);
    }

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
  if (!curStock) return;
  // 첫 로드가 비었거나(장 시작 전 1분봉) 실패했으면 차트가 없다 — 예전에는 여기서 그냥 끝나 기간을 다시 누를 때까지
  // '차트 데이터가 없습니다'가 남았다. 봉 갱신 주기마다 조용히 다시 그려 본다
  if (!chartHandle) { if (document.getElementById('chartBox')) return loadStockChart(true); return; }
  if (!chartHandle.replaceData) return;
  try {
    var isMin = (curTf === 'm' || curTf === 'm5');
    var seq = _chartSeq, handle = chartHandle;
    var d = await Market.ohlc(curStock.code, isMin ? '1m' : 'D');
    // 받는 사이 종목·기간·차트가 바뀌었으면 버린다
    if (seq !== _chartSeq || handle !== chartHandle) return;
    var bars = d.bars || d.candles || [];
    if (!bars.length) return;
    syncChartNote(isMin && d);
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
      chartHandle.updateLast(_lastQuote.price, currentBucketTime(), tickVolume(_lastQuote), allowNewBarNow(), tickOhl(_lastQuote));
      renderRange(_lastQuote);
    }
  } catch (e) { /* 다음 주기에 재시도 */ }
}

/** 장 시작 전·주말에는 워커가 직전 거래일 분봉을 준다 — 오늘 봉으로 오해하지 않게 날짜를 밝힌다 */
function syncChartNote(d) {
  var el = document.getElementById('chartNote');
  if (!el) return;
  var day = d && d.previous && /^\d{8}$/.test(String(d.day || '')) ? String(d.day) : null;
  el.style.display = day ? '' : 'none';
  el.textContent = day ? '📅 ' + Number(day.slice(4, 6)) + '/' + Number(day.slice(6, 8)) + ' 분봉 · 오늘 분봉은 09:00 부터 쌓입니다' : '';
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
    Poller.add('book', loadBook, pollMs(3000, 60000));      // 추가하는 즉시 1회 실행된다
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

    // 뼈대는 단계 수가 바뀔 때만 다시 만든다 — 상한가 등으로 한쪽 호가가 줄거나 비면, 첫 응답 길이로 만든
    // 뼈대의 남는 줄에 옛 가격·잔량이 그대로 남았다
    var shape = ask.length + '|' + bid.length;
    if (wrap.dataset.built !== shape) {
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
      wrap.dataset.built = shape;
      resetDirs('bk:');
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
      var watched = isWatched(s.code);
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

function pfCardHead(title, hint, tip) {
  return '<div class="pf-head"><h4>' + escapeHtml(title) + '</h4>'
    + (hint ? '<span class="pf-hint">' + escapeHtml(hint) + '</span>' : '')
    + (tip ? InfoTip.btn(title + ' 용어', tip, 'sm') : '') + '</div>';
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
  return '<section class="pf-card">' + pfCardHead('종목정보', '투자지표', [
      '· PER: 주가 ÷ 주당순이익(EPS). 낮을수록 버는 돈에 비해 주가가 싸다는 뜻입니다.',
      '· EPS: 1주당 순이익 (최근 4분기)',
      '· PBR: 주가 ÷ 주당순자산(BPS). 1보다 낮으면 장부상 자산보다 싸게 거래되는 중입니다.',
      '· 배당수익률: 1년 배당금 ÷ 주가',
      '· 외인소진율: 외국인이 살 수 있는 한도 중 이미 사 둔 비율'
    ].join('\n'))
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
  return '<section class="pf-card">' + pfCardHead('ETF 정보', '기초지수 · 보수', [
      '· 순자산가치(NAV): ETF 가 담은 자산의 1주당 실제 가치',
      '· 괴리율: 시장 가격이 NAV 보다 얼마나 비싸거나(+) 싼지(−)',
      '· 총보수: 1년 동안 떼는 운용 비용 비율',
      '· 분배율: 최근 1년 분배금 ÷ 가격'
    ].join('\n'))
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
