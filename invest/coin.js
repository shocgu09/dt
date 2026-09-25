/* ===== DT 재테크 — 코인 시세 (업비트 원화 마켓) =====
 * 시세 표시만 한다 (모의투자 없음).
 *  - 시세 홈: 🪙 코인 섹션 (관심 · 24시간 거래대금 · 급상승 · 급하락), 검색 결과에 코인 합치기
 *  - 코인 상세: 현재가 · 오늘/52주 범위 · 차트 · 호가 · 체결
 * 종목 상세와 같은 #stockDetail 자리를 쓰고, 뒤로 가기·기록·폴러 규칙도 종목 상세(market-ui.js)를 따른다.
 * 코인은 24시간 거래되고 "전일 대비"와 일봉은 매일 오전 9시(KST)에 끊긴다.
 */
var Coin = (function () {
  var cur = null;                  // { market, name }
  var tf = 'D';
  var tab = 'chart';               // chart | book | trades
  var chart = null, chartBars = null, chartSeq = 0;
  var lastQuote = null;
  var listSort = 'value';          // fav | value | up | down
  var listAll = false;
  var listKey = '';                // 마지막으로 그린 목록의 '정렬|코드들' — 같으면 칸만 갈아 끼운다
  var infos = null, infosLoading = null;   // 원화 마켓 이름·시장경보 (검색·관심 코인용)
  var favBusy = {};

  var LIST_LIMIT = 15;
  var TF_LIST = [['m', '1분'], ['m5', '5분'], ['m15', '15분'], ['m60', '1시간'], ['D', '일'], ['W', '주'], ['M', '월']];
  var CAUTION_LABEL = {
    PRICE_FLUCTUATIONS: '가격 급등락',
    TRADING_VOLUME_SOARING: '거래량 급등',
    DEPOSIT_AMOUNT_SOARING: '입금량 급등',
    GLOBAL_PRICE_DIFFERENCES: '해외 가격 차이',
    CONCENTRATION_OF_SMALL_ACCOUNTS: '소수 계정 거래 집중'
  };

  function isMarket(m) { return /^KRW-[A-Z0-9]{1,15}$/.test(String(m || '')); }
  function symbolOf(m) { return String(m).slice(4); }

  /* ── 숫자 ── */
  // 업비트 원화 마켓 호가 단위를 따른 소수 자릿수 (100원 이상은 정수, 그 아래는 가격대마다 한 자리씩)
  function digits(p) {
    var a = Math.abs(Number(p));
    if (a >= 100) return 0;
    if (a >= 10) return 1;
    if (a >= 1) return 2;
    if (a >= 0.1) return 3;
    if (a >= 0.01) return 4;
    if (a >= 0.001) return 5;
    if (a >= 0.0001) return 6;
    return 8;
  }
  function fmtPrice(p, dg) {
    if (p == null || isNaN(p)) return '-';
    dg = dg == null ? digits(p) : dg;
    return Number(p).toLocaleString('ko-KR', { minimumFractionDigits: dg, maximumFractionDigits: dg });
  }
  // 수량 — 비트코인은 0.0005개, 1원짜리 코인은 수억 개라 크기에 따라 자릿수를 바꾼다
  function fmtQty(q) {
    if (q == null || isNaN(q)) return '-';
    q = Number(q);
    var a = Math.abs(q);
    if (a >= 1e5) return fmtCompact(q);
    if (a >= 100) return q.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
    if (a >= 1) return q.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
    return q.toLocaleString('ko-KR', { maximumSignificantDigits: 4 });
  }
  function kstClock(ms) {
    var d = new Date(Number(ms) + 9 * 3600000);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }

  /* ── 로고 · 배지 ── */
  function logoHtml(market, name, size) {
    var ch = String(name || symbolOf(market)).trim().charAt(0) || '·';
    return '<span class="s-logo' + (size ? ' ' + size : '') + '" aria-hidden="true">'
      + '<span class="s-logo-fb">' + escapeHtml(ch) + '</span>'
      + '<img src="https://static.upbit.com/logos/' + escapeAttr(symbolOf(market)) + '.png" alt="" loading="lazy" decoding="async"'
      + ' onload="this.parentNode.classList.add(\'ok\')" onerror="this.remove()">'
      + '</span>';
  }
  function badgesHtml(x) {
    var h = '';
    if (x && x.warning) h += '<span class="cn-badge warn" title="거래지원 종료 가능성이 있는 유의 종목">유의</span>';
    if (x && x.caution && x.caution.length) {
      var why = x.caution.map(function (k) { return CAUTION_LABEL[k] || k; }).join(', ');
      h += '<span class="cn-badge caution" title="주의: ' + escapeAttr(why) + '">주의</span>';
    }
    return h;
  }

  /* ── 원화 마켓 목록 (이름·시장경보) — 검색과 관심 코인 이름에 쓴다 ── */
  function ensureInfos() {
    if (infos) return Promise.resolve(infos);
    if (infosLoading) return infosLoading;
    infosLoading = Market.coinMarkets().then(function (d) {
      infos = (d.items || []).filter(function (x) { return isMarket(x.market); });
      infos.forEach(function (x) { x._cho = chosungOf(x.name || ''); });
      infosLoading = null;
      return infos;
    }).catch(function () { infosLoading = null; return []; });
    return infosLoading;
  }

  /** 검색 결과 맨 위에 붙일 코인 (최대 5개). 목록을 아직 못 받았으면 빈 문자열.
   *  같은 등급 안에서는 목록 순서(= 24시간 거래대금 순)를 따른다 */
  function searchHtml(q) {
    if (!infos) { ensureInfos(); return ''; }
    var raw = String(q || '').trim();
    var t = raw.toLowerCase().replace(/\s+/g, '');
    if (!t) return '';
    var up = t.toUpperCase();
    var scored = [];
    infos.forEach(function (x, i) {
      var name = String(x.name || '').replace(/\s+/g, '').toLowerCase();
      var en = String(x.en || '').replace(/\s+/g, '').toLowerCase();
      var sym = symbolOf(x.market);
      var s = -1;
      if (sym === up) s = 0;
      else if (name === t) s = 1;
      else if (name.indexOf(t) === 0 || sym.indexOf(up) === 0) s = 2;
      else if (name.indexOf(t) !== -1 || (t.length >= 2 && en.indexOf(t) !== -1)) s = 3;
      else if (/^[ㄱ-ㅎ]+$/.test(t) && x._cho.indexOf(t) === 0) s = 4;
      else if (/^[ㄱ-ㅎ]+$/.test(t) && x._cho.indexOf(t) !== -1) s = 5;
      if (s !== -1) scored.push({ s: s, i: i, x: x });
    });
    scored.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    return scored.slice(0, 5).map(function (r) {
      var x = r.x;
      return '<button class="sr-item" role="option" onclick="Coin.open(\'' + x.market + '\',\'' + escapeJsArg(x.name) + '\')">'
        + logoHtml(x.market, x.name, 'sm')
        + '<span class="sr-name">' + escapeHtml(x.name) + '</span>' + badgesHtml(x)
        + '<span class="sr-meta">코인 · ' + escapeHtml(symbolOf(x.market)) + '</span>'
        + '</button>';
    }).join('');
  }

  /* ===== 시세 홈 — 🪙 코인 섹션 ===== */
  function setSort(s) {
    listSort = s;
    listAll = false;
    document.querySelectorAll('[data-csort]').forEach(function (b) { b.classList.toggle('on', b.dataset.csort === s); });
    loadList();
  }

  /** 시세 홈 목록 폴링 주기 — 전체(약 290개)를 펼쳤을 때는 10초 */
  function listPollMs() { return listAll ? 10000 : 5000; }

  function toggleAll() {
    listAll = !listAll;
    loadList();
  }

  async function loadList() {
    var el = document.getElementById('coinList');
    if (!el) return;
    var sort = listSort, all = listAll;
    var want = sort + (all ? ':all' : '');
    if (el.dataset.want !== want) { el.dataset.want = want; el.innerHTML = '<div class="loading">불러오는 중...</div>'; listKey = ''; }
    try {
      var d;
      if (sort === 'fav') {
        await ensureWatchlist();
        if (!coinWatchlist.length) {
          el.innerHTML = '<div class="empty">관심 코인이 없습니다<br><span class="cn-empty-sub">목록의 ♡ 를 누르면 여기에 모입니다</span></div>';
          listKey = '';
          return;
        }
        d = await Market.coinListOf(coinWatchlist);
        // 담은 순서대로
        var byM = {};
        (d.items || []).forEach(function (x) { byM[x.market] = x; });
        d.items = coinWatchlist.map(function (m) { return byM[m]; }).filter(Boolean);
      } else {
        d = await Market.coinList(sort, all ? 300 : LIST_LIMIT);
      }
      if (sort !== listSort || all !== listAll) return;       // 기다리는 사이 다른 정렬을 눌렀다
      el = document.getElementById('coinList');
      if (!el) return;
      var items = (d.items || []).filter(function (x) { return isMarket(x.market); });
      if (!items.length) { el.innerHTML = '<div class="empty">데이터가 없습니다</div>'; listKey = ''; return; }
      var key = want + '|' + items.map(function (x) { return x.market; }).join(',');
      if (key !== listKey) {
        el.innerHTML = items.map(rowHtml).join('') + listFootHtml(d, sort);
        listKey = key;
        resetDirs('cn:');
      }
      paintRows(items);
    } catch (e) {
      if (!el.querySelector('.rank-row')) el.innerHTML = '<div class="empty">코인 시세를 불러오지 못했습니다</div>';
    }
  }

  function rowHtml(x, i) {
    var on = coinWatchlist.indexOf(x.market) !== -1;
    return '<div class="q-row rank-row">'
      + '<button class="rank-main" onclick="Coin.open(\'' + x.market + '\',\'' + escapeJsArg(x.name) + '\')">'
      +   '<span class="q-rank">' + (i + 1) + '</span>'
      +   logoHtml(x.market, x.name)
      +   '<span class="rank-names">'
      +     '<span class="q-name">' + escapeHtml(x.name) + badgesHtml(x) + '</span>'
      +     '<span class="rank-code">' + escapeHtml(symbolOf(x.market)) + '</span>'
      +   '</span>'
      +   '<span class="rank-nums">'
      +     '<span class="q-price" id="cnp-' + x.market + '">–</span>'
      +     '<span class="q-chg flat" id="cnc-' + x.market + '">–</span>'
      +   '</span>'
      +   '<span class="rank-tv"><span id="cnv-' + x.market + '"></span></span>'
      + '</button>'
      + '<button class="fav-btn' + (on ? ' on' : '') + '" data-cfav="' + x.market + '"'
      +   ' onclick="Coin.toggleFav(\'' + x.market + '\')" aria-label="' + (on ? '관심 코인에서 빼기' : '관심 코인에 담기') + '">'
      +   (on ? '♥' : '♡') + '</button>'
      + '</div>';
  }

  function listFootHtml(d, sort) {
    var more = '';
    if (sort !== 'fav' && d.total > LIST_LIMIT) {
      more = '<button class="cn-more" onclick="Coin.toggleAll()" aria-expanded="' + listAll + '">'
        + (listAll ? '접기' : '전체 ' + d.total + '개 보기') + '</button>';
    }
    return more + '<div class="rank-note">업비트 원화 마켓 · 등락률은 오늘 오전 9시 대비 · 거래대금은 최근 24시간</div>';
  }

  function paintRows(items) {
    items.forEach(function (x) {
      var p = document.getElementById('cnp-' + x.market);
      var c = document.getElementById('cnc-' + x.market);
      var v = document.getElementById('cnv-' + x.market);
      if (!p || !c) return;
      setTextFlash(p, fmtPrice(x.price), dirOf('cn:' + x.market, x.price));
      c.textContent = fmtRate(x.changeRate);
      c.className = 'q-chg ' + signClass(x.change);
      if (v) v.textContent = x.value24h != null ? fmtCompact(x.value24h) + '원' : '';
    });
  }

  async function toggleFav(market) {
    if (!isMarket(market) || favBusy[market]) return;
    favBusy[market] = true;
    var btns = [].slice.call(document.querySelectorAll('[data-cfav="' + market + '"]'));
    btns.forEach(function (b) { b.disabled = true; });
    try {
      var on = await toggleCoinWatch(market);
      document.querySelectorAll('[data-cfav="' + market + '"]').forEach(function (b) {
        b.classList.toggle('on', on);
        b.textContent = on ? '♥' : '♡';
        b.setAttribute('aria-label', on ? '관심 코인에서 빼기' : '관심 코인에 담기');
      });
      if (listSort === 'fav' && !cur) { listKey = ''; loadList(); }
    } catch (e) {
      alert(e && e.message ? e.message : '관심 코인 저장에 실패했습니다.');
    } finally {
      favBusy[market] = false;
      document.querySelectorAll('[data-cfav="' + market + '"]').forEach(function (b) { b.disabled = false; });
    }
  }

  /* ===== 코인 상세 ===== */
  function current() { return cur ? cur.market : null; }

  /** 상세를 닫을 때 (종목 상세로 넘어가거나 시세 홈으로 돌아갈 때) — 폴러·차트만 정리한다 */
  function reset() {
    if (!cur) return;
    cur = null;
    lastQuote = null;
    stopPolling();
    chartSeq++;
    if (chart) { chart.dispose(); chart = null; }
    chartBars = null;
  }

  function stopPolling() {
    Poller.remove('coinQuote'); Poller.remove('coinBars'); Poller.remove('coinBook'); Poller.remove('coinTrades');
  }

  function startPolling() {
    if (!cur) return;
    Poller.add('coinQuote', loadQuote, 3000);
    Poller.add('coinBars', refreshBars, function () { return tf.charAt(0) === 'm' ? 30000 : 120000; });
    if (tab === 'book') Poller.add('coinBook', loadBook, 3000);
    if (tab === 'trades') Poller.add('coinTrades', loadTrades, 3000);
  }

  function url(market) {
    var u = new URL(location.href);
    if (market) u.searchParams.set('coin', market);
    else u.searchParams.delete('coin');
    u.searchParams.delete('code');
    u.searchParams.delete('briefing');
    return u.pathname + u.search + u.hash;
  }

  /**
   * @param opts.fromPop  뒤로/앞으로 가기로 열 때 — 기록을 새로 쌓지 않는다
   * @param opts.replace  딥링크로 처음 열 때 — 지금 기록을 바꿔 쓴다
   */
  function open(market, name, opts) {
    if (!isMarket(market)) return;
    opts = opts || {};
    // 시세 홈에서 들어가면 스크롤 위치를 기억해 둔다 (종목 상세와 같은 변수)
    if (!detailOpen()) {
      _detailFrom = currentTab;
      if (currentTab === 'market') _homeScrollY = window.pageYOffset || 0;
    }
    var same = cur && cur.market === market;
    // 종목 상세를 보다가 넘어오면 그쪽 폴러·차트를 정리한다
    if (curStock) {
      curStock = null;
      if (chartHandle) { chartHandle.dispose(); chartHandle = null; }
      var tb = document.getElementById('mkTradeBar');
      if (tb) tb.remove();
    }
    reset();
    Poller.stopAll();
    cur = { market: market, name: String(name || symbolOf(market)) };
    tf = 'D';
    tab = 'chart';
    resetDirs('cx:');

    document.getElementById('marketHome').style.display = 'none';
    var el = document.getElementById('stockDetail');
    el.style.display = '';
    el.innerHTML = shellHtml(cur.market, cur.name);
    window.scrollTo(0, 0);
    clearSearch();
    if (!opts.fromPop) {
      try {
        var st = { dtCoin: market, dtName: cur.name, dtPushed: true };
        if (opts.replace || same) {
          st.dtPushed = !!(history.state && history.state.dtPushed);
          history.replaceState(st, '', url(market));
        } else history.pushState(st, '', url(market));
      } catch (e) { /* 기록 API 가 막힌 환경 */ }
    }
    switchTab('market');           // enterMarketTab 이 startPolling 을 돌린다
    loadChart();
    ensureWatchlist().then(syncStar);
  }

  /** "← 시세" — 쌓아 둔 기록이 있으면 뒤로 가기와 똑같이 닫는다 */
  function back() {
    if (history.state && history.state.dtCoin && history.state.dtPushed) {
      _backToHome = true;
      history.back();              // popstate 가 closeDetail 을 부른다
      return;
    }
    try { history.replaceState(null, '', url(null)); } catch (e) {}
    closeDetail(true);
  }

  function share() {
    if (!cur || typeof shareLink !== 'function') return;
    shareLink(cur.name + ' - DT 재테크', cur.name + ' (' + symbolOf(cur.market) + ')', investUrl('coin=' + cur.market));
  }

  function syncStar() {
    var b = document.getElementById('coinStar');
    if (!b || !cur) return;
    var on = coinWatchlist.indexOf(cur.market) !== -1;
    b.classList.toggle('on', on);
    b.textContent = on ? '♥' : '♡';
  }

  function shellHtml(market, name) {
    var on = coinWatchlist.indexOf(market) !== -1;
    return ''
      + '<div class="sd-head">'
      +   '<button class="mini-btn sd-back" onclick="Coin.back()">← 시세</button>'
      +   logoHtml(market, name, 'lg')
      +   '<span class="sd-title" id="sdTitle">' + escapeHtml(name) + '</span>'
      +   '<button class="share-btn sd-share" onclick="Coin.share()" aria-label="코인 공유">↗</button>'
      +   '<button class="fav-btn sd-fav' + (on ? ' on' : '') + '" id="coinStar" data-cfav="' + market + '"'
      +     ' onclick="Coin.toggleFav(\'' + market + '\')" aria-label="관심 코인">' + (on ? '♥' : '♡') + '</button>'
      + '</div>'
      + '<div class="sd-sub" id="sdSub">' + escapeHtml(symbolOf(market)) + ' · 업비트 원화 마켓</div>'
      + '<div class="cn-alert" id="cxAlert" style="display:none"></div>'
      + '<div class="sd-price-block" id="cxPrice"><div class="loading">시세 불러오는 중...</div></div>'
      + '<div id="cxRange"></div>'
      + '<div class="sd-stats" id="cxStats"></div>'
      + '<div class="sd-tabs">'
      +   '<button class="sd-tab on" data-cxtab="chart" onclick="Coin.setTab(\'chart\')">차트</button>'
      +   '<button class="sd-tab" data-cxtab="book" onclick="Coin.setTab(\'book\')">호가</button>'
      +   '<button class="sd-tab" data-cxtab="trades" onclick="Coin.setTab(\'trades\')">체결</button>'
      + '</div>'
      + '<div class="sd-panel" id="cxChart">'
      +   '<button type="button" class="cm-toggle" id="cmToggle" onclick="Coin.toggleChartMode()" aria-pressed="false">'
      +     '<span class="cm-check" aria-hidden="true">✓</span>자세히 보기'
      +   '</button>'
      +   '<div class="tf-row cn-tf">' + TF_LIST.map(function (x) {
            return '<button class="tf-btn' + (x[0] === 'D' ? ' on' : '') + '" data-ctf="' + x[0] + '" onclick="Coin.setTf(\'' + x[0] + '\')">' + x[1] + '</button>';
          }).join('') + '</div>'
      +   '<div class="chart-hilo" id="cxHiLo" style="display:none"></div>'
      +   '<div class="ma-legend" id="cxMaLegend" style="display:none"></div>'
      +   '<div class="chart-box" id="cxChartBox"><div class="loading">차트 불러오는 중...</div></div>'
      +   '<div class="cn-chart-note">일봉은 매일 오전 9시에 시작합니다</div>'
      + '</div>'
      + '<div class="sd-panel" id="cxBook" style="display:none"><div class="loading">불러오는 중...</div></div>'
      + '<div class="sd-panel" id="cxTrades" style="display:none"><div class="loading">불러오는 중...</div></div>'
      + '<a class="ext-link" href="https://upbit.com/exchange?code=CRIX.UPBIT.' + market + '" target="_blank" rel="noopener noreferrer">업비트에서 보기 →</a>'
      + '<div class="disclaimer">⚠️ 업비트 원화 마켓 시세 · 투자 참고용 · 지연·오류가 있을 수 있습니다.</div>';
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll('[data-cxtab]').forEach(function (b) { b.classList.toggle('on', b.dataset.cxtab === t); });
    document.getElementById('cxChart').style.display = t === 'chart' ? '' : 'none';
    document.getElementById('cxBook').style.display = t === 'book' ? '' : 'none';
    document.getElementById('cxTrades').style.display = t === 'trades' ? '' : 'none';
    Poller.remove('coinBook'); Poller.remove('coinTrades');
    if (t === 'book') Poller.add('coinBook', loadBook, 3000);
    if (t === 'trades') Poller.add('coinTrades', loadTrades, 3000);
  }

  async function loadQuote() {
    if (!cur) return;
    var market = cur.market;
    var box = document.getElementById('cxPrice');
    try {
      var q = await Market.coinQuote(market);
      if (!cur || cur.market !== market) return;
      box = document.getElementById('cxPrice');
      if (!box) return;
      lastQuote = q;
      // 딥링크로 코드만 알고 들어왔으면 이름을 채운다
      if (q.name && cur.name === symbolOf(market) && q.name !== cur.name) {
        cur.name = String(q.name);
        var tEl = document.getElementById('sdTitle');
        if (tEl) tEl.textContent = cur.name;
        try {
          if (history.state && history.state.dtCoin === market) {
            history.replaceState(Object.assign({}, history.state, { dtName: cur.name }), '', location.href);
          }
        } catch (e) {}
      }
      var cls = signClass(q.change);
      var dg = digits(q.price);
      if (!box.dataset.built) {
        box.innerHTML = '<div class="sd-price" id="cxVal"></div><div class="sd-chg" id="cxChg"></div><div class="sd-asof" id="cxAsOf"></div>';
        box.dataset.built = '1';
      }
      var vEl = document.getElementById('cxVal');
      setTextFlash(vEl, fmtPrice(q.price, dg), dirOf('cx:' + market, q.price));
      vEl.className = 'sd-price ' + cls;
      var cEl = document.getElementById('cxChg');
      cEl.innerHTML = signMark(q.change) + ' ' + fmtPrice(Math.abs(q.change || 0), dg)
        + ' (' + fmtRate(q.changeRate) + ') <span class="vs">오늘 9시보다</span>';
      cEl.className = 'sd-chg ' + cls;
      var stale = isFeedStale();
      document.getElementById('cxAsOf').innerHTML = escapeHtml(shortTime(q.asOf)) + ' 기준 · 업비트 '
        + '<span class="state-dot ' + (stale ? 'stale' : 'live') + '">' + (stale ? '연결 끊김' : '24시간') + '</span>';

      document.getElementById('sdSub').textContent = symbolOf(market) + (q.en ? ' · ' + q.en : '') + ' · 업비트 원화 마켓';
      var al = document.getElementById('cxAlert');
      if (al) {
        var parts = [];
        if (q.warning) parts.push('<b>유의 종목</b> — 거래지원이 종료될 수 있습니다');
        if (q.caution && q.caution.length) {
          parts.push('<b>주의</b> — ' + escapeHtml(q.caution.map(function (k) { return CAUTION_LABEL[k] || k; }).join(', ')));
        }
        al.style.display = parts.length ? '' : 'none';
        al.innerHTML = parts.join('<br>');
      }

      document.getElementById('cxStats').innerHTML = [
        ['거래대금(24시간)', fmtCompact(q.value24h) + '원'],
        ['거래량(24시간)', fmtQty(q.volume24h) + ' ' + escapeHtml(symbolOf(market))],
        ['고가', fmtPrice(q.high, dg)],
        ['저가', fmtPrice(q.low, dg)]
      ].map(function (r) {
        return '<div class="stat"><span class="stat-k">' + r[0] + '</span><span class="stat-v">' + r[1] + '</span></div>';
      }).join('');

      document.getElementById('cxRange').innerHTML =
          rangeRow('오늘 범위', q.low, q.high, q.price, dg)
        + rangeRow('52주 범위', q.low52, q.high52, q.price, dg);

      if (chart) chart.updateLast(q.price, bucketTime(), null, tf.charAt(0) === 'm' || tf === 'D');
    } catch (e) {
      if (box && !box.dataset.built) box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
    }
  }

  function rangeRow(label, lo, hi, curP, dg) {
    if (lo == null || hi == null || !(hi > lo)) return '';
    var pct = (curP != null && hi > lo) ? Math.max(0, Math.min(100, ((curP - lo) / (hi - lo)) * 100)) : null;
    return '<div class="range-row">'
      + '<div class="range-label">' + label + '</div>'
      + '<div class="range-bar-wrap">'
      +   '<span class="range-lo">' + fmtPrice(lo, dg) + '</span>'
      +   '<span class="range-bar">' + (pct == null ? '' : '<i style="left:' + pct.toFixed(1) + '%"></i>') + '</span>'
      +   '<span class="range-hi">' + fmtPrice(hi, dg) + '</span>'
      + '</div></div>';
  }

  /** 지금 시각이 속한 봉 — 분봉은 KST 벽시계 분, 일봉은 오전 9시에 날짜가 바뀐다 */
  function bucketTime() {
    var k = new Date(Date.now() + 9 * 3600000);
    var step = { m: 1, m5: 5, m15: 15, m60: 60 }[tf];
    if (step) {
      var mins = k.getUTCHours() * 60 + k.getUTCMinutes();
      mins = Math.floor(mins / step) * step;
      return Math.floor(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), Math.floor(mins / 60), mins % 60) / 1000);
    }
    var d = new Date(Date.now());          // UTC 날짜 = KST 오전 9시에 바뀌는 날짜
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }

  function chartOpts() {
    // 봉 전체에서 가장 작은 가격 기준으로 자릿수를 잡는다 (축 눈금이 한 코인 안에서 들쭉날쭉하지 않게)
    var ref = lastQuote && lastQuote.price;
    if (ref == null && chartBars && chartBars.length) ref = chartBars[chartBars.length - 1].c;
    var dg = ref != null ? digits(ref) : 0;
    return { precision: dg, fmt: function (p) { return fmtPrice(p, dg); } };
  }

  function setTf(t) {
    tf = t;
    document.querySelectorAll('[data-ctf]').forEach(function (b) { b.classList.toggle('on', b.dataset.ctf === t); });
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
    var box = document.getElementById('cxChartBox');
    if (!box) return;
    var seq = ++chartSeq;
    var market = cur.market;
    syncChartModeBtn();
    box.innerHTML = '<div class="loading">차트 불러오는 중...</div>';
    if (chart) { chart.dispose(); chart = null; }
    try {
      var d = await Market.coinCandles(market, tf);
      if (seq !== chartSeq) return;
      var bars = d.bars || [];
      if (!bars.length) { box.innerHTML = '<div class="empty">차트 데이터가 없습니다</div>'; return; }
      chartBars = bars;
      // renderChart 는 tf 가 'm' 이면 축에 시각을 찍는다 — 코인의 모든 분봉 단위를 'm' 으로 넘긴다
      var handle = await renderChart(box, bars, tf.charAt(0) === 'm' ? 'm' : tf, chartMode, chartOpts());
      if (seq !== chartSeq) { handle.dispose(); return; }
      chart = handle;
      paintHiLo();
      var legend = document.getElementById('cxMaLegend');
      if (legend) {
        legend.style.display = chartMode === 'detail' ? '' : 'none';
        if (chartMode === 'detail') {
          legend.innerHTML = '<span class="ma-label">이동평균선</span>' + MA_DEFS.map(function (m) {
            return '<span class="ma-item" style="color:' + m[1] + '">' + m[0] + '</span>';
          }).join('');
        }
      }
      if (lastQuote && lastQuote.market === market) chart.updateLast(lastQuote.price, bucketTime(), null, tf.charAt(0) === 'm' || tf === 'D');
    } catch (e) {
      if (seq !== chartSeq) return;
      box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
    }
  }

  async function refreshBars() {
    if (!cur || !chart || !chart.replaceData) return;
    var seq = chartSeq, handle = chart, market = cur.market;
    try {
      var d = await Market.coinCandles(market, tf);
      if (seq !== chartSeq || handle !== chart) return;
      var bars = d.bars || [];
      if (!bars.length) return;
      chart.replaceData(bars);
      chartBars = bars;
      paintHiLo();
      if (lastQuote && lastQuote.market === market) chart.updateLast(lastQuote.price, bucketTime(), null, tf.charAt(0) === 'm' || tf === 'D');
    } catch (e) { /* 다음 주기에 재시도 */ }
  }

  function paintHiLo() {
    var hl = document.getElementById('cxHiLo');
    if (!hl || !chart) return;
    if (chart.periodHigh == null || chart.periodLow == null) { hl.style.display = 'none'; return; }
    var o = chartOpts();
    hl.style.display = '';
    hl.innerHTML = '<span class="hl-hi">최고 ' + o.fmt(chart.periodHigh) + '</span>'
                 + '<span class="hl-lo">최저 ' + o.fmt(chart.periodLow) + '</span>';
  }

  /** 주간/야간 전환 — 차트 색이 그릴 때 굳으므로 다시 그린다 */
  function onThemeChanged() {
    if (cur && chart) loadChart();
  }

  /* ── 호가 (15단계씩) ── */
  var BOOK_LEVELS = 15;
  async function loadBook() {
    if (!cur || tab !== 'book') return;
    var market = cur.market;
    var wrap = document.getElementById('cxBook');
    try {
      var b = await Market.coinBook(market);
      if (!cur || cur.market !== market || tab !== 'book') return;
      wrap = document.getElementById('cxBook');
      if (!wrap) return;
      var ask = (b.ask || []).slice(0, BOOK_LEVELS).reverse();     // 높은 매도 호가가 위로
      var bid = (b.bid || []).slice(0, BOOK_LEVELS);
      var max = Math.max.apply(null, ask.concat(bid).map(function (a) { return a.qty || 0; }).concat([0])) || 1;
      var dg = digits((bid[0] && bid[0].price) || (ask[0] && ask[0].price) || 0);
      var now = lastQuote && lastQuote.market === market ? lastQuote.price : null;
      var ref = lastQuote && lastQuote.market === market ? lastQuote.prevClose : null;
      var pxCell = function (p) {
        var r = ref ? ((p - ref) / ref) * 100 : null;
        return '<span class="bk-price ' + (ref ? signClass(p - ref) : '') + (now != null && p === now ? ' cn-now' : '') + '">'
          + fmtPrice(p, dg) + (r != null ? '<em>' + fmtRate(r) + '</em>' : '') + '</span>';
      };
      var h = '<div class="bk-head"><span>매도 잔량</span><span>호가</span><span>매수 잔량</span></div>';
      h += ask.map(function (a) {
        return '<div class="bk-row">'
          + '<span class="bk-qty ask"><i style="width:' + ((a.qty / max) * 100).toFixed(1) + '%"></i><b>' + fmtQty(a.qty) + '</b></span>'
          + pxCell(a.price) + '<span class="bk-qty"></span></div>';
      }).join('');
      h += bid.map(function (a) {
        return '<div class="bk-row">'
          + '<span class="bk-qty"></span>' + pxCell(a.price)
          + '<span class="bk-qty bid"><i style="width:' + ((a.qty / max) * 100).toFixed(1) + '%"></i><b>' + fmtQty(a.qty) + '</b></span></div>';
      }).join('');
      var total = (b.askTotal || 0) + (b.bidTotal || 0);
      var askPct = total ? Math.round((b.askTotal / total) * 100) : 50;
      h += '<div class="bk-ratio"><span class="bk-ratio-bar"><i style="width:' + askPct + '%"></i></span>'
        + '<span class="bk-ratio-txt">매도 ' + fmtQty(b.askTotal) + ' · 매수 ' + fmtQty(b.bidTotal)
        + ' (' + askPct + ' : ' + (100 - askPct) + ')</span></div>'
        + '<div class="bk-note">업비트 호가 ' + BOOK_LEVELS + '단계 · 잔량 단위 ' + escapeHtml(symbolOf(market)) + '</div>';
      wrap.innerHTML = h;
    } catch (e) {
      if (wrap && !wrap.querySelector('.bk-row')) wrap.innerHTML = '<div class="empty">호가를 불러오지 못했습니다</div>';
    }
  }

  /* ── 체결 ── */
  async function loadTrades() {
    if (!cur || tab !== 'trades') return;
    var market = cur.market;
    var wrap = document.getElementById('cxTrades');
    try {
      var d = await Market.coinTrades(market);
      if (!cur || cur.market !== market || tab !== 'trades') return;
      wrap = document.getElementById('cxTrades');
      if (!wrap) return;
      var items = d.items || [];
      if (!items.length) { wrap.innerHTML = '<div class="empty">체결 내역이 없습니다</div>'; return; }
      var dg = digits(items[0].price);
      wrap.innerHTML = '<div class="cn-tr-head"><span>시각</span><span>체결가</span><span>체결량</span><span>금액</span></div>'
        + items.slice(0, 30).map(function (t) {
          var cls = t.side === 'buy' ? 'up' : 'down';
          return '<div class="cn-tr-row">'
            + '<span class="cn-tr-time">' + kstClock(t.at) + '</span>'
            + '<span class="' + cls + '">' + fmtPrice(t.price, dg) + '</span>'
            + '<span class="' + cls + '">' + fmtQty(t.qty) + '</span>'
            + '<span class="cn-tr-amt">' + fmtCompact(Math.round(t.price * t.qty)) + '</span>'
            + '</div>';
        }).join('')
        + '<div class="bk-note">빨강은 매수 체결, 파랑은 매도 체결 · 최근 30건</div>';
    } catch (e) {
      if (wrap && !wrap.querySelector('.cn-tr-row')) wrap.innerHTML = '<div class="empty">체결 내역을 불러오지 못했습니다</div>';
    }
  }

  return {
    isMarket: isMarket,
    ensureInfos: ensureInfos,
    searchHtml: searchHtml,
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
    setTab: setTab,
    setTf: setTf,
    toggleChartMode: toggleChartMode,
    onThemeChanged: onThemeChanged
  };
})();
