/* ===== DT 재테크 — 미국 주식 시세 (네이버 해외주식) =====
 * 시세 표시만 한다 (모의투자 없음).
 *  - 시세 홈: 🇺🇸 미국 주식 섹션 (관심 · 거래대금 · 시가총액 · 급상승 · 급하락), 검색 결과에 미국 종목 합치기
 *  - 종목 상세: 현재가(달러·원 환산) · 프리/애프터마켓 · 오늘/52주 범위 · 투자 지표 · 차트
 * 코인과 같은 방식으로 #stockDetail 자리를 쓰고, 뒤로 가기·기록·폴러 규칙은 종목 상세(market-ui.js)를 따른다.
 * 코드는 네이버 reuters 코드(AAPL.O, BRKb, JPM) — 국내 6자리 코드와 섞이지 않게 주소도 ?us= 로 따로 쓴다.
 */
var Us = (function () {
  var cur = null;                  // { code, name }
  var tf = 'D';
  var chart = null, chartBars = null, chartSeq = 0;
  var lastQuote = null;
  var listSort = 'value';          // fav | value | cap | up | down
  var listAll = false;
  var listKey = '';
  var favBusy = {};
  var searchCache = {};            // 검색어 → 결과 (서버 5분 캐시와 같은 수명이면 충분)

  var LIST_LIMIT = 15, LIST_MORE = 50;
  var TF_LIST = [['m5', '5분'], ['D', '일'], ['W', '주'], ['M', '월']];      // 5분 — 오늘(최근) 정규장 5분봉
  var EX_LABEL = { NASDAQ: '나스닥', NYSE: '뉴욕', AMEX: '아멕스' };

  function isCode(c) { return /^[A-Za-z0-9]{1,8}(_[a-z])?(\.[A-Z])?$/.test(String(c || '')); }
  function symbolOf(code) { return String(code).split('.')[0]; }

  /* ── 미국 장 시간 (뉴욕 시각) — 폴링 주기만 여기서 가른다. 화면 상태는 네이버 값을 따른다 ── */
  function nthSunday(y, m, nth) {
    var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (nth - 1) * 7;
  }
  function isDst(y, m, d, h) {
    if (m < 3 || m > 11) return false;
    if (m > 3 && m < 11) return true;
    if (m === 3) { var s = nthSunday(y, 3, 2); return d > s || (d === s && h >= 2); }
    var e = nthSunday(y, 11, 1); return d < e || (d === e && h < 2);
  }
  /** 프리마켓 04:00 ~ 애프터마켓 20:00 (뉴욕, 평일) */
  function active() {
    var now = Date.now();
    var u = new Date(now - 4 * 3600000);
    var off = isDst(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), u.getUTCHours()) ? 4 : 5;
    var et = new Date(now - off * 3600000);
    var day = et.getUTCDay();
    if (day === 0 || day === 6) return false;
    var h = et.getUTCHours();
    return h >= 4 && h < 20;
  }

  /* ── 숫자 ── */
  function fmtUsd(p, dg) {
    if (p == null || isNaN(p)) return '-';
    if (dg == null) dg = Math.abs(p) < 1 ? 4 : 2;
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: dg, maximumFractionDigits: dg });
  }
  function fmtUsdCompact(n) {
    if (n == null || isNaN(n)) return '-';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  /** ISO(뉴욕 오프셋 포함) → 한국 시각 "9/26 05:00" */
  function kstStamp(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var d = new Date(t + 9 * 3600000);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }
  /** 차트 일봉 버킷 — 뉴욕 현지 날짜 (시세 시각 문자열의 날짜 부분) */
  function localDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
  }

  /* ── 로고 · 배지 ── */
  function logoHtml(code, name, size) {
    var ch = String(name || symbolOf(code)).trim().charAt(0) || '·';
    return '<span class="s-logo' + (size ? ' ' + size : '') + '" aria-hidden="true">'
      + '<span class="s-logo-fb">' + escapeHtml(ch) + '</span>'
      + '<img src="https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock' + encodeURIComponent(code) + '.svg" alt="" loading="lazy" decoding="async"'
      + ' onload="this.parentNode.classList.add(\'ok\')" onerror="this.remove()">'
      + '</span>';
  }
  function exLabel(ex) { return EX_LABEL[ex] || ex || ''; }
  function sessionLabel(o) { return !o ? '' : o.session === 'pre' ? '프리마켓' : (o.session === 'after' ? '애프터마켓' : '장외거래'); }

  /* ===== 검색 — 서버 자동완성에서 미국 종목만. 국내 결과를 기다리게 하지 않는다 ===== */
  function searchKey(q) { return String(q || '').trim().toLowerCase().replace(/\s+/g, ''); }

  /** 받아 둔 결과가 있으면 그 목록의 HTML, 없으면 빈 문자열 */
  function searchHtml(q) {
    var items = searchCache[searchKey(q)];
    if (!items || !items.length) return '';
    return items.slice(0, 5).map(function (x) {
      return '<button class="sr-item" role="option" onclick="Us.open(\'' + escapeJsArg(x.code) + '\',\'' + escapeJsArg(x.name) + '\')">'
        + logoHtml(x.code, x.name, 'sm')
        + '<span class="sr-name">' + escapeHtml(x.name) + '</span>'
        + '<span class="sr-meta">미국 · ' + escapeHtml(x.symbol || symbolOf(x.code)) + '</span>'
        + '</button>';
    }).join('');
  }

  /** 이름이나 티커가 검색어와 똑같은 미국 종목이 있는가 — 있으면 국내 결과보다 위에 둔다
   *  ("엔비디아"를 치면 국내 엔비디아 ETF 들보다 엔비디아 본주가 먼저 보이게) */
  function exactMatch(q) {
    var items = searchCache[searchKey(q)];
    if (!items) return false;
    var k = searchKey(q), up = k.toUpperCase();
    return items.some(function (x) {
      return String(x.name || '').toLowerCase().replace(/\s+/g, '') === k || String(x.symbol || '').toUpperCase() === up;
    });
  }

  /** 결과를 받아 둔다 — 새로 받았으면 true (화면이 다시 그린다) */
  function fetchSearch(q) {
    var k = searchKey(q);
    if (!k || searchCache[k]) return Promise.resolve(false);
    return Market.usSearch(String(q).trim()).then(function (d) {
      searchCache[k] = (d.items || []).filter(function (x) { return isCode(x.code); });
      return searchCache[k].length > 0;
    }).catch(function () { return false; });
  }

  /* ===== 시세 홈 — 🇺🇸 미국 주식 섹션 ===== */
  function setSort(s) {
    listSort = s;
    listAll = false;
    document.querySelectorAll('[data-usort]').forEach(function (b) { b.classList.toggle('on', b.dataset.usort === s); });
    loadList();
  }

  /** 시세 홈 목록 폴링 주기 — 미국 장(프리~애프터) 중 10초, 그 밖에는 2분 */
  function listPollMs() { return active() ? 10000 : 120000; }

  function toggleAll() {
    listAll = !listAll;
    loadList();
  }

  async function loadList() {
    var el = document.getElementById('usList');
    if (!el) return;
    var sort = listSort, all = listAll;
    var want = sort + (all ? ':all' : '');
    if (el.dataset.want !== want) { el.dataset.want = want; el.innerHTML = '<div class="loading">불러오는 중...</div>'; listKey = ''; }
    try {
      var d;
      if (sort === 'fav') {
        await ensureWatchlist();
        if (!usWatchlist.length) {
          el.innerHTML = '<div class="empty">관심종목이 없습니다<br><span class="cn-empty-sub">목록의 ♡ 를 누르면 여기에 모입니다</span></div>';
          listKey = '';
          return;
        }
        d = await Market.usListOf(usWatchlist);
        var byC = {};
        (d.items || []).forEach(function (x) { byC[x.code] = x; });
        d.items = usWatchlist.map(function (c) { return byC[c]; }).filter(Boolean);
      } else {
        d = await Market.usList(sort, all ? LIST_MORE : LIST_LIMIT);
      }
      if (sort !== listSort || all !== listAll) return;
      el = document.getElementById('usList');
      if (!el) return;
      var items = (d.items || []).filter(function (x) { return isCode(x.code); });
      if (!items.length) { el.innerHTML = '<div class="empty">데이터가 없습니다</div>'; listKey = ''; return; }
      var key = want + '|' + items.map(function (x) { return x.code; }).join(',');
      if (key !== listKey) {
        el.innerHTML = items.map(rowHtml).join('') + listFootHtml(sort);
        listKey = key;
        resetDirs('us:');
      }
      paintRows(items, sort);
    } catch (e) {
      if (!el.querySelector('.rank-row')) el.innerHTML = '<div class="empty">미국 주식 시세를 불러오지 못했습니다</div>';
    }
  }

  function rowId(code) { return String(code).replace(/[^A-Za-z0-9_]/g, '_'); }

  function rowHtml(x, i) {
    var on = usWatchlist.indexOf(x.code) !== -1;
    var id = rowId(x.code);
    return '<div class="q-row rank-row">'
      + '<button class="rank-main" onclick="Us.open(\'' + escapeJsArg(x.code) + '\',\'' + escapeJsArg(x.name) + '\')">'
      +   '<span class="q-rank">' + (i + 1) + '</span>'
      +   logoHtml(x.code, x.name)
      +   '<span class="rank-names">'
      +     '<span class="q-name">' + escapeHtml(x.name) + '</span>'
      +     '<span class="rank-code">' + escapeHtml(symbolOf(x.code)) + ' · ' + escapeHtml(exLabel(x.exchange)) + '</span>'
      +   '</span>'
      +   '<span class="rank-nums">'
      +     '<span class="q-price" id="usp-' + id + '">–</span>'
      +     '<span class="q-chg flat" id="usc-' + id + '">–</span>'
      +   '</span>'
      +   '<span class="rank-tv"><span id="usv-' + id + '"></span></span>'
      + '</button>'
      + '<button class="fav-btn' + (on ? ' on' : '') + '" data-ufav="' + escapeAttr(x.code) + '"'
      +   ' onclick="Us.toggleFav(\'' + escapeJsArg(x.code) + '\')" aria-label="' + (on ? '관심종목에서 빼기' : '관심종목에 담기') + '">'
      +   (on ? '♥' : '♡') + '</button>'
      + '</div>';
  }

  function listFootHtml(sort) {
    var more = '';
    if (sort !== 'fav') {
      more = '<button class="cn-more" onclick="Us.toggleAll()" aria-expanded="' + listAll + '">'
        + (listAll ? '접기' : LIST_MORE + '개 보기') + '</button>';
    }
    var note = sort === 'up' || sort === 'down'
      ? '나스닥·뉴욕·아멕스 · 1달러 이상, 거래대금 1천만 달러 이상 종목 · 정규장 기준'
      : '나스닥·뉴욕·아멕스 · 달러 기준 · 정규장 기준';
    return more + '<div class="rank-note">' + note + '</div>';
  }

  function paintRows(items, sort) {
    items.forEach(function (x) {
      var id = rowId(x.code);
      var p = document.getElementById('usp-' + id);
      var c = document.getElementById('usc-' + id);
      var v = document.getElementById('usv-' + id);
      if (!p || !c) return;
      setTextFlash(p, '$' + fmtUsd(x.price), dirOf('us:' + x.code, x.price));
      c.textContent = fmtRate(x.changeRate);
      c.className = 'q-chg ' + signClass(x.change);
      if (v) v.textContent = sort === 'cap' ? fmtUsdCompact(x.marketCap) : (x.valueUsd != null ? fmtUsdCompact(x.valueUsd) : '');
    });
  }

  async function toggleFav(code) {
    if (!isCode(code) || favBusy[code]) return;
    favBusy[code] = true;
    var sel = '[data-ufav="' + (window.CSS && CSS.escape ? CSS.escape(code) : code) + '"]';
    document.querySelectorAll(sel).forEach(function (b) { b.disabled = true; });
    try {
      var on = await toggleUsWatch(code);
      document.querySelectorAll(sel).forEach(function (b) {
        b.classList.toggle('on', on);
        b.textContent = on ? '♥' : '♡';
        b.setAttribute('aria-label', on ? '관심종목에서 빼기' : '관심종목에 담기');
      });
      if (listSort === 'fav' && !cur) { listKey = ''; loadList(); }
    } catch (e) {
      alert(e && e.message ? e.message : '관심종목 저장에 실패했습니다.');
    } finally {
      favBusy[code] = false;
      document.querySelectorAll(sel).forEach(function (b) { b.disabled = false; });
    }
  }

  /* ===== 종목 상세 ===== */
  function current() { return cur ? cur.code : null; }

  function reset() {
    if (!cur) return;
    cur = null;
    lastQuote = null;
    stopPolling();
    chartSeq++;
    if (chart) { chart.dispose(); chart = null; }
    chartBars = null;
  }

  function stopPolling() { Poller.remove('usQuote'); Poller.remove('usBars'); }

  function startPolling() {
    if (!cur) return;
    Poller.add('usQuote', loadQuote, function () { return active() ? 3000 : 60000; });
    Poller.add('usBars', refreshBars, function () { return active() ? (tf === 'm5' ? 60000 : 300000) : 600000; });
  }

  function url(code) {
    var u = new URL(location.href);
    if (code) u.searchParams.set('us', code);
    else u.searchParams.delete('us');
    u.searchParams.delete('code');
    u.searchParams.delete('coin');
    u.searchParams.delete('briefing');
    return u.pathname + u.search + u.hash;
  }

  /**
   * @param opts.fromPop  뒤로/앞으로 가기로 열 때 — 기록을 새로 쌓지 않는다
   * @param opts.replace  딥링크로 처음 열 때 — 지금 기록을 바꿔 쓴다
   */
  function open(code, name, opts) {
    if (!isCode(code)) return;
    opts = opts || {};
    if (!detailOpen()) {
      _detailFrom = currentTab;
      if (currentTab === 'market') _homeScrollY = window.pageYOffset || 0;
    }
    var same = cur && cur.code === code;
    // 종목·코인 상세를 보다가 넘어오면 그쪽 폴러·차트를 정리한다
    if (curStock) {
      curStock = null;
      var tb = document.getElementById('mkTradeBar');
      if (tb) tb.remove();
    }
    // 국내 차트 — 받는 중이던 차트가 도착해 떨어진 화면에 붙지 않게 세대를 올리고, 남은 것은 언제나 치운다
    if (typeof _chartSeq !== 'undefined') _chartSeq++;
    if (chartHandle) { chartHandle.dispose(); chartHandle = null; }
    if (window.Coin) Coin.reset();
    reset();
    Poller.stopAll();
    cur = { code: code, name: String(name || symbolOf(code)) };
    tf = 'D';
    resetDirs('ux:');

    document.getElementById('marketHome').style.display = 'none';
    var el = document.getElementById('stockDetail');
    el.style.display = '';
    el.innerHTML = shellHtml(cur.code, cur.name);
    window.scrollTo(0, 0);
    clearSearch();
    if (!opts.fromPop) {
      try {
        var st = { dtUs: code, dtName: cur.name, dtPushed: true };
        if (opts.replace || same) {
          st.dtPushed = !!(history.state && history.state.dtPushed);
          history.replaceState(st, '', url(code));
        } else history.pushState(st, '', url(code));
      } catch (e) { /* 기록 API 가 막힌 환경 */ }
    }
    switchTab('market');           // enterMarketTab 이 startPolling 을 돌린다
    loadChart();
    ensureWatchlist().then(syncStar);
  }

  function back() {
    if (history.state && history.state.dtUs && history.state.dtPushed) {
      _backToHome = true;
      history.back();
      return;
    }
    try { history.replaceState(null, '', url(null)); } catch (e) {}
    closeDetail(true);
  }

  function share() {
    if (!cur || typeof shareLink !== 'function') return;
    shareLink(cur.name + ' - DT 재테크', cur.name + ' (' + symbolOf(cur.code) + ')', investUrl('us=' + encodeURIComponent(cur.code)));
  }

  function syncStar() {
    var b = document.getElementById('usStar');
    if (!b || !cur) return;
    var on = usWatchlist.indexOf(cur.code) !== -1;
    b.classList.toggle('on', on);
    b.textContent = on ? '♥' : '♡';
  }

  function shellHtml(code, name) {
    var on = usWatchlist.indexOf(code) !== -1;
    return ''
      + '<div class="sd-head">'
      +   '<button class="mini-btn sd-back" onclick="Us.back()">← 시세</button>'
      +   logoHtml(code, name, 'lg')
      +   '<span class="sd-title" id="sdTitle">' + escapeHtml(name) + '</span>'
      +   '<button class="share-btn sd-share" onclick="Us.share()" aria-label="종목 공유">↗</button>'
      +   '<button class="fav-btn sd-fav' + (on ? ' on' : '') + '" id="usStar" data-ufav="' + escapeAttr(code) + '"'
      +     ' onclick="Us.toggleFav(\'' + escapeJsArg(code) + '\')" aria-label="관심종목">' + (on ? '♥' : '♡') + '</button>'
      + '</div>'
      + '<div class="sd-sub" id="sdSub">' + escapeHtml(symbolOf(code)) + ' · 미국</div>'
      + '<div class="sd-price-block" id="uxPrice"><div class="loading">시세 불러오는 중...</div></div>'
      + '<div id="uxRange"></div>'
      + '<div class="sd-stats" id="uxStats"></div>'
      + '<div class="sd-panel" id="uxChart">'
      +   '<button type="button" class="cm-toggle" id="cmToggle" onclick="Us.toggleChartMode()" aria-pressed="false">'
      +     '<span class="cm-check" aria-hidden="true">✓</span>자세히 보기'
      +   '</button>'
      +   '<div class="tf-row cn-tf">' + TF_LIST.map(function (x) {
            return '<button class="tf-btn' + (x[0] === 'D' ? ' on' : '') + '" data-utf="' + x[0] + '" onclick="Us.setTf(\'' + x[0] + '\')">' + x[1] + '</button>';
          }).join('') + '</div>'
      +   '<div class="chart-hilo" id="uxHiLo" style="display:none"></div>'
      +   '<div class="ma-legend" id="uxMaLegend" style="display:none"></div>'
      +   '<div class="chart-box" id="uxChartBox"><div class="loading">차트 불러오는 중...</div></div>'
      +   '<div class="cn-chart-note" id="uxChartNote">일봉 날짜는 미국 현지 날짜입니다</div>'
      + '</div>'
      + '<a class="ext-link" href="https://m.stock.naver.com/worldstock/stock/' + encodeURIComponent(code) + '/total" target="_blank" rel="noopener noreferrer">네이버 증권에서 보기 →</a>'
      + '<div class="disclaimer">⚠️ 네이버 증권 미국 주식 시세 · 투자 참고용 · 지연·오류가 있을 수 있습니다.</div>';
  }

  /** 상태 배지 — 정규장 / 프리마켓 / 애프터마켓 / 장 마감 (네이버 값 기준) */
  function stateOf(q) {
    if (q.halted) return { text: '거래 정지', cls: 'closed' };
    if (q.status === 'OPEN') return { text: '정규장', cls: 'live' };
    if (q.over && q.over.open) return { text: sessionLabel(q.over), cls: 'live' };
    return { text: '장 마감', cls: 'closed' };
  }

  async function loadQuote() {
    if (!cur) return;
    var code = cur.code;
    var box = document.getElementById('uxPrice');
    try {
      var q = await Market.usQuote(code);
      if (q.error) throw new Error(q.error);
      if (!cur || cur.code !== code) return;
      box = document.getElementById('uxPrice');
      if (!box) return;
      lastQuote = q;
      // 딥링크로 코드만 알고 들어왔으면 이름을 채운다
      if (q.name && cur.name === symbolOf(code) && q.name !== cur.name) {
        cur.name = String(q.name);
        var tEl = document.getElementById('sdTitle');
        if (tEl) tEl.textContent = cur.name;
        try {
          if (history.state && history.state.dtUs === code) {
            history.replaceState(Object.assign({}, history.state, { dtName: cur.name }), '', location.href);
          }
        } catch (e) {}
      }
      var cls = signClass(q.change);
      if (!box.dataset.built) {
        box.innerHTML = '<div class="sd-price" id="uxVal"></div><div class="sd-chg" id="uxChg"></div>'
          + '<div class="us-over" id="uxOver"></div><div class="sd-asof" id="uxAsOf"></div>';
        box.dataset.built = '1';
      }
      var vEl = document.getElementById('uxVal');
      setTextFlash(vEl, '$' + fmtUsd(q.price), dirOf('ux:' + code, q.price));
      vEl.className = 'sd-price ' + cls;
      var cEl = document.getElementById('uxChg');
      cEl.innerHTML = signMark(q.change) + ' ' + fmtUsd(Math.abs(q.change || 0), q.price != null && Math.abs(q.price) < 1 ? 4 : 2) + ' (' + fmtRate(q.changeRate) + ')'
        + (q.usdKrw && q.price != null ? ' <span class="vs">≈ ' + Math.round(q.price * q.usdKrw).toLocaleString('ko-KR') + '원</span>' : '');
      cEl.className = 'sd-chg ' + cls;

      // 프리·애프터마켓 가격 (정규장 중에는 숨긴다)
      var oEl = document.getElementById('uxOver');
      var o = q.over;
      if (o && o.price != null && q.status !== 'OPEN') {
        oEl.style.display = '';
        oEl.innerHTML = '<span class="us-over-k">' + sessionLabel(o) + '</span> '
          + '<b class="' + signClass(o.change) + '">$' + fmtUsd(o.price) + '</b> '
          + '<span class="' + signClass(o.change) + '">' + signMark(o.change) + ' ' + fmtRate(o.changeRate) + '</span>'
          + (o.asOf ? ' <span class="us-over-t">' + escapeHtml(kstStamp(o.asOf)) + '</span>' : '')
          + (o.open ? ' <span class="state-dot live">거래 중</span>' : '');
      } else {
        oEl.style.display = 'none';
      }

      // 이 줄은 위 가격(정규장) 기준 — 정규장이 닫혀 있으면 프리·애프터 중이어도 '정규장 마감'
      var st = q.halted || q.status === 'OPEN' ? stateOf(q) : { text: q.over && q.over.open ? '정규장 마감' : '장 마감', cls: 'closed' };
      var stale = isFeedStale('us');
      document.getElementById('uxAsOf').innerHTML = escapeHtml(kstStamp(q.asOf)) + ' 기준(한국 시각) · 네이버 '
        + '<span class="state-dot ' + (stale ? 'stale' : st.cls) + '">' + (stale ? '연결 끊김' : st.text) + '</span>';

      document.getElementById('sdSub').textContent = symbolOf(code) + ' · ' + exLabel(q.exchange)
        + (q.en ? ' · ' + q.en : '') + (q.industry ? ' · ' + q.industry : '');

      document.getElementById('uxStats').innerHTML = [
        ['거래대금', fmtUsdCompact(q.valueUsd)],
        ['거래량', q.volume != null ? fmtCompact(q.volume) + '주' : '-'],
        ['시가총액', q.marketValue ? escapeHtml(String(q.marketValue).replace(' USD', '달러')) : fmtUsdCompact(q.marketCap)],
        ['PER', escapeHtml(q.per || '-')],
        ['PBR', escapeHtml(q.pbr || '-')],
        ['배당수익률', escapeHtml(q.dividendYield || '-')]
      ].map(function (r) {
        return '<div class="stat"><span class="stat-k">' + r[0] + '</span><span class="stat-v">' + r[1] + '</span></div>';
      }).join('');

      document.getElementById('uxRange').innerHTML =
          rangeRow(q.status === 'OPEN' ? '오늘 범위' : '최근 거래일 범위', q.low, q.high, q.price)
        + rangeRow('52주 범위', minOf(q.low52, q.low), maxOf(q.high52, q.high), q.price);

      if (chart) updateChartLast();
    } catch (e) {
      if (box && !box.dataset.built) box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
      markFeedStale('#uxAsOf', 'us');       // 가격이 멈췄는데 '정규장' 배지가 남지 않게
    }
  }

  function minOf(a, b) { return a == null ? b : (b == null ? a : Math.min(a, b)); }
  function maxOf(a, b) { return a == null ? b : (b == null ? a : Math.max(a, b)); }
  function rangeRow(label, lo, hi, curP) {
    if (lo == null || hi == null || !(hi > lo)) return '';
    var pct = curP != null ? Math.max(0, Math.min(100, ((curP - lo) / (hi - lo)) * 100)) : null;
    return '<div class="range-row">'
      + '<div class="range-label">' + label + '</div>'
      + '<div class="range-bar-wrap">'
      +   '<span class="range-lo">' + fmtUsd(lo) + '</span>'
      +   '<span class="range-bar">' + (pct == null ? '' : '<i style="left:' + pct.toFixed(1) + '%"></i>') + '</span>'
      +   '<span class="range-hi">' + fmtUsd(hi) + '</span>'
      + '</div></div>';
  }

  /** 차트 끝점을 현재가에 맞춘다 — 정규장 중에만 새 봉을 연다 (장외에 유령 봉이 생기지 않게) */
  function updateChartLast() {
    if (!chart || !lastQuote || lastQuote.code !== (cur && cur.code)) return;
    var open = lastQuote.status === 'OPEN';
    if (tf === 'm5') {
      var k = new Date(Date.now() + 9 * 3600000);
      var mins = Math.floor((k.getUTCHours() * 60 + k.getUTCMinutes()) / 5) * 5;
      var b = Math.floor(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), Math.floor(mins / 60), mins % 60) / 1000);
      chart.updateLast(lastQuote.price, b, null, open);
    } else if (tf === 'D') {
      var day = localDay(lastQuote.asOf);
      if (day) chart.updateLast(lastQuote.price, day, null, open);
    } else {
      // 주·월봉은 마지막 봉의 종가만 맞춘다
      chart.updateLast(lastQuote.price, null, null, false);
    }
  }

  function chartOpts() {
    var ref = lastQuote && lastQuote.price;
    if (ref == null && chartBars && chartBars.length) ref = chartBars[chartBars.length - 1].c;
    var dg = ref != null && Math.abs(ref) < 1 ? 4 : 2;
    return { precision: dg, fmt: function (p) { return fmtUsd(p, dg); } };
  }

  function setTf(t) {
    tf = t;
    document.querySelectorAll('[data-utf]').forEach(function (b) { b.classList.toggle('on', b.dataset.utf === t); });
    var note = document.getElementById('uxChartNote');
    if (note) note.textContent = t === 'm5' ? '최근 거래일 정규장 5분봉 · 한국 시각' : '일봉 날짜는 미국 현지 날짜입니다';
    loadChart();
  }

  function toggleChartMode() {
    chartMode = chartMode === 'detail' ? 'simple' : 'detail';
    try { localStorage.setItem('dt-invest-chartmode', chartMode); } catch (e) {}
    syncChartModeBtn();
    loadChart();
  }

  async function loadChart() {
    if (!cur) return;
    var box = document.getElementById('uxChartBox');
    if (!box) return;
    var seq = ++chartSeq;
    var code = cur.code;
    syncChartModeBtn();
    box.innerHTML = '<div class="loading">차트 불러오는 중...</div>';
    if (chart) { chart.dispose(); chart = null; }
    try {
      var d = await Market.usCandles(code, tf);
      if (seq !== chartSeq) return;
      if (d.error) throw new Error(d.error);
      var bars = d.bars || [];
      if (!bars.length) { box.innerHTML = '<div class="empty">차트 데이터가 없습니다</div>'; return; }
      chartBars = bars;
      var handle = await renderChart(box, bars, tf === 'm5' ? 'm' : tf, chartMode, chartOpts());
      if (seq !== chartSeq) { handle.dispose(); return; }
      chart = handle;
      paintHiLo();
      var legend = document.getElementById('uxMaLegend');
      if (legend) {
        legend.style.display = chartMode === 'detail' ? '' : 'none';
        if (chartMode === 'detail') {
          legend.innerHTML = '<span class="ma-label">이동평균선</span>' + MA_DEFS.map(function (m) {
            return '<span class="ma-item" style="color:' + m[1] + '">' + m[0] + '</span>';
          }).join('');
        }
      }
      updateChartLast();
    } catch (e) {
      if (seq !== chartSeq) return;
      box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
    }
  }

  async function refreshBars() {
    if (!cur || !chart || !chart.replaceData) return;
    var seq = chartSeq, handle = chart, code = cur.code;
    try {
      var d = await Market.usCandles(code, tf);
      if (seq !== chartSeq || handle !== chart) return;
      var bars = d.bars || [];
      if (!bars.length) return;
      chart.replaceData(bars);
      chartBars = bars;
      paintHiLo();
      updateChartLast();
    } catch (e) { /* 다음 주기에 재시도 */ }
  }

  function paintHiLo() {
    var hl = document.getElementById('uxHiLo');
    if (!hl || !chart) return;
    if (chart.periodHigh == null || chart.periodLow == null) { hl.style.display = 'none'; return; }
    var o = chartOpts();
    hl.style.display = '';
    hl.innerHTML = '<span class="hl-hi">최고 $' + o.fmt(chart.periodHigh) + '</span>'
                 + '<span class="hl-lo">최저 $' + o.fmt(chart.periodLow) + '</span>';
  }

  function onThemeChanged() {
    if (cur && chart) loadChart();
  }

  return {
    isCode: isCode,
    searchHtml: searchHtml,
    exactMatch: exactMatch,
    fetchSearch: fetchSearch,
    loadList: loadList,
    pollMs: listPollMs,
    setSort: setSort,
    toggleAll: toggleAll,
    toggleFav: toggleFav,
    current: current,
    open: open,
    back: back,
    share: share,
    reset: reset,
    startPolling: startPolling,
    setTf: setTf,
    toggleChartMode: toggleChartMode,
    onThemeChanged: onThemeChanged
  };
})();
