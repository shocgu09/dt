/* ===== DT 재테크 — 모의투자 모드 =====
 * 헤더의 모의투자 버튼을 켤 때 처음 불러온다. 끄면 재테크 화면은 예전과 완전히 같다.
 * 장부는 dt-stock 워커(D1)에만 있고, 여기서는 주문을 "요청"하고 결과를 그릴 뿐이다.
 * 시세·포맷·폴링은 market.js / market-ui.js 의 것을 그대로 쓴다.
 */

var Mock = (function () {
  var on = false;
  var season = null;        // /season 응답
  var account = null;       // /account 응답
  var sheet = null;         // 열려 있는 주문창 상태 { code, name, side, type, price, qty, taxFree, busy, orderId }
  var watchingOrder = null; // 체결을 기다리는 주문 폴링 타이머
  var histNext = null;

  /* ===== 워커 호출 ===== */
  async function api(path, method, body, _retried) {
    if (!currentUser) throw new Error('로그인이 필요합니다');
    var token = await currentUser.getIdToken(!!_retried);     // 재시도 때는 토큰을 강제로 새로 받는다
    var init = {
      method: method || 'GET',
      headers: body ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { Authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined
    };
    // 워커가 붙들면 주문창이 "접수 중"에 갇힌다 — 15초에 끊는다 (주문은 clientOrderId 로 중복 접수가 막혀 있어 재전송해도 안전)
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(15000);
    var res;
    try { res = await fetch(MARKET_API + '/api/mock' + path, init); }
    catch (e) {
      throw new Error(e && e.name === 'TimeoutError' ? '서버 응답이 늦습니다. 잠시 후 다시 시도하세요' : '네트워크 오류로 요청하지 못했습니다');
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    // 시계 오차·서명키 교체 직후에는 토큰이 거부될 수 있다 — 한 번은 새 토큰으로 다시 보낸다
    if (res.status === 401 && !_retried) return api(path, method, body, true);
    if (!res.ok) {
      var err = new Error((data && data.error) || (res.status === 401 ? '로그인이 만료되었습니다. 새로고침해 주세요' : '요청을 처리하지 못했습니다 (' + res.status + ')'));
      err.code = data && data.code; err.status = res.status;
      throw err;
    }
    return data;
  }

  function modeKey() { return 'dt-invest-mock:' + (currentUser ? currentUser.uid : ''); }
  function won(n) { return fmtNum(Math.round(n)) + '원'; }
  function rateHtml(r) { return '<span class="' + signClass(r) + '">' + fmtRate(r) + '</span>'; }
  /** 체결 시각 — 좁은 줄에 들어가야 해서 "09.22 10:42" 로 짧게 쓴다 (KST 고정) */
  function kstHM(ms) {
    var d = new Date(Number(ms) || 0);
    if (isNaN(d)) return '';
    var p2 = function (n) { return String(n).padStart(2, '0'); };
    try {
      var f = new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        hour12: false, timeZone: 'Asia/Seoul'
      }).formatToParts(d).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
      return f.month + '.' + f.day + ' ' + f.hour + ':' + f.minute;
    } catch (e) {
      var k = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 9 * 3600000);
      return p2(k.getMonth() + 1) + '.' + p2(k.getDate()) + ' ' + p2(k.getHours()) + ':' + p2(k.getMinutes());
    }
  }

  /** KRX 호가단위 — 서버(engine.js)와 같은 표 */
  function tickSize(price, taxFree) {
    if (taxFree) return price < 2000 ? 1 : 5;
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    if (price < 500000) return 500;
    return 1000;
  }

  /** 한 호가 올리기/내리기. 내릴 때는 한 단계 아래 가격대의 호가단위를 따른다 (예: 200,000 → 199,900) */
  function tickStep(price, dir, taxFree) {
    var p = Number(price) || 0;
    var t = dir > 0 ? tickSize(p, taxFree) : tickSize(Math.max(1, p - 1), taxFree);
    var np = dir > 0 ? Math.floor(p / t) * t + t : Math.ceil(p / t) * t - t;
    return Math.max(t, np);
  }

  // onclick 속성에 넣는 값은 모양부터 확인한다 (주문·감시주문 id 는 UUID, 종목코드는 6자리)
  var UUID_RE = /^[0-9a-f-]{36}$/i, CODE_RE = /^[0-9A-Z]{6}$/;
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  /* ===== 모드 켜기/끄기 =====
   * userInitiated: 버튼을 직접 눌렀을 때만 계좌 탭으로 옮기고 참가 창을 띄운다.
   * 자동 복원(다시 방문)에서는 조용히 켜고, 미참가 회원에게는 계좌 탭 안의 참가 안내 카드만 남긴다. */
  async function setMode(next, userInitiated) {
    on = !!next;
    try { localStorage.setItem(modeKey(), on ? '1' : '0'); } catch (e) {}
    document.body.classList.toggle('mock-on', on);
    var btn = document.getElementById('mockToggle');
    if (btn) { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    ['tabAccount', 'tabRanking'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = on ? '' : 'none';
    });

    if (!on) {
      closeSheet();
      closeAux();
      closeJoin();
      Poller.remove('mock-acc');
      Poller.remove('mock-rank');
      document.getElementById('mockBar').style.display = 'none';
      renderTradeBar();
      if (currentTab === 'account' || currentTab === 'ranking') switchTab('market');
      return;
    }
    await refreshSeason();
    renderTradeBar();
    if (userInitiated && season && season.season && !season.joined) { switchTab('account'); openJoinFlow(); }
  }

  async function refreshSeason() {
    try { season = await api('/season'); }
    catch (e) { season = { error: e.message }; }
    if (season && season.joined) await refreshAccount();
    else renderBar();
    syncAdminMount();          // 관리 탭이 열려 있으면 시즌 패널도 맞춘다
    return season;
  }

  async function refreshAccount() {
    try {
      account = await api('/account');
      renderBar();
      if (currentTab === 'account') renderAccount();
      renderTradeBar();
    } catch (e) {
      if (e.code === 'not_joined' || e.code === 'no_season') account = null;
      if (currentTab === 'account') renderAccount(e.message);
    }
  }

  /* ===== 헤더 아래 한 줄 요약 ===== */
  function renderBar() {
    var el = document.getElementById('mockBar');
    if (!el) return;
    if (!on || !account) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<span class="mk-bar-label">💼 내 자산</span>'
      + '<b class="mk-bar-eq">' + won(account.equity) + '</b>'
      + rateHtml(account.returnRate)
      + (account.rank ? '<span class="mk-bar-rank">' + account.rank + '위<i>/' + fmtNum(account.participants) + '</i></span>' : '')
      + '<span class="mk-bar-go">계좌 →</span>';
  }

  /* ===== 탭 전환 훅 (app.js switchTab 에서 호출) ===== */
  function onTab(tab) {
    Poller.remove('mock-acc');
    Poller.remove('mock-rank');
    if (!on) return;
    if (tab === 'admin') { mountAdmin(); return; }
    if (tab === 'account') {
      _stopsAt = 0;            // 탭을 열 때마다 감시주문을 새로 받는다 (그 뒤로는 60초 간격)
      renderAccount();
      // 장중에는 10초, 장외에는 2분 — 계좌 탭을 보고 있을 때만 돈다
      Poller.add('mock-acc', refreshAccountOrSeason, pollMs(10000, 120000));
    } else if (tab === 'ranking') {
      _rankBuilt = false;
      // 순위는 실시간 — 랭킹 탭을 보고 있는 동안 장중 10초마다 다시 매긴다
      Poller.add('mock-rank', loadRanking, pollMs(10000, 120000));
    }
  }
  function refreshAccountOrSeason() { return (season && season.joined) ? refreshAccount() : refreshSeason(); }

  /* ===== 계좌 ===== */
  /**
   * 계좌 탭을 다시 그린다. 시세 폴링마다 불리므로, 사용자가 만든 상태가 있는 부분은 새로 만들지 않고
   * 기존 노드를 그대로 옮겨 붙인다 — 안 그러면 폴링 때마다 날아간다.
   *   - 시즌 관리 패널(details): 열림 상태와 입력 중인 글자
   *   - 체결 내역(#mkHistory): "불러오기"로 받아 둔 목록
   */
  var KEEP_ON_REPAINT = ['details.mk-admin', '#mkHistory'];
  function paint(el, html) {
    var kept = KEEP_ON_REPAINT.map(function (sel) { return el.querySelector(sel); });
    el.innerHTML = html;
    KEEP_ON_REPAINT.forEach(function (sel, i) {
      var old = kept[i], fresh = el.querySelector(sel);
      if (old && fresh && old.innerHTML) fresh.replaceWith(old);
    });
  }

  /** 시즌 정보가 새로 들어오면 관리 탭이 열려 있을 때 패널도 맞춘다 */
  function syncAdminMount() {
    if (typeof currentTab !== 'undefined' && currentTab === 'admin') mountAdmin();
  }

  function renderAccount(errMsg) {
    var el = document.getElementById('tab-account');
    if (!el) return;
    if (!season) { paint(el, '<div class="loading">불러오는 중</div>'); return; }
    if (season.error) { paint(el, '<div class="empty">' + escapeHtml(season.error) + '</div>'); return; }

    if (!season.season) {
      paint(el, '<div class="mk-card"><h3>지금은 진행 중인 시즌이 없습니다</h3>'
        + (season.next
            ? '<p>다음 시즌 <b>' + escapeHtml(season.next.name) + '</b> — ' + escapeHtml(season.next.start_date) + ' 시작</p>'
            : '<p>다음 시즌 일정이 정해지면 여기에 표시됩니다.</p>')
        + '<button class="mini-btn" onclick="switchTab(\'ranking\')">지난 시즌 결과 보기</button></div>'
      );
      return;
    }

    if (!season.joined) { paint(el, joinHtml()); return; }
    if (!account) { paint(el, '<div class="empty">' + escapeHtml(errMsg || '계좌 정보를 불러오는 중') + '</div>'); return; }

    var a = account, s = a.season;
    var evalPnl = a.positions.reduce(function (t, p) { return t + p.pnl; }, 0);
    var h = '<div class="mk-card mk-summary">'
      + '<div class="mk-sum-head"><span>' + escapeHtml(s.name) + '</span><span>' + escapeHtml(s.endDate) + ' 종료</span></div>'
      + '<div class="mk-eq">' + won(a.equity) + '</div>'
      + '<div class="mk-eq-sub">' + rateHtml(a.returnRate) + ' <span class="' + signClass(a.equity - s.seed) + '">'
      +   (a.equity - s.seed > 0 ? '+' : '') + fmtNum(a.equity - s.seed) + '원</span>'
      +   '<span class="mk-dim"> · 시작 ' + fmtCompact(s.seed) + '원</span></div>'
      + '<div class="mk-grid">'
      +   cell('주문 가능', won(a.available)) + cell('보유 주식', won(a.stock))
      +   cell('평가손익', '<span class="' + signClass(evalPnl) + '">' + (evalPnl > 0 ? '+' : '') + fmtNum(evalPnl) + '</span>')
      +   cell('실현손익', '<span class="' + signClass(a.realizedPnl) + '">' + (a.realizedPnl > 0 ? '+' : '') + fmtNum(a.realizedPnl) + '</span>')
      + '</div>'
      + '<div class="mk-note">' + (a.live ? '실시간 평가 (08:00~20:00, 시간외 포함)' : '장 마감 · 최종 체결가 기준 평가')
      +   ' · 순위 확정은 15:30 종가 기준</div>'
      + '</div>';

    h += corpHtml(a.corpActions);

    h += '<section class="m-section"><div class="m-head"><h3>📦 보유 종목</h3><span class="m-hint">' + a.positions.length + '종목</span></div>';
    h += a.positions.length ? a.positions.filter(function (p) { return CODE_RE.test(p.code); }).map(function (p) {
      var nStop = armedStops().filter(function (s) { return s.code === p.code && s.side === 'sell'; }).length;
      return '<div class="mk-posrow">'
        + '<button class="mk-pos" onclick="openStock(\'' + p.code + '\',\'' + escapeJsArg(p.name) + '\')">'
        + stockLogoHtml(p.code, p.name, null, 'sm')
        + '<span class="mk-pos-main"><span class="mk-pos-name">' + escapeHtml(p.name) + (p.halted ? ' <i class="mk-tag">정지</i>' : '') + '</span>'
        +   '<span class="mk-pos-sub">' + fmtNum(p.qty) + '주 · 평단 ' + fmtNum(p.avgPrice) + '원' + (nStop ? ' · ⏱ 감시 ' + nStop : '') + '</span></span>'
        + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(p.value) + '원</span>'
        +   '<span class="mk-pos-pnl ' + signClass(p.pnl) + '">' + (p.pnl > 0 ? '+' : '') + fmtNum(p.pnl) + '원 (' + fmtRate(p.pnlRate) + ')</span></span>'
        + '</button>'
        + '<button class="mk-pos-act' + (nStop ? ' on' : '') + '" onclick="Mock.openStops(\'' + p.code + '\')" aria-label="' + escapeAttr(p.name) + ' 손절·익절 설정">손절<br>익절</button>'
        + '</div>';
    }).join('') : '<div class="empty">보유 종목이 없습니다.<br>시세 탭에서 종목을 선택해 매수할 수 있습니다.</div>';
    h += '</section>';

    if (a.openOrders.length) {
      h += '<section class="m-section"><div class="m-head"><h3>⏳ 미체결 주문</h3><span class="m-hint">' + a.openOrders.length + '건</span></div>'
        + a.openOrders.map(orderRowHtml).join('') + '</section>';
    }

    h += '<div id="mkStops">' + stopsInnerHtml() + '</div>';

    h += reviewSectionHtml();

    h += '<section class="m-section"><div class="m-head"><h3>🧾 체결 내역</h3>'
      + '<button class="mini-btn" onclick="Mock.loadHistory(true)">불러오기</button></div>'
      + '<div id="mkHistory"></div></section>'
      + '<div class="disclaimer">⚠️ 가상 자금 모의투자이며 투자 권유가 아닙니다. 체결가는 네이버 증권 시세 기준(정규장 KRX · 시간외 NXT/KRX), '
      + '체결 판정은 최대 1분 지연될 수 있습니다. 최종 순위는 15:30 KRX 종가 기준 · 수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2)
      + '%(ETF·ETN 면제). 자세한 규칙은 참가 안내에 있습니다.</div>'
      ;
    paint(el, h);
    // 계좌 탭은 10초마다 다시 그려진다 — 평가가 없는 회원도 매번 GET /review 를 부르지 않게, 받아 봤으면 그 결과로 그린다.
    // 시즌이 바뀌었거나 10분이 지났으면(남은 횟수가 날짜 따라 바뀐다) 다시 받는다
    if (_reviewFor === s.id && Date.now() - _reviewAt < 600000) renderReview();
    else loadReview(s.id);
    // 감시주문은 10초 폴링마다 받지 않는다 — 탭을 열 때·등록/취소 뒤·60초가 지났을 때만
    if (Date.now() - _stopsAt >= 60000) loadStops();
  }

  /* ===== AI 계좌 평가 =====
   * 지표는 워커가 D1 으로 계산하고 AI 는 문장만 쓴다 — 화면 숫자는 워커가 준 metrics 를 그대로 쓴다.
   * 유료 API 라 하루 3회까지. 본인만 본다.
   */
  var _review = null;          // { metrics, body, createdAt }
  // 워커가 실제로 밟는 순서 — 체결 재생 → 벤치마크 → 습관 지표 → AI 작성
  var RV_STEPS = [
    ['📒', '체결 기록을 되짚는 중'],
    ['📈', '시장과 견줘 보는 중'],
    ['🔍', '매매 습관을 뜯어보는 중'],
    ['✍️', '코치가 평가를 쓰는 중']
  ];
  var _rvTimer = null;
  var _rvStep = 0;             // 진행 단계 — 계좌 탭이 다시 그려져도 처음(체결 기록)으로 돌아가지 않게 밖에 둔다
  var _reviewLeft = null;      // 오늘 남은 횟수
  var _reviewBusy = false;
  var _reviewFor = null;       // 받아 둔 평가가 어느 시즌 것인가 (없음·실패도 "받아 봤음"으로 친다)
  var _reviewAt = 0;
  var _reviewLoading = false;

  function reviewSectionHtml() {
    return '<section class="m-section"><div class="m-head"><h3>🤖 AI 계좌 평가</h3>'
      + '<span class="m-hint" id="mkRvLeft"></span></div>'
      + '<div id="mkReview"><div class="loading">불러오는 중...</div></div></section>';
  }

  async function loadReview(seasonId) {
    if (_reviewLoading) return;
    _reviewLoading = true;
    try {
      var r = await api('/review');
      _review = r.review; _reviewLeft = r.remaining;
    } catch (e) {
      _review = null; _reviewLeft = null;
    } finally {
      _reviewLoading = false;
      _reviewFor = seasonId || null;
      _reviewAt = Date.now();          // 실패해도 10분 동안은 다시 부르지 않는다 (평가받기 버튼은 그대로 쓸 수 있다)
    }
    renderReview();
  }

  function renderReview() {
    var box = document.getElementById('mkReview');
    if (!box) return;
    var left = document.getElementById('mkRvLeft');
    if (left) left.textContent = _reviewLeft == null ? '제한 없음 (테스트 중)' : '오늘 ' + _reviewLeft + '회 남음';

    if (_reviewBusy) {
      box.innerHTML = '<div class="mk-rv-load">'
        + '<div class="mk-rv-bar"><i></i></div>'
        + '<div class="mk-rv-step" id="mkRvStep"></div>'
        + '</div>';
      startRvSteps();
      return;
    }
    stopRvSteps();
    var btn = '<button class="btn-submit mk-rv-btn" onclick="Mock.askReview(this)"'
      + (_reviewLeft === 0 ? ' disabled' : '') + '>'
      + (_review ? '다시 평가받기' : '평가받기') + '</button>';

    if (!_review) {
      box.innerHTML = '<div class="mk-rv-empty">매매 기록을 바탕으로 코치처럼 짚어 드립니다.<br>'
        + '<span class="mk-dim">수익률·시장 대비 성과·보유 습관을 봅니다. 나만 볼 수 있습니다.</span></div>' + btn;
      return;
    }
    box.innerHTML = reviewCardHtml(_review) + btn;
  }

  function reviewCardHtml(r) {
    var m = r.metrics || {};
    var pct = function (v) { return v == null ? null : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%'; };
    // [라벨, 값HTML, 강조여부] — 시장 대비는 이 평가의 중심이라 줄째로 강조한다
    var rows = [];

    if (m.returnRate != null) {
      rows.push(['수익률',
        '<b class="' + signClass(m.returnRate) + '">' + pct(m.returnRate) + '</b>'
        + (m.benchmark && m.benchmark.kospi != null
            ? '<span class="mk-dim"> vs 코스피 </span><span class="' + signClass(m.benchmark.kospi) + '">' + pct(m.benchmark.kospi) + '</span>'
            : '')]);
    }
    if (m.alpha != null) {
      rows.push(['시장 대비',
        '<b class="' + signClass(m.alpha) + '">' + pct(m.alpha) + 'p</b>'
        + '<span class="mk-dim"> ' + (m.alpha >= 0 ? '앞섬' : '뒤처짐') + '</span>', true]);
    }
    if (m.topPosition && m.topPosition.weight != null) {
      // 한 종목에 절반 넘게 실려 있으면 눈에 띄게 (쏠림은 그 자체로 위험이다)
      var heavy = m.topPosition.weight >= 50;
      rows.push(['집중도',
        '<b' + (heavy ? ' class="down"' : '') + '>' + escapeHtml(m.topPosition.name) + ' ' + m.topPosition.weight.toFixed(1) + '%</b>'
        + '<span class="mk-dim"> · ' + m.positionCount + '종목</span>']);
    }
    if (m.trades) {
      rows.push(['매매', '<b>' + fmtNum(m.trades.total) + '회</b>'
        + (m.winRate != null
            ? '<span class="mk-dim"> · 승률 </span><b class="' + (m.winRate >= 50 ? 'up' : 'down') + '">' + m.winRate.toFixed(0) + '%</b>'
              + '<span class="mk-dim"> (매도 ' + fmtNum(m.trades.sells) + '건)</span>'
            : '<span class="mk-dim"> · 매도 없음</span>')]);
    }
    if (m.holdDays && m.holdDays.win != null && m.holdDays.loss != null) {
      // 손실을 더 오래 들고 있으면 처분효과 — 그 자체가 신호라 색으로 구분한다
      var bad = m.holdDays.loss > m.holdDays.win;
      rows.push(['보유기간',
        '<span class="mk-dim">이익 </span><b class="up">' + m.holdDays.win.toFixed(1) + '일</b>'
        + '<span class="mk-dim"> · 손실 </span><b class="' + (bad ? 'down' : '') + '">' + m.holdDays.loss.toFixed(1) + '일</b>',
        bad]);
    }
    if (m.mdd != null) rows.push(['최대 낙폭', '<b class="' + (m.mdd < 0 ? 'down' : '') + '">' + m.mdd.toFixed(2) + '%</b>']);
    if (m.cashRatio != null) rows.push(['현금 비중', '<b>' + m.cashRatio.toFixed(1) + '%</b>']);

    return '<div class="mk-rv-card">'
      + '<pre class="mk-rv-body">' + escapeHtml(r.body || '') + '</pre>'
      + (rows.length ? '<div class="mk-rv-metrics">' + rows.map(function (x) {
          return '<div class="mk-rv-row' + (x[2] ? ' key' : '') + '"><span>' + x[0] + '</span><span>' + x[1] + '</span></div>';
        }).join('') + '</div>' : '')
      + '<div class="mk-rv-foot">' + reviewTime(r.createdAt) + ' 기준 · 숫자는 계좌 기록에서 계산한 값입니다</div>'
      + '</div>';
  }

  function reviewTime(ms) {
    var d = new Date(Number(ms) || 0);
    if (isNaN(d)) return '';
    try { return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }); }
    catch (e) { return ''; }
  }

  /** 단계 문구를 2.5초마다 넘긴다. 마지막 단계에서 멈춘다 (끝난 척하지 않는다).
   * 평가를 기다리는 동안 계좌 탭이 다시 그려지면 이미 돌고 있는 타이머를 그대로 두고 지금 단계만 다시 칠한다 */
  function startRvSteps() {
    var paint = function () {
      var el = document.getElementById('mkRvStep');
      if (!el) return;                     // 다시 그리는 중일 수 있다 — 다음 틱에 새 칸을 찾는다
      el.innerHTML = '<span class="mk-rv-emoji">' + RV_STEPS[_rvStep][0] + '</span>' + escapeHtml(RV_STEPS[_rvStep][1]);
      el.classList.remove('in');
      void el.offsetWidth;                 // 애니메이션을 다시 태우려면 한 번 끊어야 한다
      el.classList.add('in');
    };
    paint();
    if (_rvTimer) return;
    _rvTimer = setInterval(function () {
      if (!_reviewBusy) { stopRvSteps(); return; }
      if (_rvStep >= RV_STEPS.length - 1) return;   // 마지막에서 멈춘다
      _rvStep++; paint();
    }, 2500);
  }

  function stopRvSteps() {
    if (_rvTimer) { clearInterval(_rvTimer); _rvTimer = null; }
  }

  async function askReview(btn) {
    if (_reviewBusy) return;
    _reviewBusy = true;
    _rvStep = 0;
    renderReview();
    try {
      var r = await api('/review', 'POST', {});
      _review = r.review;
      if (r.remaining != null) _reviewLeft = r.remaining;
    } catch (e) {
      alert(e && e.message ? e.message : 'AI 평가를 받지 못했습니다.');
    } finally {
      _reviewBusy = false;
      renderReview();
    }
  }

  function cell(k, v) { return '<div class="mk-cell"><span class="mk-cell-k">' + k + '</span><span class="mk-cell-v">' + v + '</span></div>'; }

  function orderRowHtml(o) {
    var sideTxt = o.side === 'buy' ? '매수' : '매도';
    var okId = UUID_RE.test(String(o.id || ''));      // onclick 에 넣기 전에 모양을 확인한다
    return '<div class="mk-ord">'
      + '<span class="mk-side ' + (o.side === 'buy' ? 'buy' : 'sell') + '">' + sideTxt + '</span>'
      + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(o.name) + '</span>'
      +   '<span class="mk-pos-sub">' + (o.type === 'market' ? '시장가' : '지정가 ' + fmtNum(o.limitPrice) + '원')
      +   ' · ' + fmtNum(o.filledQty) + '/' + fmtNum(o.qty) + '주</span></span>'
      + (okId
          ? '<span class="mk-acts">'
            + '<button class="mini-btn mk-act" onclick="Mock.openAmend(\'' + o.id + '\')">정정</button>'
            + '<button class="mini-btn danger mk-act" onclick="Mock.cancel(\'' + o.id + '\', this)">취소</button>'
            + '</span>'
          : '')
      + '</div>';
  }

  function joinHtml() {
    var s = season.season;
    return '<div class="mk-card mk-join">'
      + '<h3>🏁 ' + escapeHtml(s.name) + '</h3>'
      + '<p class="mk-join-lead">가상 <b>' + fmtCompact(s.seed) + '원</b>으로 실제 주가에 맞춰 매매하고,<br>'
      +   escapeHtml(s.endDate) + ' 종가 기준 <b>최종 자산</b>으로 순위를 가립니다.</p>'
      + '<ul class="mk-rules">'
      +   '<li>국내 상장 종목 — 주식 · ETF(레버리지 · 인버스 포함) · ETN. 거래정지 · 제한 종목 제외</li>'
      +   '<li>정규장 08:30~15:30 지정가 · 시장가 / 시간외 08:00~08:30 · 15:40~20:00 지정가만 (ETF · ETN 은 시간외 불가)</li>'
      +   '<li>체결가는 네이버 증권 시세 기준 — 정규장은 KRX, 시간외는 NXT · KRX 시간외 가격</li>'
      +   '<li>수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2) + '% (ETF · ETN 면제)</li>'
      +   '<li>주문 뒤에 실제로 거래된 가격 · 수량 안에서만 체결됩니다 (판정은 최대 1분 간격)</li>'
      +   '<li>참가자 ' + fmtNum(season.participants) + '명 · 시즌마다 초기화 · 최종 순위는 ' + escapeHtml(s.endDate) + ' 15:30 종가 기준</li>'
      + '</ul>'
      + '<button class="btn-submit mk-join-btn" onclick="Mock.openJoinFlow()">시즌 참여하기</button>'
      + '<p class="mk-note">가상의 자금이며 실제 돈과 무관합니다. 어떤 것으로도 교환되지 않습니다.</p>'
      + '</div>';
  }

  /* ===== 참가 절차: 참여 여부 → 주의사항·전달사항 확인 → 시드머니 지급 ===== */
  function joinShell(inner) {
    var el = document.getElementById('mkJoin');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mkJoin';
      el.className = 'mk-sheet-wrap';
      document.body.appendChild(el);
      document.body.classList.add('mk-noscroll');
    }
    el.innerHTML = '<div class="mk-sheet-dim" onclick="Mock.closeJoin()"></div>'
      + '<div class="mk-sheet mk-joinflow" role="dialog" aria-modal="true" aria-label="시즌 참가" tabindex="-1">' + inner + '</div>';
    focusDialog(el);
  }

  /** 다이얼로그가 열리면 첫 컨트롤(없으면 시트 자체)로 포커스를 옮긴다 — 키보드·스크린리더 사용자가 뒤 화면에 남지 않게 */
  function focusDialog(wrap) {
    var dlg = wrap.querySelector('[role="dialog"]');
    if (!dlg) return;
    var first = dlg.querySelector('input:not([disabled]), textarea, button:not([disabled]):not([aria-label="닫기"])');
    try { (first || dlg).focus({ preventScroll: true }); } catch (e) {}
  }

  function closeJoin() {
    var el = document.getElementById('mkJoin');
    if (el) el.remove();
    syncNoScroll();
  }

  /** 떠 있는 창이 하나도 없을 때만 뒤 화면 스크롤을 푼다 */
  function syncNoScroll() {
    var any = document.getElementById('mkSheet') || document.getElementById('mkJoin') || document.getElementById('mkAux');
    document.body.classList.toggle('mk-noscroll', !!any);
  }

  /** Esc — 열려 있는 창을 하나 닫는다. 닫은 게 있으면 true (app.js 의 keydown 에서 부른다) */
  function onEscape() {
    if (document.getElementById('mkAux')) { if (!aux || !aux.busy) closeAux(); return true; }
    if (document.getElementById('mkSheet')) { if (!sheet || !sheet.busy) closeSheet(); return true; }
    if (document.getElementById('mkJoin')) { closeJoin(); return true; }
    return false;
  }

  function openJoinFlow() {
    if (!season || !season.season || season.joined) return;
    var s = season.season;
    joinShell(
        '<div class="mk-jf-step">1 / 2</div>'
      + '<h3 class="mk-jf-title">🏁 ' + escapeHtml(s.name) + '에<br>참여하시겠습니까?</h3>'
      + '<p class="mk-jf-lead">가상 시드머니 <b>' + fmtCompact(s.seed) + '원</b>으로 실제 시세에 맞춰 매매하고, '
      +   '<b>' + escapeHtml(s.endDate) + '</b> 15:30 종가 기준 최종 자산으로 순위를 가립니다.</p>'
      + '<div class="mk-grid">'
      +   cell('기간', escapeHtml(s.startDate) + ' ~ ' + escapeHtml(s.endDate))
      +   cell('현재 참가자', fmtNum(season.participants) + '명')
      + '</div>'
      + '<div class="mk-jf-btns"><button class="btn-ghost" onclick="Mock.closeJoin()">나중에</button>'
      + '<button class="btn-submit" onclick="Mock.joinStep2()">참여하기</button></div>');
  }

  function joinStep2() {
    if (!season || !season.season) return;
    var s = season.season;
    var li = function (arr) { return '<ul class="mk-rules">' + arr.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>'; };
    joinShell(
        '<div class="mk-jf-step">2 / 2</div>'
      + '<h3 class="mk-jf-title">참여 전에 확인해 주세요</h3>'
      + (s.notice ? '<div class="mk-jf-h">📢 전달사항</div><div class="mk-jf-notice">' + escapeHtml(s.notice) + '</div>' : '')
      + '<div class="mk-jf-h">⚠️ 주의사항</div>'
      + li([
          '<b>가상의 자금</b>입니다. 실제 돈과 무관하며 현금·포인트·상품 등 어떤 것으로도 교환되지 않습니다.',
          '실제 매매·투자 권유가 아닙니다. 모의 결과는 실제 투자 성과와 다를 수 있습니다.',
          '시세는 네이버 증권 기준입니다. 정규장은 KRX 가격, 프리 · 애프터마켓은 NXT · KRX 시간외 가격을 따르며 지연 · 오류가 있을 수 있습니다. 시세 제공 오류로 인한 체결은 확인 후 정정 또는 취소될 수 있습니다.',
          '체결은 실제 호가창이 아니라 <b>주문 뒤에 실제로 거래된 가격 · 수량</b>으로 판정합니다. 판정은 최대 1분 간격이라 실제보다 늦게 체결이 표시될 수 있고, 시장가는 판정 시점의 현재가로 체결되어 호가 스프레드 · 잔량 · VI 는 반영되지 않습니다.',
          '주문은 거래일(주말 · 휴장일 제외)에만 접수됩니다. 액면분할 · 병합 · 무상증자는 보유 수량에, 유상증자 권리락은 현금으로 자동 반영됩니다. 현금배당은 반영되지 않습니다.',
          '순위표에 <b>이름 · 총자산 · 수익률 · 체결 건수</b>가 회원들에게 공개됩니다. 보유 종목은 공개되지 않습니다. 종목별 보유 인원 · 평균 수익률은 3명 이상일 때 이름 없이 합계로만 보입니다.',
          '1인 1계정입니다. 부정한 방법이 확인되면 순위에서 제외됩니다.'
        ])
      + '<div class="mk-jf-h">📌 매매 규칙</div>'
      + li([
          '시드머니 <b>' + fmtCompact(s.seed) + '원</b> · 시즌마다 초기화 · 순위는 <b>실시간</b>(시간외 가격 포함), 일일 기록과 최종 순위는 ' + escapeHtml(s.endDate) + ' 15:30 <b>KRX 종가</b> 기준',
          '국내 상장 종목 — 주식 · ETF(레버리지 · 인버스 포함) · ETN. 거래정지 · 제한 종목은 주문할 수 없습니다.',
          '정규장 08:30~15:30 지정가 · 시장가. 09:00 전 접수분은 <b>시가</b>, 15:20~15:30 접수분은 <b>종가</b>로 체결되고, 미체결은 장 마감 시 만료됩니다.',
          '시간외 08:00~08:30 프리마켓(NXT · 08:50 까지 체결) / 15:40~20:00 애프터마켓(NXT · KRX) — <b>지정가만</b>, ETF · ETN 은 시간외 불가, 미체결은 08:50 · 20:00 에 자동 취소됩니다.',
          '지정가는 전일 종가 ±30% 안에서 호가단위에 맞게 입력합니다. 미체결 주문은 <b>정정 · 취소</b>할 수 있고, 가격을 바꾸면 대기 순서가 뒤로 갑니다.',
          '감시주문(손절 · 익절)은 정규장(09:00~15:20)에 최대 1분 간격으로 확인하며, 급변 시 감시가와 다른 가격에 체결될 수 있습니다.',
          '수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2) + '% (ETF · ETN 면제) — 실전과 같은 수준',
          '거래가 적은 종목은 여러 번에 나눠 체결되거나 체결되지 않을 수 있습니다.',
          '시장가 매수는 현재가 기준으로 주문 가능 금액을 잡습니다. 체결가가 올라 금액이 모자라면 살 수 있는 수량까지만 체결되고 나머지는 취소됩니다.',
          '신용 · 미수 · 공매도는 없습니다.'
        ])
      + '<label class="mk-jf-check"><input type="checkbox" id="mkAgree" onchange="document.getElementById(\'mkJoinGo\').disabled = !this.checked"> 위 내용을 확인했습니다</label>'
      + '<div class="mk-jf-btns"><button class="btn-ghost" onclick="Mock.closeJoin()">취소</button>'
      + '<button class="btn-submit" id="mkJoinGo" disabled onclick="Mock.join(this)">' + fmtCompact(s.seed) + '원 받고 시작하기</button></div>');
  }

  function joinDone(cash) {
    joinShell(
        '<div class="mk-jf-done">🎉</div>'
      + '<h3 class="mk-jf-title" style="text-align:center">시드머니 ' + fmtCompact(cash) + '원이<br>지급됐습니다</h3>'
      + '<p class="mk-jf-lead" style="text-align:center">시세 탭에서 종목을 선택하면 <b>매수 · 매도</b> 주문을 할 수 있습니다.<br>주문 가능 시간은 거래일 08:00~20:00 (15:30~15:40 제외)입니다.</p>'
      + '<div class="mk-jf-btns"><button class="btn-ghost" onclick="Mock.closeJoin()">계좌 보기</button>'
      + '<button class="btn-submit" onclick="Mock.closeJoin(); switchTab(\'market\')">종목 보러 가기</button></div>');
  }

  async function join(btn) {
    btn.disabled = true; btn.textContent = '처리 중';
    try {
      var r = await api('/join', 'POST');
      await refreshSeason();
      renderAccount();
      joinDone(r.cash);
    } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = '다시 시도'; }
  }

  async function cancel(id, btn) {
    if (btn) btn.disabled = true;
    try { await api('/orders/' + encodeURIComponent(id), 'DELETE'); }
    catch (e) { alert(e.message); }
    await refreshAccount();
  }

  async function loadHistory(reset) {
    var el = document.getElementById('mkHistory');
    if (!el) return;
    if (reset) { histNext = null; el.innerHTML = '<div class="loading">불러오는 중</div>'; }
    try {
      var d = await api('/history' + (histNext ? '?before=' + histNext : ''));
      var rows = d.items.map(function (f) {
        return '<div class="mk-ord">'
          + '<span class="mk-side ' + (f.side === 'buy' ? 'buy' : 'sell') + '">' + (f.side === 'buy' ? '매수' : '매도') + '</span>'
          + stockLogoHtml(f.code, f.name, null, 'sm')
          + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(f.name) + '</span>'
          +   '<span class="mk-pos-sub">' + escapeHtml(kstHM(f.at)) + ' · ' + fmtNum(f.qty) + '주 × ' + fmtNum(f.price) + '원</span></span>'
          + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(f.qty * f.price) + '원</span>'
          +   '<span class="mk-pos-sub">' + costText(f) + '</span></span>'
          + '</div>';
      }).join('');
      if (reset) el.innerHTML = rows || '<div class="empty">체결 내역이 없습니다.</div>';
      else { var more = el.querySelector('.mk-more'); if (more) more.remove(); el.insertAdjacentHTML('beforeend', rows); }
      histNext = d.next;
      if (histNext) el.insertAdjacentHTML('beforeend', '<button class="mini-btn mk-more" onclick="Mock.loadHistory(false)">더 보기</button>');
    } catch (e) {
      if (reset) el.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
    }
  }

  /** 체결 한 건의 비용 — 매수는 수수료만, 매도는 수수료와 거래세가 따로 붙는다 */
  function costText(f) {
    if (f.side === 'buy') return '수수료 ' + fmtNum(f.fee) + '원';
    if (!f.tax) return '수수료 ' + fmtNum(f.fee) + '원 · 세금 면제';   // ETF·ETN
    return '수수료 ' + fmtNum(f.fee) + '원 · 세금 ' + fmtNum(f.tax) + '원';
  }

  /* ===== 랭킹 ===== */
  var _rankBuilt = false, _hallHtml = null, _prevRank = {}, _prevSeasonId = null;

  async function loadRanking() {
    var el = document.getElementById('tab-ranking');
    if (!el) return;
    // 갱신할 때마다 "불러오는 중"으로 깜빡이지 않게 첫 번만 표시한다
    if (!_rankBuilt) el.innerHTML = '<div class="loading">순위를 불러오는 중</div>';
    var h = '';
    try {
      var d = await api('/leaderboard');
      // 시즌이 바뀌었을 때만 이전 평가를 버린다 (10초마다 버리면 계좌 탭이 매번 다시 받았다)
      if (_reviewFor && _reviewFor !== d.season.id) { _review = null; _reviewLeft = null; _reviewFor = null; }
      // 시즌이 바뀌면 이전 시즌의 순위 기억을 버린다
      if (_prevSeasonId !== d.season.id) { _prevRank = {}; _hallHtml = null; _prevSeasonId = d.season.id; }
      h += '<section class="m-section"><div class="m-head"><h3>🏆 ' + escapeHtml(d.season.name) + '</h3>'
        + '<span class="m-hint">' + escapeHtml(kstHM(d.asOf).split(' ').slice(-1)[0]) + ' 기준 · ' + (d.live ? '장중' : '종가') + '</span></div>';
      h += d.rows.length ? d.rows.map(function (r) {
        var rr = (r.equity - d.season.seed) / d.season.seed * 100;
        var medal = r.rank === 1 ? '🥇' : (r.rank === 2 ? '🥈' : (r.rank === 3 ? '🥉' : r.rank));
        // 직전 갱신보다 순위가 오르내렸으면 잠깐 표시한다 (서버가 준 안정 키로 같은 회원을 잇는다)
        var k = r.key || r.nickname;
        var was = _prevRank[k], move = (was && was !== r.rank) ? (was > r.rank ? ' moved-up' : ' moved-down') : '';
        _prevRank[k] = r.rank;
        return '<div class="mk-rank' + (r.me ? ' me' : '') + move + '">'
          + '<span class="mk-rank-no">' + medal + '</span>'
          + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(r.nickname) + (r.me ? ' <i class="mk-tag">나</i>' : '') + '</span>'
          +   '<span class="mk-pos-sub">체결 ' + fmtNum(r.fills) + '건</span></span>'
          + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(r.equity) + '</span>'
          +   '<span class="mk-pos-pnl ' + signClass(rr) + '">' + fmtRate(rr) + '</span></span>'
          + '</div>';
      }).join('') : '<div class="empty">참가자가 없습니다.</div>';
      h += '<div class="mk-note">실시간 순위 (10초 간격 갱신) · 최종 순위는 ' + escapeHtml(d.season.endDate) + ' KRX 정규장 종가 기준 총자산으로 확정됩니다.</div></section>';
    } catch (e) {
      if (e.code !== 'no_season') h += '<div class="empty">' + escapeHtml(e.message) + '</div>';
      else h += '<div class="mk-card"><h3>지금은 진행 중인 시즌이 없습니다</h3></div>';
    }
    if (_hallHtml === null) try {
      _hallHtml = '';
      var hall = await api('/hall');
      if (hall.items.length) {
        var by = {};
        hall.items.forEach(function (r) { (by[r.season_id] = by[r.season_id] || { name: r.season_name, rows: [] }).rows.push(r); });
        _hallHtml = '<section class="m-section"><div class="m-head"><h3>🏛 명예의 전당</h3></div>'
          + Object.keys(by).map(function (k) {
              return '<div class="mk-hall"><div class="mk-hall-name">' + escapeHtml(by[k].name) + '</div>'
                + by[k].rows.slice(0, 3).map(function (r) {
                    return '<div class="mk-hall-row"><span>' + (['🥇', '🥈', '🥉'][r.rank - 1] || r.rank) + ' ' + escapeHtml(r.nickname) + '</span>'
                      + '<span>' + fmtNum(r.equity) + '원 (' + fmtRate((r.equity - r.seed) / r.seed * 100) + ')</span></div>';
                  }).join('') + '</div>';
            }).join('') + '</section>';
      }
    } catch (e) { /* 명예의 전당은 없어도 된다 */ }
    if (currentTab !== 'ranking') return;
    el.innerHTML = h + (_hallHtml || '');
    _rankBuilt = true;
  }

  /* ===== 종목 상세의 매수·매도 바 ===== */
  function holding(code) {
    if (!account) return null;
    return account.positions.filter(function (p) { return p.code === code; })[0] || null;
  }

  function renderTradeBar() {
    var old = document.getElementById('mkTradeBar');
    if (old) old.remove();
    if (!on || !curStock || !season || !season.season) return;
    var host = document.getElementById('stockDetail');
    if (!host || host.style.display === 'none') return;
    var pos = holding(curStock.code);
    var bar = document.createElement('div');
    bar.id = 'mkTradeBar';
    bar.className = 'mk-tradebar';
    bar.innerHTML = (pos
        ? '<div class="mk-hold">보유 <b>' + fmtNum(pos.qty) + '주</b> · 평단 ' + fmtNum(pos.avgPrice)
          + ' · <span class="' + signClass(pos.pnl) + '">' + (pos.pnl > 0 ? '+' : '') + fmtNum(pos.pnl) + ' (' + fmtRate(pos.pnlRate) + ')</span></div>'
        : '')
      + '<div class="mk-tb-btns">'
      + (season.joined
          ? '<button class="mk-buy" onclick="Mock.openSheet(\'buy\')">매수</button>'
            + '<button class="mk-sell" onclick="Mock.openSheet(\'sell\')"' + (pos ? '' : ' disabled') + '>매도</button>'
          : '<button class="mk-buy" onclick="switchTab(\'account\'); Mock.openJoinFlow()">모의투자 참가하고 매수하기</button>')
      + '</div>';
    host.appendChild(bar);
  }

  /* ===== 주문창 ===== */
  async function openSheet(side) {
    if (!curStock) return;
    var q = (typeof _lastQuote !== 'undefined' && _lastQuote && _lastQuote.code === curStock.code) ? _lastQuote : null;
    // 시간외에는 화면에 보이는 그 시장의 가격(q.price), 정규장에는 KRX 가격을 기본값으로
    var px = q ? (phaseInfo().limitOnly ? (q.price || (q.krx && q.krx.price)) : ((q.krx && q.krx.price) || q.price)) : 0;
    sheet = { code: curStock.code, name: curStock.name, side: side, type: 'limit', price: px || 0, qty: '', taxFree: false, busy: false, orderId: null };
    renderSheet();
    var mySheet = sheet;
    // 장 구간(정규장·시간외)이 바뀌었을 수 있으니 열 때마다 최신 상태를 받는다 — 통째로 다시 그리지 않고 안내·계산 부분만 갱신
    // (다시 그리면 입력 중인 포커스가 날아가고 모바일 키보드가 닫힌다)
    refreshAccount().then(function () { if (sheet === mySheet && !sheet.busy) refreshSheetParts(); });
    try {
      var k = await api('/kind?code=' + encodeURIComponent(sheet.code) + '&name=' + encodeURIComponent(sheet.name || ''));
      if (k && k.code) _kind[k.code] = !!k.taxFree;
      if (sheet === mySheet && sheet.code === k.code && sheet.taxFree !== !!k.taxFree) { sheet.taxFree = !!k.taxFree; refreshSheetParts(); }
    } catch (e) { /* 호가단위는 서버가 다시 확인한다 */ }
  }

  function closeSheet() {
    sheet = null;
    var el = document.getElementById('mkSheet');
    if (el) el.remove();
    syncNoScroll();
  }

  /** 지금이 어느 구간인지 — 계좌 응답이 더 최신이면 그쪽을 쓴다 */
  function phaseInfo() {
    var src = (account && account.phase) ? account : (season || {});
    return { phase: src.phase || 'closed', canOrder: !!src.canOrder, limitOnly: !!src.limitOnly, holiday: !!src.holiday };
  }

  function sessionNote() {
    var p = phaseInfo();
    if (p.phase === 'break') return '<div class="mk-warn">15:30~15:40 은 주문 접수 시간이 아닙니다. 15:40 부터 애프터마켓 주문이 가능합니다</div>';
    if (p.holiday) return '<div class="mk-warn">오늘은 휴장일입니다. 다음 거래일 08:00 부터 주문할 수 있습니다</div>';
    if (!p.canOrder) return '<div class="mk-warn">주문 가능 시간이 아닙니다 (거래일 08:00~20:00)</div>';
    if (p.phase === 'pre_market') return '<div class="mk-info"><b>프리마켓(NXT)</b> · 지정가 주문만 가능 · 08:30 접수 마감 · 08:50 까지 미체결 시 자동 취소</div>';
    if (p.phase === 'after_market') return '<div class="mk-info"><b>애프터마켓</b> · 지정가 주문만 가능 · 20:00 까지 미체결 시 자동 취소 · ETF·ETN 제외</div>';
    if (p.phase === 'pre_open') return '<div class="mk-info">장전 주문 · 09:00 <b>시가</b>로 체결됩니다</div>';
    if (p.phase === 'close_auction') return '<div class="mk-info">장 마감 동시호가 · 15:30 <b>종가</b>로 체결됩니다</div>';
    return '';
  }

  function sheetNumbers() {
    var s = sheet, a = account, fr = a ? a.season.feeRate : 0.00015, tr = a ? a.season.taxRate : 0.002;
    var price = Number(s.price) || 0, qty = Math.floor(Number(s.qty)) || 0;
    var amount = price * qty;
    var fee = Math.floor(amount * fr + 1e-6);
    var tax = (s.side === 'sell' && !s.taxFree) ? Math.floor(amount * tr + 1e-6) : 0;
    var pos = holding(s.code);
    var maxQty = s.side === 'buy'
      ? (price > 0 && a ? Math.floor(a.available / (price * (1 + fr))) : 0)
      : (pos ? pos.qty - (a ? a.openOrders.filter(function (o) { return o.code === s.code && o.side === 'sell'; })
                                  .reduce(function (t, o) { return t + (o.qty - o.filledQty); }, 0) : 0) : 0);
    return { price: price, qty: qty, amount: amount, fee: fee, tax: tax, maxQty: Math.max(0, maxQty) };
  }

  function calcHtml(n) {
    var isBuy = sheet.side === 'buy', a = account;
    return row('주문 금액', won(n.amount))
      + row('수수료' + (n.tax || !isBuy ? ' · 세금' : ''), won(n.fee + n.tax))
      + (a ? row(isBuy ? '주문 후 주문 가능 금액' : '받을 금액', won(isBuy ? a.available - n.amount - n.fee : n.amount - n.fee - n.tax)) : '');
  }

  function renderSheet() {
    if (!sheet) return;
    var s = sheet, n = sheetNumbers();
    var el = document.getElementById('mkSheet');
    var fresh = !el;
    if (!el) {
      el = document.createElement('div');
      el.id = 'mkSheet';
      el.className = 'mk-sheet-wrap';
      document.body.appendChild(el);
      document.body.classList.add('mk-noscroll');
    }
    var isBuy = s.side === 'buy';
    var limitOnly = phaseInfo().limitOnly;
    if (limitOnly) s.type = 'limit';            // 시간외에는 실전과 같이 지정가만
    el.innerHTML = '<div class="mk-sheet-dim" onclick="Mock.closeSheet()"></div>'
      + '<div class="mk-sheet ' + s.side + '" role="dialog" aria-modal="true" aria-label="주문" tabindex="-1">'
      + '<div class="mk-sheet-head"><span class="mk-sheet-title">' + escapeHtml(s.name) + ' <i>' + escapeHtml(s.code) + '</i></span>'
      +   '<button class="mini-btn" onclick="Mock.closeSheet()" aria-label="닫기">✕</button></div>'
      + '<div class="seg-row mk-seg2" role="group" aria-label="매매 구분">'
      +   '<button class="seg' + (isBuy ? ' on buy' : '') + '" aria-pressed="' + isBuy + '" onclick="Mock.setSheet(\'side\',\'buy\')">매수</button>'
      +   '<button class="seg' + (!isBuy ? ' on sell' : '') + '" aria-pressed="' + !isBuy + '" onclick="Mock.setSheet(\'side\',\'sell\')">매도</button>'
      + '</div>'
      + '<div class="seg-row sub mk-seg2" role="group" aria-label="주문 종류">'
      +   '<button class="seg' + (s.type === 'limit' ? ' on' : '') + '" aria-pressed="' + (s.type === 'limit') + '" onclick="Mock.setSheet(\'type\',\'limit\')">지정가</button>'
      +   '<button class="seg' + (s.type === 'market' ? ' on' : '') + '" aria-pressed="' + (s.type === 'market') + '" onclick="Mock.setSheet(\'type\',\'market\')"' + (limitOnly ? ' disabled' : '') + '>시장가</button>'
      + '</div>'
      + '<div id="mkSessionNote">' + sessionNote() + '</div>'
      + '<div class="mk-field"><span id="mkPriceLbl">가격</span>'
      + (s.type === 'market'
          ? '<div class="mk-market">시장가 · 접수 후 실제 체결가로 체결됩니다</div>'
          : '<div class="mk-stepper"><button type="button" onclick="Mock.step(-1)" aria-label="한 호가 내리기">−</button>'
            + '<input id="mkPrice" type="text" inputmode="numeric" aria-labelledby="mkPriceLbl" value="' + (n.price ? fmtNum(n.price) : '') + '" oninput="Mock.input(\'price\', this)">'
            + '<button type="button" onclick="Mock.step(1)" aria-label="한 호가 올리기">+</button></div>')
      + '</div>'
      + '<div class="mk-field"><span id="mkQtyLbl">수량</span>'
      +   '<div class="mk-stepper"><input id="mkQty" type="text" inputmode="numeric" aria-labelledby="mkQtyLbl" placeholder="0" value="' + (n.qty ? fmtNum(n.qty) : '') + '" oninput="Mock.input(\'qty\', this)"><em>주</em></div>'
      + '</div>'
      + '<div class="mk-pct">' + [10, 25, 50, 100].map(function (p) {
          return '<button type="button" class="mini-btn" onclick="Mock.pct(' + p + ')">' + (p === 100 ? '최대' : p + '%') + '</button>';
        }).join('') + '<span class="mk-dim" id="mkMaxQty">' + (isBuy ? '최대 ' : '보유 ') + fmtNum(n.maxQty) + '주</span></div>'
      + '<div class="mk-calc">' + calcHtml(n) + '</div>'
      + '<div class="mk-sheet-msg" id="mkMsg" role="alert"></div>'
      + '<button class="mk-submit ' + s.side + '" id="mkSubmit" onclick="Mock.submit()"' + (s.busy ? ' disabled' : '') + '>'
      +   (isBuy ? '매수' : '매도') + ' 주문</button>'
      + '</div>';
    if (fresh) focusDialog(el);
  }
  function row(k, v) { return '<div class="mk-calc-row"><span>' + k + '</span><b>' + v + '</b></div>'; }

  /** 입력 중에 바뀔 수 있는 부분만 갱신 — 안내문·최대 수량·계산 행 (포커스와 키보드는 그대로) */
  function refreshSheetParts() {
    if (!sheet || !document.getElementById('mkSheet')) return;
    var limitOnly = phaseInfo().limitOnly;
    if (limitOnly && sheet.type === 'market') { renderSheet(); return; }     // 구간이 바뀌어 시장가가 막히면 통째로
    var n = sheetNumbers();
    var note = document.getElementById('mkSessionNote'); if (note) note.innerHTML = sessionNote();
    var mx = document.getElementById('mkMaxQty'); if (mx) mx.textContent = (sheet.side === 'buy' ? '최대 ' : '보유 ') + fmtNum(n.maxQty) + '주';
    var calc = document.querySelector('#mkSheet .mk-calc'); if (calc) calc.innerHTML = calcHtml(n);
  }

  function setSheet(key, val) {
    if (!sheet || sheet.busy) return;
    sheet[key] = val;
    if (key === 'side') sheet.qty = '';
    renderSheet();
  }

  /** 입력 중에는 통째로 다시 그리지 않는다 — 커서가 튀고 모바일 키보드가 닫힌다 */
  function input(key, el) {
    if (!sheet) return;
    var v = Number(String(el.value).replace(/[^0-9]/g, '')) || 0;
    sheet[key] = v;
    el.value = v ? fmtNum(v) : '';
    msg('');
    var n = sheetNumbers();
    var mx = document.getElementById('mkMaxQty'); if (mx) mx.textContent = (sheet.side === 'buy' ? '최대 ' : '보유 ') + fmtNum(n.maxQty) + '주';
    var calc = document.querySelector('#mkSheet .mk-calc'); if (calc) calc.innerHTML = calcHtml(n);
  }

  function step(dir) {
    if (!sheet || sheet.busy) return;
    sheet.price = tickStep(sheet.price, dir, sheet.taxFree);
    var inp = document.getElementById('mkPrice');
    if (inp) { inp.value = fmtNum(sheet.price); input('price', inp); }
    else renderSheet();
  }

  function pct(p) {
    if (!sheet || sheet.busy) return;
    sheet.qty = Math.floor(sheetNumbers().maxQty * p / 100);
    var inp = document.getElementById('mkQty');
    if (inp) { inp.value = sheet.qty ? fmtNum(sheet.qty) : ''; input('qty', inp); }
    else renderSheet();
  }

  function msg(text, cls) {
    var el = document.getElementById('mkMsg');
    if (el) { el.textContent = text || ''; el.className = 'mk-sheet-msg ' + (cls || ''); }
  }

  /** 서버에 보내기 전에 걸러 낼 수 있는 것은 여기서 — 왕복 없이 바로 안내한다 (최종 판정은 서버) */
  function validateBeforeSubmit(n) {
    var p = phaseInfo();
    if (!p.canOrder) return p.holiday ? '오늘은 휴장일입니다' : (p.phase === 'break' ? '15:30~15:40 은 주문 접수 시간이 아닙니다' : '주문 가능 시간이 아닙니다 (거래일 08:00~20:00)');
    if (n.qty <= 0) return '수량을 입력하세요';
    if (sheet.type === 'limit') {
      if (n.price <= 0) return '주문 가격을 입력하세요';
      var t = tickSize(n.price, sheet.taxFree);
      if (n.price % t !== 0) {
        // 가장 가까운 호가로 맞춰 주고 한 번 더 누르게 한다
        sheet.price = Math.round(n.price / t) * t;
        var inp = document.getElementById('mkPrice');
        if (inp) { inp.value = fmtNum(sheet.price); input('price', inp); }
        return '호가단위(' + t + '원)에 맞춰 ' + fmtNum(sheet.price) + '원으로 바꿨습니다. 확인 후 다시 눌러 주세요';
      }
      var q = (typeof _lastQuote !== 'undefined' && _lastQuote && _lastQuote.code === sheet.code) ? _lastQuote : null;
      var prev = q && q.krx && q.krx.prevClose;
      if (prev) {
        var upRaw = prev * 1.3, dnRaw = prev * 0.7;
        var upper = Math.floor(upRaw / tickSize(upRaw, sheet.taxFree)) * tickSize(upRaw, sheet.taxFree);
        var lower = Math.ceil(dnRaw / tickSize(dnRaw, sheet.taxFree)) * tickSize(dnRaw, sheet.taxFree);
        if (n.price > upper || n.price < lower) return '가격제한폭을 벗어났습니다 (' + fmtNum(lower) + '~' + fmtNum(upper) + '원)';
      }
    }
    if (sheet.side === 'buy' && account && n.amount + n.fee > account.available) return '주문 가능 금액이 부족합니다';
    if (sheet.side === 'sell' && n.qty > n.maxQty) return '매도 가능 수량이 부족합니다 (' + fmtNum(n.maxQty) + '주)';
    return null;
  }

  async function submit() {
    if (!sheet || sheet.busy) return;
    var n = sheetNumbers();
    var bad = validateBeforeSubmit(n);
    if (bad) { msg(bad, 'err'); return; }
    sheet.busy = true;
    var btn = document.getElementById('mkSubmit');
    if (btn) { btn.disabled = true; btn.textContent = '주문 접수 중'; }
    // 같은 주문이 두 번 들어가지 않도록 주문마다 고유값을 붙인다 (서버가 재전송을 같은 주문으로 본다).
    // 고유값은 주문창에 붙여 둔다 — 15초 시간 초과 뒤 다시 누르면 같은 값으로 보내야 서버가 중복을 막는다.
    // 종목·매매·종류·수량·가격이 바뀌었을 때만 새로 만든다 (거절된 주문은 서버에 남지 않아 같은 값으로 다시 보내도 된다)
    var cidKey = [sheet.code, sheet.side, sheet.type, n.qty, sheet.type === 'limit' ? n.price : ''].join('|');
    if (!sheet.cid || sheet.cidKey !== cidKey) {
      sheet.cid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      sheet.cidKey = cidKey;
    }
    var cid = sheet.cid;
    var mySheet = sheet;
    try {
      var d = await api('/orders', 'POST', {
        clientOrderId: cid, code: sheet.code, side: sheet.side, type: sheet.type, qty: n.qty,
        limitPrice: sheet.type === 'limit' ? n.price : undefined
      });
      if (sheet !== mySheet) return;          // 기다리는 사이 창을 닫았으면 계좌 탭에서 확인하면 된다
      sheet.cid = null;                       // 접수됐다 — 이 창에서 다음 주문은 새 값으로
      sheet.orderId = d.order.id;
      showPending(d.order);
      watchOrder(d.order.id, 0);
    } catch (e) {
      if (sheet !== mySheet) return;
      sheet.busy = false;
      msg(e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = (sheet.side === 'buy' ? '매수' : '매도') + ' 주문'; }
    }
  }

  /** 접수 직후 주문창 하단을 체결 대기 패널로 바꾼다 */
  function showPending(o, filledQty) {
    var el = document.getElementById('mkSubmit') || document.getElementById('mkPending');
    if (!el) return;
    var wrap = document.createElement('div');
    wrap.id = 'mkPending';
    wrap.className = 'mk-pending';
    var sideTxt = o.side === 'buy' ? '매수' : '매도';
    var typeTxt = o.type === 'market' ? '시장가' : '지정가 ' + fmtNum(o.limitPrice) + '원';
    wrap.innerHTML = '<div class="mk-pending-head"><span class="mk-spin" aria-hidden="true"></span>'
      + '<b>' + (filledQty ? '일부 체결 · 잔량 대기' : '주문 접수 완료 · 체결 대기') + '</b></div>'
      + '<div class="mk-pending-body">' + escapeHtml(o.name) + ' ' + sideTxt + ' ' + fmtNum(o.qty) + '주 · ' + typeTxt
      + (filledQty ? '<br>체결 ' + fmtNum(filledQty) + '주 / 미체결 ' + fmtNum(o.qty - filledQty) + '주' : '') + '</div>'
      + '<div class="mk-pending-note">창을 닫아도 주문은 유지됩니다 · 계좌 탭 미체결 주문</div>'
      + '<button class="btn-ghost mk-pending-close" onclick="Mock.closeSheet()">닫기</button>';
    el.replaceWith(wrap);
    msg('');
  }

  /** 주문 직후 2초마다 상태를 물어본다 — 물어볼 때 서버가 체결을 시도한다. 1분 넘으면 크론에 맡긴다.
   *  창은 "이 주문을 접수한 그 창"일 때만 닫는다 — 다른 종목의 새 주문창을 끌어내리지 않게 */
  function watchOrder(id, tries) {
    clearTimeout(watchingOrder);
    var mine = function () { return sheet && sheet.orderId === id; };
    watchingOrder = setTimeout(async function () {
      try {
        var d = await api('/orders/' + encodeURIComponent(id));
        var o = d.order;
        if (o.status === 'filled' || o.status === 'cancelled' || o.status === 'expired' || o.status === 'rejected') {
          await refreshAccount();
          var done = o.filledQty > 0
            ? (o.name + ' ' + (o.side === 'buy' ? '매수' : '매도') + ' 체결 · ' + fmtNum(o.filledQty) + '주' + (d.fill ? ' · ' + fmtNum(d.fill.price) + '원' : ''))
            : (o.name + ' 주문이 ' + (o.status === 'cancelled' ? '취소' : '만료') + '되었습니다' + (o.reason ? ' (' + o.reason + ')' : ''));
          if (mine()) closeSheet();
          toast(done, o.filledQty > 0 ? o.side : '');
          return;
        }
        if (o.filledQty > 0 && mine()) showPending(o, o.filledQty);
        if (tries >= 30 || !mine()) {
          await refreshAccount();
          if (mine()) { closeSheet(); toast(o.name + ' 주문 대기 중 · 계좌 탭에서 확인할 수 있습니다', ''); }
          return;
        }
        watchOrder(id, tries + 1);
      } catch (e) { if (tries < 30 && mine()) watchOrder(id, tries + 1); }
    }, 2000);
  }

  function toast(text, cls) {
    var old = document.getElementById('mkToast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'mkToast';
    el.className = 'mk-toast ' + (cls || '');
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 400); }, 3600);
  }

  /* ===== 보조 창 (정정 · 손절/익절) =====
   * 주문창(#mkSheet)과 따로 #mkAux 하나를 쓴다. 상태는 aux 에 두고,
   * 입력 중에는 도움말·계산 칸만 고친다 (통째로 다시 그리면 포커스와 모바일 키보드가 날아간다).
   */
  var aux = null;
  var _kind = {};              // 종목코드 → ETF·ETN 여부 (호가단위용)

  function closeAux() {
    aux = null;
    var el = document.getElementById('mkAux');
    if (el) el.remove();
    syncNoScroll();
  }

  function auxShell(inner, cls, label) {
    var el = document.getElementById('mkAux');
    var fresh = !el, top = 0;
    if (!el) {
      el = document.createElement('div');
      el.id = 'mkAux';
      el.className = 'mk-sheet-wrap';
      document.body.appendChild(el);
    } else {
      var old = el.querySelector('.mk-sheet');
      if (old) top = old.scrollTop;              // 지정가로 바꾸는 등 다시 그려도 보던 자리를 지킨다
    }
    el.innerHTML = '<div class="mk-sheet-dim" onclick="Mock.closeAux()"></div>'
      + '<div class="mk-sheet ' + cls + (fresh ? '' : ' still') + '" role="dialog" aria-modal="true" aria-label="' + label + '" tabindex="-1">' + inner + '</div>';
    syncNoScroll();
    if (fresh) focusDialog(el);
    else { var nw = el.querySelector('.mk-sheet'); if (nw) nw.scrollTop = top; }
  }

  function auxHead(title, sub) {
    return '<div class="mk-sheet-head"><span class="mk-sheet-title">' + title + (sub ? ' <i>' + sub + '</i>' : '') + '</span>'
      + '<button class="mini-btn mk-x" onclick="Mock.closeAux()" aria-label="닫기">✕</button></div>';
  }

  /** key 는 내부 상수만 넘어온다 ('price', 'tp.trig' …) */
  function auxGet(key) { var k = key.split('.'); return k.length > 1 ? aux[k[0]][k[1]] : aux[key]; }
  function auxPut(key, v) { var k = key.split('.'); if (k.length > 1) aux[k[0]][k[1]] = v; else aux[key] = v; }
  function auxInputId(key) { return 'mkAux-' + key.replace('.', '-'); }

  function stepperHtml(key, val, suffix, label, ph) {
    return '<div class="mk-stepper"><button type="button" onclick="Mock.auxStep(\'' + key + '\',-1)" aria-label="' + label + ' 내리기">−</button>'
      + '<input id="' + auxInputId(key) + '" type="text" inputmode="numeric" aria-label="' + label + '"'
      +   (ph ? ' placeholder="' + ph + '"' : '') + ' value="' + (val ? fmtNum(val) : '') + '" oninput="Mock.auxInput(\'' + key + '\', this)">'
      + (suffix ? '<em>' + suffix + '</em>' : '')
      + '<button type="button" onclick="Mock.auxStep(\'' + key + '\',1)" aria-label="' + label + ' 올리기">+</button></div>';
  }

  function segHtml(key, cur, opts, disabledVal) {
    return '<div class="seg-row sub mk-seg2" role="group">' + opts.map(function (o) {
      var on = cur === o[0];
      return '<button type="button" class="seg' + (on ? ' on' : '') + '" aria-pressed="' + on + '"'
        + ' onclick="Mock.auxSet(\'' + key + '\',\'' + o[0] + '\')"' + (o[0] === disabledVal ? ' disabled' : '') + '>' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function auxMsg(text, cls) {
    var el = document.getElementById('mkAuxMsg');
    if (el) { el.textContent = text || ''; el.className = 'mk-sheet-msg ' + (cls || ''); }
  }

  function setAuxBusy(b, label) {
    if (!aux) return;
    aux.busy = b;
    var btn = document.getElementById('mkAuxGo');
    if (!btn) return;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = b;
    btn.textContent = b ? label : btn.dataset.label;
  }

  function setAuxInput(key, v) {
    var inp = document.getElementById(auxInputId(key));
    if (inp) inp.value = v ? fmtNum(v) : '';
  }

  /** 지금 보이는 가격 — 종목 상세의 시세가 있으면 그것, 없으면 계좌의 평가 가격 */
  function curPrice(code) {
    var q = (typeof _lastQuote !== 'undefined' && _lastQuote && _lastQuote.code === code) ? _lastQuote : null;
    if (q) return (q.krx && q.krx.price) || q.price || null;
    var p = holding(code);
    return p && p.price ? p.price : null;
  }

  async function fetchKind(a) {
    if (_kind[a.code] != null) { a.taxFree = _kind[a.code]; return; }
    try {
      var k = await api('/kind?code=' + encodeURIComponent(a.code) + '&name=' + encodeURIComponent(a.name || ''));
      if (k && k.code) _kind[k.code] = !!k.taxFree;
      if (aux === a && k.code === a.code) a.taxFree = !!k.taxFree;
    } catch (e) { /* 호가단위는 서버가 다시 확인한다 */ }
  }

  function renderAux() {
    if (!aux) return;
    if (aux.kind === 'amend') auxShell(amendHtml(), aux.side === 'buy' ? 'buy' : 'sell', '주문 정정');
    else if (aux.kind === 'stop') auxShell(stopSheetHtml(), 'sell', '손절 · 익절 설정');
    refreshAuxParts();
  }

  function refreshAuxParts() {
    if (!aux) return;
    if (aux.kind === 'amend') amendParts();
    else if (aux.kind === 'stop') stopParts();
  }

  function auxInput(key, el) {
    if (!aux || aux.busy) return;
    var v = Number(String(el.value).replace(/[^0-9]/g, '')) || 0;
    auxPut(key, v || '');
    el.value = v ? fmtNum(v) : '';
    auxMsg('');
    refreshAuxParts();
  }

  function auxStep(key, dir) {
    if (!aux || aux.busy) return;
    var cur = Number(auxGet(key)) || 0, v;
    if (key === 'qty') {
      var max = aux.kind === 'amend' ? aux.rem : (aux.kind === 'stop' ? aux.hold : Infinity);
      if (!cur) cur = max;                                  // 손절·익절의 빈칸은 "전량"
      v = Math.min(max, Math.max(1, cur + dir));
    } else {
      if (!cur) cur = curPrice(aux.code) || 0;
      v = cur ? tickStep(cur, dir, aux.taxFree) : '';
    }
    auxPut(key, v);
    setAuxInput(key, v);
    auxMsg('');
    refreshAuxParts();
  }

  function auxSet(key, val) {
    if (!aux || aux.busy) return;
    auxPut(key, val);
    // 지정가로 바꾸면 주문가 칸을 감시가로 채워 둔다
    var m = /^(tp|sl)\.type$/.exec(key);
    if (m && val === 'limit' && !aux[m[1]].limit) aux[m[1]].limit = aux[m[1]].trig;
    if (key === 'type' && val === 'limit' && aux.kind === 'amend' && !aux.price) aux.price = curPrice(aux.code) || '';
    renderAux();
  }

  function auxSel(key, el) {
    if (!aux || aux.busy) return;
    auxPut(key, el.value);
    refreshAuxParts();
  }

  function auxSubmit() {
    if (!aux || aux.busy) return;
    if (aux.kind === 'amend') return amendSubmit();
    if (aux.kind === 'stop') return stopSubmit();
  }

  /** 지정가가 호가단위에 안 맞으면 가까운 호가로 맞추고 한 번 더 누르게 한다 (주문창과 같은 방식) */
  function fixTick(key, taxFree) {
    var p = Number(auxGet(key)) || 0;
    var t = tickSize(p, taxFree);
    if (!p || p % t === 0) return null;
    var np = Math.round(p / t) * t;
    auxPut(key, np); setAuxInput(key, np); refreshAuxParts();
    return '호가단위(' + t + '원)에 맞춰 ' + fmtNum(np) + '원으로 바꿨습니다. 확인 후 다시 눌러 주세요';
  }

  /** 같은 요청이 두 번 들어가지 않게 — 입력이 바뀌었거나 접수된 뒤에만 새 값을 만든다 */
  function cidFor(holder, body) {
    var key = JSON.stringify(body);
    if (!holder.cid || holder.cidKey !== key) { holder.cid = newId(); holder.cidKey = key; }
    return holder.cid;
  }

  /* ----- 정정 ----- */
  function openAmend(id) {
    if (!UUID_RE.test(id) || !account) return;
    var o = account.openOrders.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    closeSheet();
    var rem = o.qty - o.filledQty;
    aux = {
      kind: 'amend', id: o.id, code: o.code, name: o.name, side: o.side, filled: o.filledQty, rem: rem,
      origType: o.type, origPrice: o.limitPrice || null,
      type: o.type, price: o.limitPrice || curPrice(o.code) || '', qty: rem,
      taxFree: false, busy: false, cid: null, cidKey: null
    };
    renderAux();
    fetchKind(aux);
  }

  function amendHtml() {
    var a = aux, isBuy = a.side === 'buy', limitOnly = phaseInfo().limitOnly;
    var sideTxt = isBuy ? '매수' : '매도';
    var typeTxt = a.origType === 'market' ? '시장가' : '지정가 ' + fmtNum(a.origPrice) + '원';
    return auxHead('정정 · ' + escapeHtml(a.name), CODE_RE.test(a.code) ? a.code : '')
      + '<div class="mk-info mk-cur">현재 주문 · ' + sideTxt + ' ' + typeTxt + ' · 미체결 <b>' + fmtNum(a.rem) + '주</b>'
      +   (a.filled ? ' (체결 ' + fmtNum(a.filled) + '주)' : '') + '</div>'
      + '<div class="mk-field"><span>주문 종류</span>'
      +   segHtml('type', a.type, [['limit', '지정가'], ['market', '시장가']], limitOnly ? 'market' : null) + '</div>'
      + '<div class="mk-field"><span>가격</span>'
      + (a.type === 'market'
          ? '<div class="mk-market">시장가 · 접수 후 실제 체결가로 체결됩니다</div>'
          : stepperHtml('price', a.price, '원', '정정 가격'))
      + '</div>'
      + '<div class="mk-field"><span>수량</span>' + stepperHtml('qty', a.qty, '주', '정정 수량') + '</div>'
      + '<div class="mk-pct"><span class="mk-dim">미체결 ' + fmtNum(a.rem) + '주까지 · 늘릴 수는 없습니다</span></div>'
      + '<div class="mk-help">가격을 바꾸면 대기 순서가 뒤로 갑니다 · 수량만 줄이면 유지됩니다</div>'
      + '<div class="mk-calc" id="mkAuxCalc"></div>'
      + '<div class="mk-sheet-msg" id="mkAuxMsg" role="alert"></div>'
      + '<button class="mk-submit ' + (isBuy ? 'buy' : 'sell') + '" id="mkAuxGo" onclick="Mock.auxSubmit()">정정 주문</button>';
  }

  /** 무엇이 바뀌는지 한 줄씩 — 바뀐 것만 서버로 보낸다 */
  function amendChanges() {
    var a = aux, out = [], qty = Math.floor(Number(a.qty)) || 0, price = Number(a.price) || 0;
    if (a.type !== a.origType) out.push(['주문 종류', (a.origType === 'market' ? '시장가' : '지정가') + ' → ' + (a.type === 'market' ? '시장가' : '지정가')]);
    if (a.type === 'limit' && price && (a.type !== a.origType || price !== a.origPrice)) {
      out.push(['가격', (a.origPrice ? fmtNum(a.origPrice) + ' → ' : '') + fmtNum(price) + '원']);
    }
    if (qty && qty !== a.rem) out.push(['수량', fmtNum(a.rem) + ' → ' + fmtNum(qty) + '주']);
    return out;
  }

  function amendParts() {
    var box = document.getElementById('mkAuxCalc');
    if (!box) return;
    var ch = amendChanges();
    box.innerHTML = ch.length ? ch.map(function (c) { return row(c[0], c[1]); }).join('') : row('변경', '없음');
  }

  async function amendSubmit() {
    var a = aux;
    var qty = Math.floor(Number(a.qty)) || 0, price = Number(a.price) || 0;
    if (qty <= 0) return auxMsg('수량을 입력하세요. 전부 거두려면 취소를 누르세요', 'err');
    if (qty > a.rem) return auxMsg('수량은 늘릴 수 없습니다 (미체결 ' + fmtNum(a.rem) + '주까지)', 'err');
    var body = {};
    if (a.type !== a.origType) body.type = a.type;
    if (a.type === 'limit') {
      if (price <= 0) return auxMsg('주문 가격을 입력하세요', 'err');
      var fix = fixTick('price', a.taxFree);
      if (fix) return auxMsg(fix, 'err');
      if (body.type || price !== a.origPrice) body.limitPrice = price;
    }
    if (qty !== a.rem) body.qty = qty;          // 새 미체결 수량 (줄이기만 가능)
    if (!Object.keys(body).length) return auxMsg('바뀐 내용이 없습니다', 'err');
    body.clientOrderId = cidFor(a, body);
    setAuxBusy(true, '정정 접수 중');
    try {
      var d = await api('/orders/' + encodeURIComponent(a.id) + '/amend', 'POST', body);
      a.cid = null;
      if (aux === a) closeAux();
      toast(a.name + ' 정정 완료' + (d && d.replaced ? ' · 새 주문으로 대기합니다' : ' · 대기 순서 유지'), '');
    } catch (e) {
      if (aux !== a) return;
      setAuxBusy(false);
      auxMsg(e.message, 'err');
    } finally {
      refreshAccount();
    }
  }

  /* ----- 유효기간 (KST 달력 기준, 시즌 종료일을 넘지 않는다) ----- */
  function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function ymdAdd(ymd, days, months) {
    var p = ymd.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + (months || 0), p[2] + (days || 0)));
    if (months && d.getUTCDate() !== p[2]) d = new Date(Date.UTC(p[0], p[1] + months, 0));   // 1/31 + 1개월 → 2월 말일
    return d.toISOString().slice(0, 10);
  }
  function seasonEnd() {
    var e = account && account.season && fmtYmd(account.season.endDate);
    return /^\d{4}-\d{2}-\d{2}$/.test(e || '') ? e : null;
  }
  function validOpts() {
    var t = kstToday(), end = seasonEnd();
    var cap = function (d) { return end && d > end ? end : d; };
    var o = [['today', '오늘', cap(t)], ['1w', '1주', cap(ymdAdd(t, 7))], ['1m', '1개월', cap(ymdAdd(t, 0, 1))]];
    if (end) o.push(['season', '시즌 끝까지', end]);
    return o;
  }
  function validDate(v) {
    var o = validOpts().filter(function (x) { return x[0] === v; })[0] || validOpts()[0];
    return o[2];
  }
  function validSelHtml(cur) {
    return '<div class="mk-field"><span id="mkAuxValidLbl">유효기간</span>'
      + '<select class="f-select mk-select" aria-labelledby="mkAuxValidLbl" onchange="Mock.auxSel(\'valid\', this)">'
      + validOpts().map(function (o) {
          return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + ' (~' + md(o[2]) + ')</option>';
        }).join('')
      + '</select></div>';
  }
  /** '2026-10-30' · '20261030' → '10/30' */
  function md(v) {
    var m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(v || ''));
    return m ? Number(m[2]) + '/' + Number(m[3]) : '';
  }
  function pct1(x) { return (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }

  /* ----- 손절 · 익절 (보유 종목) ----- */
  function openStops(code) {
    if (!CODE_RE.test(code)) return;
    var p = holding(code);
    if (!p) return;
    closeSheet();
    var blank = function () { return { trig: '', type: 'market', limit: '', done: null, cid: null, cidKey: null }; };
    aux = {
      kind: 'stop', code: code, name: p.name, hold: p.qty, avg: p.avgPrice,
      tp: blank(), sl: blank(), qty: '', valid: '1m', groupId: null, taxFree: false, busy: false
    };
    renderAux();
    fetchKind(aux);
  }

  function stopBlockHtml(k) {
    var r = aux[k], isTp = k === 'tp', lbl = isTp ? '익절' : '손절';
    if (r.done) {
      return '<div class="mk-stop-blk ' + k + ' done"><div class="mk-stop-h"><b>' + lbl + '</b><i class="mk-tag">등록됨</i></div>'
        + '<div class="mk-help">' + escapeHtml(stopSentence(r.done)) + '</div></div>';
    }
    return '<div class="mk-stop-blk ' + k + '">'
      + '<div class="mk-stop-h"><b>' + lbl + '</b><span>현재가가</span></div>'
      + stepperHtml(k + '.trig', r.trig, isTp ? '원 이상이면' : '원 이하면', lbl + ' 감시가', '감시가')
      + '<div class="mk-help" id="mkAuxHelp-' + k + '"></div>'
      + segHtml(k + '.type', r.type, [['market', '시장가 매도'], ['limit', '지정가 매도']])
      + (r.type === 'limit' ? '<div class="mk-field mk-field-tight"><span>주문가</span>' + stepperHtml(k + '.limit', r.limit, '원', lbl + ' 주문가') + '</div>' : '')
      + '</div>';
  }

  function stopSheetHtml() {
    var a = aux;
    return auxHead('손절 · 익절 · ' + escapeHtml(a.name), a.code)
      + '<div class="mk-info mk-cur">보유 <b>' + fmtNum(a.hold) + '주</b> · 평단 ' + fmtNum(a.avg) + '원'
      +   (curPrice(a.code) ? ' · 현재가 ' + fmtNum(curPrice(a.code)) + '원' : '') + '</div>'
      + stopBlockHtml('tp')
      + stopBlockHtml('sl')
      + '<div class="mk-field"><span>수량</span>' + stepperHtml('qty', a.qty, '주', '감시 매도 수량', '전량') + '</div>'
      + '<div class="mk-pct"><button type="button" class="mini-btn mk-chip" onclick="Mock.auxSet(\'qty\',\'\')">전량</button>'
      +   '<span class="mk-dim">비우면 발동 시점 보유 전량</span></div>'
      + validSelHtml(a.valid)
      + '<div id="mkAuxWarn"></div>'
      + '<div class="mk-help">둘 다 걸면 하나가 발동될 때 나머지는 자동 취소됩니다</div>'
      + '<div class="mk-sheet-msg" id="mkAuxMsg" role="alert"></div>'
      + '<button class="mk-submit sell" id="mkAuxGo" onclick="Mock.auxSubmit()">감시주문 등록</button>';
  }

  /** 입력한 감시가를 평단 · 현재가와 견줘 보여 준다 */
  function trigHelp(v, cond, avg, code) {
    v = Number(v) || 0;
    if (!v) return '';
    var parts = [], cur = curPrice(code);
    if (avg) parts.push('평단 대비 <b class="' + signClass(v - avg) + '">' + pct1((v - avg) / avg * 100) + '</b>');
    if (cur) parts.push('현재가 대비 <b class="' + signClass(v - cur) + '">' + pct1((v - cur) / cur * 100) + '</b>');
    if (cur && (cond === 'gte' ? cur >= v : cur <= v)) parts.push('<span class="mk-hot">현재가가 이미 조건에 닿아 있습니다 · 일반 주문을 이용하세요</span>');
    return parts.join(' · ');
  }

  function stopParts() {
    var a = aux;
    ['tp', 'sl'].forEach(function (k) {
      var el = document.getElementById('mkAuxHelp-' + k);
      if (el) el.innerHTML = trigHelp(a[k].trig, k === 'tp' ? 'gte' : 'lte', a.avg, a.code);
    });
    var w = document.getElementById('mkAuxWarn');
    if (!w) return;
    // 이미 걸린 감시 매도 + 이번에 거는 묶음(둘 중 하나만 발동)의 수량이 보유보다 많으면 알려만 준다
    var newOnes = ['tp', 'sl'].filter(function (k) { return !a[k].done && Number(a[k].trig) > 0; });
    var q = a.qty === '' ? a.hold : (Number(a.qty) || 0);
    var over = newOnes.length ? sellStopOver(a.code, q) : null;
    var msgs = [];
    if (a.qty !== '' && Number(a.qty) > a.hold) msgs.push('보유 수량(' + fmtNum(a.hold) + '주)보다 많습니다');
    else if (over) msgs.push('이 종목의 감시 매도 수량 합계(' + fmtNum(over.need) + '주)가 보유 ' + fmtNum(over.hold) + '주보다 많습니다. 먼저 발동된 주문만 체결될 수 있습니다');
    w.innerHTML = msgs.length ? '<div class="mk-warn">' + escapeHtml(msgs[0]) + '</div>' : '';
  }

  async function stopSubmit() {
    var a = aux;
    var todo = ['tp', 'sl'].filter(function (k) { return !a[k].done && Number(a[k].trig) > 0; });
    if (!todo.length) {
      if (a.tp.done || a.sl.done) { closeAux(); return; }
      return auxMsg('익절가나 손절가를 입력하세요', 'err');
    }
    var tpv = Number(a.tp.trig) || 0, slv = Number(a.sl.trig) || 0;
    if (tpv && slv && tpv <= slv) return auxMsg('익절가는 손절가보다 높아야 합니다', 'err');
    var qty = a.qty === '' ? null : Math.floor(Number(a.qty)) || 0;
    if (qty !== null && (qty <= 0 || qty > a.hold)) return auxMsg('수량은 보유 ' + fmtNum(a.hold) + '주 안에서 입력하세요', 'err');
    for (var i = 0; i < todo.length; i++) {
      var r = a[todo[i]];
      if (r.type !== 'limit') continue;
      if (!(Number(r.limit) > 0)) return auxMsg((todo[i] === 'tp' ? '익절' : '손절') + ' 주문가를 입력하세요', 'err');
      var fix = fixTick(todo[i] + '.limit', a.taxFree);
      if (fix) return auxMsg(fix, 'err');
    }
    // 둘 다 걸면 한 묶음(OCO) — 하나가 먼저 접수되고 다른 하나가 실패해도 다시 누르면 같은 묶음으로 보낸다
    var pair = (tpv > 0 || a.tp.done) && (slv > 0 || a.sl.done);
    if (pair && !a.groupId) a.groupId = newId();
    var validUntil = validDate(a.valid);
    setAuxBusy(true, '등록 중');
    var made = 0;
    for (var j = 0; j < todo.length; j++) {
      var k = todo[j], row0 = a[k];
      var body = {
        code: a.code, side: 'sell', cond: k === 'tp' ? 'gte' : 'lte', triggerPrice: Number(row0.trig),
        orderType: row0.type, limitPrice: row0.type === 'limit' ? Number(row0.limit) : undefined,
        qty: qty, validUntil: validUntil, groupId: pair ? a.groupId : undefined
      };
      body.clientOrderId = cidFor(row0, body);
      try {
        var d = await api('/stops', 'POST', body);
        row0.cid = null;
        row0.done = (d && d.stop) || Object.assign({ name: a.name }, body);
        made++;
      } catch (e) {
        loadStops(true);
        if (aux !== a) return;
        setAuxBusy(false);
        renderAux();
        auxMsg((k === 'tp' ? '익절' : '손절') + ' 등록 실패 · ' + e.message, 'err');
        return;
      }
    }
    loadStops(true);
    if (aux === a) closeAux();
    toast(a.name + ' 감시주문 ' + made + '건 등록', '');
  }

  /* ===== 감시주문 목록 (계좌 탭) =====
   * 10초 폴링마다 받지 않는다 — 탭을 열 때, 등록·취소 뒤, 60초가 지났을 때만 받고
   * 계좌 탭을 다시 그릴 때는 받아 둔 것으로 그린다.
   */
  var _stops = null, _stopsAt = 0, _stopsLoading = false, _stopsAgain = false, _stopsPastOpen = false;

  async function loadStops(force) {
    if (_stopsLoading) { if (force) _stopsAgain = true; return; }
    if (!force && Date.now() - _stopsAt < 60000) return;
    if (!season || !season.joined) return;
    _stopsLoading = true;
    _stopsAt = Date.now();
    try {
      var d = await api('/stops');
      _stops = (d && Array.isArray(d.items)) ? d.items : [];
    } catch (e) {
      if (!_stops) _stops = [];            // 못 받으면 받아 둔 목록을 그대로 둔다
    } finally {
      _stopsLoading = false;
    }
    if (_stopsAgain) { _stopsAgain = false; return loadStops(true); }
    var box = document.getElementById('mkStops');
    if (box) box.innerHTML = stopsInnerHtml();
  }

  function armedStops() { return (_stops || []).filter(function (s) { return s.status === 'armed'; }); }

  function stopRole(s) {
    return s.cond === 'gte' ? '익절' : '손절';
  }

  /** "285,000원 이하 → 전량 시장가 매도 · ~10/30" */
  function stopSentence(s) {
    var q = s.qty == null ? '전량' : fmtNum(s.qty) + '주';
    var how = s.orderType === 'limit' ? '지정가 ' + fmtNum(s.limitPrice) + '원' : '시장가';
    return fmtNum(s.triggerPrice) + '원 ' + (s.cond === 'gte' ? '이상' : '이하') + ' → ' + q + ' ' + how + ' 매도'
      + (md(s.validUntil) ? ' · ~' + md(s.validUntil) : '');
  }

  /**
   * 한 종목에 걸린 감시 매도 수량 합계가 보유보다 많은지. 같은 묶음(OCO)은 하나만 발동되니 큰 쪽만 센다.
   * extraQty 가 있으면 새로 거는 묶음 하나를 더해 본다.
   */
  function sellStopOver(code, extraQty) {
    var hold = (holding(code) || {}).qty || 0;
    var groups = {};
    armedStops().forEach(function (s) {
      if (s.side !== 'sell' || s.code !== code) return;
      var q = s.qty == null ? hold : (Number(s.qty) || 0);
      var g = s.groupId || s.id;
      groups[g] = Math.max(groups[g] || 0, q);
    });
    var keys = Object.keys(groups);
    if (!keys.length) return null;         // 새로 거는 것만 있으면 수량 칸에서 따로 확인한다
    var need = keys.reduce(function (t, g) { return t + groups[g]; }, 0) + (extraQty || 0);
    return need > hold ? { need: need, hold: hold } : null;
  }

  function stopsInnerHtml() {
    var list = _stops || [];
    var armed = list.filter(function (s) { return s.status === 'armed'; });
    var past = list.filter(function (s) { return s.status !== 'armed'; });
    if (!armed.length && !past.length) return '';
    var h = '<section class="m-section"><div class="m-head"><h3>⏱ 감시 중</h3><span class="m-hint">' + armed.length + '건</span></div>';
    var warned = {};
    armed.forEach(function (s) {
      if (s.side !== 'sell' || warned[s.code] || !CODE_RE.test(s.code)) return;
      warned[s.code] = true;
      var hold = (holding(s.code) || {}).qty || 0;
      if (!hold) { h += '<div class="mk-warn mk-stopwarn">' + escapeHtml(s.name || s.code) + ' — 보유 수량이 없어 발동돼도 매도 주문이 나가지 않습니다</div>'; return; }
      var over = sellStopOver(s.code, 0);
      if (over) h += '<div class="mk-warn mk-stopwarn">' + escapeHtml(s.name || s.code) + ' — 감시 매도 합계 ' + fmtNum(over.need) + '주가 보유 ' + fmtNum(over.hold) + '주보다 많습니다</div>';
    });
    h += armed.length ? armed.map(stopRowHtml).join('') : '<div class="mk-empty-line">감시 중인 주문이 없습니다</div>';
    if (past.length) {
      h += '<details class="mk-past"' + (_stopsPastOpen ? ' open' : '') + ' ontoggle="Mock.pastToggle(this.open)">'
        + '<summary>지난 감시주문 <span>' + past.length + '건</span></summary>'
        + past.map(pastStopHtml).join('') + '</details>';
    }
    return h + '</section>';
  }

  function stopRowHtml(s) {
    var okId = UUID_RE.test(String(s.id || ''));
    return '<div class="mk-ord mk-stop">'
      + '<span class="mk-side sell">' + stopRole(s) + '</span>'
      + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(s.name || s.code) + (s.groupId ? ' <i class="mk-tag mk-tag-dim">묶음</i>' : '') + '</span>'
      +   '<span class="mk-pos-sub">' + escapeHtml(stopSentence(s)) + '</span></span>'
      + (okId ? '<button class="mini-btn danger mk-act" onclick="Mock.cancelStop(\'' + s.id + '\', this)">취소</button>' : '')
      + '</div>';
  }

  var STOP_STATUS = { triggered: ['발동', 'ok'], cancelled: ['취소', ''], expired: ['만료', ''], failed: ['실패', 'bad'] };

  function pastStopHtml(s) {
    var st = STOP_STATUS[s.status] || [String(s.status || ''), ''];
    var when = s.triggeredAt ? anyTime(s.triggeredAt) : '';
    return '<div class="mk-ord mk-stop past">'
      + '<span class="mk-st ' + st[1] + '">' + escapeHtml(st[0]) + '</span>'
      + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(s.name || s.code) + ' <span class="mk-dim">' + stopRole(s) + '</span></span>'
      +   '<span class="mk-pos-sub">' + escapeHtml(stopSentence(s)) + (when ? ' · ' + escapeHtml(when) : '') + '</span>'
      +   (s.reason ? '<span class="mk-pos-sub mk-reason">' + escapeHtml(s.reason) + '</span>' : '')
      +   (s.status === 'triggered' && s.orderId ? '<span class="mk-pos-sub">주문 접수됨 · 체결 내역에서 확인</span>' : '')
      + '</span></div>';
  }

  /** 서버 시각이 ms 숫자든 ISO 문자열이든 "09.22 10:42" 로 */
  function anyTime(v) {
    var ms = typeof v === 'number' ? v : (/^\d+$/.test(String(v)) ? Number(v) : Date.parse(v));
    return isNaN(ms) ? '' : kstHM(ms);
  }

  async function cancelStop(id, btn) {
    if (!UUID_RE.test(id)) return;
    if (btn) btn.disabled = true;
    try {
      await api('/stops/' + encodeURIComponent(id), 'DELETE');
      toast('감시주문을 취소했습니다', '');
    } catch (e) {
      alert(e.message);
      if (btn) btn.disabled = false;
    }
    loadStops(true);
  }

  /* ===== 권리 변동 (내 계좌, 최근 30일) ===== */
  function trimNum(x) { return String(Math.round(Number(x) * 10000) / 10000); }

  function corpHtml(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return '<div class="mk-card mk-ca"><div class="mk-ca-h">🔔 권리 변동</div>'
      + list.slice(0, 10).map(function (c) { return '<div class="mk-ca-line">' + corpLine(c) + '</div>'; }).join('')
      + '</div>';
  }

  function corpLine(c) {
    var nm = '<b>' + escapeHtml(c.name || c.code || '') + '</b> ';
    var r = Number(c.ratio) || 0;
    var qty = (c.qtyBefore != null && c.qtyAfter != null) ? ' · ' + fmtNum(c.qtyBefore) + '주 → ' + fmtNum(c.qtyAfter) + '주' : '';
    var cash = function (label) {
      var v = Math.round(Number(c.cashDelta) || 0);
      return v ? ' · ' + label + ' <span class="' + signClass(v) + '">' + (v > 0 ? '+' : '') + fmtNum(v) + '원</span>' : '';
    };
    var when = md(c.exDate) ? ' <span class="mk-dim">(' + md(c.exDate) + ')</span>' : '';
    switch (c.kind) {
      case 'split': return nm + '액면분할' + (r > 1 ? ' 1→' + trimNum(r) : '') + qty + cash('단주 현금') + when;
      case 'merge': return nm + '병합' + (r > 0 && r < 1 ? ' ' + Math.round(1 / r) + '→1' : '') + qty + cash('단주 현금') + when;
      case 'bonus': return nm + '무상증자' + (r > 1 ? ' (주당 ' + trimNum(r - 1) + '주)' : '') + qty + cash('단주 현금') + when;
      case 'rights': return nm + '유상증자 권리락' + (cash('현금 보전') || ' · 현금 보전') + when;
      case 'delist': return nm + '상장폐지 · 보유 0주 처리' + cash('정리 금액') + when;
      default: return nm + '권리 변동' + qty + cash('현금') + when;
    }
  }

  /* ===== 관리자: 권리 변동 확인 =====
   * 자동으로 판단한 건 워커가 바로 반영하고, 애매한 건(needs_review)만 여기서 고른다.
   */
  var _corp = null;
  var CA_KIND = { split: '액면분할', merge: '병합', bonus: '무상증자', rights: '유상증자', delist: '상장폐지' };
  var CA_STATUS = { applied: ['반영', 'on'], dismissed: ['무시', 'off'], needs_review: ['확인 필요', 'wait'] };

  function corpAdminHtml() {
    return '<details class="mk-admin mk-ca-admin" ontoggle="if(this.open) Mock.loadCorpAdmin()"><summary>🔔 권리 변동 <span class="mk-ca-badge" id="mkCaBadge"></span></summary>'
      + '<div id="mkCaAdmin"><div class="loading">불러오는 중...</div></div></details>';
  }

  async function loadCorpAdmin() {
    var box = document.getElementById('mkCaAdmin');
    if (!box) return;
    try {
      var r = await api('/admin/corp-actions');
      _corp = (r && Array.isArray(r.items)) ? r.items : [];
      renderCorpAdmin();
    } catch (e) {
      box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
    }
  }

  function caOkId(id) { return /^[0-9A-Za-z_-]{1,64}$/.test(String(id == null ? '' : id)); }

  function caInfo(x) {
    var parts = [];
    if (x.exDate) parts.push('기준일 ' + escapeHtml(fmtYmd(x.exDate)));
    if (x.ratio != null) parts.push('비율 ' + escapeHtml(trimNum(x.ratio)));
    if (x.prevClose && x.basePrice) {
      parts.push('전일 종가 ' + fmtNum(x.prevClose) + ' → 기준가 ' + fmtNum(x.basePrice) + '원 (' + trimNum(x.prevClose / x.basePrice) + '배)');
    }
    if (x.holders != null) parts.push('보유 ' + fmtNum(x.holders) + '명');
    if (x.source) parts.push(escapeHtml(x.source));
    return parts.join(' · ');
  }

  function renderCorpAdmin() {
    var box = document.getElementById('mkCaAdmin');
    if (!box) return;
    var items = _corp || [];
    var review = items.filter(function (x) { return x.status === 'needs_review'; });
    var done = items.filter(function (x) { return x.status !== 'needs_review'; }).slice(0, 20);
    var badge = document.getElementById('mkCaBadge');
    if (badge) badge.textContent = review.length ? '확인 필요 ' + review.length + '건' : '';
    box.innerHTML = '<div class="mk-seasons-head">확인 필요 <span>' + fmtNum(review.length) + '건</span></div>'
      + (review.length ? review.map(function (x) {
          var ok = caOkId(x.id), id = ok ? String(x.id) : '';
          return '<div class="mk-ca-item">'
            + '<div class="mk-season-top"><b>' + escapeHtml(x.name || x.code) + '</b><span class="mk-dim">' + escapeHtml(x.code) + '</span>'
            +   '<span class="mk-season-badge wait">' + escapeHtml(CA_KIND[x.kind] || '종류 미정') + '</span></div>'
            + '<div class="mk-season-sub">' + caInfo(x) + '</div>'
            + (x.note ? '<div class="mk-season-sub">' + escapeHtml(x.note) + '</div>' : '')
            + (ok ? '<div class="mk-ca-btns">'
                + '<button class="mini-btn mk-act" onclick="Mock.caApply(\'' + id + '\',\'split\', this)">분할·무상으로 반영</button>'
                + '<button class="mini-btn mk-act" onclick="Mock.caApply(\'' + id + '\',\'rights\', this)">현금 보전으로 반영</button>'
                + '<button class="mini-btn danger mk-act" onclick="Mock.caDismiss(\'' + id + '\', this)">무시</button>'
                + '</div>' : '')
            + '</div>';
        }).join('') : '<div class="mk-empty-line">확인할 항목이 없습니다</div>')
      + '<div class="mk-seasons-head mk-ca-hist">최근 처리 <span>' + fmtNum(done.length) + '건</span></div>'
      + (done.length ? done.map(function (x) {
          var st = CA_STATUS[x.status] || [String(x.status || ''), 'off'];
          return '<div class="mk-hol">'
            + '<span class="mk-season-badge ' + st[1] + '">' + escapeHtml(st[0]) + '</span>'
            + '<span class="mk-hol-d">' + escapeHtml(x.name || x.code) + '</span>'
            + '<span class="mk-hol-n">' + escapeHtml((CA_KIND[x.kind] || '') + ' · ' + fmtYmd(x.exDate)
                + (x.ratio != null ? ' · 비율 ' + trimNum(x.ratio) : '') + (x.holders != null ? ' · ' + fmtNum(x.holders) + '명' : '')) + '</span>'
            + '</div>';
        }).join('') : '<div class="mk-empty-line">처리 기록이 없습니다</div>')
      + '<p class="mk-note">반영하면 그 종목 보유자 전원에게 바로 적용되며 되돌릴 수 없습니다.</p>';
  }

  function caFind(id) { return (_corp || []).filter(function (x) { return String(x.id) === id; })[0]; }

  async function caApply(id, kind, btn) {
    if (!caOkId(id) || (kind !== 'split' && kind !== 'rights')) return;
    var x = caFind(id) || {};
    var what = kind === 'split' ? '분할 · 무상증자(보유 수량 조정)' : '유상증자 권리락(현금 보전)';
    if (!confirm((x.name || x.code || '') + ' — ' + what + '로 반영합니다.\n보유 ' + fmtNum(x.holders || 0) + '명에게 바로 적용되며 되돌릴 수 없습니다.')) return;
    if (btn) btn.disabled = true;
    try {
      await api('/admin/corp-actions/' + encodeURIComponent(id) + '/apply', 'POST', { kind: kind });
      toast('권리 변동을 반영했습니다', '');
    } catch (e) { alert(e && e.message ? e.message : '반영하지 못했습니다.'); }
    loadCorpAdmin();
  }

  async function caDismiss(id, btn) {
    if (!caOkId(id)) return;
    var x = caFind(id) || {};
    if (!confirm((x.name || x.code || '') + ' — 이 항목을 무시합니다. 보유 수량 · 현금은 바뀌지 않습니다.')) return;
    if (btn) btn.disabled = true;
    try { await api('/admin/corp-actions/' + encodeURIComponent(id) + '/dismiss', 'POST', {}); }
    catch (e) { alert(e && e.message ? e.message : '처리하지 못했습니다.'); }
    loadCorpAdmin();
  }

  /* ===== 관리자: 시즌 만들기·고치기 ===== */
  /** 관리 탭에 시즌·휴장일 패널을 그린다 (계좌 탭에 있던 것을 옮겼다) */
  function mountAdmin() {
    var mount = document.getElementById('mkAdminMount');
    if (!mount) return;
    if (!season || !season.isAdmin) { mount.innerHTML = ''; return; }
    // 이미 그려 뒀으면 다시 만들지 않는다 (펼친 상태와 입력 중인 값을 지키기 위해)
    if (mount.querySelector('.mk-admin')) return;
    mount.innerHTML = adminHtml() + corpAdminHtml();
    fillAdminForm();
    loadCorpAdmin();           // 접힌 채로도 "확인 필요 N건"을 제목에 띄운다
  }

  function adminHtml() {
    if (!season || !season.isAdmin) return '';
    return '<details class="mk-admin" ontoggle="if(this.open) Mock.loadSeasons()"><summary>⚙️ 시즌 · 휴장일 관리</summary>'
      + '<div class="form-grid">'
      + '<p class="mk-note" style="margin-top:0" id="mkSformNote"></p>'
      + '<input class="f-input" id="mkSid" placeholder="시즌 ID (예: 2026PRE, 2027Q1)" aria-label="시즌 ID"'
      +   ' oninput="Mock.onSeasonIdInput()">'
      + '<input class="f-input" id="mkSname" placeholder="이름 (예: 프리시즌, 2027년 1분기)" aria-label="시즌 이름">'
      + '<div class="form-row"><input type="date" class="f-input" id="mkSstart" aria-label="시작일">'
      + '<input type="date" class="f-input" id="mkSend" aria-label="종료일"></div>'
      + '<textarea class="f-textarea" id="mkSnotice" maxlength="1000" placeholder="전달사항 (선택) — 참가 안내 창에 표시됩니다" style="min-height:80px" aria-label="전달사항"></textarea>'
      + '<div class="form-row">'
      +   '<button class="btn-submit" onclick="Mock.saveSeason(this)">시즌 저장</button>'
      +   '<button class="btn-ghost" onclick="Mock.newSeasonForm()">새 시즌</button>'
      + '</div>'
      + '<div class="status-msg" id="mkSstatus"></div>'
      + '<div class="mk-seasons" id="mkSeasons"><div class="loading">시즌 목록 불러오는 중...</div></div>'
      + '<div class="mk-holidays" id="mkHolidays"></div>'
      + '<p class="mk-note">새 시즌은 시드 1억원 · 수수료 0.015% · 매도세 0.20% 로 만들어집니다. 시작일이 되면 자동으로 열리고, 종료일 장 마감 후 최종 순위가 확정됩니다. '
      + '같은 ID 로 저장하면 기존 시즌을 고칩니다 (시드·요율은 유지).</p>'
      + '</div></details>';
  }

  /* ===== 시즌 목록 =====
   * 워커에 GET /admin/seasons 가 있었는데 화면이 부르지 않아 목록을 볼 방법이 없었다.
   * 행을 누르면 폼에 채워져 그대로 고칠 수 있다.
   */
  var _seasons = null;

  async function loadSeasons() {
    var box = document.getElementById('mkSeasons');
    if (!box) return;
    try {
      var r = await api('/admin/seasons');
      _seasons = r.items || [];
      renderSeasons();
      loadHolidays();
      updateFormNote();
    } catch (e) {
      box.innerHTML = '<div class="empty">시즌 목록을 불러오지 못했습니다</div>';
    }
  }

  var SEASON_STATUS = {
    upcoming: { text: '시작 전', cls: 'up' },
    active:   { text: '진행 중', cls: 'on' },
    settling: { text: '정산 중', cls: 'wait' },
    closed:   { text: '종료',   cls: 'off' }
  };

  function renderSeasons() {
    var box = document.getElementById('mkSeasons');
    if (!box) return;
    if (!_seasons || !_seasons.length) { box.innerHTML = '<div class="empty">아직 만든 시즌이 없습니다</div>'; return; }
    var curId = season && season.season && season.season.id;
    box.innerHTML = '<div class="mk-seasons-head">시즌 목록 <span>' + fmtNum(_seasons.length) + '개</span></div>'
      + _seasons.map(function (x) {
          var st = SEASON_STATUS[x.status] || { text: x.status, cls: 'off' };
          return '<div class="mk-season' + (x.id === curId ? ' now' : '') + '">'
            + '<button class="mk-season-main" onclick="Mock.pickSeason(\'' + escapeJsArg(x.id) + '\')">'
            +   '<span class="mk-season-top">'
            +     '<b>' + escapeHtml(x.name) + '</b>'
            +     '<span class="mk-season-badge ' + st.cls + '">' + st.text + '</span>'
            +   '</span>'
            +   '<span class="mk-season-sub">' + escapeHtml(x.id) + ' · ' + escapeHtml(x.start_date) + ' ~ ' + escapeHtml(x.end_date)
            +     ' · 참가 ' + fmtNum(x.participants || 0) + '명'
            +     ' · 시드 ' + fmtCompact(x.seed) + '원'
            +     (x.finals ? ' · 최종순위 확정' : '') + '</span>'
            + '</button></div>';
        }).join('')
      + '<p class="mk-note">행을 누르면 위 폼에 값이 채워집니다. 시작·종료는 날짜에 맞춰 자동 처리됩니다.</p>';
  }

  /* 상태 변경 버튼은 두지 않는다 — 시작(시작일 도달)과 종료(종료일 장 마감)가 모두 자동이라
     관리자가 손댈 일이 없고, 잘못 누르면 최종 순위 확정을 건너뛴다. */

  /* ===== 휴장일 =====
   * 예전에는 코드 두 곳(engine.js · market.js)에 목록을 복붙해 두고 손으로 고쳤다.
   * 이제 D1 이 단일 출처고, 크론이 코스피 일봉으로 지난 휴장일을 자동으로 메운다.
   * 앞날의 휴장일(설·추석 등)만 여기서 미리 넣어 두면 된다.
   */
  var _holidays = null, _holToday = null;

  async function loadHolidays() {
    var box = document.getElementById('mkHolidays');
    if (!box) return;
    try {
      var r = await api('/admin/holidays');
      _holidays = r.items || []; _holToday = r.today;
      renderHolidays();
    } catch (e) {
      box.innerHTML = '<div class="empty">휴장일을 불러오지 못했습니다</div>';
    }
  }

  function renderHolidays() {
    var box = document.getElementById('mkHolidays');
    if (!box) return;
    var up = _holidays || [];
    box.innerHTML = '<div class="mk-seasons-head">휴장일 <span>앞으로 ' + fmtNum(up.length) + '일</span></div>'
      + '<div class="form-row mk-hol-add">'
      +   '<input type="date" class="f-input" id="mkHolDate" aria-label="휴장일 날짜">'
      +   '<input type="text" class="f-input" id="mkHolName" maxlength="40" placeholder="설명 (선택)" aria-label="휴장일 설명">'
      +   '<button class="mini-btn" onclick="Mock.addHoliday(this)">추가</button>'
      + '</div>'
      + (up.length
          ? up.map(function (x) {
              return '<div class="mk-hol">'
                + '<span class="mk-hol-d">' + fmtYmd(x.ymd) + '</span>'
                + '<span class="mk-hol-n">' + escapeHtml(x.name || '') + '</span>'
                + '<button class="mk-hol-x" onclick="Mock.removeHoliday(\'' + escapeJsArg(x.ymd) + '\')" aria-label="삭제">✕</button>'
                + '</div>';
            }).join('')
          : '<div class="empty">등록된 휴장일이 없습니다</div>');
  }

  function fmtYmd(y) {
    return String(y || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  }

  async function addHoliday(btn) {
    var d = document.getElementById('mkHolDate'), nm = document.getElementById('mkHolName');
    if (!d || !d.value) { alert('날짜를 골라 주세요.'); return; }
    btn.disabled = true;
    try {
      await api('/admin/holidays', 'POST', { ymd: d.value, name: nm ? nm.value.trim() : '' });
      d.value = ''; if (nm) nm.value = '';
      await loadHolidays();
    } catch (e) { alert(e && e.message ? e.message : '추가하지 못했습니다.'); }
    btn.disabled = false;
  }

  async function removeHoliday(ymd) {
    if (!confirm(fmtYmd(ymd) + ' 을 휴장일에서 빼시겠습니까?')) return;
    try {
      await api('/admin/holidays?ymd=' + encodeURIComponent(ymd), 'DELETE');
      await loadHolidays();
    } catch (e) { alert(e && e.message ? e.message : '삭제하지 못했습니다.'); }
  }

  /** 폼에 어떤 시즌이 들어 있는지에 맞춰 안내를 고친다 — 고정 문구면 다른 시즌을 채웠을 때 어긋난다 */
  function updateFormNote() {
    var el = document.getElementById('mkSformNote');
    if (!el) return;
    var idEl = document.getElementById('mkSid');
    var id = idEl ? idEl.value.trim() : '';
    if (!id) {
      el.innerHTML = '새 시즌을 만들려면 쓰지 않은 ID 를 넣으세요. 아래 목록에서 행을 누르면 그 시즌을 고칠 수 있습니다.';
      return;
    }
    var x = (_seasons || []).filter(function (s) { return s.id === id; })[0];
    if (!x) {
      el.innerHTML = '<b>' + escapeHtml(id) + '</b> — 새 시즌으로 만들어집니다.';
      return;
    }
    var st = (SEASON_STATUS[x.status] || {}).text || x.status;
    var rule = x.status === 'closed' ? '종료된 시즌은 수정할 수 없습니다.'
      : x.status === 'upcoming' ? '시작 전이라 모든 값을 바꿀 수 있습니다.'
      : '진행 중인 시즌은 이름 · 종료일 · 전달사항만 바꿀 수 있습니다.';
    el.innerHTML = '<b>' + escapeHtml(x.name) + '</b> (' + escapeHtml(x.id) + ' · ' + escapeHtml(st) + ') 값이 채워져 있습니다. ' + rule;
  }

  function onSeasonIdInput() { updateFormNote(); }

  /** 목록에서 고른 시즌을 폼에 채운다 (입력 중이던 값은 덮어쓴다 — 고르는 행동 자체가 의도다) */
  function pickSeason(id) {
    var x = (_seasons || []).filter(function (s) { return s.id === id; })[0];
    if (!x) return;
    var set = function (elId, v) {
      var el = document.getElementById(elId);
      if (el) { el.value = v || ''; el.dataset.touched = '1'; }
    };
    set('mkSid', x.id); set('mkSname', x.name);
    set('mkSstart', x.start_date); set('mkSend', x.end_date); set('mkSnotice', x.notice || '');
    var st = document.getElementById('mkSstatus');
    if (st) {
      st.innerHTML = x.status === 'closed'
        ? '<span class="err">종료된 시즌은 수정할 수 없습니다. 값만 참고용으로 채웠습니다.</span>'
        : '<span class="ok">' + escapeHtml(x.name) + ' 값을 채웠습니다.'
          + (x.status !== 'upcoming' ? ' 진행 중이라 이름 · 종료일 · 전달사항만 바뀝니다.' : '') + '</span>';
    }
    updateFormNote();
    var f = document.getElementById('mkSid');
    if (f) f.scrollIntoView({ block: 'nearest' });
  }

  /** 새 시즌을 만들려고 폼을 비운다 */
  function newSeasonForm() {
    ['mkSid', 'mkSname', 'mkSstart', 'mkSend', 'mkSnotice'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.value = ''; el.dataset.touched = '1'; }
    });
    var st = document.getElementById('mkSstatus');
    if (st) st.innerHTML = '<span class="ok">새 시즌 정보를 입력하세요. 새 ID 로 저장하면 만들어집니다.</span>';
    updateFormNote();
    var f = document.getElementById('mkSid');
    if (f) f.focus();
  }

  /** 시즌 관리 폼에 현재(또는 다음) 시즌 값을 채운다 — 비어 있을 때만 (입력 중인 글자를 덮지 않는다) */
  function fillAdminForm() {
    var cur = season && (season.season || season.next);
    if (!cur) return;
    var set = function (id, v) { var el = document.getElementById(id); if (el && !el.value && !el.dataset.touched) { el.value = v || ''; el.oninput = function () { el.dataset.touched = '1'; }; } };
    set('mkSid', cur.id); set('mkSname', cur.name);
    set('mkSstart', cur.startDate || cur.start_date); set('mkSend', cur.endDate || cur.end_date);
    set('mkSnotice', cur.notice || '');
    updateFormNote();
  }

  async function saveSeason(btn) {
    var st = document.getElementById('mkSstatus');
    var v = function (id) { return document.getElementById(id).value.trim(); };
    btn.disabled = true;
    try {
      var r = await api('/admin/seasons', 'POST', { id: v('mkSid'), name: v('mkSname'), startDate: v('mkSstart'), endDate: v('mkSend'), notice: v('mkSnotice') });
      st.innerHTML = '<span class="ok">✅ ' + (r.updated ? '기존 시즌을 고쳤습니다.' : '새 시즌을 만들었습니다.') + '</span>';
      await loadSeasons();
      await refreshSeason();
      renderAccount();
    } catch (e) { st.innerHTML = '<span class="err">❌ ' + escapeHtml(e.message) + '</span>'; }
    btn.disabled = false;
  }

  return {
    isOn: function () { return on; },
    setMode: setMode, onTab: onTab, renderTradeBar: renderTradeBar, onEscape: onEscape,
    join: join, openJoinFlow: openJoinFlow, joinStep2: joinStep2, closeJoin: closeJoin, cancel: cancel, loadHistory: loadHistory,
    openSheet: openSheet, closeSheet: closeSheet, setSheet: setSheet, input: input, step: step, pct: pct, submit: submit,
    askReview: askReview,
    openAmend: openAmend, openStops: openStops, closeAux: closeAux,
    auxInput: auxInput, auxStep: auxStep, auxSet: auxSet, auxSel: auxSel, auxSubmit: auxSubmit,
    cancelStop: cancelStop, pastToggle: function (o) { _stopsPastOpen = !!o; },
    loadCorpAdmin: loadCorpAdmin, caApply: caApply, caDismiss: caDismiss,
    mountAdmin: mountAdmin,
    saveSeason: saveSeason, loadSeasons: loadSeasons, pickSeason: pickSeason,
    newSeasonForm: newSeasonForm, onSeasonIdInput: onSeasonIdInput,
    addHoliday: addHoliday, removeHoliday: removeHoliday,
    // 커뮤니티 자랑하기 — 숫자는 워커가 장부에서 직접 만든다 (community.js 가 쓴다)
    brag: function (code) { return api('/brag', 'POST', { code: code }); },
    brags: function (ids) { return api('/brag?ids=' + encodeURIComponent(ids.join(','))); }
  };
})();
