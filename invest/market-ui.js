/* ===== DT 재테크 — 시세 화면 (Phase 3) =====
 * 토스증권 구조를 DT 스타일로 옮긴 시세 홈 + 종목 상세.
 * 인프라(API·폴링·차트)는 market.js.
 */

var marketLoaded = false;
var curStock = null;        // { code, name }
var curTf = 'D';
var bookOpen = false;
var chartDispose = null;
var searchTimer = null;
var rankType = 'up';
var rankMarket = 'KOSPI';

/* ===== 시세 탭 진입 ===== */
async function enterMarketTab() {
  if (curStock) return;                     // 종목 상세 보는 중이면 유지
  document.getElementById('stockDetail').style.display = 'none';
  document.getElementById('marketHome').style.display = '';

  if (!marketLoaded) {
    marketLoaded = true;
    await loadWatchlist();
    renderRecent();
    loadSectors();
    loadRank();
  }
  startHomePolling();
}

function leaveMarketTab() {
  Poller.stopAll();
}

function startHomePolling() {
  Poller.stopAll();
  Poller.add('index', loadIndex, isMarketOpen() ? 30000 : 600000);
  if (watchlist.length) {
    Poller.add('watch', loadWatchQuotes, isMarketOpen() ? 7000 : 600000);
  } else {
    loadWatchQuotes();       // 비어 있어도 1회는 그려야 "불러오는 중"이 안 남는다
  }
}

/* ===== 지수 스트립 ===== */
async function loadIndex() {
  var el = document.getElementById('indexStrip');
  if (!el) return;
  try {
    var d = await Market.index();
    var st = marketStateLabel();
    var cells = ['kospi', 'kosdaq'].map(function (k) {
      var x = d[k];
      if (!x) return '';
      var c = signClass(x.change);
      return '<div class="idx-cell">'
        + '<div class="idx-name">' + escapeHtml(x.name) + '</div>'
        + '<div class="idx-price ' + c + '">' + fmtNum(Math.round(x.price * 100) / 100) + '</div>'
        + '<div class="idx-chg ' + c + '">' + signMark(x.change) + ' ' + fmtRate(x.changeRate) + '</div>'
        + '</div>';
    }).join('');
    el.innerHTML = cells + '<div class="idx-state ' + st.cls + '">' + st.text + '</div>';
  } catch (e) {
    el.innerHTML = '<div class="idx-err">지수를 불러오지 못했습니다</div>';
  }
}

/* ===== 종목 검색 (초성 지원) ===== */
function onSearchInput(v) {
  clearTimeout(searchTimer);
  var q = (v || '').trim();
  var box = document.getElementById('searchResults');
  if (!q) { box.innerHTML = ''; box.style.display = 'none'; return; }
  searchTimer = setTimeout(function () { doSearch(q); }, 250);
}

async function doSearch(q) {
  var box = document.getElementById('searchResults');
  box.style.display = '';
  box.innerHTML = '<div class="sr-empty">검색 중...</div>';
  try {
    var d = await Market.search(q);
    if (!d.items || !d.items.length) { box.innerHTML = '<div class="sr-empty">검색 결과가 없습니다</div>'; return; }
    box.innerHTML = d.items.map(function (i) {
      return '<button class="sr-item" onclick="openStock(\'' + i.code + '\',\'' + escapeAttr(i.name) + '\')">'
        + '<span class="sr-name">' + escapeHtml(i.name) + '</span>'
        + '<span class="sr-meta">' + escapeHtml(i.market || '') + ' · ' + i.code + '</span>'
        + '</button>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<div class="sr-empty">' + escapeHtml(e.message) + '</div>';
  }
}

function clearSearch() {
  document.getElementById('stockSearch').value = '';
  var box = document.getElementById('searchResults');
  box.innerHTML = ''; box.style.display = 'none';
}

/* ===== 관심종목 ===== */
async function loadWatchQuotes() {
  var el = document.getElementById('watchList');
  if (!el) return;
  if (!watchlist.length) {
    el.innerHTML = '<div class="empty">관심종목이 없습니다.<br>종목을 검색해 ⭐를 눌러보세요.</div>';
    return;
  }
  try {
    var rows = await Promise.all(watchlist.map(function (c) {
      return Market.quote(c).catch(function () { return null; });
    }));
    el.innerHTML = rows.filter(Boolean).map(quoteRowHtml).join('')
      || '<div class="empty">시세를 불러오지 못했습니다</div>';
  } catch (e) {
    el.innerHTML = '<div class="empty">시세를 불러오지 못했습니다</div>';
  }
}

function quoteRowHtml(q) {
  var c = signClass(q.change);
  return '<button class="q-row" onclick="openStock(\'' + q.code + '\',\'' + escapeAttr(q.name) + '\')">'
    + '<span class="q-name">' + escapeHtml(q.name) + '</span>'
    + '<span class="q-price">' + fmtNum(q.price) + '</span>'
    + '<span class="q-chg ' + c + '">' + signMark(q.change) + ' ' + fmtRate(q.changeRate) + '</span>'
    + '</button>';
}

/* ===== 최근 본 종목 ===== */
function renderRecent() {
  var el = document.getElementById('recentList');
  var wrap = document.getElementById('recentSection');
  if (!el || !wrap) return;
  var list = getRecent();
  wrap.style.display = list.length ? '' : 'none';
  el.innerHTML = list.map(function (r) {
    return '<button class="chip" onclick="openStock(\'' + r.code + '\',\'' + escapeAttr(r.name) + '\')">'
      + escapeHtml(r.name) + '</button>';
  }).join('');
}

function onClearRecent() {
  clearRecent();
  renderRecent();
}

/* ===== 지금 뜨는 테마 ===== */
async function loadSectors() {
  var el = document.getElementById('themeList');
  if (!el) return;
  try {
    var d = await Market.sectors('theme');
    var top = (d.groups || []).slice(0, 8);
    el.innerHTML = top.map(function (g) {
      var c = signClass(g.changeRate);
      return '<button class="theme-row" onclick="openSector(' + g.no + ',\'' + escapeAttr(g.name) + '\')">'
        + '<span class="theme-name">' + escapeHtml(g.name) + '</span>'
        + '<span class="theme-sub">↑' + g.rise + ' ↓' + g.fall + ' / ' + g.total + '</span>'
        + '<span class="theme-rate ' + c + '">' + fmtRate(g.changeRate) + '</span>'
        + '</button>';
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="empty">테마를 불러오지 못했습니다</div>';
  }
}

async function openSector(no, name) {
  var el = document.getElementById('themeList');
  el.innerHTML = '<div class="loading">' + escapeHtml(name) + ' 종목 불러오는 중...</div>';
  try {
    var d = await Market.sectors('theme', no);
    el.innerHTML = '<div class="sector-head">'
      + '<strong>' + escapeHtml(name) + '</strong>'
      + '<button class="mini-btn" onclick="loadSectors()">← 테마 목록</button></div>'
      + (d.items || []).map(function (s) {
        var c = signClass(s.changeRate);
        return '<button class="q-row" onclick="openStock(\'' + s.code + '\',\'' + escapeAttr(s.name) + '\')">'
          + '<span class="q-name">' + escapeHtml(s.name) + '</span>'
          + '<span class="q-price">' + fmtNum(s.price) + '</span>'
          + '<span class="q-chg ' + c + '">' + fmtRate(s.changeRate) + '</span>'
          + '</button>';
      }).join('');
  } catch (e) {
    el.innerHTML = '<div class="empty">종목을 불러오지 못했습니다</div>';
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
  el.innerHTML = '<div class="loading">불러오는 중...</div>';
  try {
    var d = await Market.rank(rankType, rankMarket);
    el.innerHTML = (d.items || []).slice(0, 15).map(function (s, i) {
      var c = signClass(s.changeRate);
      return '<button class="q-row" onclick="openStock(\'' + s.code + '\',\'' + escapeAttr(s.name) + '\')">'
        + '<span class="q-rank">' + (i + 1) + '</span>'
        + '<span class="q-name">' + escapeHtml(s.name) + '</span>'
        + '<span class="q-price">' + fmtNum(s.price) + '</span>'
        + '<span class="q-chg ' + c + '">' + fmtRate(s.changeRate) + '</span>'
        + '</button>';
    }).join('') || '<div class="empty">데이터가 없습니다</div>';
  } catch (e) {
    el.innerHTML = '<div class="empty">랭킹을 불러오지 못했습니다</div>';
  }
}

/* ===== 종목 상세 ===== */
async function openStock(code, name) {
  curStock = { code: code, name: name };
  curTf = 'D';
  bookOpen = false;
  pushRecent(code, name);

  Poller.stopAll();
  if (chartDispose) { chartDispose(); chartDispose = null; }

  switchTab('market');
  document.getElementById('marketHome').style.display = 'none';
  var el = document.getElementById('stockDetail');
  el.style.display = '';
  el.innerHTML = stockShellHtml(code, name);
  window.scrollTo(0, 0);
  clearSearch();

  loadStockQuote();
  loadStockChart();
  Poller.add('quote', loadStockQuote, isMarketOpen() ? 5000 : 600000);
}

function backToMarket() {
  curStock = null;
  Poller.stopAll();
  if (chartDispose) { chartDispose(); chartDispose = null; }
  document.getElementById('stockDetail').style.display = 'none';
  document.getElementById('marketHome').style.display = '';
  renderRecent();
  loadWatchQuotes();
  startHomePolling();
  window.scrollTo(0, 0);
}

function stockShellHtml(code, name) {
  var watched = watchlist.indexOf(code) !== -1;
  return ''
    + '<div class="sd-head">'
    +   '<button class="mini-btn" onclick="backToMarket()">← 시세</button>'
    +   '<span class="sd-title">' + escapeHtml(name) + '</span>'
    +   '<button class="star-btn' + (watched ? ' on' : '') + '" id="starBtn" onclick="onToggleWatch()">'
    +     (watched ? '★' : '☆') + '</button>'
    + '</div>'
    + '<div class="sd-sub" id="sdSub">' + code + '</div>'
    + '<div class="sd-price-block" id="sdPrice"><div class="loading">시세 불러오는 중...</div></div>'
    + '<div id="sdRange"></div>'
    + '<div class="sd-stats" id="sdStats"></div>'
    + '<div class="sd-tabs">'
    +   '<button class="sd-tab on" data-sdtab="chart" onclick="sdSwitch(\'chart\')">차트</button>'
    +   '<button class="sd-tab" data-sdtab="news" onclick="sdSwitch(\'news\')">뉴스</button>'
    +   '<button class="sd-tab" data-sdtab="community" onclick="sdSwitch(\'community\')">커뮤니티</button>'
    + '</div>'
    + '<div class="sd-panel" id="sdChart">'
    +   '<div class="tf-row">'
    +     ['m:1분', 'm5:5분', 'D:일', 'W:주', 'M:월'].map(function (x) {
            var v = x.split(':')[0], label = x.split(':')[1];
            return '<button class="tf-btn' + (v === 'D' ? ' on' : '') + '" data-tf="' + v + '" onclick="setTf(\'' + v + '\')">' + label + '</button>';
          }).join('')
    +   '</div>'
    +   '<div class="chart-box" id="chartBox"><div class="loading">차트 불러오는 중...</div></div>'
    +   '<button class="book-toggle" id="bookToggle" onclick="toggleBook()">▾ 호가 보기</button>'
    +   '<div class="book-wrap" id="bookWrap" style="display:none"></div>'
    +   '<a class="ext-link" href="https://m.stock.naver.com/domestic/stock/' + code + '/total" target="_blank" rel="noopener noreferrer">네이버 증권에서 보기 →</a>'
    + '</div>'
    + '<div class="sd-panel" id="sdNews" style="display:none"></div>'
    + '<div class="sd-panel" id="sdCommunity" style="display:none">'
    +   '<div class="empty">종목별 커뮤니티는 준비 중입니다.<br>지금은 <b>시황 탭</b>의 브리핑 댓글을 이용해 주세요.</div>'
    + '</div>'
    + '<div class="disclaimer">⚠️ 시세는 참고용이며 지연·오류가 있을 수 있습니다. 실제 매매는 증권사 앱에서 확인하세요.</div>';
}

function sdSwitch(tab) {
  document.querySelectorAll('.sd-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.sdtab === tab); });
  document.getElementById('sdChart').style.display = tab === 'chart' ? '' : 'none';
  document.getElementById('sdNews').style.display = tab === 'news' ? '' : 'none';
  document.getElementById('sdCommunity').style.display = tab === 'community' ? '' : 'none';
  if (tab === 'news') loadStockNews();
}

async function onToggleWatch() {
  if (!curStock) return;
  var btn = document.getElementById('starBtn');
  btn.disabled = true;
  try {
    var on = await toggleWatch(curStock.code);
    btn.classList.toggle('on', on);
    btn.textContent = on ? '★' : '☆';
  } catch (e) {
    alert('관심종목 저장에 실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}

async function loadStockQuote() {
  if (!curStock) return;
  try {
    var q = await Market.quote(curStock.code);
    var c = signClass(q.change);
    var st = marketStateLabel();
    document.getElementById('sdSub').textContent =
      q.code + ' · ' + (q.market || '') + (q.tradeHalted ? ' · 거래정지' : '');
    document.getElementById('sdPrice').innerHTML =
        '<div class="sd-price ' + c + '">' + fmtNum(q.price) + ' <span class="won">원</span></div>'
      + '<div class="sd-chg ' + c + '">' + signMark(q.change) + ' ' + fmtNum(Math.abs(q.change))
      + ' (' + fmtRate(q.changeRate) + ') <span class="vs">어제보다</span></div>'
      + '<div class="sd-asof">' + escapeHtml(shortTime(q.asOf)) + ' 기준 · 네이버 '
      + '<span class="state-dot ' + st.cls + '">' + st.text + '</span></div>';

    document.getElementById('sdStats').innerHTML = [
      ['거래량', fmtCompact(q.volume)],
      ['시가', fmtNum(q.open)],
      ['고가', fmtNum(q.high)],
      ['저가', fmtNum(q.low)]
    ].map(function (r) {
      return '<div class="stat"><span class="stat-k">' + r[0] + '</span><span class="stat-v">' + r[1] + '</span></div>';
    }).join('');

    renderRange(q);
  } catch (e) {
    var el = document.getElementById('sdPrice');
    if (el) el.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
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
  var pct = Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100));
  return '<div class="range-row">'
    + '<div class="range-label">' + label + '</div>'
    + '<div class="range-bar-wrap">'
    +   '<span class="range-lo">' + fmtNum(lo) + '</span>'
    +   '<span class="range-bar"><i style="left:' + pct.toFixed(1) + '%"></i></span>'
    +   '<span class="range-hi">' + fmtNum(hi) + '</span>'
    + '</div></div>';
}

function setTf(tf) {
  curTf = tf;
  document.querySelectorAll('.tf-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.tf === tf); });
  loadStockChart();
}

async function loadStockChart() {
  if (!curStock) return;
  var box = document.getElementById('chartBox');
  if (!box) return;
  box.innerHTML = '<div class="loading">차트 불러오는 중...</div>';
  if (chartDispose) { chartDispose(); chartDispose = null; }
  try {
    var isMin = (curTf === 'm' || curTf === 'm5');
    var d = await Market.ohlc(curStock.code, isMin ? '1m' : 'D');
    var bars = d.bars || d.candles || [];
    if (!bars.length) { box.innerHTML = '<div class="empty">차트 데이터가 없습니다</div>'; return; }

    if (!isMin) { _dayBars = bars; if (_lastQuote) renderRange(_lastQuote); }

    var use = bars;
    if (curTf === 'm5') use = groupMinutes(bars, 5);
    else if (curTf === 'W') use = aggregateCandles(bars, 'W');
    else if (curTf === 'M') use = aggregateCandles(bars, 'M');
    else if (curTf === 'D') use = bars.slice(-120);

    chartDispose = await renderChart(box, use, curTf);
  } catch (e) {
    box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
  }
}

/** 1분봉 → N분봉 */
function groupMinutes(bars, n) {
  var out = [], cur = null, cnt = 0;
  bars.forEach(function (b) {
    if (!cur) { cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }; cnt = 1; }
    else {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l);
      cur.c = b.c; cur.t = b.t; cur.v += (b.v || 0); cnt++;
    }
    if (cnt === n) { out.push(cur); cur = null; cnt = 0; }
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
  btn.textContent = bookOpen ? '▴ 호가 접기' : '▾ 호가 보기';
  if (bookOpen) {
    loadBook();
    Poller.add('book', loadBook, isMarketOpen() ? 3000 : 600000);
  } else {
    Poller.remove('book');
  }
}

async function loadBook() {
  if (!curStock || !bookOpen) return;
  var wrap = document.getElementById('bookWrap');
  if (!wrap) return;
  try {
    var b = await Market.book(curStock.code);
    var ask = b.ask || [], bid = b.bid || [];
    var total = (b.askTotal || 0) + (b.bidTotal || 0);
    var askPct = total ? Math.round((b.askTotal / total) * 100) : 50;

    var qtyOf = function (a) { return (a.count !== undefined && a.count !== null) ? a.count : a.qty; };
    var rows = ask.map(function (a) {
      return '<div class="bk-row">'
        + '<span class="bk-qty ask"><i style="width:' + (a.rate || 0) + '%"></i><b>' + fmtNum(qtyOf(a)) + '</b></span>'
        + '<span class="bk-price">' + fmtNum(a.price) + '</span>'
        + '<span class="bk-qty"></span></div>';
    }).join('');
    rows += '<div class="bk-mid">매도 ' + fmtNum(b.askTotal) + ' · 매수 ' + fmtNum(b.bidTotal) + '</div>';
    rows += bid.map(function (a) {
      return '<div class="bk-row">'
        + '<span class="bk-qty"></span>'
        + '<span class="bk-price">' + fmtNum(a.price) + '</span>'
        + '<span class="bk-qty bid"><i style="width:' + (a.rate || 0) + '%"></i><b>' + fmtNum(qtyOf(a)) + '</b></span></div>';
    }).join('');

    wrap.innerHTML = '<div class="bk-head"><span>매도잔량</span><span>호가</span><span>매수잔량</span></div>'
      + rows
      + '<div class="bk-ratio"><span class="bk-ratio-bar"><i style="width:' + askPct + '%"></i></span>'
      + '<span class="bk-ratio-txt">매도 ' + askPct + '% : 매수 ' + (100 - askPct) + '%</span></div>'
      + '<div class="bk-note">5단계 · 현재가와 1~2초 차이가 있을 수 있습니다</div>';
  } catch (e) {
    wrap.innerHTML = '<div class="empty">호가를 불러오지 못했습니다<br><span style="font-size:.74rem">'
      + escapeHtml(e.message) + '</span></div>';
  }
}

/* ===== 종목 뉴스 ===== */
var _newsLoadedFor = null;
async function loadStockNews() {
  if (!curStock) return;
  var el = document.getElementById('sdNews');
  if (!el) return;
  if (_newsLoadedFor === curStock.code && el.innerHTML) return;
  el.innerHTML = '<div class="loading">뉴스 불러오는 중...</div>';
  try {
    var d = await Market.news(curStock.code);
    if (!d.items || !d.items.length) { el.innerHTML = '<div class="empty">관련 뉴스가 없습니다</div>'; return; }
    el.innerHTML = d.items.map(function (n) {
      return '<a class="news-item" href="' + escapeAttr(n.url) + '" target="_blank" rel="noopener noreferrer">'
        + '<div class="news-title">' + escapeHtml(n.title) + '</div>'
        + '<div class="news-meta">' + escapeHtml(n.office || '') + ' · ' + newsTime(n.datetime) + '</div>'
        + '</a>';
    }).join('');
    _newsLoadedFor = curStock.code;
  } catch (e) {
    el.innerHTML = '<div class="empty">뉴스를 불러오지 못했습니다</div>';
  }
}

/* ===== 유틸 ===== */
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function shortTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 16).replace('T', ' ');
  var p = function (n) { return String(n).padStart(2, '0'); };
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

function newsTime(s) {
  if (!s || String(s).length < 12) return '';
  var t = String(s);
  return t.slice(4, 6) + '.' + t.slice(6, 8) + ' ' + t.slice(8, 10) + ':' + t.slice(10, 12);
}
