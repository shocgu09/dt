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
  var watching = {};        // 주문 id → 체결을 기다리는 폴링 타이머 (주문창 주문·정정으로 생긴 새 주문)
  var histNext = null;

  /* ===== 워커 호출 ===== */
  /**
   * 워커가 붙들면 주문창이 "접수 중"에 갇힌다 — 시간을 정해 끊는다.
   * 주문·정정은 워커가 시세(8초)·종목 종류(8초, 실패 시 종목 마스터 8초)를 차례로 받아 최악 24초쯤 걸린다 — 15초로 자르면
   * 접수됐는데 화면은 실패로 알았다. AI 평가는 워커가 60초까지 기다린다.
   * (주문은 clientOrderId 로 중복 접수가 막혀 있어 같은 내용으로 다시 보내도 안전하다)
   */
  function timeoutFor(path, method) {
    if (method === 'POST' && path === '/review') return 75000;
    if (method === 'POST' && path === '/shares') return 60000;      // 사진을 올릴 때 (4장 × 수백 KB)
    if (method === 'POST' && /^\/orders/.test(path)) return 30000;
    return 15000;
  }

  async function api(path, method, body, _retried) {
    if (!currentUser) throw new Error('로그인이 필요합니다');
    var token = await currentUser.getIdToken(!!_retried);     // 재시도 때는 토큰을 강제로 새로 받는다
    var init = {
      method: method || 'GET',
      headers: body ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { Authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined
    };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(timeoutFor(path, init.method));
    var res;
    try { res = await fetch(MARKET_API + '/api/mock' + path, init); }
    catch (e) {
      var ne = new Error(e && e.name === 'TimeoutError' ? '서버 응답이 늦습니다. 잠시 후 다시 시도하세요' : '네트워크 오류로 요청하지 못했습니다');
      ne.code = e && e.name === 'TimeoutError' ? 'timeout' : 'network';
      throw ne;
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    // 시계 오차·서명키 교체 직후에는 토큰이 거부될 수 있다 — 한 번은 새 토큰으로 다시 보낸다
    if (res.status === 401 && !_retried) return api(path, method, body, true);
    if (!res.ok) {
      // 새 토큰으로도 401 이면 로그인이 풀린 것이다 — 워커 게이트 문구('회원 전용입니다')보다 할 일을 알려 준다
      var err = new Error(res.status === 401 ? '로그인이 만료되었습니다. 새로고침해 주세요'
        : ((data && data.error) || '요청을 처리하지 못했습니다 (' + res.status + ')'));
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
  /** 위 형식에서 시각만 ("10:42") */
  function hmOf(ms) { return kstHM(ms).split(' ').slice(-1)[0]; }

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

  // onclick 속성에 넣는 값은 모양부터 확인한다 (주문 id 는 UUID, 종목코드는 6자리)
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
    try { season = await api('/season'); season._recvAt = Date.now(); }
    catch (e) { season = { error: e.message }; }
    if (season && season.joined) await refreshAccount();
    else renderBar();
    syncAdminMount();          // 관리 탭이 열려 있으면 시즌 패널도 맞춘다
    return season;
  }

  var _accSeq = 0, _reseason = false;
  async function refreshAccount() {
    var seq = ++_accSeq;
    try {
      var d = await api('/account');
      if (seq !== _accSeq) return;            // 뒤에 보낸 요청이 먼저 왔다 — 옛 응답으로 덮지 않는다
      var prevFills = account ? account.fills : null;
      account = d;
      account._recvAt = _accAt = Date.now();
      renderBar();
      if (currentTab === 'account') renderAccount();
      renderTradeBar();
      // 체결이 늘었으면 열어 둔 체결 내역도 다시 받는다 — 위 보유 종목은 바뀌었는데 아래 내역에는 새 체결이 없었다
      if (prevFills != null && d.fills !== prevFills) {
        var hist = document.getElementById('mkHistory');
        if (hist && hist.innerHTML) loadHistory(true);
      }
    } catch (e) {
      if (seq !== _accSeq) return;
      if (e.code === 'not_joined' || e.code === 'no_season') {
        // 시즌이 끝났거나 새 시즌이 열렸다 — 계좌만 비우면 헤더에 옛 자산이 남고, 새 시즌에는 참가 버튼 대신
        // 매수 버튼이 떠서 누르면 '시즌 참가 후 이용할 수 있습니다'로 막혔다. 시즌 정보부터 다시 받는다
        account = null;
        if (!_reseason) {             // /season 과 /account 가 잠깐 엇갈려도 서로 부르며 돌지 않게 한 번만
          _reseason = true;
          try { await refreshSeason(); } finally { _reseason = false; }
        }
        renderBar();
        renderTradeBar();
        if (currentTab === 'account') renderAccount();
        return;
      }
      // 시세를 못 받았다 — 옛 값을 실시간처럼 두지 않고 받은 시각을 밝힌다 (다음 갱신이 성공하면 새 응답으로 사라진다)
      if (account) { account._stale = true; renderBar(); }
      if (currentTab === 'account') renderAccount(e.message);
    }
  }

  /* ===== 헤더 아래 한 줄 요약 ===== */
  /* 랭킹 탭이 받은 내 줄 { seasonId, equity, returnRate, rank, participants }.
   * 이 줄(/account, 30초)과 순위표(/leaderboard, 10초)는 다른 순간의 시세로 계산돼, 랭킹을 보는 동안
   * 같은 화면에 내 자산이 두 값으로 보였다(99,033,113 vs 99,083,113). 랭킹 탭에서는 순위표의 내 줄로 그린다. */
  var _boardMe = null;
  function renderBar() {
    var el = document.getElementById('mockBar');
    if (!el) return;
    if (!on || !account) { el.style.display = 'none'; return; }
    var src = (typeof currentTab !== 'undefined' && currentTab === 'ranking' && _boardMe
      && account.season && _boardMe.seasonId === account.season.id) ? _boardMe : account;
    el.style.display = '';
    el.innerHTML = '<span class="mk-bar-label">💼 내 자산</span>'
      + '<b class="mk-bar-eq">' + won(src.equity) + '</b>'
      + rateHtml(src.returnRate)
      + (src.rank ? '<span class="mk-bar-rank">' + src.rank + '위<i>/' + fmtNum(src.participants) + '</i></span>' : '')
      + '<span class="mk-bar-go">' + (src._stale ? escapeHtml(hmOf(src._recvAt)) + ' 기준' : '계좌 →') + '</span>';
  }

  /* ===== 탭 전환 훅 (app.js switchTab 에서 호출) ===== */
  function onTab(tab) {
    Poller.remove('mock-acc');
    Poller.remove('mock-rank');
    if (!on) return;
    if (tab !== 'ranking' && _boardMe) {
      // 랭킹에서 나오면 계좌 응답으로 돌아간다 — 그게 순위표보다 오래됐으면 지금 새로 받는다
      if (_boardMe.at > _accAt) refreshAccount();
      _boardMe = null;
      renderBar();
    }
    if (tab === 'admin') { mountAdmin(); return; }
    if (tab === 'account') {
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

  /* 헤더 아래 '내 자산' 줄과 종목 상세의 보유 줄은 계좌 응답으로 그린다. 계좌 탭 밖에서는 계좌를 다시 받지 않아
   * 시세가 움직여도 자산·순위가 몇십 분씩 멈춰 있었다 — 장중 30초 · 장외 5분마다 조용히 다시 받는다.
   * (계좌 탭은 자기 폴러가 10초마다 받는다. Poller 는 화면 전환 때 stopAll 로 지워지므로 따로 둔다) */
  var _accAt = 0;
  setInterval(function () {
    if (!on || !season || !season.joined || !account || document.hidden) return;
    if (typeof currentTab !== 'undefined' && currentTab === 'account') return;
    var gap = (typeof isMarketOpen === 'function' && isMarketOpen()) ? 30000 : 300000;
    if (Date.now() - _accAt >= gap) { _accAt = Date.now(); refreshAccount(); }
  }, 10000);

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
      + '<div class="mk-sum-head"><span>' + escapeHtml(s.name) + '</span><span class="mk-sum-end">' + escapeHtml(s.endDate) + ' 종료' + InfoTip.btn('계좌 보는 법', [
          '· 총자산 = 현금 + 보유 주식 (현재가로 평가)',
          '· 주문 가능: 현금에서 미체결 매수 주문이 묶어 둔 돈(주문 대기)을 뺀 금액',
          '· 평가손익: 보유 주식의 지금 가치 − 산 금액',
          '· 실현손익: 판 금액에서 수수료·세금과 산 금액(평균 단가)을 뺀 손익',
          '· 매수 수수료는 산 금액에 넣지 않습니다. 평가손익 + 실현손익 − 매수 수수료 = 총손익입니다.'
        ].join('\n'), 'sm') + '</span></div>'
      + '<div class="mk-eq">' + won(a.equity) + '</div>'
      + '<div class="mk-eq-sub">' + rateHtml(a.returnRate) + ' <span class="' + signClass(a.equity - s.seed) + '">'
      +   (a.equity - s.seed > 0 ? '+' : '') + fmtNum(a.equity - s.seed) + '원</span>'
      +   '<span class="mk-dim"> · 시작 ' + fmtCompact(s.seed) + '원</span></div>'
      + '<div class="mk-grid">'
      // 총자산 = 현금 + 보유 주식. 미체결 매수가 묶어 둔 돈은 '주문 가능'에서 빠지므로 따로 밝혀 합이 맞게 한다
      +   cell('주문 가능', won(a.available) + (a.cash > a.available ? '<small class="mk-cell-sub">주문 대기 ' + won(a.cash - a.available) + '</small>' : ''))
      +   cell('보유 주식', won(a.stock))
      +   cell('평가손익', '<span class="' + signClass(evalPnl) + '">' + (evalPnl > 0 ? '+' : '') + fmtNum(evalPnl) + '원</span>')
      // 매수 수수료는 매입금액에 넣지 않는다 — 평가손익 + 실현손익 − 매수 수수료 = 위 총손익이 되도록 함께 적는다
      +   cell('실현손익', '<span class="' + signClass(a.realizedPnl) + '">' + (a.realizedPnl > 0 ? '+' : '') + fmtNum(a.realizedPnl) + '원</span>'
            + (a.buyFees ? '<small class="mk-cell-sub">매수 수수료 −' + fmtNum(a.buyFees) + '원</small>' : ''))
      + '</div>'
      + '<div class="mk-note">' + (a._stale ? '<b>' + escapeHtml(hmOf(a._recvAt)) + ' 기준 평가</b> · 최신 시세를 받지 못했습니다'
          : a.closing ? '시즌 마지막 날 · 15:30 종가 기준 평가 · 최종 순위 집계 중'
          : (a.live ? '실시간 평가 (08:00~20:00, 시간외 포함)' : '장 마감 · 최종 체결가 기준 평가') + ' · 순위 확정은 15:30 종가 기준')
      + '</div>'
      + '</div>';

    h += corpHtml(a.corpActions);

    h += '<section class="m-section"><div class="m-head"><h3>📦 보유 종목</h3><span class="m-hint">' + a.positions.length + '종목</span></div>';
    h += a.positions.length ? a.positions.filter(function (p) { return CODE_RE.test(p.code); }).map(function (p) {
      return '<button class="mk-pos" onclick="openStock(\'' + p.code + '\',\'' + escapeJsArg(p.name) + '\')">'
        + stockLogoHtml(p.code, p.name, null, 'sm')
        + '<span class="mk-pos-main"><span class="mk-pos-name">' + escapeHtml(p.name) + (p.halted ? ' <i class="mk-tag">정지</i>' : '')
        +   (p.price == null ? ' <i class="mk-tag">시세 없음</i>' : '') + '</span>'
        +   '<span class="mk-pos-sub">' + fmtNum(p.qty) + '주 · 평단 ' + fmtNum(p.avgPrice) + '원</span></span>'
        + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(p.value) + '원</span>'
        +   '<span class="mk-pos-pnl ' + signClass(p.pnl) + '">' + (p.pnl > 0 ? '+' : '') + fmtNum(p.pnl) + '원 (' + fmtRate(p.pnlRate) + ')</span></span>'
        + '</button>';
    }).join('') : '<div class="empty">보유 종목이 없습니다.<br>시세 탭에서 종목을 선택해 매수할 수 있습니다.</div>';
    h += '</section>';

    if (a.openOrders.length) {
      h += '<section class="m-section"><div class="m-head"><h3>⏳ 미체결 주문</h3><span class="m-hint">' + a.openOrders.length + '건</span></div>'
        + a.openOrders.map(orderRowHtml).join('') + '</section>';
    }

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
    if (left) left.textContent = _reviewLeft == null ? '' : '오늘 ' + _reviewLeft + '회 남음';

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
      +   '<li>국내 상장 주식 · ETF(레버리지 · 인버스 포함) · ETN 모두 거래할 수 있습니다 (거래정지 종목 제외)</li>'
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
    var any = document.getElementById('mkSheet') || document.getElementById('mkJoin') || document.getElementById('mkAux')
      || document.getElementById('mkShare') || document.getElementById('mkPhoto');
    document.body.classList.toggle('mk-noscroll', !!any);
  }

  /** Esc — 열려 있는 창을 하나 닫는다. 닫은 게 있으면 true (app.js 의 keydown 에서 부른다) */
  function onEscape() {
    if (document.getElementById('mkAux')) { if (!aux || !aux.busy) closeAux(); return true; }
    if (document.getElementById('mkSheet')) { tryCloseSheet(); return true; }
    if (document.getElementById('mkJoin')) { closeJoin(); return true; }
    if (document.getElementById('mkPhoto')) { closePhoto(); return true; }
    if (document.getElementById('mkShare')) { if (!_shSheet || !_shSheet.busy) closeShare(); return true; }
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
          '순위표에 <b>닉네임 · 총자산 · 수익률 · 체결 건수</b>가 회원들에게 공개됩니다. 실명과 보유 종목은 공개되지 않습니다. 종목별 보유 인원 · 평균 수익률은 3명 이상일 때 이름 없이 합계로만 보입니다.',
          '1인 1계정입니다. 부정한 방법이 확인되면 순위에서 제외됩니다.'
        ])
      + '<div class="mk-jf-h">📌 매매 규칙</div>'
      + li([
          '시드머니 <b>' + fmtCompact(s.seed) + '원</b> · 시즌마다 초기화 · 순위는 <b>실시간</b>(시간외 가격 포함), 일일 기록과 최종 순위는 ' + escapeHtml(s.endDate) + ' 15:30 <b>KRX 종가</b> 기준',
          '국내 상장 주식 · ETF(레버리지 · 인버스 포함) · ETN 을 <b>모두 거래할 수 있습니다</b>. 거래정지 종목과 주문이 제한된 종목만 예외입니다.',
          '정규장 08:30~15:30 지정가 · 시장가. 09:00 전 접수분은 <b>시가</b>, 15:20~15:30 접수분은 <b>종가</b>로 체결되고, 미체결은 장 마감 시 만료됩니다.',
          '시간외 08:00~08:30 프리마켓(NXT · 08:50 까지 체결) / 15:40~20:00 애프터마켓(NXT · KRX) — <b>지정가만</b>, ETF · ETN 은 시간외 불가, 미체결은 08:50 · 20:00 에 만료됩니다. 시즌 마지막 날은 15:30 정규장으로 매매가 끝납니다.',
          '지정가는 전일 종가 ±30% 안에서 호가단위에 맞게 입력합니다. 미체결 주문은 <b>정정 · 취소</b>할 수 있고, 가격을 바꾸면 대기 순서가 뒤로 갑니다.',
          '수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2) + '% (ETF · ETN 면제) — 실전과 같은 수준',
          '거래가 적은 종목은 여러 번에 나눠 체결되거나 체결되지 않을 수 있습니다.',
          '시장가 매수는 현재가 기준으로 주문 가능 금액을 잡습니다. 체결가가 올라 금액이 모자라면 살 수 있는 수량까지만 체결되고 나머지는 취소됩니다.',
          '신용 · 미수 · 공매도는 없습니다.'
        ])
      + '<div class="mk-jf-h">🏷️ 닉네임</div>'
      + '<p class="mk-jf-lead">순위표와 커뮤니티에는 실명 대신 닉네임이 보입니다. <span id="mkJoinAuto"></span></p>'
      + '<input id="mkJoinNick" class="f-input" maxlength="10" autocomplete="off" aria-label="닉네임" placeholder="원하는 닉네임 (띄어쓰기 없이 2~10자)">'
      + '<div class="mk-nick-err" id="mkJoinNickErr" role="alert"></div>'
      + '<label class="mk-jf-check"><input type="checkbox" id="mkAgree" onchange="document.getElementById(\'mkJoinGo\').disabled = !this.checked"> 위 내용을 확인했습니다</label>'
      + '<div class="mk-jf-btns"><button class="btn-ghost" onclick="Mock.closeJoin()">취소</button>'
      + '<button class="btn-submit" id="mkJoinGo" disabled onclick="Mock.join(this)">' + fmtCompact(s.seed) + '원 받고 시작하기</button></div>');
    fillJoinAuto();
  }

  // 참가 창 2단계가 열리면 자동 닉네임을 받아 안내에 채운다
  function fillJoinAuto() {
    loadNick().then(function (n) {
      var b = document.getElementById('mkJoinAuto');
      if (!b) return;
      // 이미 직접 정한 닉네임이 있으면(커뮤니티에서 먼저 정했다) 그걸 그대로 쓴다고 알린다
      b.textContent = !n ? '비워 두면 자동 닉네임으로 시작하고, 나중에 랭킹 탭에서 바꿀 수 있습니다.'
        : n.auto ? '비워 두면 자동 닉네임 \'' + n.nick + '\'(으)로 시작하고, 나중에 랭킹 탭에서 바꿀 수 있습니다.'
        : '비워 두면 지금 닉네임 \'' + n.nick + '\'을(를) 그대로 씁니다.';
    });
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
    // 닉네임을 적었으면 먼저 정한다 — 안 되는 이름이면 참가하기 전에 멈춰서 고치게 한다
    var nIn = document.getElementById('mkJoinNick'), nErr = document.getElementById('mkJoinNickErr');
    var want = nIn ? nIn.value.trim() : '';
    if (want && !/^[가-힣A-Za-z0-9]{2,10}$/.test(want)) { nErr.textContent = '닉네임은 띄어쓰기 없이 한글·영문·숫자 2~10자로 정해 주세요'; nIn.focus(); return; }
    btn.disabled = true; btn.textContent = '처리 중';
    if (want && !(_nick && _nick.nick === want)) {
      try { _nick = await api('/nickname', 'POST', { nick: want }); if (nErr) nErr.textContent = ''; }
      catch (e) { nErr.textContent = e.message; nIn.focus(); btn.disabled = false; btn.textContent = '다시 시도'; return; }
    }
    try {
      var r = await api('/join', 'POST');
      await refreshSeason();
      renderAccount();
      joinDone(r.cash);
    } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = '다시 시도'; }
  }

  async function cancel(id, btn) {
    // 정정 버튼 바로 옆이라 잘못 누르기 쉽다 — 한 번 묻는다
    var o = account && account.openOrders.filter(function (x) { return x.id === id; })[0];
    if (!confirm((o ? o.name + ' ' + (o.side === 'buy' ? '매수' : '매도') + ' 미체결 ' + fmtNum(o.qty - o.filledQty) + '주' : '이 주문') + '을(를) 취소할까요?')) return;
    if (btn) btn.disabled = true;
    try { await api('/orders/' + encodeURIComponent(id), 'DELETE'); }
    catch (e) { alert(e.message); }
    await refreshAccount();
  }

  var _histBusy = false;
  async function loadHistory(reset) {
    var el = document.getElementById('mkHistory');
    if (!el || _histBusy) return;             // '더 보기'를 두 번 누르면 같은 페이지가 두 번 붙었다
    _histBusy = true;
    var moreBtn = el.querySelector('.mk-more');
    if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = '불러오는 중'; }
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
      else if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = '더 보기'; }
    } finally {
      _histBusy = false;
    }
  }

  /** 체결 한 건의 비용 — 매수는 수수료만, 매도는 수수료와 거래세가 따로 붙는다 */
  function costText(f) {
    if (f.side === 'buy') return '수수료 ' + fmtNum(f.fee) + '원';
    // 면제는 ETF·ETN 일 때만 — 소액 매도는 세금이 원 미만이라 0원이 될 뿐 면제가 아니다 (옛 워커는 taxFree 를 안 준다)
    if (!f.tax && f.taxFree) return '수수료 ' + fmtNum(f.fee) + '원 · 세금 면제';
    return '수수료 ' + fmtNum(f.fee) + '원 · 세금 ' + fmtNum(f.tax) + '원';
  }

  /* ===== 랭킹 ===== */
  var _rankBuilt = false, _hallHtml = null, _prevRank = {}, _prevSeasonId = null, _rankSeq = 0;

  async function loadRanking() {
    var el = document.getElementById('tab-ranking');
    if (!el) return;
    // 갱신할 때마다 "불러오는 중"으로 깜빡이지 않게 첫 번만 표시한다
    if (!_rankBuilt) el.innerHTML = '<div class="loading">순위를 불러오는 중</div>';
    var h = '';
    var seq = ++_rankSeq;
    try {
      var d = await api('/leaderboard');
      if (seq !== _rankSeq) return;           // 탭을 오가며 겹친 요청 — 늦게 온 옛 응답으로 덮지 않는다
      if (currentTab === 'ranking') {
        _boardMe = d.me ? {
          seasonId: d.season.id, equity: d.me.equity, returnRate: (d.me.equity - d.season.seed) / d.season.seed * 100,
          rank: d.me.rank, participants: d.rows.length, at: Date.now()
        } : null;
        renderBar();
      }
      // 시즌이 바뀌었을 때만 이전 평가를 버린다 (10초마다 버리면 계좌 탭이 매번 다시 받았다)
      if (_reviewFor && _reviewFor !== d.season.id) { _review = null; _reviewLeft = null; _reviewFor = null; }
      // 시즌이 바뀌면 이전 시즌의 순위 기억을 버린다
      if (_prevSeasonId !== d.season.id) { _prevRank = {}; _hallHtml = null; _prevSeasonId = d.season.id; }
      h += '<section class="m-section"><div class="m-head"><h3>🏆 ' + escapeHtml(d.season.name) + '</h3>'
        + '<span class="m-hint">' + (d.closing ? '15:30 종가 기준 · 최종 순위 집계 중'
          : escapeHtml(hmOf(d.asOf)) + ' 기준 · ' + (d.live ? '장중' : '장 마감')) + '</span></div>';
      h += d.rows.length ? d.rows.map(function (r) {
        var rr = (r.equity - d.season.seed) / d.season.seed * 100;
        var medal = r.rank === 1 ? '🥇' : (r.rank === 2 ? '🥈' : (r.rank === 3 ? '🥉' : r.rank));
        // 직전 갱신보다 순위가 오르내렸으면 잠깐 표시한다 (서버가 준 안정 키로 같은 회원을 잇는다)
        var k = r.key || r.nickname;
        var was = _prevRank[k], move = (was && was !== r.rank) ? (was > r.rank ? ' moved-up' : ' moved-down') : '';
        _prevRank[k] = r.rank;
        return '<div class="mk-rank' + (r.me ? ' me' : '') + move + '">'
          + '<span class="mk-rank-no">' + medal + '</span>'
          + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(r.nickname) + (r.realName ? ' <small class="mk-real" title="실명 (관리자에게만 보임)">' + escapeHtml(r.realName) + '</small>' : '') + (r.me ? ' <i class="mk-tag">나</i>' : '') + '</span>'
          +   '<span class="mk-pos-sub">체결 ' + fmtNum(r.fills) + '건</span></span>'
          + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(r.equity) + '</span>'
          +   '<span class="mk-pos-pnl ' + signClass(rr) + '">' + fmtRate(rr) + '</span></span>'
          + '</div>';
      }).join('') : '<div class="empty">참가자가 없습니다.</div>';
      h += '<div class="mk-note">' + (d.closing
          ? '시즌 마지막 날 · ' + escapeHtml(d.season.endDate) + ' KRX 정규장 종가(15:30) 기준 총자산으로 매긴 순위입니다.'
          : '실시간 순위 · 장중에는 10초마다 다시 매깁니다 (시간외 가격 포함) · 최종 순위는 ' + escapeHtml(d.season.endDate) + ' KRX 정규장 종가 기준 총자산으로 확정됩니다.')
        + '</div></section>';
    } catch (e) {
      if (seq !== _rankSeq) return;
      // 시즌이 막 끝났다 — 한 번 받아 둔 명예의 전당에 방금 끝난 시즌이 빠져 있으니 다시 받는다
      if (e.code === 'no_season' && _prevSeasonId) { _hallHtml = null; _prevSeasonId = null; }
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
                    return '<div class="mk-hall-row"><span>' + (['🥇', '🥈', '🥉'][r.rank - 1] || r.rank) + ' ' + escapeHtml(r.nickname) + (r.realName ? ' <small class="mk-real" title="실명 (관리자에게만 보임)">' + escapeHtml(r.realName) + '</small>' : '') + '</span>'
                      + '<span>' + fmtNum(r.equity) + '원 (' + fmtRate((r.equity - r.seed) / r.seed * 100) + ')</span></div>';
                  }).join('') + '</div>';
            }).join('') + '</section>';
      }
    } catch (e) { /* 명예의 전당은 없어도 된다 */ }
    if (currentTab !== 'ranking') return;
    // 순위표는 10초마다 다시 그린다 — 계좌 공유(#rkShare)는 따로 두어 펼친 댓글·입력 중인 글이 날아가지 않게 한다
    var fresh = !document.getElementById('rkBoard');
    if (fresh) {
      el.innerHTML = '<div class="seg-row mk-rk-seg" role="tablist" aria-label="랭킹 보기">'
        +   '<button type="button" class="seg" role="tab" data-rk="board" onclick="Mock.rankView(\'board\')">🏆 순위</button>'
        +   '<button type="button" class="seg" role="tab" data-rk="share" onclick="Mock.rankView(\'share\')">💬 커뮤니티<i class="mk-rk-dot" hidden></i></button>'
        + '</div>'
        + '<div id="rkNick"></div>'
        + '<div id="rkBoard" role="tabpanel"></div><div id="rkHall"></div><div id="rkShare" role="tabpanel"></div>';
      applyRankView();
      loadNick();
    }
    document.getElementById('rkBoard').innerHTML = h;
    document.getElementById('rkHall').innerHTML = _hallHtml || '';
    if (fresh) loadShares(true);     // 커뮤니티를 열지 않아도 새 글 표시(점)를 위해 받아 둔다
    _rankBuilt = true;
  }

  /* ===== 닉네임 — 순위표·명예의 전당·커뮤니티에는 실명 대신 이 이름이 보인다 =====
   * 서버가 처음 부를 때 자동 닉네임('용감한 황소 27')을 만들어 둔다. 직접 바꾸면 30일 동안 다시 못 바꾼다.
   * 자동 닉네임인 회원에게는 랭킹 탭에서 한 번 바꿔 보라고 권한다 ('이대로 쓰기'를 누르면 이 기기에서 다시 묻지 않는다). */
  var _nick = null, _nickEdit = false;
  function nickAskKey() { return 'dt-invest-nick-asked:' + (currentUser ? currentUser.uid : ''); }
  function nickAsked() { try { return !!localStorage.getItem(nickAskKey()); } catch (e) { return true; } }
  async function loadNick() {
    try { _nick = await api('/nickname'); } catch (e) { _nick = null; }
    renderNick();
    return _nick;
  }
  function renderNick() {
    var el = document.getElementById('rkNick');
    if (!el) return;
    if (!_nick) { el.innerHTML = ''; return; }
    if (_nickEdit) {
      el.innerHTML = '<div class="mk-nick edit">'
        + '<div class="mk-nick-row"><input id="mkNickIn" class="f-input" maxlength="10" autocomplete="off" aria-label="새 닉네임"'
        +   ' placeholder="새 닉네임" value="' + (_nick.auto ? '' : escapeHtml(_nick.nick)) + '"'
        +   ' onkeydown="if(event.key===\'Enter\')Mock.saveNick()">'
        +   '<button class="btn-submit" id="mkNickSave" onclick="Mock.saveNick()">저장</button>'
        +   '<button class="btn-ghost" onclick="Mock.editNick(false)">취소</button></div>'
        + '<div class="mk-nick-hint">띄어쓰기 없이 한글·영문·숫자 2~10자 · 저장하면 30일 동안 바꿀 수 없습니다</div>'
        + '<div class="mk-nick-err" id="mkNickErr" role="alert"></div>'
        + '</div>';
      var inp = document.getElementById('mkNickIn');
      if (inp) inp.focus();
      return;
    }
    var ask = _nick.auto && !nickAsked();
    var next = _nick.nextChangeAt ? new Date(_nick.nextChangeAt + 9 * 3600e3) : null;
    el.innerHTML = '<div class="mk-nick' + (ask ? ' ask' : '') + '">'
      + (ask ? '<div class="mk-nick-lead">순위표와 커뮤니티에는 실명 대신 닉네임이 보입니다. 원하는 이름으로 바꿔 보세요.</div>' : '')
      + '<div class="mk-nick-row"><span class="mk-nick-k">내 닉네임</span><b class="mk-nick-v">' + escapeHtml(_nick.nick) + '</b>'
      +   (_nick.auto ? '<i class="mk-nick-auto">자동</i>' : '')
      +   '<span class="mk-nick-act">'
      +   (_nick.canChange ? '<button class="mini-btn" onclick="Mock.editNick(true)">바꾸기</button>'
            : '<span class="mk-nick-next">' + (next.getUTCMonth() + 1) + '/' + next.getUTCDate() + '부터 변경 가능</span>')
      +   (ask ? '<button class="mini-btn" onclick="Mock.keepNick()">이대로 쓰기</button>' : '')
      +   '</span></div>'
      + '</div>';
  }
  function editNick(on) { _nickEdit = !!on; renderNick(); }
  function keepNick() { try { localStorage.setItem(nickAskKey(), '1'); } catch (e) {} renderNick(); }
  async function saveNick() {
    var inp = document.getElementById('mkNickIn'), err = document.getElementById('mkNickErr'), btn = document.getElementById('mkNickSave');
    if (!inp) return;
    var v = inp.value.trim();
    if (!/^[가-힣A-Za-z0-9]{2,10}$/.test(v)) { err.textContent = '띄어쓰기 없이 한글·영문·숫자 2~10자로 정해 주세요'; return; }
    if (!confirm('닉네임을 \'' + v + '\'(으)로 바꿀까요?\n바꾼 뒤 30일 동안은 다시 바꿀 수 없습니다.')) return;
    btn.disabled = true; err.textContent = '';
    try {
      _nick = await api('/nickname', 'POST', { nick: v });
      _nickEdit = false;
      keepNick();
      loadRanking();
      if (_sh && _sh.items && _sh.items.length) loadShares(true);    // 커뮤니티 글·댓글의 이름도 새로
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
    }
  }

  /* 랭킹 탭 안의 두 화면 — 순위(순위표·명예의 전당) | 커뮤니티(계좌 공유 글). 한 번에 하나만 보인다 */
  var _rkView = 'board';
  function rankView(v) {
    _rkView = v === 'share' ? 'share' : 'board';
    applyRankView();
    if (_rkView === 'share') markSharesSeen();
  }
  function applyRankView() {
    var share = _rkView === 'share';
    document.querySelectorAll('.mk-rk-seg .seg').forEach(function (b) {
      var on = b.dataset.rk === _rkView;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    });
    var show = function (id, v) { var e = document.getElementById(id); if (e) e.hidden = !v; };
    show('rkBoard', !share); show('rkHall', !share); show('rkShare', share);
  }
  /* 새 글 표시 — 마지막으로 커뮤니티를 본 뒤 남이 올린 글이 있으면 탭에 점을 찍는다 (이 기기 기준) */
  function seenKey() { return 'dt-invest-share-seen:' + (currentUser ? currentUser.uid : ''); }
  function markSharesSeen() {
    var top = _sh.items[0];
    if (top) try { localStorage.setItem(seenKey(), String(top.createdAt)); } catch (e) {}
    updateShareDot();
  }
  function updateShareDot() {
    var dot = document.querySelector('.mk-rk-dot');
    if (!dot) return;
    var seen = 0;
    try { seen = Number(localStorage.getItem(seenKey())) || 0; } catch (e) {}
    var fresh = _sh.items.some(function (x) { return !x.mine && x.createdAt > seen; });
    dot.hidden = !fresh || _rkView === 'share';
  }

  /* ===== 랭킹 탭 · 계좌 공유 =====
   * 카드 숫자는 서버가 장부로 만든다 — 화면은 종류(계좌 전체/종목 하나)·종목코드·한마디만 보낸다.
   * 공유한 시각의 값으로 고정된 스냅샷이고, 실시간 값은 바로 위 순위표가 보여 준다.
   * 읽기·댓글은 시즌에 참가하지 않은 회원도 할 수 있고, 공유는 참가자만 할 수 있다.
   */
  var SHARE_PREVIEW = 3, SHARE_POS_PREVIEW = 3, SHARE_POS_FULL = 10, COMMENT_MAX = 300;
  function newShareState() { return { items: [], next: null, loading: false, err: null, all: false, open: {}, full: {}, cm: {} }; }
  var _sh = newShareState();
  var _shSheet = null;         // 공유 시트 { kind, code, body, busy }

  function signedWon(n) { return (n > 0 ? '+' : '') + fmtNum(Math.round(n)) + '원'; }
  function linkText(t) { var e = escapeHtml(t); return typeof linkifyBody === 'function' ? linkifyBody(e) : e; }

  async function loadShares(reset) {
    if (reset) _sh = newShareState();
    if (_sh.loading) return;
    _sh.loading = true;
    renderShares();
    try {
      var d = await api('/shares' + (!reset && _sh.next ? '?before=' + encodeURIComponent(_sh.next) : ''));
      _sh.items = reset ? d.items : _sh.items.concat(d.items);
      _sh.next = d.next; _sh.err = null;
    } catch (e) { _sh.err = e.message; }
    _sh.loading = false;
    renderShares();
  }

  function renderShares() {
    var el = document.getElementById('rkShare');
    if (!el) return;
    // 다시 그려도 쓰던 댓글이 지워지지 않게 (다른 카드의 댓글을 받아 오는 사이 등)
    var drafts = {};
    el.querySelectorAll('textarea[data-cm]').forEach(function (t) { if (t.value) drafts[t.dataset.cm] = t.value; });
    var focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.cm : null;

    var joined = !!(season && season.joined);
    var h = '<section class="m-section mk-share"><div class="m-head"><span class="m-hint">회원들의 이야기와 모의투자 계좌</span>'
      + '<button class="mini-btn mk-share-btn" onclick="Mock.openShare()">✏️ 글쓰기</button></div>';
    if (!_sh.items.length) {
      h += _sh.err ? '<div class="empty">' + escapeHtml(_sh.err) + '</div>'
        : (_sh.loading ? '<div class="loading">불러오는 중</div>' : '<div class="mk-share-empty">아직 올라온 글이 없습니다.</div>');
    } else {
      h += (_sh.all ? _sh.items : _sh.items.slice(0, SHARE_PREVIEW)).map(shareCardHtml).join('');
      if (!_sh.all && _sh.items.length > SHARE_PREVIEW) {
        h += '<button class="mini-btn mk-share-more" onclick="Mock.moreShares()">공유 더 보기</button>';
      } else if (_sh.all && _sh.next) {
        h += '<button class="mini-btn mk-share-more" onclick="Mock.moreShares()"' + (_sh.loading ? ' disabled' : '') + '>'
          + (_sh.loading ? '불러오는 중' : '더 불러오기') + '</button>';
      }
    }
    h += '<div class="mk-note">' + (joined
      ? '글에 모의투자 계좌를 붙일 수 있습니다 (하루 3번). 계좌 카드는 올린 시각의 값으로 고정됩니다.'
      : '시즌에 참가하면 글에 모의투자 계좌를 붙일 수 있습니다.') + '</div></section>';
    el.innerHTML = h;
    hydrateShareImages(el);
    if (_rkView === 'share') markSharesSeen(); else updateShareDot();

    Object.keys(drafts).forEach(function (id) { var t = document.getElementById('cmi-' + id); if (t) t.value = drafts[id]; });
    if (focused) { var f = document.getElementById('cmi-' + focused); if (f) try { f.focus({ preventScroll: true }); } catch (e) {} }
  }

  /** 평단 — 몇십 원짜리 ETF 는 반올림하면 평단과 현재가가 같아 보이므로 소수 둘째 자리까지 */
  function avgText(p) {
    var exact = p.qty ? (p.value - p.pnl) / p.qty : p.avgPrice;
    return exact < 1000 && Math.abs(exact - Math.round(exact)) > 0.004 ? exact.toFixed(2) : fmtNum(p.avgPrice);
  }
  function stockBtn(p, cls) {
    return '<button type="button" class="' + cls + '" onclick="openStock(\'' + escapeJsArg(p.code) + '\',\'' + escapeJsArg(p.name) + '\')">'
      + escapeHtml(p.name) + '</button>';
  }

  /** 보유 종목 한 칸 (계좌 카드 안의 타일) */
  /** 계좌 탭 보유 행과 같은 배치 — 왼쪽 종목·수량·평단→현재가, 오른쪽 평가금액·손익(수익률) */
  function shareTileHtml(p) {
    return '<div class="mk-sc-tile ' + signClass(p.pnl) + '">'
      + '<div class="mk-sc-tl">' + stockBtn(p, 'mk-sc-name') + '<span class="mk-sc-q">' + fmtNum(p.qty) + '주</span>'
      +   '<b class="mk-sc-val">' + won(p.value) + '</b></div>'
      + '<div class="mk-sc-tl sub"><span>평단 ' + avgText(p) + ' → ' + (p.price != null ? fmtNum(p.price) : '-') + '</span>'
      +   '<span class="' + signClass(p.pnl) + '">' + signedWon(p.pnl) + ' (' + fmtRate(p.pnlRate) + ')</span></div>'
      + '</div>';
  }

  /** 카드 = 머리(누가·언제) → 글 → 계좌 박스(첨부) → 댓글·삭제 줄 */
  function shareCardHtml(s) {
    var c = s.card || {}, open = !!_sh.open[s.id];
    // 모의투자인 건 랭킹 탭이라 자명하다 — 배지 대신 오른쪽에는 공유 시점 순위를 둔다
    var rank = c.kind === 'account' && c.rank
      ? '<span class="mk-sc-rank">' + c.rank + '위' + (c.participants ? '<i>/' + fmtNum(c.participants) + '명</i>' : '') + '</span>' : '';
    var h = '<article class="mk-sc" id="sc-' + s.id + '">'
      + '<div class="mk-sc-top"><div class="mk-sc-id"><b class="mk-sc-who">' + escapeHtml(s.nickname) + '</b>' + (s.realName ? ' <small class="mk-real" title="실명 (관리자에게만 보임)">' + escapeHtml(s.realName) + '</small>' : '')
      +   (s.mine ? '<i class="mk-tag">나</i>' : '') + '</div>' + rank + '</div>'
      + '<div class="mk-sc-meta">' + (c.seasonName ? '<span class="mk-sc-season">' + escapeHtml(c.seasonName) + '</span>' : '')
      +   escapeHtml(kstHM(c.at || s.createdAt) + (c.kind === 'text' ? '' : (c.closing ? ' 종가' : '') + ' 기준')) + '</div>';
    if (s.body) h += '<div class="mk-sc-body">' + linkText(s.body) + '</div>';
    h += sharePhotosHtml(s);

    if (c.kind === 'account' || c.position) h += '<div class="mk-sc-att">';
    if (c.kind === 'account') {
      // 카드에는 평가금액 상위 10종목까지 (20개로 저장된 예전 카드도 10개까지만 보여 준다)
      var ps = (c.positions || []).slice(0, SHARE_POS_FULL), total = c.holdings != null ? c.holdings : (c.positions || []).length;
      h += '<div class="mk-sc-sum"><span class="mk-sc-k">총자산</span>'
        + '<b class="mk-sc-total">' + won(c.equity) + '</b>'
        + '<span class="mk-sc-chg ' + signClass(c.pnl) + '">' + signedWon(c.pnl) + ' · ' + fmtRate(c.returnRate) + '</span></div>'
        + '<div class="mk-sc-cells">'
        +   '<div><span class="mk-sc-k">현금</span><b>' + won(c.cash) + '</b>'
        +     (c.equity > 0 ? '<em>' + (c.cash / c.equity * 100).toFixed(1) + '%</em>' : '') + '</div>'
        +   '<div><span class="mk-sc-k">실현손익</span><b class="' + signClass(c.realizedPnl) + '">' + signedWon(c.realizedPnl) + '</b></div>'
        + '</div>';
      h += '<div class="mk-sc-k mk-sc-lh">보유 종목 <b>' + fmtNum(total) + '</b></div>';
      if (!ps.length) h += '<div class="mk-sc-none">보유 종목이 없습니다</div>';
      else {
        // 보유 종목은 평가금액이 큰 순 — 처음엔 3개만, [모두 보기]로 펼친다 (댓글 펼침과 따로)
        var full = !!_sh.full[s.id];
        h += '<div class="mk-sc-list">' + (full ? ps : ps.slice(0, SHARE_POS_PREVIEW)).map(shareTileHtml).join('') + '</div>';
        var shown = full ? ps.length : Math.min(ps.length, SHARE_POS_PREVIEW);
        if (total > ps.length && shown === ps.length) h += '<div class="mk-sc-none">외 ' + fmtNum(total - ps.length) + '종목</div>';
        if (ps.length > SHARE_POS_PREVIEW) {
          h += '<button type="button" class="mk-sc-all" onclick="Mock.fullShare(\'' + s.id + '\')" aria-expanded="' + full + '">'
            + (full ? '접기 ▴' : '나머지 종목 보기 ▾') + '</button>';
        }
      }
    } else if (c.position) {
      var p = c.position;
      h += '<div class="mk-sc-sum">' + '<span class="mk-sc-k">' + stockBtn(p, 'mk-sc-name big') + ' · ' + fmtNum(p.qty) + '주</span>'
        + '<b class="mk-sc-total ' + signClass(p.pnl) + '">' + signedWon(p.pnl) + '</b>'
        + '<span class="mk-sc-chg ' + signClass(p.pnlRate) + '">' + fmtRate(p.pnlRate) + '</span></div>'
        + '<div class="mk-sc-cells three">'
        +   '<div><span class="mk-sc-k">평단</span><b>' + avgText(p) + '</b></div>'
        +   '<div><span class="mk-sc-k">현재가</span><b>' + (p.price != null ? fmtNum(p.price) : '-') + '</b></div>'
        +   '<div><span class="mk-sc-k">평가금액</span><b>' + won(p.value) + '</b></div>'
        + '</div>';
    }
    if (c.kind === 'account' || c.position) h += '</div>';

    h += '<div class="mk-sc-act">'
      + '<button type="button" class="mk-sc-btn' + (open ? ' on' : '') + '" onclick="Mock.toggleShare(\'' + s.id + '\')" aria-expanded="' + open + '">'
      +   '💬 댓글 <b>' + fmtNum(s.commentCount) + '</b><span class="mk-sc-caret" aria-hidden="true">' + (open ? '▴' : '▾') + '</span></button>'
      + (s.canDelete ? '<button type="button" class="mk-sc-btn danger" onclick="Mock.deleteShare(\'' + s.id + '\')">삭제</button>' : '')
      + '</div>';
    if (open) h += shareCommentsHtml(s);
    return h + '</article>';
  }

  function shareCommentsHtml(s) {
    var list = _sh.cm[s.id];
    var h = '<div class="mk-sc-cm">';
    if (!list) h += '<div class="mk-sc-none">댓글을 불러오는 중</div>';
    else if (list.err) h += '<div class="mk-sc-none">' + escapeHtml(list.err) + '</div>';
    else if (!list.length) h += '<div class="mk-sc-none">첫 댓글을 남겨 보세요</div>';
    else h += list.map(function (c) {
      return '<div class="mk-sc-c"><div class="mk-sc-ch"><b>' + escapeHtml(c.nickname) + '</b>' + (c.realName ? ' <small class="mk-real" title="실명 (관리자에게만 보임)">' + escapeHtml(c.realName) + '</small>' : '') + '<span class="mk-sc-ct">' + escapeHtml(kstHM(c.createdAt)) + '</span>'
        + (c.canDelete ? '<button type="button" class="mk-sc-cdel" onclick="Mock.deleteComment(\'' + s.id + '\',\'' + c.id + '\')" aria-label="댓글 삭제">삭제</button>' : '')
        + '</div><div class="mk-sc-cb">' + linkText(c.body) + '</div></div>';
    }).join('');
    h += '<div class="mk-sc-cw"><textarea class="comment-input" id="cmi-' + s.id + '" data-cm="' + s.id + '" maxlength="' + COMMENT_MAX + '" rows="1"'
      + ' aria-label="댓글" placeholder="댓글을 남겨 보세요"></textarea>'
      + '<button type="button" class="btn-submit" onclick="Mock.submitComment(\'' + s.id + '\', this)">등록</button></div></div>';
    return h;
  }

  function findShare(id) { return _sh.items.filter(function (x) { return x.id === id; })[0] || null; }

  async function loadShareComments(id) {
    try { _sh.cm[id] = (await api('/shares/' + id + '/comments')).items; }
    catch (e) {
      if (e.code === 'gone') { dropShare(id); toast('삭제된 공유입니다'); return; }
      _sh.cm[id] = { err: e.message };
    }
    renderShares();
  }

  function dropShare(id) {
    _sh.items = _sh.items.filter(function (x) { return x.id !== id; });
    delete _sh.open[id]; delete _sh.full[id]; delete _sh.cm[id];
    renderShares();
  }

  function fullShare(id) {
    _sh.full[id] = !_sh.full[id];
    renderShares();
    // 접을 때 긴 목록이 사라지며 화면이 튀지 않게 카드 머리로 돌아간다
    if (!_sh.full[id]) { var el = document.getElementById('sc-' + id); if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' }); }
  }

  function toggleShare(id) {
    _sh.open[id] = !_sh.open[id];
    renderShares();
    if (_sh.open[id] && !_sh.cm[id]) loadShareComments(id);
  }

  function moreShares() {
    if (!_sh.all) { _sh.all = true; renderShares(); return; }
    if (_sh.next) loadShares(false);
  }

  async function deleteShare(id) {
    var s = findShare(id);
    if (!s || !confirm(s.mine ? '이 공유를 삭제할까요?' : s.nickname + '님의 공유를 삭제할까요?')) return;
    try { await api('/shares/' + id, 'DELETE'); dropShare(id); toast('삭제했습니다'); }
    catch (e) { if (e.code === 'gone') dropShare(id); toast(e.message, 'err'); }
  }

  async function submitComment(id, btn) {
    var t = document.getElementById('cmi-' + id);
    var text = t ? t.value.trim() : '';
    if (!text) { if (t) t.focus(); return; }
    btn.disabled = true;
    try {
      var r = await api('/shares/' + id + '/comments', 'POST', { body: text });
      if (Array.isArray(_sh.cm[id])) _sh.cm[id].push(r.comment);
      var s = findShare(id);
      if (s && r.commentCount != null) s.commentCount = r.commentCount;
      t.value = '';
      renderShares();
    } catch (e) {
      btn.disabled = false;
      if (e.code === 'gone') { dropShare(id); }
      toast(e.message, 'err');
    }
  }

  async function deleteComment(id, cid) {
    if (!confirm('댓글을 삭제할까요?')) return;
    try {
      var r = await api('/shares/' + id + '/comments/' + cid, 'DELETE');
      if (Array.isArray(_sh.cm[id])) _sh.cm[id] = _sh.cm[id].filter(function (c) { return c.id !== cid; });
      var s = findShare(id);
      if (s && r.commentCount != null) s.commentCount = r.commentCount;
      renderShares();
    } catch (e) { toast(e.message, 'err'); if (e.code === 'gone') loadShareComments(id); }
  }

  /* ── 글쓰기 시트 ──
   * 글·사진(4장까지)에 계좌를 붙일 수 있다: 없음(일반 글) · 계좌 전체 · 종목 하나.
   * 계좌를 붙이는 건 시즌 참가자만, 하루 3번까지 (일반 글과 따로 센다).
   */
  var PHOTO_MAX = 4, POST_MAX = 2000;
  function openShare() {
    _shSheet = { kind: 'text', code: null, body: '', imgs: [], busy: false, reading: 0 };
    renderShareSheet();
    if (season && season.joined && !account) refreshAccount().then(function () { if (_shSheet) renderShareSheet(); }).catch(function () {});
  }

  function closeShare() {
    _shSheet = null;
    var el = document.getElementById('mkShare');
    if (el) el.remove();
    syncNoScroll();
  }

  function canPost(st) {
    if (st.busy || st.reading) return false;
    if (st.kind === 'stock') return !!st.code;
    if (st.kind === 'account') return true;
    return !!(st.body.trim() || st.imgs.length);
  }

  function renderShareSheet() {
    var st = _shSheet;
    if (!st) return;
    var el = document.getElementById('mkShare'), fresh = !el;
    if (!el) {
      el = document.createElement('div');
      el.id = 'mkShare';
      el.className = 'mk-sheet-wrap';
      document.body.appendChild(el);
    }
    var joined = !!(season && season.joined);
    var pos = (account && account.positions) || [];
    var h = '<div class="mk-sheet-head"><span class="mk-sheet-title">글쓰기</span>'
      + '<button class="mini-btn mk-x" onclick="Mock.closeShare()" aria-label="닫기">✕</button></div>'
      + '<textarea class="comment-input mk-share-text" id="mkShareText" maxlength="' + POST_MAX + '" aria-label="글"'
      + ' placeholder="자유롭게 이야기를 나눠 보세요" oninput="Mock.shareInput(this)">' + escapeHtml(st.body) + '</textarea>'
      + '<div class="mk-share-cnt" id="mkShareCnt">' + st.body.length + '/' + POST_MAX + '</div>';

    // 사진
    h += '<div class="mk-photo-row">' + st.imgs.map(function (u, i) {
      return '<div class="mk-photo-th"><img src="' + u + '" alt="첨부 사진 ' + (i + 1) + '">'
        + '<button type="button" onclick="Mock.removePhoto(' + i + ')" aria-label="사진 ' + (i + 1) + ' 빼기">✕</button></div>';
    }).join('');
    if (st.imgs.length < PHOTO_MAX) {
      h += '<label class="mk-photo-add">' + (st.reading ? '줄이는 중' : '📷 사진<em>' + st.imgs.length + '/' + PHOTO_MAX + '</em>')
        + '<input type="file" accept="image/*" multiple onchange="Mock.sharePhotos(this)"' + (st.reading ? ' disabled' : '') + '></label>';
    }
    h += '</div>';

    // 계좌 붙이기
    var seg = function (k, label, dis) {
      var on = st.kind === k;
      return '<button type="button" class="seg' + (on ? ' on' : '') + '" aria-pressed="' + on + '" onclick="Mock.shareKind(\'' + k + '\')"'
        + (dis ? ' disabled' : '') + '>' + label + '</button>';
    };
    h += '<div class="mk-share-lbl">계좌 붙이기</div>';
    if (!joined) {
      h += '<div class="mk-share-desc">시즌에 참가하면 모의투자 계좌를 함께 공유할 수 있습니다.</div>';
    } else {
      h += '<div class="seg-row sub mk-seg2" role="group">' + seg('text', '없음') + seg('account', '계좌 전체') + seg('stock', '종목 하나', account && !pos.length) + '</div>';
      if (st.kind === 'account') {
        h += '<div class="mk-share-desc">총자산·수익률·순위, 보유 종목(평가금액 상위 10개)과 현금이 올린 시각의 값으로 붙습니다. 계좌 공유는 하루 3번까지입니다.</div>';
      } else if (st.kind === 'stock') {
        h += !account ? '<div class="mk-share-desc">계좌를 불러오는 중</div>'
          : '<div class="mk-share-pick" role="group" aria-label="공유할 종목">' + pos.map(function (p) {
              var on = st.code === p.code;
              return '<button type="button" class="mk-share-opt' + (on ? ' on' : '') + '" aria-pressed="' + on + '" onclick="Mock.shareCode(\'' + escapeJsArg(p.code) + '\')">'
                + '<b>' + escapeHtml(p.name) + '</b><span>' + fmtNum(p.qty) + '주 · ' + rateHtml(p.pnlRate) + '</span></button>';
            }).join('') + '</div>';
      }
    }
    h += '<div class="mk-sheet-msg" id="mkShareMsg" role="alert"></div>'
      + '<button type="button" class="btn-submit mk-share-go" onclick="Mock.submitShare(this)"' + (canPost(st) ? '' : ' disabled') + '>'
      + (st.busy ? '올리는 중' : '올리기') + '</button>';
    var top = 0, old = el.querySelector('.mk-sheet');
    if (old) top = old.scrollTop;
    el.innerHTML = '<div class="mk-sheet-dim" onclick="Mock.closeShare()"></div>'
      + '<div class="mk-sheet mk-share-sheet' + (fresh ? '' : ' still') + '" role="dialog" aria-modal="true" aria-label="글쓰기" tabindex="-1">' + h + '</div>';
    syncNoScroll();
    if (fresh) focusDialog(el);
    else { var nw = el.querySelector('.mk-sheet'); if (nw) nw.scrollTop = top; }
  }

  function shareKind(k) {
    if (!_shSheet || _shSheet.busy) return;
    _shSheet.kind = k === 'stock' || k === 'account' ? k : 'text';
    renderShareSheet();
  }
  function shareCode(code) { if (!_shSheet || _shSheet.busy) return; _shSheet.code = code; renderShareSheet(); }
  function shareInput(t) {
    if (!_shSheet) return;
    var had = canPost(_shSheet);
    _shSheet.body = t.value;
    var c = document.getElementById('mkShareCnt');
    if (c) c.textContent = t.value.length + '/' + POST_MAX;
    if (had !== canPost(_shSheet)) { var b = document.querySelector('.mk-share-go'); if (b) b.disabled = !canPost(_shSheet); }
  }

  /** 사진을 긴 변 1280px JPEG 로 줄인다 (서버 한도 1.2MB 안쪽). HEIC 등 못 여는 형식은 거절 */
  async function compressPhoto(file) {
    var src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      src = await new Promise(function (res, rej) {
        var img = new Image();
        img.onload = function () { res(img); };
        img.onerror = function () { rej(new Error('이 사진 형식은 올릴 수 없습니다')); };
        img.src = URL.createObjectURL(file);
      });
    }
    var w = src.width, h = src.height, k = Math.min(1, 1280 / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    if (src.close) src.close();
    var q = 0.82, url = c.toDataURL('image/jpeg', q);
    while (url.length > 1550000 && q > 0.4) { q -= 0.12; url = c.toDataURL('image/jpeg', q); }
    return url;
  }

  async function sharePhotos(input) {
    var st = _shSheet;
    if (!st || !input.files) return;
    var files = Array.prototype.slice.call(input.files, 0, PHOTO_MAX - st.imgs.length);
    if (input.files.length > files.length) toast('사진은 ' + PHOTO_MAX + '장까지 올릴 수 있습니다');
    st.reading = files.length;
    renderShareSheet();
    for (var i = 0; i < files.length; i++) {
      try { var u = await compressPhoto(files[i]); if (_shSheet === st && st.imgs.length < PHOTO_MAX) st.imgs.push(u); }
      catch (e) { toast(e.message || '사진을 읽지 못했습니다', 'err'); }
      st.reading--;
    }
    st.reading = 0;
    if (_shSheet === st) renderShareSheet();
  }
  function removePhoto(i) { if (!_shSheet || _shSheet.busy) return; _shSheet.imgs.splice(i, 1); renderShareSheet(); }

  async function submitShare() {
    var st = _shSheet;
    if (!st || !canPost(st)) return;
    st.busy = true;
    renderShareSheet();
    try {
      var r = await api('/shares', 'POST', {
        kind: st.kind, code: st.kind === 'stock' ? st.code : undefined,
        body: st.body.trim(), images: st.imgs.length ? st.imgs : undefined
      });
      closeShare();
      _sh.items.unshift(r.share);
      if (_rkView !== 'share') rankView('share');
      renderShares();
      toast(r.share.kind !== 'text' && r.left != null ? '올렸습니다 · 오늘 계좌 공유 ' + r.left + '번 남음' : '올렸습니다');
    } catch (e) {
      if (!_shSheet) return;
      _shSheet.busy = false;
      renderShareSheet();
      var m = document.getElementById('mkShareMsg');
      if (m) { m.textContent = e.message; m.className = 'mk-sheet-msg err'; }
    }
  }

  /* ── 사진 보기 — 회원 토큰으로 받아 blob 주소로 띄운다 (주소만으로는 볼 수 없게) ── */
  var _imgUrl = {};
  function shareImgUrl(id) {
    if (!_imgUrl[id]) {
      _imgUrl[id] = (async function () {
        var token = await currentUser.getIdToken();
        var res = await fetch(MARKET_API + '/api/mock/share-images/' + id, { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('사진을 불러오지 못했습니다');
        return URL.createObjectURL(await res.blob());
      })();
      _imgUrl[id].catch(function () { delete _imgUrl[id]; });
    }
    return _imgUrl[id];
  }
  function hydrateShareImages(root) {
    (root || document).querySelectorAll('img[data-simg]:not([src])').forEach(function (img) {
      shareImgUrl(img.dataset.simg).then(function (u) { img.src = u; }).catch(function () { img.classList.add('broken'); img.alt = '사진을 불러오지 못했습니다'; });
    });
  }
  function sharePhotosHtml(s) {
    var ids = s.images || [];
    if (!ids.length) return '';
    return '<div class="mk-sc-photos n' + Math.min(ids.length, 4) + '">' + ids.map(function (id, i) {
      return '<button type="button" class="mk-sc-ph" onclick="Mock.viewPhoto(\'' + id + '\')" aria-label="사진 ' + (i + 1) + ' 크게 보기">'
        + '<img data-simg="' + id + '" alt="" loading="lazy"></button>';
    }).join('') + '</div>';
  }
  function viewPhoto(id) {
    var el = document.createElement('div');
    el.id = 'mkPhoto';
    el.className = 'mk-photo-view';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '사진');
    el.innerHTML = '<button type="button" class="mk-photo-x" aria-label="닫기">✕</button><img alt="">';
    el.onclick = closePhoto;
    document.body.appendChild(el);
    syncNoScroll();
    shareImgUrl(id).then(function (u) { var im = el.querySelector('img'); if (im) im.src = u; }).catch(function () { closePhoto(); toast('사진을 불러오지 못했습니다', 'err'); });
    try { el.querySelector('.mk-photo-x').focus({ preventScroll: true }); } catch (e) {}
  }
  function closePhoto() { var el = document.getElementById('mkPhoto'); if (el) el.remove(); syncNoScroll(); }

  /* ===== 종목 상세의 매수·매도 바 ===== */
  function holding(code) {
    if (!account) return null;
    return account.positions.filter(function (p) { return p.code === code; })[0] || null;
  }

  /** 종목 상세에 떠 있는 시세(market-ui.js 의 _lastQuote) — 그 종목일 때만 */
  function liveQuote(code) {
    return (typeof _lastQuote !== 'undefined' && _lastQuote && _lastQuote.code === code) ? _lastQuote : null;
  }
  /** 평가 가격 — 서버 평가(pricer)와 같은 기준: 화면에 보이는 현재가(시간외에는 그 시장 가격) */
  function livePrice(code) {
    var q = liveQuote(code);
    // 네이버가 막혀 대체 출처(다음·야후) 시세가 떠 있으면 계좌 평가(네이버)와 어긋나므로 계좌 응답의 가격을 쓴다
    if (!q || (q.source && q.source !== 'naver')) return null;
    return q.price != null ? q.price : (q.krx && q.krx.price);
  }

  /** 보유 한 줄 — 계좌 응답은 수십 초 간격이라 손익은 지금 보이는 현재가로 다시 계산한다 (상단 시세와 어긋나지 않게) */
  function holdHtml(pos) {
    var px = livePrice(pos.code);
    if (px == null) px = pos.price;
    var value = px != null ? px * pos.qty : pos.cost;
    var pnl = value - pos.cost, rate = pos.cost ? pnl / pos.cost * 100 : 0;
    return '보유 <b>' + fmtNum(pos.qty) + '주</b> · 평단 ' + fmtNum(pos.avgPrice) + '원'
      + ' · 평가손익 <span class="' + signClass(pnl) + '">' + (pnl > 0 ? '+' : '') + fmtNum(pnl) + '원 (' + fmtRate(rate) + ')</span>';
  }

  function renderTradeBar() {
    var old = document.getElementById('mkTradeBar');
    if (!on || !curStock || !season || !season.season) { if (old) old.remove(); return; }
    var host = document.getElementById('stockDetail');
    if (!host || host.style.display === 'none') { if (old) old.remove(); return; }
    var pos = holding(curStock.code);
    // 계좌를 새로 받을 때마다 불린다 — 버튼 구성이 그대로면 보유 줄만 고친다 (누르는 중인 버튼이 사라지지 않게)
    var key = [curStock.code, season.joined ? 1 : 0, pos ? pos.qty + ':' + pos.cost : ''].join('|');
    if (old && old.dataset.key === key && old.parentNode === host) { paintHold(); return; }
    if (old) old.remove();
    var bar = document.createElement('div');
    bar.id = 'mkTradeBar';
    bar.className = 'mk-tradebar';
    bar.dataset.key = key;
    bar.innerHTML = (pos ? '<div class="mk-hold" id="mkHold">' + holdHtml(pos) + '</div>' : '')
      + '<div class="mk-tb-btns">'
      + (season.joined
          ? '<button class="mk-buy" onclick="Mock.openSheet(\'buy\')">매수</button>'
            + '<button class="mk-sell" onclick="Mock.openSheet(\'sell\')"' + (pos ? '' : ' disabled title="보유한 주식이 없습니다"') + '>매도</button>'
          : '<button class="mk-buy" onclick="switchTab(\'account\'); Mock.openJoinFlow()">모의투자 참가하고 매수하기</button>')
      + '</div>';
    host.appendChild(bar);
  }

  function paintHold() {
    var el = document.getElementById('mkHold');
    if (!el || !curStock) return;
    var pos = holding(curStock.code);
    if (pos) el.innerHTML = holdHtml(pos);
  }

  /** 종목 상세의 시세 틱마다 (market-ui.js loadStockQuote 가 부른다) — 보유 손익과 시장가 주문창 계산을 현재가에 맞춘다 */
  function onQuote(q) {
    if (!on || !q) return;
    if (curStock && q.code === curStock.code) paintHold();
    // 주문창 — 시장가 예상 금액·최대 수량, 그리고 시간대 안내(08:30·15:40 등을 넘기는 순간)를 맞춘다
    if (sheet && sheet.code === q.code && !sheet.busy) refreshSheetParts();
  }

  /* ===== 주문창 ===== */
  async function openSheet(side) {
    if (!curStock) return;
    if (side === 'sell' && !holding(curStock.code)) side = 'buy';
    var q = liveQuote(curStock.code);
    // 시간외에는 화면에 보이는 그 시장의 가격(q.price), 정규장에는 KRX 가격을 기본값으로
    var px = q ? (phaseInfo().limitOnly ? (q.price || (q.krx && q.krx.price)) : ((q.krx && q.krx.price) || q.price)) : 0;
    // ETF·ETN 여부를 이미 알면 바로 쓴다 — 모르면 일반 주식 호가단위로 시작하고 아래에서 받아 고친다
    var tf = _kind[curStock.code];
    sheet = { code: curStock.code, name: curStock.name, side: side, type: 'limit', price: px || 0, qty: '', taxFree: tf != null ? tf : false, busy: false, orderId: null };
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

  /** 주문을 보내는 중에는 닫지 않는다 — 닫으면 접수 결과(거절 사유·접수 확인)가 버려져 회원이 실패로 알고 또 주문했다 */
  function tryCloseSheet() {
    if (sheet && sheet.busy && !sheet.orderId) { msg('주문을 보내는 중입니다. 결과가 나올 때까지 잠시만 기다려 주세요', ''); return; }
    closeSheet();
  }

  function closeSheet() {
    sheet = null;
    var el = document.getElementById('mkSheet');
    if (el) el.remove();
    syncNoScroll();
  }

  /** 지금이 어느 구간인지 — 계좌 응답이 더 최신이면 그쪽을 쓴다.
   * 응답은 받은 순간의 구간이라, 주문창을 연 채 08:00·08:30·15:30·15:40·20:00 을 넘기면 틀린 안내로 막았다.
   * 서버 시각을 기준으로 흐른 시간만큼 시계를 돌려 같은 규칙(api.js sessionInfo)으로 다시 매긴다.
   * 거래일 여부(휴장일)는 서버만 알므로, 날짜가 바뀌었으면 서버 값을 그대로 둔다 (다음 계좌 갱신이 고친다). */
  function phaseInfo() {
    var src = (account && account.phase) ? account : (season || {});
    var base = { phase: src.phase || 'closed', canOrder: !!src.canOrder, limitOnly: !!src.limitOnly, holiday: !!src.holiday };
    if (!src.serverTime || !src._recvAt) return base;
    var then = kstClock(src.serverTime), now = kstClock(src.serverTime + (Date.now() - src._recvAt));
    if (then.ymd !== now.ymd) return base;
    var hm = now.hm, phase = 'closed';
    if (now.dow >= 1 && now.dow <= 5 && !base.holiday) {
      if (hm >= 480 && hm < 510) phase = 'pre_market';            // 08:00~08:30 NXT 프리마켓
      else if (hm >= 510 && hm < 540) phase = 'pre_open';         // 08:30~09:00 장전 → 시가
      else if (hm >= 540 && hm < 920) phase = 'continuous';       // 09:00~15:20
      else if (hm >= 920 && hm < 930) phase = 'close_auction';    // 15:20~15:30 → 종가
      else if (hm >= 930 && hm < 940) phase = 'break';            // 15:30~15:40
      else if (hm >= 940 && hm < 1200) phase = 'after_market';    // 15:40~20:00
    }
    return { phase: phase, canOrder: phase !== 'closed' && phase !== 'break',
             limitOnly: phase === 'pre_market' || phase === 'after_market', holiday: base.holiday };
  }
  function kstClock(ms) {
    var k = new Date(ms + 9 * 3600000);
    return { ymd: k.getUTCFullYear() * 10000 + (k.getUTCMonth() + 1) * 100 + k.getUTCDate(), hm: k.getUTCHours() * 60 + k.getUTCMinutes(), dow: k.getUTCDay() };
  }

  /** 오늘(KST)이 시즌 종료일인가 — 서버가 그날 애프터마켓 주문을 받지 않는다 */
  function seasonLastDay() {
    var src = (account && account.serverTime) ? account : season;
    var end = (account && account.season && account.season.endDate) || (season && season.season && season.season.endDate);
    if (!src || !src.serverTime || !end) return false;
    var k = new Date(src.serverTime + (Date.now() - (src._recvAt || Date.now())) + 9 * 3600000);
    var iso = k.getUTCFullYear() + '-' + String(k.getUTCMonth() + 1).padStart(2, '0') + '-' + String(k.getUTCDate()).padStart(2, '0');
    return iso >= end;
  }

  function sessionNote() {
    var p = phaseInfo();
    if (p.phase === 'break') return '<div class="mk-warn">15:30~15:40 은 주문 접수 시간이 아닙니다. 15:40 부터 애프터마켓 주문이 가능합니다</div>';
    if (p.holiday) return '<div class="mk-warn">오늘은 휴장일입니다. 다음 거래일 08:00 부터 주문할 수 있습니다</div>';
    if (!p.canOrder) return '<div class="mk-warn">주문 가능 시간이 아닙니다 (거래일 08:00~20:00)</div>';
    if (p.phase === 'pre_market') return '<div class="mk-info"><b>프리마켓(NXT)</b> · 지정가 주문만 가능 · 08:30 접수 마감 · 08:50 까지 미체결이면 만료</div>';
    if (p.phase === 'after_market') {
      if (seasonLastDay()) return '<div class="mk-warn">시즌 마지막 날은 15:30 정규장으로 매매가 끝났습니다 · 최종 순위는 15:30 종가 기준입니다</div>';
      return '<div class="mk-info"><b>애프터마켓</b> · 지정가 주문만 가능 · 20:00 까지 미체결이면 만료 · ETF·ETN 제외</div>';
    }
    // 시가·종가에 닿지 않는 지정가는 체결되지 않고 이어서 기다린다 — '체결됩니다'로 단정하지 않는다
    if (p.phase === 'pre_open') return '<div class="mk-info">장전 주문 · 시장가와 시가에 닿는 지정가는 09:00 <b>시가</b>로 체결됩니다</div>';
    if (p.phase === 'close_auction') return '<div class="mk-info">장 마감 동시호가 · 체결되면 15:30 <b>종가</b>로 체결됩니다 · 미체결은 장 마감에 만료</div>';
    return '';
  }

  /** 시장가 주문의 기준 가격 — 시장가는 정규장에만 받고, 서버도 접수 순간의 KRX 현재가로 증거금을 잡는다 */
  function marketPx(code) {
    var q = liveQuote(code);
    return q ? ((q.krx && q.krx.price) || q.price || null) : null;
  }

  function sheetNumbers() {
    var s = sheet, a = account, fr = a ? a.season.feeRate : 0.00015, tr = a ? a.season.taxRate : 0.002;
    // 시장가는 주문창을 연 순간의 가격이 아니라 지금 시세로 계산한다 (틱마다 onQuote 가 다시 그린다)
    var price = (s.type === 'market' ? marketPx(s.code) : null) || Number(s.price) || 0;
    var qty = Math.floor(Number(s.qty)) || 0;
    var amount = price * qty;
    var fee = Math.floor(amount * fr + 1e-6);
    var tax = (s.side === 'sell' && !s.taxFree) ? Math.floor(amount * tr + 1e-6) : 0;
    var pos = holding(s.code);
    var maxQty = s.side === 'buy'
      ? (price > 0 && a ? Math.floor(a.available / (price * (1 + fr))) : 0)
      : (pos ? pos.qty - (a ? a.openOrders.filter(function (o) { return o.code === s.code && o.side === 'sell'; })
                                  .reduce(function (t, o) { return t + (o.qty - o.filledQty); }, 0) : 0) : 0);
    return { price: price, qty: qty, amount: amount, fee: fee, tax: tax, maxQty: Math.max(0, maxQty), held: pos ? pos.qty : 0 };
  }

  /** 수량 옆 안내 — 매도는 '보유'가 아니라 미체결 매도를 뺀 '매도 가능' 수량이다 */
  function maxText(n) {
    if (sheet.side === 'buy') return '최대 ' + fmtNum(n.maxQty) + '주';
    return '매도 가능 ' + fmtNum(n.maxQty) + '주' + (n.held !== n.maxQty ? ' (보유 ' + fmtNum(n.held) + '주)' : '');
  }

  /** 주문창 제목 옆 ! — 체결 규칙과 비용 */
  function orderTipHtml() {
    var ss = account && account.season, fr = ss ? ss.feeRate : 0.00015, tr = ss ? ss.taxRate : 0.002;
    return InfoTip.btn('주문 규칙', [
      '· 실제 시장에서 거래가 일어난 가격으로만 체결됩니다. 주문 뒤 거래가 생기고, 그 가격이 지정가에 닿아야 합니다.',
      '· 시장가는 그때의 체결가로 체결됩니다. 체결 판정은 최대 1분 늦을 수 있습니다.',
      '· 동시호가·VI·거래정지로 가격이 멈춘 동안에는 체결되지 않고, 거래가 다시 생기면 그 가격으로 체결됩니다.',
      '· 수수료 ' + (fr * 100).toFixed(3) + '% (매수·매도) · 매도세 ' + (tr * 100).toFixed(2) + '% (ETF·ETN 면제)',
      '· 매도 가능 = 보유 수량 − 아직 체결 안 된 매도 주문 수량'
    ].join('\n'), 'sm');
  }

  function calcHtml(n) {
    var isBuy = sheet.side === 'buy', a = account;
    // 시장가는 체결가가 정해지지 않았다 — 지금 시세로 어림한 값임을 밝힌다
    return row(sheet.type === 'market' ? '예상 주문 금액' : '주문 금액', won(n.amount))
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
    // 보유가 없으면 매도 탭을 막는다 — 종목 상세 하단 바의 매도 버튼과 같은 기준
    // (매도 중에 전량 체결돼 보유가 0이 된 경우는 지금 보고 있는 탭이라 그대로 둔다)
    var noHolding = !holding(s.code);
    var limitOnly = phaseInfo().limitOnly;
    s._limitOnly = limitOnly;
    if (limitOnly && s.type === 'market') {     // 시간외에는 실전과 같이 지정가만
      s.type = 'limit';
      if (!s.price) s.price = livePrice(s.code) || 0;
    }
    el.innerHTML = '<div class="mk-sheet-dim" onclick="Mock.tryCloseSheet()"></div>'
      + '<div class="mk-sheet ' + s.side + '" role="dialog" aria-modal="true" aria-label="주문" tabindex="-1">'
      + '<div class="mk-sheet-head"><span class="mk-sheet-title">' + escapeHtml(s.name) + ' <i>' + escapeHtml(s.code) + '</i></span>'
      +   '<span class="mk-sheet-acts">' + orderTipHtml() + '<button class="mini-btn" onclick="Mock.tryCloseSheet()" aria-label="닫기">✕</button></span></div>'
      + '<div class="seg-row mk-seg2" role="group" aria-label="매매 구분">'
      +   '<button class="seg' + (isBuy ? ' on buy' : '') + '" aria-pressed="' + isBuy + '" onclick="Mock.setSheet(\'side\',\'buy\')">매수</button>'
      +   '<button class="seg' + (!isBuy ? ' on sell' : '') + '" aria-pressed="' + !isBuy + '" onclick="Mock.setSheet(\'side\',\'sell\')"' + (isBuy && noHolding ? ' disabled title="보유한 주식이 없습니다"' : '') + '>매도</button>'
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
        }).join('') + '<span class="mk-dim" id="mkMaxQty">' + maxText(n) + '</span></div>'
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
    if (!sheet || !document.getElementById('mkSheet') || document.getElementById('mkPending')) return;
    var limitOnly = phaseInfo().limitOnly;
    // 구간이 바뀌어 시장가가 막히거나 풀리면 버튼 상태가 달라지므로 통째로 다시 그린다 (하루 몇 번뿐)
    if (sheet._limitOnly != null && sheet._limitOnly !== limitOnly) { sheet._limitOnly = limitOnly; renderSheet(); return; }
    var n = sheetNumbers();
    var note = document.getElementById('mkSessionNote'); if (note) note.innerHTML = sessionNote();
    var mx = document.getElementById('mkMaxQty'); if (mx) mx.textContent = maxText(n);
    var calc = document.querySelector('#mkSheet .mk-calc'); if (calc) calc.innerHTML = calcHtml(n);
  }

  function setSheet(key, val) {
    if (!sheet || sheet.busy) return;
    if (key === 'side' && val === 'sell' && sheet.side !== 'sell' && !holding(sheet.code)) return;
    sheet[key] = val;
    if (key === 'side') sheet.qty = '';
    renderSheet();
  }

  /** 입력 중에는 통째로 다시 그리지 않는다 — 커서가 튀고 모바일 키보드가 닫힌다 */
  /** "1.5" → 1, "-5" → 5, "1,000" → 1000. 소수점 뒤를 숫자로 이어 붙이면 1.5주가 15주가 됐다 */
  function digitsOf(raw) {
    var v = Number(String(raw).split('.')[0].replace(/[^0-9]/g, '')) || 0;
    return Math.min(v, 999999999);
  }

  function input(key, el) {
    if (!sheet) return;
    var v = digitsOf(el.value);
    sheet[key] = v;
    el.value = v ? fmtNum(v) : '';
    msg('');
    var n = sheetNumbers();
    var mx = document.getElementById('mkMaxQty'); if (mx) mx.textContent = maxText(n);
    var calc = document.querySelector('#mkSheet .mk-calc'); if (calc) calc.innerHTML = calcHtml(n);
  }

  function step(dir) {
    if (!sheet || sheet.busy) return;
    // 가격이 비어 있으면 1원부터가 아니라 지금 가격에서 시작한다
    if (!Number(sheet.price)) { var cp = curPrice(sheet.code); if (cp) { sheet.price = cp; dir = 0; } }
    if (dir) sheet.price = tickStep(sheet.price, dir, sheet.taxFree);
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
      // 서버(engine.js)와 같은 예외 — 현재가가 이미 전일 종가 ±30% 밖이면 가격제한폭이 없는 날(정리매매 등)로 본다.
      // 이 예외가 없어 상장폐지 정리매매 종목의 지정가 매도가 화면에서 전부 막혔다 (시간외에는 매도할 방법이 없었다)
      var noLimit = prev && q.krx.price != null && Math.abs(q.krx.price / prev - 1) > 0.3;
      if (prev && !noLimit) {
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
      if (sheet !== mySheet) {                // 기다리는 사이 창이 닫혔다 — 접수 사실은 알리고 뒤에서 지켜본다
        toast(d.order.name + ' 주문 접수 · 체결되면 알려 드립니다', '');
        refreshAccount();
        watchOrder(d.order.id, 0);
        return;
      }
      sheet.cid = null;                       // 접수됐다 — 이 창에서 다음 주문은 새 값으로
      sheet.orderId = d.order.id;
      showPending(d.order);
      refreshAccount();                       // 주문 가능 금액·매도 가능 수량·보유 줄을 바로 맞춘다
      watchOrder(d.order.id, 0);
    } catch (e) {
      if (sheet !== mySheet) { toast(e.message, ''); return; }
      sheet.busy = false;
      if (e.code === 'timeout') {
        // 워커가 늦게 답했을 뿐 접수됐을 수 있다 — 내용을 바꾸지 않고 다시 누르면 같은 주문 번호로 가서 두 번 접수되지 않는다
        msg('서버 응답이 늦습니다. 주문이 접수됐을 수 있으니 계좌 탭의 미체결 주문을 확인하세요 (같은 내용으로 다시 눌러도 두 번 주문되지 않습니다)', 'err');
        refreshAccount();
        if (btn) { btn.disabled = false; btn.textContent = (sheet.side === 'buy' ? '매수' : '매도') + ' 주문'; }
        return;
      }
      // 시장가 '최대'는 화면의 현재가로 셈한다 — 접수 순간 시세가 한 호가만 올라도 금액이 모자랄 수 있다
      msg(e.message + (e.code === 'cash' && sheet.type === 'market' && sheet.side === 'buy'
        ? ' · 시장가는 접수 순간의 현재가로 계산합니다. 수량을 조금 줄여 다시 시도하세요' : ''), 'err');
      if (e.code === 'cash' || e.code === 'qty') refreshAccount().then(function () { if (sheet === mySheet && !sheet.busy) refreshSheetParts(); });
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
   *  창은 "이 주문을 접수한 그 창"일 때만 닫는다 — 다른 종목의 새 주문창을 끌어내리지 않게.
   *  창을 닫았거나(주문은 유지된다) 정정으로 새 주문이 생겼으면 창 없이 계속 지켜보다가 끝나면 알림만 띄운다. */
  function watchOrder(id, tries, seenFilled) {
    clearTimeout(watching[id]);
    var mine = function () { return sheet && sheet.orderId === id; };
    watching[id] = setTimeout(async function () {
      delete watching[id];
      if (!on) return;
      try {
        var d = await api('/orders/' + encodeURIComponent(id));
        var o = d.order;
        if (o.status === 'filled' || o.status === 'cancelled' || o.status === 'expired' || o.status === 'rejected') {
          await refreshAccount();
          var sideTxt = o.side === 'buy' ? '매수' : '매도';
          var endTxt = o.status === 'cancelled' ? '취소' : (o.status === 'rejected' ? '거부' : '만료');
          // 체결가 — 여러 번에 나눠 체결됐으면 평균가 (서버가 fillAvg·fillCount 를 준다. 옛 워커면 이번 판정의 체결가)
          var px = d.fillAvg || (d.fill && d.fill.price);
          var done = o.filledQty > 0
            ? (o.name + ' ' + sideTxt + ' 체결 · ' + fmtNum(o.filledQty) + '주' + (px ? ' · ' + (d.fillCount > 1 ? '평균 ' : '') + fmtNum(px) + '원' : '')
               + (o.filledQty < o.qty ? ' · 나머지 ' + fmtNum(o.qty - o.filledQty) + '주 ' + endTxt + (o.reason ? ' (' + o.reason + ')' : '') : ''))
            : (o.name + ' 주문이 ' + endTxt + '되었습니다' + (o.reason ? ' (' + o.reason + ')' : ''));
          if (mine()) closeSheet();
          // 정정으로 닫힌 원주문('정정')은 새 주문이 이어받았으니 알리지 않는다
          if (o.reason !== '정정' || o.filledQty > 0) toast(done, o.filledQty > 0 ? o.side : '');
          return;
        }
        if (o.filledQty > 0 && mine()) showPending(o, o.filledQty);
        // 일부 체결 — 대기 패널만 바뀌고 헤더·보유 줄·매도 버튼은 다음 계좌 갱신(최대 30~40초)까지 그대로였다
        if (o.filledQty > (seenFilled || 0)) refreshAccount();
        if (tries >= 30) {
          await refreshAccount();
          if (mine()) { closeSheet(); toast(o.name + ' 주문 대기 중 · 계좌 탭에서 확인할 수 있습니다', ''); }
          return;
        }
        watchOrder(id, tries + 1, o.filledQty);
      } catch (e) {
        // 주문이 없거나 시즌이 끝났다 — 더 물어볼 게 없다
        if (e.status === 404 || e.code === 'no_season' || e.code === 'not_joined') { if (mine()) closeSheet(); refreshAccount(); return; }
        if (tries < 30) { watchOrder(id, tries + 1, seenFilled); return; }
        // 계속 실패 — 스피너에 갇히지 않게 창을 닫고 확인할 곳을 알려 준다
        if (mine()) { closeSheet(); toast('체결 확인이 늦어지고 있습니다 · 계좌 탭의 미체결 주문에서 확인하세요', ''); }
        refreshAccount();
      }
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

  /* ===== 보조 창 (주문 정정) =====
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
    refreshAuxParts();
  }

  function refreshAuxParts() {
    if (!aux) return;
    if (aux.kind === 'amend') amendParts();
  }

  function auxInput(key, el) {
    if (!aux || aux.busy) return;
    var v = digitsOf(el.value);
    auxPut(key, v || '');
    el.value = v ? fmtNum(v) : '';
    auxMsg('');
    refreshAuxParts();
  }

  function auxStep(key, dir) {
    if (!aux || aux.busy) return;
    var cur = Number(auxGet(key)) || 0, v;
    if (key === 'qty') {
      var max = aux.rem;
      if (!cur) cur = max;
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
    body.filledQty = a.filled;                  // 창을 연 뒤 체결이 있었는지 서버가 가릴 수 있게 (그 사이 체결되면 남은 수량이 줄어 있다)
    setAuxBusy(true, '정정 접수 중');
    try {
      var d = await api('/orders/' + encodeURIComponent(a.id) + '/amend', 'POST', body);
      a.cid = null;
      if (aux === a) closeAux();
      toast(a.name + ' 정정 완료' + (d && d.replaced ? ' · 새 주문으로 대기합니다' : ' · 대기 순서 유지'), '');
      // 가격을 바꾸면 새 주문이 된다 — 지켜보며 바로 체결을 시도한다 (안 그러면 크론을 최대 1분 기다렸다)
      if (d && d.order && d.order.id && (d.order.status === 'open' || d.order.status === 'partial')) watchOrder(d.order.id, 0);
    } catch (e) {
      if (aux !== a) return;
      setAuxBusy(false);
      auxMsg(e.message, 'err');
    } finally {
      refreshAccount();
    }
  }

  /* ===== 권리 변동 (내 계좌, 최근 30일) ===== */
  /** '2026-10-30' · '20261030' → '10/30' */
  function md(v) {
    var m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(v || ''));
    return m ? Number(m[2]) + '/' + Number(m[3]) : '';
  }

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
      + '<p class="mk-note">반영하면 1분 안에(다음 크론) 그 종목 보유자 전원에게 적용되며 되돌릴 수 없습니다.</p>';
  }

  function caFind(id) { return (_corp || []).filter(function (x) { return String(x.id) === id; })[0]; }

  async function caApply(id, kind, btn) {
    if (!caOkId(id) || (kind !== 'split' && kind !== 'rights')) return;
    var x = caFind(id) || {};
    var what = kind === 'split' ? '분할 · 무상증자(보유 수량 조정)' : '유상증자 권리락(현금 보전)';
    if (!confirm((x.name || x.code || '') + ' — ' + what + '로 반영합니다.\n보유 ' + fmtNum(x.holders || 0) + '명에게 1분 안에 적용되며 되돌릴 수 없습니다.')) return;
    if (btn) btn.disabled = true;
    try {
      await api('/admin/corp-actions/' + encodeURIComponent(id) + '/apply', 'POST', { kind: kind });
      toast('반영 대기에 올렸습니다 · 1분 안에 보유자 계좌에 적용됩니다', '');
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
    setMode: setMode, onTab: onTab, renderTradeBar: renderTradeBar, onQuote: onQuote, onEscape: onEscape,
    join: join, openJoinFlow: openJoinFlow, joinStep2: joinStep2, closeJoin: closeJoin, cancel: cancel, loadHistory: loadHistory,
    openSheet: openSheet, closeSheet: closeSheet, tryCloseSheet: tryCloseSheet, setSheet: setSheet, input: input, step: step, pct: pct, submit: submit,
    askReview: askReview,
    openAmend: openAmend, closeAux: closeAux,
    auxInput: auxInput, auxStep: auxStep, auxSet: auxSet, auxSel: auxSel, auxSubmit: auxSubmit,
    loadCorpAdmin: loadCorpAdmin, caApply: caApply, caDismiss: caDismiss,
    mountAdmin: mountAdmin,
    saveSeason: saveSeason, loadSeasons: loadSeasons, pickSeason: pickSeason,
    newSeasonForm: newSeasonForm, onSeasonIdInput: onSeasonIdInput,
    addHoliday: addHoliday, removeHoliday: removeHoliday,
    openShare: openShare, closeShare: closeShare, shareKind: shareKind, shareCode: shareCode, shareInput: shareInput, submitShare: submitShare,
    sharePhotos: sharePhotos, removePhoto: removePhoto, viewPhoto: viewPhoto,
    editNick: editNick, saveNick: saveNick, keepNick: keepNick,
    rankView: rankView, toggleShare: toggleShare, fullShare: fullShare, moreShares: moreShares, deleteShare: deleteShare, submitComment: submitComment, deleteComment: deleteComment
  };
})();
