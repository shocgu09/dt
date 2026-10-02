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
  /** 억·만 단위를 빠짐없이 — 100,100,000 → '1억 10만', 100,000,000 → '1억' (원금처럼 몇십만 차이가 중요한 곳에) */
  function korWon(n) {
    n = Math.round(n || 0);
    var eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4), rest = n % 1e4, out = [];
    if (eok) out.push(fmtNum(eok) + '억');
    if (man) out.push(fmtNum(man) + '만');
    if (rest || !out.length) out.push(fmtNum(rest));
    return out.join(' ');
  }
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
      if (sheet && !sheet.busy) refreshSheetParts();
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
    el.classList.toggle('has-pend', !!(account.openOrders && account.openOrders.length));
    el.innerHTML = '<span class="mk-bar-label">💼 내 자산</span>'
      + '<b class="mk-bar-eq">' + won(src.equity) + '</b>'
      + rateHtml(src.returnRate)
      + (src.rank ? '<span class="mk-bar-rank">' + src.rank + '위<i>/' + fmtNum(src.participants) + '</i></span>' : '')
      + pendChipHtml(account.openOrders)
      + '<span class="mk-bar-go">계좌 →</span>';
  }

  /** 상단 바의 체결 대기 칩 — 한 건이면 종목·방향·수량, 여러 건이면 매수·매도 건수. 매수만 빨강·매도만 파랑·섞이면 앰버 */
  function pendChipHtml(orders) {
    var list = orders || [];
    if (!list.length) return '';
    var buys = list.filter(function (o) { return o.side === 'buy'; }).length;
    var cls = buys === list.length ? 'buy' : buys === 0 ? 'sell' : 'mix';
    var txt;
    if (list.length === 1) {
      var o = list[0];
      txt = escapeHtml(o.name) + ' ' + (o.forced ? '반대매매' : (o.side === 'buy' ? '매수' : '매도')) + ' '
        + (o.filledQty ? fmtNum(o.filledQty) + '/' : '') + fmtNum(o.qty) + '주';
    } else {
      // 여러 건 — 매수·매도를 따로 센다 (한쪽만 있으면 그쪽만)
      var sells = list.length - buys;
      txt = [buys ? '<b class="up">매수 ' + fmtNum(buys) + '건</b>' : '', sells ? '<b class="down">매도 ' + fmtNum(sells) + '건</b>' : '']
        .filter(Boolean).join('<i class="mk-pend-sep"> · </i>');
    }
    return '<span class="mk-bar-pend ' + cls + '"><i class="mk-pend-dot" aria-hidden="true"></i>'
      + '<span class="mk-pend-txt">' + txt + '</span><em>체결 대기</em></span>';
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
    // 화면을 켜 둔 채 5분 넘게 조작이 없으면 장중에도 5분 (Poller 의 자리 비움 판정과 같다)
    var idle = typeof Poller !== 'undefined' && Poller.isIdle && Poller.isIdle();
    var gap = (typeof isMarketOpen === 'function' && isMarketOpen() && !idle) ? 30000 : 300000;
    if (Date.now() - _accAt >= gap) { _accAt = Date.now(); refreshAccount(); }
  }, 10000);

  /* ===== 계좌 ===== */
  /**
   * 계좌 탭을 다시 그린다. 시세 폴링마다 불리므로, 사용자가 만든 상태가 있는 부분은 새로 만들지 않고
   * 기존 노드를 그대로 옮겨 붙인다 — 안 그러면 폴링 때마다 날아간다.
   *   - 시즌 관리 패널(details): 열림 상태와 입력 중인 글자
   *   - 체결 내역(#mkHistory): "불러오기"로 받아 둔 목록
   */
  var KEEP_ON_REPAINT = ['details.mk-admin', '#mkHistory', '#mkLedger'];
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
        + nextSeasonHtml()
        + '<button class="mini-btn" onclick="switchTab(\'ranking\')">지난 시즌 결과 보기</button></div>'
      );
      return;
    }

    if (!season.joined) { paint(el, joinHtml()); return; }
    if (!account) { paint(el, '<div class="empty">' + escapeHtml(errMsg || '계좌 정보를 불러오는 중') + '</div>'); return; }

    var a = account, s = a.season;
    var principal = a.principal || s.seed;          // 원금 = 시드 + 출석금 (옛 워커 응답에는 없다)
    var evalPnl = a.positions.reduce(function (t, p) { return t + p.pnl; }, 0)
      + ((a.credit && a.credit.lots) || []).reduce(function (t, l) { return t + (l.qty > 0 ? l.pnl : 0); }, 0);
    var h = '<div class="mk-card mk-summary">'
      + '<div class="mk-sum-head"><span class="mk-sum-end">' + escapeHtml(s.name) + '<span class="mk-dim">· ' + (md(s.endDate) || escapeHtml(s.endDate)) + ' 종료</span></span>'
      // 오른쪽: 계좌 보는 법 + 출석 체크 작은 버튼(renderAttend 가 채운다)
      + '<span class="mk-sum-end">' + InfoTip.btn('계좌 보는 법', [
          '· 총자산 = 현금 + 보유 주식 (현재가로 평가)',
          '· 주문 가능: 현금에서 미체결 매수 주문이 묶어 둔 돈(주문 대기)을 뺀 금액' + (a.credit && creditActive(a) ? ' (증거금률 "종목별"이면 결제 전 외상분을 더하고, 결제 전에 산 주식을 되판 대금 중 재사용할 수 없는 몫을 뺍니다)' : ''),
          '· 평가손익: 보유 주식의 지금 가치 − 산 금액',
          '· 실현손익: 판 금액에서 수수료·세금과 산 금액(평균 단가)을 뺀 손익',
          '· 매수 수수료는 산 금액에 넣지 않습니다. 평가손익 + 실현손익 − 매수 수수료' + (a.credit && creditActive(a) ? ' − 이자(낸 이자 + 쌓인 이자)' : '') + ' = 총손익입니다.',
          '· 원금 = 시드머니 + 출석금. 출석금은 수익이 아니라서 손익·수익률은 원금 기준으로 계산합니다 (순위는 총자산 기준).'
        ].concat(a.credit && creditActive(a) ? ['· 신용·담보대출·미수가 있으면 총자산은 순자산입니다: 예수금 + 보유 주식 − 융자·대출 원금 − 쌓인 이자'] : []).join('\n'), 'sm') + '<span id="mkAttend"></span></span></div>'
      + '<div class="mk-eq">' + won(a.equity) + '</div>'
      + '<div class="mk-eq-sub">' + rateHtml(a.returnRate) + ' <span class="' + signClass(a.equity - principal) + '">'
      +   (a.equity - principal > 0 ? '+' : '') + fmtNum(a.equity - principal) + '원</span>'
      +   '<span class="mk-dim"> · 시작 ' + fmtCompact(s.seed) + '원</span></div>'
      + '<div class="mk-grid">'
      // 총자산 = 현금 + 보유 주식. 미체결 매수가 묶어 둔 돈은 '주문 가능'에서 빠지므로 따로 밝혀 합이 맞게 한다
      +   cell('주문 가능', won(a.available) + ((a.reserved != null ? a.reserved : a.cash - a.available) > 0 ? '<small class="mk-cell-sub">주문 대기 ' + won(a.reserved != null ? a.reserved : a.cash - a.available) + '</small>' : ''))
      +   cell('보유 주식', won(a.stock))
      +   cell('평가손익', '<span class="' + signClass(evalPnl) + '">' + (evalPnl > 0 ? '+' : '') + fmtNum(evalPnl) + '원</span>')
      // 매수 수수료는 매입금액에 넣지 않는다 — 평가손익 + 실현손익 − 매수 수수료 = 위 총손익이 되도록 함께 적는다
      +   cell('실현손익', '<span class="' + signClass(a.realizedPnl) + '">' + (a.realizedPnl > 0 ? '+' : '') + fmtNum(a.realizedPnl) + '원</span>'
            + (a.buyFees ? '<small class="mk-cell-sub">매수 수수료 −' + fmtNum(a.buyFees) + '원</small>' : ''))
      + '</div>'
      + '<div class="mk-note">' + (a.closing ? '시즌 종료 · 최종 순위 집계 중'
          : (a.live ? '실시간 평가 (08:00~20:00, 시간외 포함)' : '장 마감 · 최종 체결가 기준 평가') + ' · 최종 순위는 마지막 날 20:00 평가액 기준')
      + '</div>'
      + '</div>';

    h += corpHtml(a.corpActions);

    var lots = (a.credit && a.credit.lots) || [];
    var lotRows = lots.map(function (l, i) { return l.qty > 0 || l.principal > 0 ? lotRowHtml(l, i) : ''; }).join('');
    h += '<section class="m-section"><div class="m-head"><h3>📦 보유 종목</h3><span class="m-hint">' + a.positions.length + '종목'
      + (lotRows ? ' · 신용·담보 ' + lots.filter(function (l) { return l.qty > 0 || l.principal > 0; }).length + '건' : '') + '</span></div>';
    h += lotRows;
    h += a.positions.length ? a.positions.filter(function (p) { return CODE_RE.test(p.code); }).map(function (p) {
      return '<button class="mk-pos" onclick="openStock(\'' + p.code + '\',\'' + escapeJsArg(p.name) + '\')">'
        + stockLogoHtml(p.code, p.name, null, 'sm')
        + '<span class="mk-pos-main"><span class="mk-pos-name">' + escapeHtml(p.name) + (p.halted ? ' <i class="mk-tag">정지</i>' : '')
        +   (p.price == null ? ' <i class="mk-tag">시세 없음</i>' : '') + '</span>'
        +   '<span class="mk-pos-sub">' + fmtNum(p.qty) + '주 · 평단 ' + fmtNum(p.avgPrice) + '원</span></span>'
        + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(p.value) + '원</span>'
        +   '<span class="mk-pos-pnl ' + signClass(p.pnl) + '">' + (p.pnl > 0 ? '+' : '') + fmtNum(p.pnl) + '원 (' + fmtRate(p.pnlRate) + ')</span></span>'
        + '</button>';
    }).join('') : (lotRows ? '' : '<div class="empty">보유 종목이 없습니다.<br>시세 탭에서 종목을 선택해 매수할 수 있습니다.</div>');
    h += '</section>';

    // 미체결 주문은 보유 종목 바로 아래 — 방금 낸 주문을 보유와 함께 본다
    if (a.openOrders.length) {
      h += '<section class="m-section"><div class="m-head"><h3>⏳ 미체결 주문</h3><span class="m-hint">' + a.openOrders.length + '건</span></div>'
        + a.openOrders.map(orderRowHtml).join('') + '</section>';
    }

    h += creditHtml(a);

    h += reviewSectionHtml();

    h += '<section class="m-section"><div class="m-head"><h3>🧾 체결 내역</h3>'
      + '<button class="mini-btn" onclick="Mock.loadHistory(true)">불러오기</button></div>'
      + '<div id="mkHistory"></div></section>'
      + '<div class="disclaimer">⚠️ 가상 자금 모의투자이며 투자 권유가 아닙니다. 체결가는 네이버 증권 시세 기준(정규장 KRX · 시간외 NXT/KRX), '
      + '체결 판정은 최대 1분 지연될 수 있습니다. 최종 순위는 마지막 날 20:00 평가액 기준 · 수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2)
      + '%(ETF·ETN 면제). <button class="mk-link" onclick="Mock.joinStep2(true)">규칙 전체 보기</button></div>'
      ;
    paint(el, h);
    renderAttend();
    if (_attFor !== s.id || Date.now() - _attAt > 300000) loadAttend(s.id);
    // 계좌 탭은 10초마다 다시 그려진다 — 평가가 없는 회원도 매번 GET /review 를 부르지 않게, 받아 봤으면 그 결과로 그린다.
    // 시즌이 바뀌었거나 10분이 지났으면(남은 횟수가 날짜 따라 바뀐다) 다시 받는다
    if (_reviewFor === s.id && Date.now() - _reviewAt < 600000) renderReview();
    else loadReview(s.id);
  }

  /* ===== 결제·미수·신용·담보대출 =====
   * 규칙은 워커(credit.js, 키움증권 기준)가 정하고 계좌 응답의 credit.rules 로 내려준다. 화면은 보여 주고 요청만 한다.
   * 시즌 credit_mode 가 켜진 회원(creditOn)이거나, 이미 빚·미수가 있는 계좌에만 보인다.
   */
  function cr() { return account && account.credit; }
  function creditOnNow() { var c = cr(); return !!(c && c.on); }
  function lotsOf(code) { var c = cr(); return c ? c.lots.filter(function (l) { return l.code === code && l.qty > 0; }) : []; }
  function hasAny(code) { return !!holding(code) || lotsOf(code).length > 0; }
  function pctTxt(r) { return (Math.round(r * 1000) / 10) + '%'; }
  /** 기산일부터 endYmd 까지의 총이자 — credit.js interestTotal 과 같은 식 (소급법: 총 일수의 구간 이율을 전체에, 원 미만 절사) */
  function interestTo(l, principal, endYmd) {
    var ms = function (y) { return Date.UTC(+y.slice(0, 4), +y.slice(4, 6) - 1, +y.slice(6, 8)); };
    var days = Math.max(0, Math.round((ms(endYmd) - ms(l.startYmd)) / 864e5));
    if (!days || principal <= 0) return 0;
    var rate = l.rate, R = (cr() && cr().rules) || {};
    if (l.kind === 'credit') {
      var b = (R.creditBrackets || []).filter(function (x) { return x.upto == null || days <= x.upto; })[0];
      if (b) rate = b.rate;
    }
    var y = +endYmd.slice(0, 4), yd = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
    return Math.floor(principal * rate * days / yd + 1e-6);
  }
  function lotLabel(l) { return (l.kind === 'credit' ? '신용' : '담보') + ' ' + md(l.startYmd); }
  /** 시즌 신용 규칙 (참가 직후 잠금 · 막판 신규 금지 · 만기 당김) — 참가 안내와 규칙 설명에 같이 쓴다 */
  function seasonCreditRuleTxt(sr) {
    if (!sr) return '';
    var parts = [];
    if (sr.unlockDays) parts.push('참가 후 ' + sr.unlockDays + '거래일이 지나야 미수 · 신용 · 대출을 쓸 수 있습니다');
    if (sr.cutoffYmd) parts.push('시즌 마지막 ' + sr.cutoffDays + '거래일(' + md(sr.cutoffYmd) + '부터)에는 새로 빌릴 수 없습니다');
    if (sr.dueCapYmd) parts.push('신용 · 대출 만기는 ' + md(sr.dueCapYmd) + '(종료 ' + sr.dueDays + '거래일 전)로 당겨지고 다음 거래일 아침 자동상환됩니다');
    return parts.length ? parts.join('. ') + '.' : '';
  }

  function creditActive(a) {
    var c = a.credit, st = a.settle;
    if (!c || !st) return false;
    return c.on || c.debt > 0 || st.misu > 0 || a.cash < 0 || (c.calls && c.calls.length > 0);
  }

  /** 반대매매·담보부족·미수 알림 한 줄 */
  function callLine(c) {
    var amt = won(c.amount);
    if (c.kind === 'misu') {
      if (c.status === 'covered') return '<div class="mk-alert warn">미수금 <b>' + amt + '</b> · 결제 전 매도대금으로 갚아집니다 · 연체이자 연 9.7%</div>';
      if (c.status === 'ordered') return '<div class="mk-alert bad">미수 반대매매 주문 · ' + md(c.dueYmd) + ' 09:00 시가 · 미수금 ' + amt + '</div>';
      return '<div class="mk-alert bad">미수금 <b>' + amt + '</b> · ' + md(c.dueYmd) + ' 09:00 시가에 반대매매됩니다 (수수료 0.3%)</div>';
    }
    if (c.kind === 'collateral') {
      var r = c.ratio != null ? ' ' + pctTxt(c.ratio) : '';
      if (c.status === 'open') return '<div class="mk-alert bad">담보비율' + r + ' · 140% 미만 · 부족액 <b>' + amt + '</b> · 다음 거래일 종가 기준으로도 부족하면 그다음 거래일 09:00 시가에 반대매매됩니다</div>';
      if (c.status === 'due') return '<div class="mk-alert bad">담보부족 · ' + md(c.dueYmd) + ' 09:00 시가에 반대매매됩니다 (부족액 ' + amt + ')</div>';
      return '<div class="mk-alert bad">담보부족 반대매매 주문 · 09:00 시가</div>';
    }
    if (c.kind === 'expiry') return '<div class="mk-alert warn">대출 만기 · ' + md(c.dueYmd) + ' 아침 주문가능현금으로 자동상환하고, 모자라면 반대매매됩니다</div>';
    return '';
  }

  function creditHtml(a) {
    if (!creditActive(a)) return '';
    var c = a.credit, st = a.settle, R = c.rules || {};
    var h = '<div class="mk-card mk-credit">'
      + '<div class="mk-sum-head"><span>💳 예수금 · 신용</span><span>' + InfoTip.btn('결제·신용 규칙', [
          '· 주식은 체결일 포함 3영업일째(T+2)에 결제됩니다. 매도대금은 결제 전이라도 바로 다시 매수할 수 있습니다 (결제 전에 산 주식을 되판 대금은 증거금률만큼만).',
          '· 증거금률 "종목별": 대부분 종목 ' + pctTxt(R.stockMarginRate || 0.4) + '만 현금으로 내고 나머지는 결제일까지 외상입니다 (레버리지·인버스·ETN·정리매매 100%). 결제일에 예수금이 모자라면 미수금입니다.',
          '· 미수금은 결제일 23:30까지 못 갚으면 다음 거래일 09:00 시가에 반대매매됩니다. 10만 원이 넘으면 30일간 증거금 100%(미수동결). 연체이자 연 9.7%.',
          '· 신용매수: 보증금 ' + pctTxt(R.creditDepositRate || 0.45) + '(현금), 나머지는 결제일에 융자 · 기간 ' + (R.creditTermDays || 180) + '일 · 이자 7일 이하 5.4% / 15일 이하 7.7% / 90일 이하 8.5% / 90일 초과 9.1% (보유기간 전체에 적용) · 매월 첫 영업일에 전월분 이자 출금',
          '· 증권담보대출: 결제된 주식을 담보로 전일종가의 ' + pctTxt(R.loanLtv || 0.7) + ' · 연 ' + ((R.loanRate || 0.0865) * 100).toFixed(2) + '% · ' + (R.loanTermDays || 180) + '일 · 매월 첫 영업일에 전월분 이자 출금',
          '· 담보비율(신용·대출 합산)이 장 마감 종가 기준 140% 아래면 추가담보를 요구합니다. 다음 거래일 종가 기준으로도 부족하면 그다음 거래일 09:00 시가에 반대매매됩니다.',
          '· 순위와 순자산은 빌린 돈(원금)과 쌓인 이자를 뺀 금액입니다.'
        ].concat(seasonCreditRuleTxt(R) ? ['· 시즌 규칙: ' + seasonCreditRuleTxt(R)] : []).join('\n'), 'sm') + '</span></div>';
    (c.calls || []).forEach(function (x) { h += callLine(x); });
    if (c.on && c.gate) h += '<div class="mk-alert warn">🔒 ' + escapeHtml(c.gate.msg) + '</div>';
    if (c.frozenUntil) h += '<div class="mk-alert warn">🔒 미수동결 · ' + md(c.frozenUntil) + '까지 증거금 100%로만 매수할 수 있습니다</div>';
    h += '<div class="mk-grid mk-grid3">'
      + cell('예수금', won(st.d0))
      + cell('D+1 (' + md(st.d1Ymd) + ')', '<span class="' + (st.d1 < 0 ? 'down' : '') + '">' + won(st.d1) + '</span>')
      + cell('D+2 (' + md(st.d2Ymd) + ')', '<span class="' + (st.d2 < 0 ? 'down' : '') + '">' + won(st.d2) + '</span>')
      + '</div><div class="mk-grid">'
      + cell('미수금', st.misu > 0 ? '<span class="down">' + won(st.misu) + '</span>' : '0원')
      + cell('주문가능현금', won(a.available))
      + (c.creditPrincipal || c.on ? cell('신용융자', won(c.creditPrincipal)) : '')
      + (c.loanPrincipal || c.on ? cell('담보대출', won(c.loanPrincipal)) : '')
      + (c.debt ? cell('쌓인 이자', won(c.accrued) + '<small class="mk-cell-sub">낸 이자 ' + won(c.interestPaid) + '</small>') : '')
      + (c.collateral ? cell('담보비율', '<span class="' + (c.collateral.ratio < 140 ? 'down' : '') + '">' + Math.round(c.collateral.ratio) + '%</span>'
          + '<small class="mk-cell-sub">140% 미만이면 추가담보 요구 · 지금 시세 기준</small>') : '')
      + '</div>';
    if (c.on) {
      var m = c.marginMode === 'spectrum';
      h += '<div class="mk-field mk-cr-mode"><span>증거금률</span><div class="seg-row sub mk-seg2" role="group" aria-label="계좌 증거금률">'
        + '<button class="seg' + (!m ? ' on' : '') + '" aria-pressed="' + !m + '" onclick="Mock.setMarginMode(\'cash\', this)">100% (현금)</button>'
        + '<button class="seg' + (m ? ' on' : '') + (c.gate && !m ? ' mk-locked' : '') + '" aria-pressed="' + m + '" onclick="Mock.setMarginMode(\'spectrum\', this)">' + (c.gate && !m ? '🔒 ' : '') + '종목별 (미수)</button>'
        + '</div></div>'
        // 잠금 중에는 "종목별" 계좌도 서버가 증거금 100% 로 받는다 — 40% 라고 안내하면 틀린 말이 된다
        + '<div class="mk-note" style="margin-top:4px">' + (m && c.gate
          ? '🔒 ' + (c.gate.code === 'credit_closing' ? '시즌 마지막 ' + (R.cutoffDays || 10) + '거래일이라' : md(c.gate.until) + ' 전까지는') + ' 새 매수에도 증거금 100%가 적용됩니다.'
          : m ? '대부분 종목을 ' + pctTxt(R.stockMarginRate || 0.4) + ' 증거금으로 매수합니다. 결제일(D+2)까지 부족분을 채우지 못하면 미수 → 반대매매.' : '새로 사는 주문은 예수금 안에서만 매수합니다. 이미 "종목별"로 산 주식의 외상분은 결제일에 빠져나가니 D+2 예수금을 함께 확인하세요. 신용매수는 주문창에서 고릅니다.') + '</div>'
        // 잠긴 동안에도 눌리게 둔다 — disabled 는 아무 반응이 없어 고장처럼 보였다. 누르면 언제부터 되는지 알려 준다
        + '<div class="mk-cr-btns"><button class="mini-btn' + (c.gate ? ' mk-locked' : '') + '" onclick="Mock.openLoan()"' + (c.gate ? ' aria-disabled="true"' : '') + '>' + (c.gate ? '🔒 ' : '') + '증권담보대출</button>'
        + '<button class="mini-btn" onclick="Mock.loadLedger()">대출·이자 내역</button></div>';
    } else {
      h += '<div class="mk-cr-btns"><button class="mini-btn" onclick="Mock.loadLedger()">대출·이자 내역</button></div>';
    }
    h += '<div id="mkLedger"></div></div>';
    return h;
  }

  /** 보유 종목 목록의 신용·담보 잔고 줄 */
  function lotRowHtml(l, i) {
    return '<div class="mk-pos mk-lot">'
      + '<button class="mk-lot-open" onclick="openStock(\'' + l.code + '\',\'' + escapeJsArg(l.name) + '\')">'
      + stockLogoHtml(l.code, l.name, null, 'sm')
      + '<span class="mk-pos-main"><span class="mk-pos-name"><i class="mk-tag ' + (l.kind === 'credit' ? 'cr' : 'ln') + '">' + (l.kind === 'credit' ? '신용' : '담보') + '</i> ' + escapeHtml(l.name)
      +   (l.halted ? ' <i class="mk-tag">정지</i>' : '') + '</span>'
      +   '<span class="mk-pos-sub">' + fmtNum(l.qty) + '주 · 평단 ' + fmtNum(l.avgPrice) + '원 · ' + (l.kind === 'credit' ? '융자' : '대출') + ' ' + fmtCompact(l.principal) + '원</span>'
      +   '<span class="mk-pos-sub">' + md(l.startYmd) + ' ' + (l.executed ? '실행' : '실행 예정') + ' · 만기 ' + md(l.dueYmd) + ' · ' + (l.rate * 100).toFixed(2) + '% · 이자 ' + fmtNum(l.accrued) + '원</span></span>'
      + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(l.value) + '원</span>'
      +   '<span class="mk-pos-pnl ' + signClass(l.pnl) + '">' + (l.pnl > 0 ? '+' : '') + fmtNum(l.pnl) + '원 (' + fmtRate(l.pnlRate) + ')</span></span>'
      + '</button>'
      + (l.executed ? '<button class="mini-btn mk-lot-repay" onclick="Mock.repayLot(' + i + ', this)">현금상환</button>' : '')
      + '</div>';
  }

  async function setMarginMode(mode, btn) {
    var c = cr();
    if (mode === 'spectrum' && c && c.gate && c.marginMode !== 'spectrum') { toast(c.gate.msg, ''); return; }
    if (btn) btn.disabled = true;
    try {
      await api('/margin-mode', 'POST', { mode: mode });
      toast(mode === 'spectrum' ? '증거금률: 종목별 (새 주문부터)' : '증거금률: 100% (새 주문부터)', '');
    } catch (e) { alert(e.message); }
    await refreshAccount();
  }

  async function repayLot(i, btn) {
    var c = cr(); var l = c && c.lots[i];
    if (!l) return;
    // 서버는 매도 주문 중인 수량을 빼고 나머지만 상환한다 — 확인창도 그 수량·원금으로 보여 준다
    var pend = (account.openOrders || []).filter(function (o) { return o.side === 'sell' && o.lotId === l.id; })
      .reduce(function (t, o) { return t + (o.qty - o.filledQty); }, 0);
    var free = l.qty > 0 ? l.qty - pend : 0;
    if (l.qty > 0 && free <= 0) { alert('매도 주문 중인 수량만 남아 현금상환할 수 없습니다'); return; }
    var part = l.qty > 0 ? free / l.qty : 1;
    var pr = Math.round(l.principal * part), it = Math.round(l.accrued * part);
    var total = pr + it;
    if (!confirm(l.name + ' ' + lotLabel(l) + ' ' + fmtNum(free) + '주를 현금상환할까요?' + (pend ? ' (매도 주문 중 ' + fmtNum(pend) + '주 제외)' : '')
      + '\n원금 ' + fmtNum(pr) + '원 + 이자 약 ' + fmtNum(it) + '원 = 약 ' + fmtNum(total) + '원이 예수금에서 나갑니다.\n상환한 주식은 현금 보유로 바뀝니다.')) return;
    if (btn) btn.disabled = true;
    try {
      var r = await api('/lots/' + encodeURIComponent(l.id) + '/repay', 'POST', {});
      toast(l.name + ' 현금상환 · 원금 ' + fmtNum(r.principal) + '원 · 이자 ' + fmtNum(r.interest) + '원', '');
    } catch (e) { alert(e.message); }
    await refreshAccount();
  }

  var LEDGER_KIND = { loan_in: '대출 입금', repay: '현금상환', interest: '이자', overdue_fee: '미수 연체이자' };
  var CALL_KIND = { misu: '미수', collateral: '담보부족', expiry: '만기' };
  var CALL_STATUS = { open: '추가담보 요구', due: '반대매매 예정', ordered: '반대매매 주문', covered: '매도대금으로 충당', resolved: '해소' };
  async function loadLedger() {
    var el = document.getElementById('mkLedger');
    if (!el) return;
    el.innerHTML = '<div class="loading">불러오는 중</div>';
    try {
      var d = await api('/ledger');
      var rows = (d.events || []).map(function (e) {
        var det = e.detail || {};
        return '<div class="mk-led"><span>' + escapeHtml(kstHM(e.at)) + '</span><span>' + (LEDGER_KIND[e.kind] || e.kind)
          + (det.name ? ' · ' + escapeHtml(det.name) : '') + (det.interest ? ' <i class="mk-dim">(이자 ' + fmtNum(det.interest) + ')</i>' : '') + '</span>'
          + '<b class="' + signClass(e.amount) + '">' + (e.amount > 0 ? '+' : '') + fmtNum(e.amount) + '원</b></div>';
      }).concat((d.calls || []).map(function (c) {
        return '<div class="mk-led"><span>' + md(c.ymd.slice(0, 8)) + '</span><span>' + (CALL_KIND[c.kind] || c.kind) + ' · ' + (CALL_STATUS[c.status] || c.status)
          + (c.ratio ? ' · ' + pctTxt(c.ratio) : '') + '</span><b>' + fmtNum(c.amount) + '원</b></div>';
      }));
      el.innerHTML = rows.length ? '<div class="mk-ledger">' + rows.join('') + '</div>' : '<div class="empty">대출·이자 내역이 없습니다</div>';
    } catch (e) { el.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>'; }
  }

  /* ----- 증권담보대출 (보조 창) ----- */
  function openLoan() {
    if (!account || !creditOnNow()) return;
    if (cr().gate) { toast(cr().gate.msg, ''); return; }
    var opts = account.positions.filter(function (p) { return pledgeable(p) > 0 && CODE_RE.test(p.code); });
    closeSheet();
    var first = opts[0];
    aux = { kind: 'loan', code: first ? first.code : '', qty: first ? pledgeable(first) : '', amount: '', rem: first ? pledgeable(first) : 0, busy: false, cid: null };
    renderAux();
  }
  /** 담보로 잡을 수 있는 수량 — 서버와 같이 결제된 수량에서 매도 주문 중인 수량을 뺀다 */
  function pledgeable(p) {
    var pend = (account.openOrders || []).filter(function (o) { return o.code === p.code && o.side === 'sell' && !o.lotId; })
      .reduce(function (t, o) { return t + (o.qty - o.filledQty); }, 0);
    return Math.max(0, (p.settledQty || 0) - pend);
  }
  function loanPos() { return account && account.positions.filter(function (p) { return p.code === aux.code; })[0]; }
  function loanLimit() {
    var p = loanPos(), R = (cr() && cr().rules) || {};
    var q = Math.floor(Number(aux.qty)) || 0;
    if (!p || !p.prevClose || !q) return 0;
    return Math.floor(q * p.prevClose * (R.loanLtv || 0.7) / (R.loanUnit || 10000)) * (R.loanUnit || 10000);
  }
  function loanHtml() {
    var opts = account.positions.filter(function (p) { return pledgeable(p) > 0 && CODE_RE.test(p.code); });
    var R = (cr() && cr().rules) || {};
    if (!opts.length) {
      return auxHead('증권담보대출') + '<div class="empty">담보로 잡을 수 있는 주식이 없습니다.<br>결제(체결 후 2영업일)가 끝난 현금 보유 주식만 담보가 됩니다.</div>';
    }
    return auxHead('증권담보대출')
      + '<div class="mk-info">결제된 주식을 담보로 전일종가의 <b>' + pctTxt(R.loanLtv || 0.7) + '</b>까지 · 연 <b>' + ((R.loanRate || 0.0865) * 100).toFixed(2) + '%</b> · ' + (R.loanTermDays || 180) + '일 · 대출금은 바로 예수금에 들어옵니다</div>'
      + '<div class="mk-field"><span>담보 종목</span><select class="f-input" onchange="Mock.auxSel(\'code\', this)" aria-label="담보 종목">'
      + opts.map(function (p) { return '<option value="' + p.code + '"' + (p.code === aux.code ? ' selected' : '') + '>' + escapeHtml(p.name) + ' · 담보 가능 ' + fmtNum(pledgeable(p)) + '주</option>'; }).join('')
      + '</select></div>'
      + '<div class="mk-field"><span>담보 수량</span>' + stepperHtml('qty', aux.qty, '주', '담보 수량') + '</div>'
      + '<div class="mk-field"><span>대출 금액</span>' + stepperHtml('amount', aux.amount, '원', '대출 금액', '10만 원 이상, 1만 원 단위') + '</div>'
      + '<div class="mk-pct"><button type="button" class="mini-btn" onclick="Mock.auxSet(\'amount\', \'max\')">한도까지</button><span class="mk-dim" id="mkLoanLimit"></span></div>'
      + '<div class="mk-calc" id="mkAuxCalc"></div>'
      + '<div class="mk-help">담보로 잡은 주식은 "담보" 잔고로 옮겨집니다. 팔면 매도대금으로 먼저 대출을 갚고(매도상환), 계좌 탭에서 현금상환할 수 있습니다.</div>'
      + '<div class="mk-sheet-msg" id="mkAuxMsg" role="alert"></div>'
      + '<button class="mk-submit buy" id="mkAuxGo" onclick="Mock.auxSubmit()">대출 받기</button>';
  }
  function loanParts() {
    var lim = loanLimit(), p = loanPos(), R = (cr() && cr().rules) || {};
    var el = document.getElementById('mkLoanLimit');
    if (el) el.textContent = '한도 ' + fmtNum(lim) + '원';
    var box = document.getElementById('mkAuxCalc');
    if (!box) return;
    var amt = Math.floor(Number(aux.amount)) || 0;
    box.innerHTML = row('전일종가', p && p.prevClose ? won(p.prevClose) : '-')
      + row('대출 한도', won(lim))
      + row('하루 이자 (약)', won(Math.floor(amt * (R.loanRate || 0.0865) / 365)))
      + row('대출 후 예수금', won(((account.settle && account.settle.d0 != null) ? account.settle.d0 : (account.cash || 0)) + amt));
  }
  async function loanSubmit() {
    var a = aux, qty = Math.floor(Number(a.qty)) || 0, amt = Math.floor(Number(a.amount)) || 0, R = (cr() && cr().rules) || {};
    if (!a.code) return auxMsg('담보 종목을 고르세요', 'err');
    if (qty <= 0) return auxMsg('담보 수량을 입력하세요', 'err');
    if (amt < (R.loanMin || 100000) || amt % (R.loanUnit || 10000)) return auxMsg('대출 금액은 10만 원 이상, 1만 원 단위입니다', 'err');
    if (amt > loanLimit()) return auxMsg('한도(' + fmtNum(loanLimit()) + '원)를 넘습니다', 'err');
    setAuxBusy(true, '대출 신청 중');
    try {
      var r = await api('/loans', 'POST', { code: a.code, qty: qty, amount: amt });
      if (aux === a) closeAux();
      toast('증권담보대출 ' + fmtNum(r.amount) + '원 입금 · 담보 ' + fmtNum(r.qty) + '주', '');
    } catch (e) {
      if (aux !== a) return;
      setAuxBusy(false);
      auxMsg(e.message, 'err');
    } finally { refreshAccount(); }
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

  function ordTags(o) {
    if (o.forced) return '<i class="mk-tag bad">반대매매</i> ';
    if (o.credit === 'buy') return '<i class="mk-tag cr">신용</i> ';
    if (o.lotId) return '<i class="mk-tag cr">상환</i> ';
    return '';
  }
  function orderRowHtml(o) {
    var sideTxt = o.side === 'buy' ? '매수' : '매도';
    var okId = UUID_RE.test(String(o.id || ''));      // onclick 에 넣기 전에 모양을 확인한다
    return '<div class="mk-ord">'
      + '<span class="mk-side ' + (o.side === 'buy' ? 'buy' : 'sell') + '">' + sideTxt + '</span>'
      // 종목을 누르면 종목 화면으로 (정정·취소 버튼은 따로)
      + (CODE_RE.test(o.code) ? '<button type="button" class="mk-ord-main mk-ord-open" onclick="openStock(\'' + o.code + '\',\'' + escapeJsArg(o.name) + '\')">' : '<span class="mk-ord-main">')
      +   '<span class="mk-pos-name">' + ordTags(o) + escapeHtml(o.name) + '</span>'
      +   '<span class="mk-pos-sub">' + (o.type === 'market' ? '시장가' : '지정가 ' + fmtNum(o.limitPrice) + '원')
      +   ' · ' + fmtNum(o.filledQty) + '/' + fmtNum(o.qty) + '주' + (o.forced ? ' · ' + escapeHtml(o.reason || '반대매매') + ' · 09:00 시가' : '') + '</span>'
      + (CODE_RE.test(o.code) ? '</button>' : '</span>')
      + (okId && !o.forced
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
      +   escapeHtml(s.endDate) + ' 20:00 기준 <b>최종 자산</b>으로 순위를 가립니다.</p>'
      + '<ul class="mk-rules">'
      +   '<li>국내 상장 주식 · ETF(레버리지 · 인버스 포함) · ETN 모두 거래할 수 있습니다 (거래정지 종목 제외)</li>'
      +   '<li>정규장 08:30~15:30 지정가 · 시장가 / 시간외 08:00~08:30 · 15:40~20:00 지정가만 (ETF · ETN 은 시간외 불가)</li>'
      +   '<li>체결가는 네이버 증권 시세 기준 — 정규장은 KRX, 시간외는 NXT · KRX 시간외 가격</li>'
      +   '<li>수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2) + '% (ETF · ETN 면제)</li>'
      +   '<li>주문 뒤에 실제로 거래된 가격 · 수량 안에서만 체결됩니다 (판정은 최대 1분 간격)</li>'
      +   '<li>참가자 ' + fmtNum(season.participants) + '명 · 시즌마다 초기화 · 최종 순위는 ' + escapeHtml(s.endDate) + ' 20:00 평가액 기준</li>'
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
    // 제목 옆 ! 설명 버튼은 건너뛴다 — 포커스를 받으면 설명이 펼쳐져, 창을 열 때마다 주문 규칙이 떠 있었다
    var first = dlg.querySelector('input:not([disabled]), textarea, button:not([disabled]):not([aria-label="닫기"]):not(.info-tip)');
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
      +   '<b>' + escapeHtml(s.endDate) + '</b> 20:00 기준 최종 자산으로 순위를 가립니다.</p>'
      + '<div class="mk-grid">'
      +   cell('기간', escapeHtml(s.startDate) + ' ~ ' + escapeHtml(s.endDate))
      +   cell('현재 참가자', fmtNum(season.participants) + '명')
      + '</div>'
      + '<div class="mk-jf-btns"><button class="btn-ghost" onclick="Mock.closeJoin()">나중에</button>'
      + '<button class="btn-submit" onclick="Mock.joinStep2()">참여하기</button></div>');
  }

  // view: 이미 참가한 회원이 계좌 화면에서 규칙만 다시 볼 때 (닉네임·동의·참가 버튼 없이 닫기만)
  function joinStep2(view) {
    if (!season || !season.season) return;
    view = view === true;
    var s = season.season;
    var li = function (arr) { return '<ul class="mk-rules">' + arr.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>'; };
    var body =
        (view ? '<h3 class="mk-jf-title">' + escapeHtml(s.name) + ' 규칙</h3>'
          : '<div class="mk-jf-step">2 / 2</div>' + '<h3 class="mk-jf-title">참여 전에 확인해 주세요</h3>')
      + (s.notice ? '<div class="mk-jf-h">📢 전달사항</div><div class="mk-jf-notice">' + escapeHtml(s.notice) + '</div>' : '')
      + '<div class="mk-jf-h">⚠️ 주의사항</div>'
      + li([
          '<b>가상의 자금</b>입니다. 실제 돈과 무관하며 현금·포인트·상품 등 어떤 것으로도 교환되지 않습니다.',
          '실제 매매·투자 권유가 아닙니다. 모의 결과는 실제 투자 성과와 다를 수 있습니다.',
          '시세는 네이버 증권 기준입니다. 정규장은 KRX 가격, 프리 · 애프터마켓은 NXT · KRX 시간외 가격을 따르며 지연 · 오류가 있을 수 있습니다. 시세 제공 오류로 인한 체결은 확인 후 정정 또는 취소될 수 있습니다.',
          '체결은 실제 호가창이 아니라 <b>주문 뒤에 실제로 거래된 가격 · 수량</b>으로 판정합니다. 판정은 최대 1분 간격이라 실제보다 늦게 체결이 표시될 수 있고, 시장가는 판정 시점의 현재가로 체결되어 호가 스프레드 · 잔량 · VI 는 반영되지 않습니다.',
          '주문은 거래일(주말 · 휴장일 제외)에만 접수됩니다. 액면분할 · 병합 · 무상증자는 보유 수량에, 유상증자 권리락은 현금으로 자동 반영됩니다. 현금배당은 반영되지 않습니다.',
          '순위표에 <b>닉네임 · 총자산 · 수익률 · 주문 건수</b>' + (s.creditOn ? '와 신용 · 미수 · 대출 사용 여부' : '') + '가 회원들에게 공개됩니다. 실명과 보유 종목은 공개되지 않습니다. 종목별 보유 인원 · 평균 수익률은 3명 이상일 때 이름 없이 합계로만 보입니다.',
          '1인 1계정입니다. 부정한 방법이 확인되면 순위에서 제외됩니다.'
        ])
      + '<div class="mk-jf-h">📌 매매 규칙</div>'
      + li([
          '시드머니 <b>' + fmtCompact(s.seed) + '원</b> · 시즌마다 초기화 · 순위는 <b>실시간</b>(시간외 가격 포함) · 일일 기록은 15:30 <b>KRX 종가</b> 기준 · 최종 순위는 ' + escapeHtml(s.endDate) + ' <b>20:00 평가액</b>(애프터마켓 가격 포함) 기준',
          '국내 상장 주식 · ETF(레버리지 · 인버스 포함) · ETN 을 <b>모두 거래할 수 있습니다</b>. 거래정지 종목과 주문이 제한된 종목만 예외입니다.',
          '정규장 08:30~15:30 지정가 · 시장가. 09:00 전 접수분은 <b>시가</b>, 15:20~15:30 접수분은 <b>종가</b>로 체결되고, 미체결은 장 마감 시 만료됩니다.',
          '시간외 08:00~08:30 프리마켓(NXT · 08:50 까지 체결) / 15:40~20:00 애프터마켓(NXT · KRX) — <b>지정가만</b>, ETF · ETN 은 시간외 불가, 미체결은 08:50 · 20:00 에 만료됩니다. 시즌 마지막 날도 20:00 애프터마켓까지 매매할 수 있습니다.',
          '지정가는 전일 종가 ±30% 안에서 호가단위에 맞게 입력합니다. 미체결 주문은 <b>정정 · 취소</b>할 수 있고, 가격을 바꾸면 대기 순서가 뒤로 갑니다.',
          '수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2) + '% (ETF · ETN 면제) — 실전과 같은 수준',
          '거래가 적은 종목은 여러 번에 나눠 체결되거나 체결되지 않을 수 있습니다.',
          '시장가 매수는 현재가 기준으로 주문 가능 금액을 잡습니다. 체결가가 올라 금액이 모자라면 살 수 있는 수량까지만 체결되고 나머지는 취소됩니다.',
          '거래일마다 <b>출석</b>하면 10만 원, 5일 연속마다 보너스 20만 원이 현금으로 들어옵니다. 순위는 총자산 기준이고, 출석금은 원금에 더해져 수익률에는 들어가지 않습니다.',
          s.creditOn
            ? '결제는 실제와 같이 <b>T+2</b>입니다. 계좌 증거금률을 "종목별"로 바꾸면 <b>미수</b>(대부분 40% 증거금)를 쓸 수 있고, <b>신용매수</b>(보증금 45%) · <b>증권담보대출</b>(전일종가 70%)도 됩니다. 이자 · 연체이자 · 담보비율 140% · 반대매매 규칙은 키움증권 기준입니다. 순위는 빌린 돈을 뺀 순자산 기준입니다. 공매도는 없습니다.'
              + (seasonCreditRuleTxt(s.creditRules) ? ' ' + seasonCreditRuleTxt(s.creditRules) : '')
            : '신용 · 미수 · 공매도는 없습니다.'
        ])
      ;
    if (view) { joinShell(body + '<div class="mk-jf-btns"><button class="btn-submit" onclick="Mock.closeJoin()">닫기</button></div>'); return; }
    joinShell(body
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
      // 주문별로 묶어서 받는다 — 한 주문이 여러 번에 나눠 체결되면 평균가·총수량 한 줄 (누르면 체결 건별로 펼친다)
      var d = await api('/history?by=order' + (histNext ? '&before=' + histNext : ''));
      var rows = d.items.map(histOrderHtml).join('');
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

  /** 줄바꿈은 ' · ' 사이에서만 — 숫자 중간에서 끊기지 않게 */
  function nwJoin(parts) { return parts.map(function (p) { return '<span class="nw">' + p + '</span>'; }).join(' · '); }
  /** 오늘 체결이면 시각만, 지난 날이면 날짜도 */
  function histWhen(ms) {
    var full = kstHM(ms), today = kstHM(Date.now());
    return escapeHtml(full.split(' ')[0] === today.split(' ')[0] ? hmOf(ms) : full);
  }
  /** 주문 한 줄 — 체결 수량·평균가와 미체결(대기·취소·만료) 수량을 따로 */
  function histOrderHtml(o) {
    var okId = UUID_RE.test(String(o.orderId || ''));
    var left = o.qty - o.fillQty;
    var leftTxt = left > 0
      ? ' · <span class="mk-hist-left nw">미체결 ' + fmtNum(left) + '주' + (o.status === 'open' || o.status === 'partial' ? ' 대기' : o.status === 'cancelled' ? ' 취소' : o.status === 'expired' ? ' 만료' : '') + '</span>'
      : '';
    var multi = o.fills > 1 && okId;
    return '<div class="mk-hist' + (multi ? ' multi' : '') + '" id="mkh-' + (okId ? o.orderId : '') + '">'
      + '<div class="mk-ord"' + (multi ? ' role="button" tabindex="0" aria-expanded="false" onclick="Mock.toggleFills(\'' + o.orderId + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();Mock.toggleFills(\'' + o.orderId + '\')}"' : '') + '>'
      + '<span class="mk-side ' + (o.side === 'buy' ? 'buy' : 'sell') + '">' + (o.side === 'buy' ? '매수' : '매도') + '</span>'
      + stockLogoHtml(o.code, o.name, null, 'sm')
      // 가운데: 이름 / 수량·가격 / 비용·결제·미체결 — 오른쪽은 금액(과 펼치기)만 두어 좁은 화면에서 가운데가 눌리지 않게
      + '<span class="mk-ord-main"><span class="mk-pos-name">' + histTags(o) + escapeHtml(o.name) + '</span>'
      +   '<span class="mk-pos-sub">' + nwJoin([histWhen(o.lastAt), fmtNum(o.fillQty) + '주 × ' + (o.fills > 1 ? '평균 ' : '') + fmtNum(o.avgPrice) + '원']) + leftTxt + '</span>'
      +   '<span class="mk-pos-sub mk-hist-cost">' + nwJoin(costText(o).split(' · ').concat(o.settleYmd ? ['결제 ' + md(o.settleYmd)] : [])) + '</span></span>'
      + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(o.amount) + '원</span>'
      +   (multi ? '<span class="mk-pos-sub mk-hist-more">' + fmtNum(o.fills) + '건 ▾</span>' : '') + '</span>'
      + '</div><div class="mk-hist-fills" hidden></div></div>';
  }
  /** 여러 번에 나눠 체결된 주문 — 체결 건별로 펼친다 (처음 펼칠 때 한 번 받는다) */
  async function toggleFills(orderId, aiBot) {
    if (!UUID_RE.test(String(orderId))) return;
    var box = document.getElementById('mkh-' + orderId);
    if (!box) return;
    var list = box.querySelector('.mk-hist-fills'), head = box.querySelector('.mk-ord'), more = box.querySelector('.mk-hist-more');
    var open = list.hidden;
    list.hidden = !open;
    if (head) head.setAttribute('aria-expanded', String(open));
    if (more) more.textContent = more.textContent.replace(open ? '▾' : '▴', open ? '▴' : '▾');
    if (!open || list.dataset.loaded) return;
    list.innerHTML = '<div class="mk-hist-fill loading">불러오는 중</div>';
    try {
      // AI 계좌 체결은 AI 리그 쪽에서 받는다 (회원 계좌 API 는 내 주문만 준다)
      var d = await api((aiBot ? '/ai/history/fills?bot=' + encodeURIComponent(aiBot) + '&' : '/history/fills?') + 'order=' + encodeURIComponent(orderId));
      list.innerHTML = d.items.map(function (f, i) {
        return '<div class="mk-hist-fill"><span>' + (i + 1) + '</span><span>' + escapeHtml(hmOf(f.at)) + '</span>'
          + '<span>' + fmtNum(f.qty) + '주 × ' + fmtNum(f.price) + '원</span><b>' + fmtNum(f.qty * f.price) + '원</b></div>';
      }).join('');
      list.dataset.loaded = '1';
    } catch (e) { list.innerHTML = '<div class="mk-hist-fill">' + escapeHtml(e.message) + '</div>'; }
  }

  function histTags(f) {
    if (f.forced) return '<i class="mk-tag bad">반대매매</i> ';
    if (f.credit === 'buy') return '<i class="mk-tag cr">신용</i> ';
    if (f.lotKind) return '<i class="mk-tag cr">' + (f.lotKind === 'credit' ? '신용상환' : '담보상환') + '</i> ';
    return '';
  }
  /** 체결 한 건의 비용 — 매수는 수수료만, 매도는 수수료와 거래세가 따로 붙는다. 신용은 융자·상환 원금과 이자도 */
  function costText(f) {
    if (f.side === 'buy' && f.credit === 'buy' && f.loan) return '수수료 ' + fmtNum(f.fee) + '원 · 융자 ' + fmtNum(f.loan) + '원';
    if (f.side === 'buy') return '수수료 ' + fmtNum(f.fee) + '원';
    if (f.loan) return '상환 ' + fmtNum(f.loan) + '원 · 이자 ' + fmtNum(f.interest || 0) + '원 · 수수료·세금 ' + fmtNum(f.fee + f.tax) + '원';
    // 면제는 ETF·ETN 일 때만 — 소액 매도는 세금이 원 미만이라 0원이 될 뿐 면제가 아니다 (옛 워커는 taxFree 를 안 준다)
    if (!f.tax && f.taxFree) return '수수료 ' + fmtNum(f.fee) + '원 · 세금 면제';
    return '수수료 ' + fmtNum(f.fee) + '원 · 세금 ' + fmtNum(f.tax) + '원';
  }

  var _nextAskAt = 0;
  /** 다음 시즌 안내 — '2026년 4분기 · 10/1(목) 시작 · 12/31(목) 종료' (계좌·랭킹 탭 공통) */
  function nextSeasonHtml() {
    var n = season && season.next;
    if (!n) return '<p class="mk-next">다음 시즌 일정이 정해지면 여기에 표시됩니다.</p>';
    var md = function (iso) {
      var d = new Date(iso + 'T00:00:00Z');
      return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + '일월화수목금토'.charAt(d.getUTCDay()) + ')';
    };
    return '<p class="mk-next">다음 시즌 <b>' + escapeHtml(n.name) + '</b> · ' + md(n.start_date) + ' 시작'
      + (n.end_date ? ' · ' + md(n.end_date) + ' 종료' : '') + '</p>';
  }

  /* ===== 출석 보상 =====
   * 거래일 하루 1번 출석하면 현금이 들어온다 (금액·보너스는 서버가 정한다). 연속 출석 N일마다 보너스.
   * 계좌 탭은 10초마다 다시 그려지므로 받아 둔 상태로 그리고, 서버에는 5분에 한 번(또는 출석 직후)만 묻는다. */
  var _att = null, _attFor = null, _attAt = 0, _attBusy = false;
  async function loadAttend(seasonId) {
    _attFor = seasonId; _attAt = Date.now();
    try { _att = await api('/attendance'); } catch (e) { _att = { err: e.message }; }
    renderAttend();
  }
  function renderAttend() {
    var el = document.getElementById('mkAttend');
    if (!el) return;
    var t = _att;
    if (!t || t.err) { el.innerHTML = ''; return; }    // 출석은 부가 기능 — 실패해도 계좌 화면을 가리지 않는다
    var tip = escapeHtml(attendSummary(t));
    if (t.canAttend && !t.today) {
      el.innerHTML = '<button class="mk-att-chip go" onclick="Mock.attend(this)" title="' + tip + '"' + (_attBusy ? ' disabled' : '') + '>'
        + '📅 출석 +' + fmtCompact(t.amount + (t.bonusToday ? t.bonus : 0)) + '</button>';
    } else {
      // 출석했거나 휴장일 — 누르면 이번 시즌 출석 현황을 알려 준다
      el.innerHTML = '<button class="mk-att-chip' + (t.today ? ' done' : '') + '" onclick="Mock.attendInfo()" title="' + tip + '">'
        + (t.today ? '✓ 출석' : '📅 출석') + (t.streak ? ' · 연속 ' + fmtNum(t.streak) + '일' : '') + '</button>';
    }
  }
  function attendSummary(t) {
    var every = t.every || 5;
    return (t.today ? '오늘 출석 완료' : t.canAttend ? '오늘 아직 출석 전' : (!t.inSeason ? '시즌 기간이 아닙니다' : '오늘은 휴장일이라 출석 보상이 없습니다'))
      + ' · 이번 시즌 ' + fmtNum(t.days) + '일 · 받은 출석금 ' + korWon(t.total) + '원'
      + (t.bonusToday ? ' · 오늘 출석하면 보너스 +' + fmtCompact(t.bonus) + '원' : t.untilBonus ? ' · ' + t.untilBonus + '번 더 출석하면 보너스 +' + fmtCompact(t.bonus) + '원' : '')
      + '\n거래일 하루 1번 ' + fmtCompact(t.amount) + '원 · ' + every + '일 연속마다 +' + fmtCompact(t.bonus) + '원. 출석금은 원금에 더해지고 수익률에는 들어가지 않습니다.';
  }
  function attendInfo() { if (_att && !_att.err) toast(attendSummary(_att).split('\n')[0]); }
  async function attend(btn) {
    if (_attBusy) return;
    _attBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = '처리 중'; }
    try {
      var r = await api('/attendance', 'POST');
      _att = r; _attAt = Date.now();
      toast('출석 완료 · ' + fmtCompact(r.paid.amount + r.paid.bonus) + '원' + (r.paid.bonus ? ' (연속 ' + r.paid.streak + '일 보너스 포함)' : '') + '이 들어왔습니다');
      await refreshAccount();
    } catch (e) {
      if (e.code === 'done') await loadAttend(_attFor);
      else toast(e.message);
    }
    _attBusy = false;
    renderAttend();
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
          seasonId: d.season.id, equity: d.me.equity, returnRate: (d.me.equity - (d.me.principal || d.season.seed)) / (d.me.principal || d.season.seed) * 100,
          rank: d.me.rank, participants: d.rows.length, at: Date.now()
        } : null;
        renderBar();
      }
      // 시즌이 바뀌었을 때만 이전 평가를 버린다 (10초마다 버리면 계좌 탭이 매번 다시 받았다)
      if (_reviewFor && _reviewFor !== d.season.id) { _review = null; _reviewLeft = null; _reviewFor = null; }
      // 시즌이 바뀌면 이전 시즌의 순위 기억을 버린다
      if (_prevSeasonId !== d.season.id) { _prevRank = {}; _hallHtml = null; _prevSeasonId = d.season.id; }
      h += '<section class="m-section"><div class="m-head"><h3>🏆 ' + escapeHtml(d.season.name) + '</h3>'
        + '<span class="m-hint">' + (d.closing ? '시즌 종료 · 최종 순위 집계 중'
          : escapeHtml(hmOf(d.asOf)) + ' 기준 · ' + (d.live ? '장중' : '장 마감')) + '</span></div>';
      h += d.rows.length ? d.rows.map(function (r) {
        var base = r.principal || d.season.seed;         // 원금 = 시드 + 출석금
        var rr = (r.equity - base) / base * 100;
        var medal = r.rank === 1 ? '🥇' : (r.rank === 2 ? '🥈' : (r.rank === 3 ? '🥉' : r.rank));
        // 직전 갱신보다 순위가 오르내렸으면 잠깐 표시한다 (서버가 준 안정 키로 같은 회원을 잇는다)
        var k = r.key || r.nickname;
        var was = _prevRank[k], move = (was && was !== r.rank) ? (was > r.rank ? ' moved-up' : ' moved-down') : '';
        _prevRank[k] = r.rank;
        return '<div class="mk-rank' + (r.me ? ' me' : '') + move + '">'
          + '<span class="mk-rank-no">' + medal + '</span>'
          + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(r.nickname) + (r.realName ? ' <small class="mk-real" title="실명 (관리자에게만 보임)">' + escapeHtml(r.realName) + '</small>' : '') + (r.me ? ' <i class="mk-tag">나</i>' : '')
          +   (r.credit ? ' <i class="mk-tag cr" title="신용·담보대출·미수 사용 중 — 순자산은 빌린 돈을 뺀 금액">신용</i>' : '') + '</span>'
          +   '<span class="mk-pos-sub">주문 ' + fmtNum(r.orders != null ? r.orders : r.fills) + '건</span></span>'
          + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(r.equity) + '</span>'
          +   '<span class="mk-pos-pnl ' + signClass(rr) + '">' + fmtRate(rr) + '</span></span>'
          + '</div>';
      }).join('') : '<div class="empty">참가자가 없습니다.</div>';
      h += '<div class="mk-note">' + (d.closing
          ? '시즌이 끝났습니다 · 최종 순위를 집계하고 있습니다.'
          : '실시간 순위 · 장중에는 10초마다 다시 매깁니다 (시간외 가격 포함) · 최종 순위는 ' + escapeHtml(d.season.endDate) + ' 20:00 총자산(애프터마켓 가격 포함)으로 확정됩니다.')
        + '</div></section>';
    } catch (e) {
      if (seq !== _rankSeq) return;
      // 시즌이 막 끝났다 — 한 번 받아 둔 명예의 전당에 방금 끝난 시즌이 빠져 있으니 다시 받는다
      if (e.code === 'no_season' && _prevSeasonId) { _hallHtml = null; _prevSeasonId = null; }
      if (e.code !== 'no_season') h += '<div class="empty">' + escapeHtml(e.message) + '</div>';
      else {
        // 시즌이 방금 끝났으면 들고 있던 시즌 정보에 다음 시즌이 없다 — 한 번 새로 받는다
        // (순위 탭은 10초마다 돈다 — 다음 시즌이 아직 없으면 5분에 한 번만 다시 묻는다)
        if (!(season && season.next) && Date.now() - _nextAskAt > 300000) {
          _nextAskAt = Date.now();
          try { await refreshSeason(); } catch (e2) { /* 안내만 빠진다 */ }
        }
        h += '<div class="mk-card"><h3>지금은 진행 중인 시즌이 없습니다</h3>' + nextSeasonHtml() + '</div>';
      }
    }
    if (_hallHtml === null) try {
      _hallHtml = '';
      var hall = await api('/hall');
      if (hall.items.length) {
        var by = {};
        hall.items.forEach(function (r) { (by[r.season_id] = by[r.season_id] || { name: r.season_name, start: r.start_date, end: r.end_date, rows: [] }).rows.push(r); });
        // '2026-09-22' → '26.9.22'
        var ymd = function (iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[0].slice(2) + '.' + (+p[1]) + '.' + (+p[2]) : ''; };
        var info = hall.seasons || {};
        _hallHtml = '<section class="m-section"><div class="m-head"><h3>🏛 명예의 전당</h3></div>'
          + Object.keys(by).map(function (k) {
              var si = info[k] || {}, seed = by[k].rows[0].seed, me = si.me;
              return '<div class="mk-hall"><div class="mk-hall-name">' + escapeHtml(by[k].name)
                +   (by[k].start ? '<span class="mk-hall-n">' + ymd(by[k].start) + ' ~ ' + ymd(by[k].end) + '</span>' : '')
                +   (si.participants ? '<span class="mk-hall-n">' + fmtNum(si.participants) + '명 참가</span>' : '') + '</div>'
                + by[k].rows.slice(0, 3).map(function (r) {
                    return '<div class="mk-hall-row' + (r.me ? ' me' : '') + '"><span>' + (['🥇', '🥈', '🥉'][r.rank - 1] || r.rank) + ' ' + escapeHtml(r.nickname)
                      + (r.realName ? ' <small class="mk-real" title="실명 (관리자에게만 보임)">' + escapeHtml(r.realName) + '</small>' : '')
                      + (r.me ? ' <i class="mk-tag">나</i>' : '') + '</span>'
                      + '<span>' + fmtNum(r.equity) + '원 (' + fmtRate((r.equity - (r.principal || r.seed)) / (r.principal || r.seed) * 100) + ')</span></div>';
                  }).join('')
                // 1~3위 밖이면 내 최종 순위를 따로 — '5위 / 7명'
                + (me && me.rank > 3
                    ? '<div class="mk-hall-row me"><span>내 순위 <b>' + me.rank + '위</b> / ' + fmtNum(si.participants) + '명</span>'
                      + '<span>' + fmtNum(me.equity) + '원 (' + fmtRate((me.equity - (me.principal || seed)) / (me.principal || seed) * 100) + ')</span></div>'
                    : '')
                + '</div>';
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
        // 순위 화면 안에서 회원 순위 ↔ AI 리그 (AI 리그가 열렸을 때만)
        + (aiVisible() ? '<div class="seg-row sub mk-seg2 mk-rk-sub" id="rkSub" role="group" aria-label="순위 종류">'
          +   '<button type="button" class="seg" data-sub="members" onclick="Mock.rankSub(\'members\')">👥 회원</button>'
          +   '<button type="button" class="seg" data-sub="ai" onclick="Mock.rankSub(\'ai\')">🤖 AI</button></div>' : '')
        + '<div id="rkBoard" role="tabpanel"></div><div id="rkHall"></div><div id="rkShare" role="tabpanel"></div><div id="rkAi" role="tabpanel"></div>'
        + '<div id="rkNick"></div>';          // 내 닉네임 — 순위 화면 맨 아래
      applyRankView();
      loadNick();
    }
    document.getElementById('rkBoard').innerHTML = h;
    document.getElementById('rkHall').innerHTML = _hallHtml || '';
    if (fresh) loadShares(true);     // 커뮤니티를 열지 않아도 새 글 표시(점)를 위해 받아 둔다
    if (_rkView === 'board' && _rkSub === 'ai' && Date.now() - _aiAt > 30000) loadAi();     // AI 리그는 30초마다
    _rankBuilt = true;
  }

  /* ===== 닉네임 — 순위표·명예의 전당·커뮤니티에는 실명 대신 이 이름이 보인다 =====
   * 서버가 처음 부를 때 자동 닉네임('용감한 황소 27')을 만들어 둔다. 직접 바꾸면 30일 동안 다시 못 바꾼다. */
  var _nick = null, _nickEdit = false;
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
    var next = _nick.nextChangeAt ? new Date(_nick.nextChangeAt + 9 * 3600e3) : null;
    el.innerHTML = '<div class="mk-nick">'
      + '<div class="mk-nick-row"><span class="mk-nick-k">내 닉네임</span><b class="mk-nick-v">' + escapeHtml(_nick.nick) + '</b>'
      +   (_nick.auto ? '<i class="mk-nick-auto">자동</i>' : '')
      // 바꿀 수 없는 기간에도 버튼 모양은 같게 두고, 누르면 언제부터 되는지 알려 준다
      +   '<span class="mk-nick-act"><button class="mini-btn" onclick="Mock.editNick(true)">바꾸기</button></span></div>'
      + (_nickWait && next ? '<div class="mk-nick-hint" role="status">' + (next.getUTCMonth() + 1) + '/' + next.getUTCDate()
          + '부터 변경 가능합니다 (닉네임은 30일에 한 번 바꿀 수 있습니다)</div>' : '')
      + '</div>';
  }
  var _nickWait = false;
  function editNick(on) {
    if (on && _nick && !_nick.canChange) { _nickWait = true; renderNick(); return; }
    _nickWait = false; _nickEdit = !!on; renderNick();
  }
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
      if (typeof _nickMap === 'object' && currentUser) _nickMap[currentUser.uid] = _nick.nick;    // 시황 댓글의 내 이름도
      renderNick();
      loadRanking();
      if (_sh && _sh.items && _sh.items.length) loadShares(true);    // 커뮤니티 글·댓글의 이름도 새로
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
    }
  }

  /* 랭킹 탭 안의 두 화면 — 순위(순위표·명예의 전당) | 커뮤니티(계좌 공유 글). 한 번에 하나만 보인다 */
  var _rkView = 'board', _rkSub = 'members';
  function rankView(v) {
    _rkView = v === 'share' ? 'share' : 'board';
    applyRankView();
    if (_rkView === 'share') {
      markSharesSeen();
      if (_sh.who !== shareWho()) loadShares(true);      // 순위에서 고른 회원 / AI 를 커뮤니티에도 맞춘다
    }
    if (_rkView === 'board' && _rkSub === 'ai') loadAi();
  }
  /** 순위 화면 안의 회원 ↔ AI 리그 전환 */
  function rankSub(v) {
    var was = _rkSub;
    _rkSub = v === 'ai' && aiVisible() ? 'ai' : 'members';
    applyRankView();
    if (_rkView === 'share') { if (was !== _rkSub) loadShares(true); }      // 커뮤니티도 회원 글 / AI 글로 나눠 본다
    else if (_rkSub === 'ai') loadAi();
  }
  function applyRankView() {
    var share = _rkView === 'share', aiSub = _rkSub === 'ai' && aiVisible(), ai = !share && aiSub;
    document.querySelectorAll('.mk-rk-sub .seg').forEach(function (b) {
      var on = b.dataset.sub === (aiSub ? 'ai' : 'members');
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    document.querySelectorAll('.mk-rk-seg .seg').forEach(function (b) {
      var on = b.dataset.rk === _rkView;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    });
    var show = function (id, v) { var e = document.getElementById(id); if (e) e.hidden = !v; };
    show('rkBoard', !share && !ai); show('rkHall', !share && !ai); show('rkShare', share); show('rkAi', ai);
    show('rkNick', !share && !ai);   // 닉네임 바꾸기는 순위 화면에만
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

  /* ===== 랭킹 탭 · AI 리그 =====
   * 무료 모델 AI 들이 회원과 같은 규칙으로 정규장 하루 6번 판단한다 (서버 mock/ai.js). 계좌·보유·주문·판단 이유가 전부 공개된다.
   * 시험 모드(ai_mode=admin)에서는 관리자에게만 보인다. 회원 순위표에는 AI 가 들어가지 않는다. */
  var _ai = null, _aiAt = 0, _aiOpen = {}, _aiBusy = false, _aiPrev = {}, _aiMore = {}, _aiMoreLeft = {}, _aiHist = {};
  function aiVisible() { return !!(season && season.season && season.season.aiVisible); }
  /* 회사 로고 — Simple Icons 최신판을 그때그때 불러온다 (회사가 로고를 바꾸면 따라간다).
   * 글자색으로 칠해 다크·라이트 모두에서 보이고, 못 불러오면 빈칸으로 남는다 */
  function aiLogo(slug) {
    if (!/^[a-z0-9]+$/.test(slug || '')) return '';
    return '<span class="mk-ai-logo" aria-hidden="true" style="--logo:url(https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/' + slug + '.svg)"></span>';
  }
  function hmTxt(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  async function loadAi() {
    var el = document.getElementById('rkAi');
    if (!el) return;
    _aiAt = Date.now();
    if (!_ai) el.innerHTML = '<div class="loading">AI 리그를 불러오는 중</div>';
    try { _ai = await api('/ai'); renderAi(); }
    catch (e) { el.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>'; }
  }
  function aiNextRound(d) {
    var now = kstNowMin(), r = (d.rounds || []).filter(function (m) { return m > now; })[0];
    return r != null ? hmTxt(r) : null;
  }
  function kstNowMin() { var k = new Date(Date.now() + 9 * 3600e3); return k.getUTCHours() * 60 + k.getUTCMinutes(); }
  /** 판단 기록의 주문 한 건 — 종목 · 수량 · 비중 · 가격, 아래에 계획과 이유 */
  function actItem(a) {
    return '<div class="mk-ai-item"><b>' + escapeHtml(a.name || a.code) + '</b> ' + (a.qty ? fmtNum(a.qty) + '주' : '')
      + (a.weight ? ' (' + Math.round(a.weight * 100) + '%)' : '') + (a.type === 'limit' && a.price ? ' · 지정가 ' + fmtNum(a.price) : a.type === 'market' ? ' · 시장가' : '')
      + (a.result === 'dry' ? ' <i class="mk-tag">판단만</i>' : '')
      + (a.stop ? '<span class="mk-ai-plan">손절 ' + fmtNum(a.stop) + (a.target ? ' · 목표 ' + fmtNum(a.target) : '') + (a.hold_days ? ' · ' + a.hold_days + '일' : '') + '</span>' : '')
      + (a.reason ? '<span class="mk-ai-why">' + escapeHtml(a.reason) + '</span>' : '') + '</div>';
  }
  function actRow(label, items, cls) {
    return '<div class="mk-ai-line' + (cls ? ' ' + cls : '') + '"><span class="mk-ai-k">' + label + ':</span>'
      + (items.length ? '<div class="mk-ai-items">' + items.join('') + '</div>' : '<span class="mk-ai-none">없음</span>') + '</div>';
  }
  function journalHtml(j, withName) {
    var dt = j.detail || {}, acts = (dt.actions || []);
    var head = '<div class="mk-ai-jh"><span>' + hmTxt(j.hm) + (j.ymd !== _ai.today ? ' · ' + md(j.ymd) : '') + (withName ? ' · <b>' + escapeHtml(j.maker || j.name) + '</b> <small class="mk-ai-model">' + escapeHtml(j.name) + '</small>' : '') + '</span>'
      + (j.status === 'fail' ? '<i class="mk-tag no">판단 실패</i>' : j.status === 'dry' ? '<i class="mk-tag">판단만</i>' : '')
      + (j.ms ? '<small>' + Math.round(j.ms / 1000) + '초' + (j.neurons != null ? ' · ' + fmtNum(j.neurons) + '뉴런' : '') + '</small>' : '') + '</div>';
    var body = '';
    if (j.status === 'fail') body = '<div class="mk-ai-why">' + escapeHtml(dt.error || '응답 없음') + '</div>';
    else {
      if (j.view) body += '<div class="mk-ai-view">' + escapeHtml(j.view) + '</div>';
      // 매수: ~ / 매도: ~ (없으면 없음) · 거부된 것은 따로 한 줄
      var done = function (a) { return a.result === 'placed' || a.result === 'dry'; };
      var stops = (dt.stops || []).map(function (x) {
        return '<div class="mk-ai-item"><b>' + escapeHtml(x.name || x.code) + '</b> ' + fmtNum(x.qty) + '주 · 손절<span class="mk-ai-plan">손절가 ' + fmtNum(x.stop) + ' 도달 — 코드가 자동으로 팜</span></div>';
      });
      body += actRow('매수', acts.filter(function (a) { return done(a) && a.side === 'buy'; }).map(actItem));
      body += actRow('매도', stops.concat(acts.filter(function (a) { return done(a) && a.side === 'sell'; }).map(actItem)));
      var rej = acts.filter(function (a) { return !done(a); });
      if (rej.length) body += actRow('거부', rej.map(function (a) {
        return '<div class="mk-ai-item"><b>' + escapeHtml(a.name || a.code) + '</b> ' + (a.side === 'sell' ? '매도' : '매수') + ' — ' + escapeHtml(a.note || '거부')
          + (a.reason ? '<span class="mk-ai-why">' + escapeHtml(a.reason) + '</span>' : '') + '</div>';
      }), 'no');
    }
    return '<div class="mk-ai-j">' + head + body + '</div>';
  }
  function renderAi() {
    var el = document.getElementById('rkAi'), d = _ai;
    if (!el || !d) return;
    var admin = !!(season && season.isSuper);      // 모드 바꾸기·지금 판단시키기는 슈퍼관리자만
    var r = d.round, next = aiNextRound(d);
    var isPost = r && /-post$/.test(r.id);
    var status = isPost ? (r.phase !== 'done' ? '✍ 장 마감 이야기 쓰는 중' : '✍ 장 마감 이야기 끝') + (next ? ' · 다음 ' + next : '')
      : r && r.phase !== 'done' ? '🔄 ' + escapeHtml(r.id.slice(-4).replace(/(\d\d)(\d\d)/, '$1:$2')) + ' 라운드 진행 중' + (r.left ? ' · 남은 AI ' + r.left : '')
      : (r ? '마지막 라운드 ' + escapeHtml(r.id.replace(/^\d{8}-/, '').replace(/^(\d\d)(\d\d)/, '$1:$2')) + (r.dry ? ' (판단만)' : '') + (r.error ? ' · ' + escapeHtml(r.error) : '') : '아직 라운드 없음')
        + (next ? ' · 다음 ' + next : ' · 오늘 판단 끝');
    var h = '<section class="m-section"><div class="m-head"><h3>🤖 ' + escapeHtml((d.season && d.season.name) || '') + ' AI 리그' + (d.mode === 'admin' ? ' <i class="mk-tag">시험 중 · 관리자만</i>' : '') + '</h3>'
      + '<span class="m-hint">' + status
      // 지금 한 번 판단시키기 — 슈퍼관리자만, 작게. 정규장 밖이면 시간외 지정가로 넣는다
      + (admin ? ' <button class="mk-ai-run" onclick="Mock.aiRun(this)"' + (_aiBusy ? ' disabled' : '') + ' title="지금 4명이 판단하고 주문까지 넣습니다 (정규장 밖은 시간외 지정가)">▶ 지금 판단</button>' : '')
      + '</span></div>'
      + '<div class="mk-note" style="margin:0 0 8px">무료 AI 모델들이 회원과 같은 규칙(시드 1억 · 같은 체결)으로 정규장 하루 ' + (d.rounds || []).length + '번(' + (d.rounds || []).map(hmTxt).join(' · ') + ') 판단합니다. 현금만 쓰고, 보유 · 주문 · 판단 이유가 모두 공개됩니다. 회원 시즌과 같이 시작하고 끝나며, 회원 순위에는 들어가지 않습니다.</div>';
    h += d.bots.map(function (b, i) {
      var open = !!_aiOpen[b.id], rr = b.returnRate;
      var cashPct = b.equity ? Math.round(b.cash / b.equity * 100) : 100;
      var row = '<button class="mk-rank mk-ai-row" aria-expanded="' + open + '" onclick="Mock.aiToggle(\'' + escapeJsArg(b.id) + '\')">'
        + '<span class="mk-rank-no">' + (['🥇', '🥈', '🥉'][i] || i + 1) + '</span>'
        + '<span class="mk-ord-main"><span class="mk-pos-name">' + aiLogo(b.logo) + escapeHtml(b.maker || b.name) + ' <small class="mk-ai-model">' + escapeHtml(b.name) + '</small></span>'
        +   '<span class="mk-pos-sub">보유 ' + b.positions.length + '종목 · 현금 ' + cashPct + '% · 판단 ' + fmtNum(b.rounds) + '회' + (b.fails ? ' · 실패 ' + b.fails : '') + (b.neurons != null ? ' · ' + fmtNum(b.neurons) + '뉴런' : '') + '</span></span>'
        + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(b.equity) + '</span><span class="mk-pos-pnl ' + signClass(rr) + '">' + fmtRate(rr) + '</span></span></button>';
      if (!open) return row;
      // 내 계좌 화면과 같은 모양 — 요약 카드 · 📦 보유 종목 · ⏳ 미체결 (AI 계좌라 정정·취소 버튼은 없다)
      var evalPnl = b.positions.reduce(function (t, p) { return t + (p.pnl || 0); }, 0);
      var det = '<div class="mk-ai-det">'
        // 총자산·수익률은 바로 위 순위 줄에 있으므로 여기서는 나눠 본 값만 (박스 없이)
        +   '<div class="mk-grid mk-ai-grid">'
        +     cell('주문 가능', won(b.available) + (b.reserved > 0 ? '<small class="mk-cell-sub">주문 대기 ' + won(b.reserved) + '</small>' : ''))
        +     cell('보유 주식', won(b.stock))
        +     cell('평가손익', '<span class="' + signClass(evalPnl) + '">' + (evalPnl > 0 ? '+' : '') + fmtNum(evalPnl) + '원</span>')
        +     cell('실현손익', '<span class="' + signClass(b.realizedPnl || 0) + '">' + ((b.realizedPnl || 0) > 0 ? '+' : '') + fmtNum(b.realizedPnl || 0) + '원</span>'
              + (b.buyFees ? '<small class="mk-cell-sub">매수 수수료 −' + fmtNum(b.buyFees) + '원</small>' : ''))
        +   '</div>'
        + '<div class="mk-ai-sub">📦 보유 종목 ' + b.positions.length + '종목</div>';
      det += b.positions.length ? b.positions.filter(function (p) { return CODE_RE.test(p.code); }).map(function (p) {
        var pl = p.plan || {};
        return '<button class="mk-pos" onclick="openStock(\'' + p.code + '\',\'' + escapeJsArg(p.name) + '\')">'
          + stockLogoHtml(p.code, p.name, null, 'sm')
          + '<span class="mk-pos-main"><span class="mk-pos-name">' + escapeHtml(p.name) + (p.halted ? ' <i class="mk-tag">정지</i>' : '') + '</span>'
          +   '<span class="mk-pos-sub">' + fmtNum(p.qty) + '주 · 평단 ' + fmtNum(p.avgPrice) + '원</span></span>'
          + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(p.value) + '원</span>'
          +   '<span class="mk-pos-pnl ' + signClass(p.pnl) + '">' + (p.pnl > 0 ? '+' : '') + fmtNum(p.pnl) + '원 (' + fmtRate(p.pnlRate) + ')</span></span>'
          + '</button>'
          + (pl.stop ? '<div class="mk-ai-plan mk-ai-posplan">🎯 손절 ' + fmtNum(pl.stop) + (pl.target ? ' · 목표 ' + fmtNum(pl.target) : '') + (pl.holdDays ? ' · ' + pl.holdDays + '일 예정' : '') + (pl.openedYmd ? ' · ' + md(pl.openedYmd) + ' 매수' : '')
            + (pl.thesis ? '<span class="mk-ai-why">' + escapeHtml(pl.thesis) + '</span>' : '') + '</div>' : '');
      }).join('') : '<div class="empty">보유 종목이 없습니다.</div>';
      if (b.openOrders.length) det += '<div class="mk-ai-sub">⏳ 미체결 ' + b.openOrders.length + '건</div>'
        + b.openOrders.map(function (o) { return orderRowHtml(Object.assign({}, o, { id: null })); }).join('');
      // 🧾 체결 내역 — 내 계좌처럼 '불러오기'
      var hs = _aiHist[b.id] || {};
      det += '<div class="mk-ai-sub mk-ai-subrow">🧾 체결 내역<button class="mini-btn" onclick="Mock.aiHist(\'' + escapeJsArg(b.id) + '\', true)"' + (hs.busy ? ' disabled' : '') + '>' + (hs.html != null ? '새로고침' : '불러오기') + '</button></div>'
        + (hs.html != null ? (hs.html || '<div class="empty">체결 내역이 없습니다.</div>')
          + (hs.next ? '<button class="mini-btn mk-more" onclick="Mock.aiHist(\'' + escapeJsArg(b.id) + '\', false)"' + (hs.busy ? ' disabled' : '') + '>더 보기</button>' : '') : '');
      var js = d.journal.filter(function (j) { return j.bot === b.id; }).concat(_aiMore[b.id] || []);
      det += '<div class="mk-ai-sub">최근 판단</div>' + (js.length ? journalHtml(js[0], false) : '<div class="mk-ai-act">아직 없음</div>');
      var older = js.length < (b.rounds || 0) && _aiMoreLeft[b.id] !== false;   // 아직 안 받은 기록이 있나
      if (js.length > 1 || older) {
        var po = !!_aiPrev[b.id];
        det += '<button type="button" class="mk-ai-prev" aria-expanded="' + po + '" onclick="Mock.aiPrev(\'' + escapeJsArg(b.id) + '\')">이전 판단 ' + (po ? '접기 ▲' : (js.length - 1) + '건' + (older ? '+' : '') + ' 보기 ▼') + '</button>';
        if (po) {
          det += js.slice(1).map(function (j) { return journalHtml(j, false); }).join('');
          if (older) det += '<button type="button" class="mk-ai-prev" onclick="Mock.aiMore(\'' + escapeJsArg(b.id) + '\', this)">더 이전 기록 불러오기</button>';
        }
      }
      return row + det + '</div>';
    }).join('');
    h += '</section>';

    el.innerHTML = h;
  }
  function aiToggle(id) { _aiOpen[id] = !_aiOpen[id]; renderAi(); }
  function aiPrev(id) { _aiPrev[id] = !_aiPrev[id]; renderAi(); }
  /** AI 체결 내역 — 회원 계좌의 체결 내역과 같은 줄(주문별, 30개씩). 여러 번 나눠 체결된 주문은 눌러서 펼친다 */
  async function aiHist(id, reset) {
    var hs = _aiHist[id] = _aiHist[id] || {};
    if (hs.busy) return;
    hs.busy = true; renderAi();
    try {
      var d = await api('/ai/history?bot=' + encodeURIComponent(id) + (!reset && hs.next ? '&before=' + encodeURIComponent(hs.next) : ''));
      var rows = d.items.map(histOrderHtml).join('').replace(/Mock\.toggleFills\('([0-9a-f-]{36})'\)/g, "Mock.toggleFills('$1','" + id + "')");
      hs.html = (reset ? '' : (hs.html || '')) + rows;
      hs.next = d.next;
    } catch (e) { toast(e.message, 'err'); }
    hs.busy = false; renderAi();
  }
  /** 더 이전 판단 — 지금 보이는 가장 오래된 기록보다 앞선 10개 */
  async function aiMore(id, btn) {
    var js = _ai.journal.filter(function (j) { return j.bot === id; }).concat(_aiMore[id] || []);
    var last = js[js.length - 1];
    if (btn) btn.disabled = true;
    try {
      var r = await api('/ai/journal?bot=' + encodeURIComponent(id) + (last ? '&before=' + last.at : ''));
      var seen = {}; js.forEach(function (j) { seen[j.at + j.bot] = 1; });
      _aiMore[id] = (_aiMore[id] || []).concat(r.items.filter(function (j) { return !seen[j.at + j.bot]; }));
      _aiMoreLeft[id] = r.more;
    } catch (e) { toast(e.message, 'err'); }
    renderAi();
  }
  async function aiRun(btn) {
    if (_aiBusy) return;
    _aiBusy = true; if (btn) btn.disabled = true;
    try {
      var r = await api('/admin/ai/run', 'POST', {});
      toast(r.ok ? '판단을 시작했습니다 · 1~2분 뒤 결과가 보입니다' : (r.message || '시작하지 못했습니다'), '');
    } catch (e) { toast(e.message, 'err'); }
    _aiBusy = false;
    setTimeout(loadAi, 15000);
    loadAi();
  }


  /* ===== 랭킹 탭 · 계좌 공유 =====
   * 카드 숫자는 서버가 장부로 만든다 — 화면은 종류(계좌 전체/종목 하나)·종목코드·한마디만 보낸다.
   * 공유한 시각의 값으로 고정된 스냅샷이고, 실시간 값은 바로 위 순위표가 보여 준다.
   * 읽기·댓글은 시즌에 참가하지 않은 회원도 할 수 있고, 공유는 참가자만 할 수 있다.
   */
  var SHARE_PREVIEW = 3, SHARE_POS_PREVIEW = 3, SHARE_POS_FULL = 10, COMMENT_MAX = 300;
  // seasonId: 고른 시즌 (null = 서버 기본 — 진행 중인 시즌, 없으면 가장 최근에 끝난 시즌) · closed: 지난 시즌이라 읽기만
  function newShareState() { return { items: [], next: null, loading: false, err: null, all: false, open: {}, full: {}, cm: {}, seasonId: null, seasons: [], closed: false }; }
  var _sh = newShareState();
  var _shSheet = null;         // 공유 시트 { kind, code, body, busy }

  function signedWon(n) { return (n > 0 ? '+' : '') + fmtNum(Math.round(n)) + '원'; }
  function linkText(t) { var e = escapeHtml(t); return typeof linkifyBody === 'function' ? linkifyBody(e) : e; }

  async function loadShares(reset) {
    if (reset) { var keep = { seasonId: _sh.seasonId, seasons: _sh.seasons, closed: _sh.closed }; _sh = newShareState(); Object.assign(_sh, keep); }
    if (_sh.loading) return;
    _sh.loading = true;
    renderShares();
    try {
      var q = [];
      if (_sh.seasonId) q.push('season=' + encodeURIComponent(_sh.seasonId));
      if (!reset && _sh.next) q.push('before=' + encodeURIComponent(_sh.next));
      var who = shareWho();
      if (who) q.push('who=' + who);
      var d = await api('/shares' + (q.length ? '?' + q.join('&') : ''));
      _sh.items = reset ? d.items : _sh.items.concat(d.items);
      _sh.next = d.next; _sh.err = null; _sh.who = who;
      _sh.seasons = d.seasons || [];
      _sh.closed = !!(d.season && d.season.closed);
      _sh.shown = d.season ? d.season.id : null;          // 지금 보이는 시즌 (고른 게 없으면 서버가 정한 것)
    } catch (e) { _sh.err = e.message; }
    _sh.loading = false;
    renderShares();
  }

  /** 커뮤니티에서 AI 글을 보고 있나 (회원 / AI 전환) */
  function aiShareView() { return _rkSub === 'ai' && aiVisible(); }
  function shareWho() { return aiVisible() ? (_rkSub === 'ai' ? 'ai' : 'members') : null; }
  function renderShares() {
    var el = document.getElementById('rkShare');
    if (!el) return;
    // 다시 그려도 쓰던 댓글이 지워지지 않게 (다른 카드의 댓글을 받아 오는 사이 등)
    var drafts = {};
    el.querySelectorAll('textarea[data-cm]').forEach(function (t) { if (t.value) drafts[t.dataset.cm] = t.value; });
    var focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.cm : null;

    var joined = !!(season && season.joined);
    // 시즌이 둘 이상이면 고를 수 있게 — 지난 시즌 글은 읽기만 (글쓰기·댓글 입력 숨김)
    // 기본은 현재 시즌(목록 맨 앞 — 진행 중, 없으면 가장 최근에 끝난 시즌)만. 지난 시즌은 머리 줄의 작은 '이전 시즌 ▾'로 고른다
    var curId = _sh.seasons.length ? _sh.seasons[0].id : null;
    var past = _sh.seasons.filter(function (x) { return x.id !== curId; });
    var viewingPast = !!(_sh.shown && curId && _sh.shown !== curId);
    var shownName = (_sh.seasons.filter(function (x) { return x.id === _sh.shown; })[0] || {}).name || '';
    var pastPicker = past.length
      ? '<select class="mini-btn mk-sh-older" aria-label="이전 시즌 보기" onchange="if(this.value)Mock.shareSeason(this.value)">'
        + '<option value="">이전 시즌 ▾</option>'
        + past.map(function (x) {
            return '<option value="' + escapeHtml(x.id) + '"' + (x.id === _sh.shown ? ' selected' : '') + '>' + escapeHtml(x.name) + '</option>';
          }).join('') + '</select>'
      : '';
    var h = '<section class="m-section mk-share">'
      + '<div class="m-head"><span class="m-hint">'
      +   (viewingPast ? '<b class="mk-sh-name">' + escapeHtml(shownName) + '</b> 지난 시즌 글 · 읽기만 할 수 있습니다'
            : (_sh.closed ? '지난 시즌 글 · 읽기만 할 수 있습니다' : aiShareView() ? 'AI 들의 장 마감 이야기 · 매일 15:50' : '회원들의 이야기와 모의투자 계좌')) + '</span>'
      +   '<span class="mk-sh-acts">'
      +   (viewingPast ? '<button type="button" class="mini-btn" onclick="Mock.shareSeason(\'' + escapeJsArg(curId) + '\')">← 현재 시즌</button>' : pastPicker)
      +   (_sh.closed || aiShareView() ? '' : '<button class="mini-btn mk-share-btn" onclick="Mock.openShare()">✏️ 글쓰기</button>')
      +   '</span></div>';
    if (!_sh.items.length) {
      h += _sh.err ? '<div class="empty">' + escapeHtml(_sh.err) + '</div>'
        : (_sh.loading ? '<div class="loading">불러오는 중</div>' : '<div class="mk-share-empty">' + (aiShareView() ? 'AI 글은 장 마감 뒤(15:50) 올라옵니다. 쓸지 말지는 AI 가 정합니다.' : '아직 올라온 글이 없습니다.') + '</div>');
    } else {
      h += (_sh.all ? _sh.items : _sh.items.slice(0, SHARE_PREVIEW)).map(shareCardHtml).join('');
      if (!_sh.all && _sh.items.length > SHARE_PREVIEW) {
        h += '<button class="mini-btn mk-share-more" onclick="Mock.moreShares()">공유 더 보기</button>';
      } else if (_sh.all && _sh.next) {
        h += '<button class="mini-btn mk-share-more" onclick="Mock.moreShares()"' + (_sh.loading ? ' disabled' : '') + '>'
          + (_sh.loading ? '불러오는 중' : '더 불러오기') + '</button>';
      }
    }
    if (!_sh.closed && !aiShareView()) h += '<div class="mk-note">' + (joined
      ? '글에 모의투자 계좌를 붙일 수 있습니다 (하루 3번). 계좌 카드는 올린 시각의 값으로 고정됩니다.'
      : '시즌에 참가하면 글에 모의투자 계좌를 붙일 수 있습니다.') + '</div>';
    h += '</section>';
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
      ? '<span class="mk-sc-rank">' + (c.aiLeague ? 'AI ' : '') + c.rank + '위' + (c.participants ? '<i>/' + fmtNum(c.participants) + '명</i>' : '') + '</span>' : '';
    // AI 리그의 장 마감 이야기 — 작성자를 로고 · 회사 · 모델로
    var who = s.ai ? aiLogo(s.ai.logo) + '<b class="mk-sc-who">' + escapeHtml(s.ai.maker) + '</b> <small class="mk-ai-model">' + escapeHtml(s.ai.name) + '</small> <i class="mk-tag">🤖 AI</i>'
      : '<b class="mk-sc-who">' + escapeHtml(s.nickname) + '</b>';
    var h = '<article class="mk-sc" id="sc-' + s.id + '">'
      + '<div class="mk-sc-top"><div class="mk-sc-id">' + who + (s.realName ? ' <small class="mk-real" title="실명 (관리자에게만 보임)">' + escapeHtml(s.realName) + '</small>' : '')
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
        + '<span class="mk-sc-chg ' + signClass(c.pnl) + '">' + signedWon(c.pnl) + ' · ' + fmtRate(c.returnRate) + '</span>' + '</div>'
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
    else if (!list.length) h += '<div class="mk-sc-none">' + (_sh.closed ? '댓글이 없습니다' : '첫 댓글을 남겨 보세요') + '</div>';
    else h += list.map(function (c) {
      return '<div class="mk-sc-c"><div class="mk-sc-ch"><b>' + escapeHtml(c.nickname) + '</b>' + (c.realName ? ' <small class="mk-real" title="실명 (관리자에게만 보임)">' + escapeHtml(c.realName) + '</small>' : '') + '<span class="mk-sc-ct">' + escapeHtml(kstHM(c.createdAt)) + '</span>'
        + (c.canDelete ? '<button type="button" class="mk-sc-cdel" onclick="Mock.deleteComment(\'' + s.id + '\',\'' + c.id + '\')" aria-label="댓글 삭제">삭제</button>' : '')
        + '</div><div class="mk-sc-cb">' + linkText(c.body) + '</div></div>';
    }).join('');
    if (_sh.closed) return h + '</div>';            // 지난 시즌 — 댓글은 읽기만
    h += '<div class="mk-sc-cw"><textarea class="comment-input" id="cmi-' + s.id + '" data-cm="' + s.id + '" maxlength="' + COMMENT_MAX + '" rows="1"'
      + ' aria-label="댓글" placeholder="댓글을 남겨 보세요"></textarea>'
      + '<button type="button" class="btn-submit" onclick="Mock.submitComment(\'' + s.id + '\', this)">등록</button></div></div>';
    return h;
  }

  function shareSeason(id) {
    if (id === _sh.shown) return;
    _sh.seasonId = id;
    loadShares(true);
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
    var pos = holding(curStock.code), lots = lotsOf(curStock.code);
    // 계좌를 새로 받을 때마다 불린다 — 버튼 구성이 그대로면 보유 줄만 고친다 (누르는 중인 버튼이 사라지지 않게)
    var key = [curStock.code, season.joined ? 1 : 0, pos ? pos.qty + ':' + pos.cost : '', lots.map(function (l) { return l.id + ':' + l.qty; }).join(',')].join('|');
    if (old && old.dataset.key === key && old.parentNode === host) { paintHold(); return; }
    if (old) old.remove();
    var bar = document.createElement('div');
    bar.id = 'mkTradeBar';
    bar.className = 'mk-tradebar';
    bar.dataset.key = key;
    bar.innerHTML = (pos || lots.length ? '<div class="mk-hold" id="mkHold">' + holdLines(curStock.code) + '</div>' : '')
      + '<div id="mkTbPend">' + (season.joined ? pendListHtml(curStock.code) : '') + '</div>'
      + '<div class="mk-tb-btns">'
      + (season.joined
          ? '<button class="mk-buy" onclick="Mock.openSheet(\'buy\')">매수</button>'
            + '<button class="mk-sell" onclick="Mock.openSheet(\'sell\')"' + (pos || lots.length ? '' : ' disabled title="보유한 주식이 없습니다"') + '>매도</button>'
          : '<button class="mk-buy" onclick="switchTab(\'account\'); Mock.openJoinFlow()">모의투자 참가하고 매수하기</button>')
      + '</div>';
    host.appendChild(bar);
  }

  /** 이 종목의 체결 대기 주문 — 종목 상세와 주문창에 같은 모양으로. 금액은 아직 체결 안 된 수량 기준 (시장가는 지금 시세로 어림) */
  function pendOf(code) { return account && account.openOrders ? account.openOrders.filter(function (o) { return o.code === code; }) : []; }
  function pendListHtml(code, orders) {
    var list = orders || pendOf(code);
    if (!list.length) return '';
    var px = livePrice(code), buyAmt = 0, sellAmt = 0;
    var rows = list.map(function (o) {
      var left = o.qty - o.filledQty, isBuy = o.side === 'buy';
      var p = o.type === 'limit' ? o.limitPrice : px;
      var amt = p != null ? p * left : null;
      if (amt != null) { if (isBuy) buyAmt += amt; else sellAmt += amt; }
      var okId = UUID_RE.test(String(o.id || ''));
      return '<div class="mk-pl-row"><span class="mk-side ' + (isBuy ? 'buy' : 'sell') + '">' + (isBuy ? '매수' : '매도') + '</span>'
        + '<span class="mk-pl-main">' + ordTags(o) + (o.type === 'limit' ? fmtNum(o.limitPrice) + '원' : '시장가')
        +   ' · ' + (o.filledQty ? fmtNum(o.filledQty) + '/' : '') + fmtNum(o.qty) + '주</span>'
        + '<b class="mk-pl-amt">' + (amt != null ? (o.type === 'market' ? '약 ' : '') + won(amt) : '-') + '</b>'
        + (okId && !o.forced ? '<button class="mini-btn danger mk-pl-x" onclick="Mock.cancel(\'' + o.id + '\', this)">취소</button>' : '')
        + '</div>';
    }).join('');
    var sums = [buyAmt ? '<b class="up">매수 ' + won(buyAmt) + '</b>' : '', sellAmt ? '<b class="down">매도 ' + won(sellAmt) + '</b>' : ''].filter(Boolean).join(' · ');
    return '<div class="mk-pendlist"><div class="mk-pl-head"><span><i class="mk-pend-dot" aria-hidden="true"></i>체결 대기 ' + list.length + '건</span><span>' + sums + '</span></div>' + rows + '</div>';
  }

  /** 종목 상세 보유 줄 — 현금 보유와 신용·담보 잔고 */
  function holdLines(code) {
    var pos = holding(code), out = [];
    if (pos) out.push(holdHtml(pos));
    lotsOf(code).forEach(function (l) {
      var px = livePrice(code); if (px == null) px = l.price;
      var value = px != null ? px * l.qty : l.cost, pnl = value - l.cost;
      out.push('<i class="mk-tag ' + (l.kind === 'credit' ? 'cr' : 'ln') + '">' + lotLabel(l) + '</i> <b>' + fmtNum(l.qty) + '주</b> · 평단 ' + fmtNum(l.avgPrice) + '원'
        + ' · <span class="' + signClass(pnl) + '">' + (pnl > 0 ? '+' : '') + fmtNum(pnl) + '원</span>');
    });
    return out.join('<br>');
  }
  function paintHold() {
    if (!curStock) return;
    var pe = document.getElementById('mkTbPend');
    if (pe && season && season.joined) pe.innerHTML = pendListHtml(curStock.code);
    var el = document.getElementById('mkHold');
    if (!el) return;
    if (hasAny(curStock.code)) el.innerHTML = holdLines(curStock.code);
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
    if (side === 'sell' && !hasAny(curStock.code)) side = 'buy';
    var q = liveQuote(curStock.code);
    // 시간외에는 화면에 보이는 그 시장의 가격(q.price), 정규장에는 KRX 가격을 기본값으로
    var px = q ? (phaseInfo().limitOnly ? (q.price || (q.krx && q.krx.price)) : ((q.krx && q.krx.price) || q.price)) : 0;
    // ETF·ETN 여부를 이미 알면 바로 쓴다 — 모르면 일반 주식 호가단위로 시작하고 아래에서 받아 고친다
    var tf = _kind[curStock.code];
    var lots0 = lotsOf(curStock.code);
    sheet = { code: curStock.code, name: curStock.name, side: side, type: 'limit', price: px || 0, qty: '', taxFree: tf != null ? tf : false, busy: false, orderId: null,
      fund: 'cash', lotId: holding(curStock.code) || !lots0.length ? '' : lots0[0].id, terms: _terms[curStock.code] || null };
    renderSheet();
    var mySheet = sheet;
    // 장 구간(정규장·시간외)이 바뀌었을 수 있으니 열 때마다 최신 상태를 받는다 — 통째로 다시 그리지 않고 안내·계산 부분만 갱신
    // (다시 그리면 입력 중인 포커스가 날아가고 모바일 키보드가 닫힌다)
    refreshAccount().then(function () { if (sheet === mySheet && !sheet.busy) refreshSheetParts(); });
    try {
      var k = await api('/kind?code=' + encodeURIComponent(sheet.code) + '&name=' + encodeURIComponent(sheet.name || ''));
      if (k && k.code) _kind[k.code] = !!k.taxFree;
      if (k && k.code && k.marginRate != null) _terms[k.code] = { marginRate: k.marginRate, creditOk: !!k.creditOk, creditReason: k.creditReason || null };
      if (sheet === mySheet && sheet.code === k.code) {
        var tChanged = !sheet.terms && _terms[k.code];
        sheet.terms = _terms[k.code] || sheet.terms;
        if (sheet.fund === 'credit' && sheet.terms && !sheet.terms.creditOk) sheet.fund = 'cash';
        if (sheet.taxFree !== !!k.taxFree) { sheet.taxFree = !!k.taxFree; refreshSheetParts(); }
        if (tChanged && creditOnNow()) renderSheet();
      }
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
      if (seasonLastDay()) return '<div class="mk-info"><b>애프터마켓 · 시즌 마지막 날</b> · 지정가만 · 20:00 평가액으로 최종 순위가 확정됩니다</div>';
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
    var rate = s.side === 'buy' ? buyRate() : 1;
    var lot = s.side === 'sell' && s.lotId ? lotsOf(s.code).filter(function (l) { return l.id === s.lotId; })[0] : null;
    var pendSell = function (match) {
      return a ? a.openOrders.filter(function (o) { return o.side === 'sell' && match(o); }).reduce(function (t, o) { return t + (o.qty - o.filledQty); }, 0) : 0;
    };
    var maxQty = s.side === 'buy'
      ? (price > 0 && a ? Math.floor(a.available / (price * (rate + fr))) : 0)
      : lot ? lot.qty - pendSell(function (o) { return o.lotId === lot.id; })
      : (pos ? pos.qty - pendSell(function (o) { return o.code === s.code && !o.lotId; }) : 0);
    // 매수에 드는 증거금 (100% 면 매수 금액 전부) · 신용은 보증금
    var need = rate >= 1 ? amount + fee : Math.ceil(amount * rate) + fee;
    return { price: price, qty: qty, amount: amount, fee: fee, tax: tax, maxQty: Math.max(0, maxQty), held: lot ? lot.qty : (pos ? pos.qty : 0), rate: rate, need: need, lot: lot };
  }

  /** 매수 증거금률 — 신용은 보증금률, 증거금 100% 계좌·동결 계좌는 1, 종목별 계좌는 그 종목 증거금률 */
  function buyRate() {
    var c = cr();
    if (!c || !sheet) return 1;
    if (sheet.fund === 'credit') return (c.rules && c.rules.creditDepositRate) || 0.45;
    if (!c.on || c.marginMode !== 'spectrum' || c.frozenUntil || c.gate) return 1;
    if (sheet.terms && sheet.terms.marginRate) return sheet.terms.marginRate;
    // 종목 조건을 아직 못 받았으면(조회 실패) 이름으로 어림한다 — 레버리지·인버스·ETN 은 서버가 100% 로 받는다
    return /레버리지|인버스|2X|곱버스|울트라|\bBULL\b|\bBEAR\b|ETN/i.test(sheet.name || '') ? 1 : 0.4;
  }

  /** 수량 옆 안내 — 매도는 '보유'가 아니라 미체결 매도를 뺀 '매도 가능' 수량이다 */
  function maxText(n) {
    if (sheet.side === 'buy') return '최대 ' + fmtNum(n.maxQty) + '주';
    if (n.lot) return '상환 가능 ' + fmtNum(n.maxQty) + '주';
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
    var out = row(sheet.type === 'market' ? '예상 주문 금액' : '주문 금액', won(n.amount))
      + row('수수료' + (n.tax || !isBuy ? ' · 세금' : ''), won(n.fee + n.tax));
    if (isBuy && sheet.fund === 'credit') {
      var dep = Math.ceil(n.amount * n.rate);
      out += row('보증금 (' + pctTxt(n.rate) + ')', won(dep)) + row('융자 (결제일 실행)', won(n.amount - dep));
    } else if (isBuy && n.rate < 1) {
      out += row('필요 증거금 (' + pctTxt(n.rate) + ')', won(n.need)) + row('결제일(D+2)에 낼 나머지', won(n.amount + n.fee - n.need));
    }
    if (!isBuy && n.lot) {
      var part = n.qty >= n.lot.qty ? 1 : n.qty / n.lot.qty;
      var pr = Math.round(n.lot.principal * part);
      // 서버와 같이 매도 결제일(D+2)까지의 총이자(소급법) − 상환분의 이미 낸 이자 — 오늘까지 쌓인 이자로 보이면 구간이 바뀔 때 적게 보인다
      var d2 = a && a.settle && a.settle.d2Ymd;
      var it = d2 ? Math.max(0, interestTo(n.lot, pr, d2) - Math.round((n.lot.interestPaid || 0) * part)) : Math.round(n.lot.accrued * part);
      out += row((n.lot.kind === 'credit' ? '융자' : '대출') + ' 상환', won(pr)) + row('이자 (약, 결제일까지)', won(it));
      var net = n.amount - n.fee - n.tax - pr - it;
      return out + (a ? row('받을 금액 (약)', won(net)) : '')
        + (net < 0 && n.qty ? '<div class="mk-help">매도대금이 갚을 돈보다 적습니다 · 모자라는 ' + won(-net) + '은 결제일에 미수가 됩니다</div>' : '');
    }
    return out + (a ? row(isBuy ? '주문 후 주문 가능 금액' : '받을 금액', won(isBuy ? a.available - n.need : n.amount - n.fee - n.tax)) : '');
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
    var noHolding = !hasAny(s.code);
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
      + '<div id="mkSheetPend">' + pendListHtml(s.code) + '</div>'
      + fundHtml(s)
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

  /** 매수: 현금 / 신용 · 매도: 현금 보유 / 신용·담보 잔고 (신용 기능이 켜졌거나 잔고가 있을 때만) */
  function fundHtml(s) {
    if (s.side === 'buy') {
      if (!creditOnNow()) return '';
      var t = s.terms, c = cr(), R = (c && c.rules) || {};
      var gate = c && c.gate, no = !!gate || !!(t && !t.creditOk), noWhy = gate ? gate.msg : ((t && t.creditReason) || '신용 불가 종목');
      var note = s.fund === 'credit'
        ? '보증금 ' + pctTxt(R.creditDepositRate || 0.45) + ' · 나머지는 결제일에 융자 · ' + (R.creditTermDays || 180) + '일 · 이자 5.4~9.1%'
        : (buyRate() < 1 ? '증거금률 ' + pctTxt(buyRate()) + ' (종목별) · 결제일에 모자라면 미수' : '증거금 100% (현금)');
      return '<div class="seg-row sub mk-seg2" role="group" aria-label="매수 자금">'
        + '<button class="seg' + (s.fund !== 'credit' ? ' on' : '') + '" aria-pressed="' + (s.fund !== 'credit') + '" onclick="Mock.setSheet(\'fund\',\'cash\')">현금</button>'
        + '<button class="seg' + (s.fund === 'credit' ? ' on' : '') + '" aria-pressed="' + (s.fund === 'credit') + '" onclick="Mock.setSheet(\'fund\',\'credit\')"'
        +   (no ? ' disabled title="' + escapeHtml(noWhy) + '"' : '') + '>신용</button>'
        + '</div><div class="mk-dim mk-fund-note">' + escapeHtml(no && s.fund !== 'credit' ? noWhy : note) + '</div>';
    }
    var lots = lotsOf(s.code);
    if (!lots.length) return '';
    var pos = holding(s.code);
    var opts = (pos ? [['', '현금 보유 · ' + fmtNum(pos.qty) + '주']] : [])
      .concat(lots.map(function (l) { return [l.id, lotLabel(l) + ' · ' + fmtNum(l.qty) + '주 (매도상환)']; }));
    return '<div class="mk-field mk-lot-pick"><span>매도할 잔고</span><select class="f-input" aria-label="매도할 잔고" onchange="Mock.setSheet(\'lotId\', this.value)">'
      + opts.map(function (o) { return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === (s.lotId || '') ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>'; }).join('')
      + '</select></div>';
  }

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
    var sp = document.getElementById('mkSheetPend'); if (sp) sp.innerHTML = pendListHtml(sheet.code);
  }

  function setSheet(key, val) {
    if (!sheet || sheet.busy) return;
    if (key === 'side' && val === 'sell' && sheet.side !== 'sell' && !hasAny(sheet.code)) return;
    if (key === 'fund' && val === 'credit' && (!creditOnNow() || cr().gate || (sheet.terms && !sheet.terms.creditOk))) return;
    sheet[key] = val;
    if (key === 'side' || key === 'fund' || key === 'lotId') sheet.qty = '';
    if (key === 'side' && val === 'sell') { var l0 = lotsOf(sheet.code); sheet.lotId = holding(sheet.code) || !l0.length ? '' : l0[0].id; }
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
    if (sheet.side === 'buy' && account && n.need > account.available) return account.available < 0 && n.rate < 1 && sheet.fund !== 'credit' ? '미수금이 있어 매수할 수 없습니다' : '주문 가능 금액이 부족합니다';
    if (sheet.side === 'sell' && n.qty > n.maxQty) return (n.lot ? '상환 가능 수량이 부족합니다 (' : '매도 가능 수량이 부족합니다 (') + fmtNum(n.maxQty) + '주)';
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
    var cidKey = [sheet.code, sheet.side, sheet.type, n.qty, sheet.type === 'limit' ? n.price : '', sheet.fund || '', sheet.lotId || ''].join('|');
    if (!sheet.cid || sheet.cidKey !== cidKey) {
      sheet.cid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      sheet.cidKey = cidKey;
    }
    var cid = sheet.cid;
    var mySheet = sheet;
    try {
      var d = await api('/orders', 'POST', {
        clientOrderId: cid, code: sheet.code, side: sheet.side, type: sheet.type, qty: n.qty,
        limitPrice: sheet.type === 'limit' ? n.price : undefined,
        credit: sheet.side === 'buy' && sheet.fund === 'credit' ? 'buy' : undefined,
        lotId: sheet.side === 'sell' && sheet.lotId ? sheet.lotId : undefined
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
    var sideTxt = o.credit === 'buy' ? '신용매수' : o.lotId ? '매도상환' : (o.side === 'buy' ? '매수' : '매도');
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
  var _terms = {};             // 종목코드 → { marginRate, creditOk, creditReason } (증거금률·신용 가능)

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
    else if (aux.kind === 'loan') auxShell(loanHtml(), 'buy', '증권담보대출');
    refreshAuxParts();
  }

  function refreshAuxParts() {
    if (!aux) return;
    if (aux.kind === 'amend') amendParts();
    else if (aux.kind === 'loan') loanParts();
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
    if (key === 'amount') {
      // 대출 금액 — 100만 원씩, 한도 안에서
      v = Math.min(loanLimit(), Math.max(100000, (cur || 0) + dir * 1000000));
      v = Math.floor(v / 10000) * 10000;
    } else if (key === 'qty') {
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
    if (aux.kind === 'loan' && key === 'amount' && val === 'max') val = loanLimit();
    auxPut(key, val);
    if (key === 'type' && val === 'limit' && aux.kind === 'amend' && !aux.price) aux.price = curPrice(aux.code) || '';
    renderAux();
  }

  function auxSel(key, el) {
    if (!aux || aux.busy) return;
    auxPut(key, el.value);
    if (aux.kind === 'loan' && key === 'code') {
      // 종목을 바꾸면 담보 수량을 그 종목의 결제된 수량으로
      var p = loanPos();
      aux.rem = p ? pledgeable(p) : 0; aux.qty = aux.rem; aux.amount = '';
      renderAux(); return;
    }
    refreshAuxParts();
  }

  function auxSubmit() {
    if (!aux || aux.busy) return;
    if (aux.kind === 'amend') return amendSubmit();
    if (aux.kind === 'loan') return loanSubmit();
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
      + '<label class="mk-note" style="margin:0" for="mkScredit">미수 · 신용 · 담보대출</label>'
      + '<select class="f-input" id="mkScredit" aria-label="미수 · 신용 · 담보대출"><option value="on">켜기</option><option value="off">끄기</option></select>'
      + '<div class="form-row">'
      +   '<button class="btn-submit" onclick="Mock.saveSeason(this)">시즌 저장</button>'
      +   '<button class="btn-ghost" onclick="Mock.newSeasonForm()">새 시즌</button>'
      + '</div>'
      + '<div class="status-msg" id="mkSstatus"></div>'
      + '<div class="mk-seasons" id="mkSeasons"><div class="loading">시즌 목록 불러오는 중...</div></div>'
      + '<div class="mk-holidays" id="mkHolidays"></div>'
      + '<p class="mk-note">새 시즌은 시드 1억원 · 수수료 0.015% · 매도세 0.20% 로 만들어집니다. 시작일이 되면 자동으로 열리고, 종료일 20:00 애프터마켓이 끝나면 최종 순위가 확정됩니다. '
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
            +     (x.finals ? ' · 최종순위 확정' : '')
            +     ' · 미수·신용 ' + (x.credit_mode === 'off' ? '끔' : '켬')
            + '</span>'
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
      : '진행 중인 시즌은 이름 · 종료일 · 전달사항 · 미수·신용 설정만 바꿀 수 있습니다.';
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
    var crSel = document.getElementById('mkScredit'); if (crSel) crSel.value = x.credit_mode === 'off' ? 'off' : 'on';
    var st = document.getElementById('mkSstatus');
    if (st) {
      st.innerHTML = x.status === 'closed'
        ? '<span class="err">종료된 시즌은 수정할 수 없습니다. 값만 참고용으로 채웠습니다.</span>'
        : '<span class="ok">' + escapeHtml(x.name) + ' 값을 채웠습니다.'
          + (x.status !== 'upcoming' ? ' 진행 중이라 이름 · 종료일 · 전달사항 · 미수·신용 켜기/끄기만 바뀝니다.' : '') + '</span>';
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
    var crSel = document.getElementById('mkScredit');
    if (crSel && !crSel.dataset.touched) { crSel.value = (cur.creditMode || cur.credit_mode) === 'off' ? 'off' : 'on'; crSel.onchange = function () { crSel.dataset.touched = '1'; }; }
    updateFormNote();
  }

  async function saveSeason(btn) {
    var st = document.getElementById('mkSstatus');
    var v = function (id) { return document.getElementById(id).value.trim(); };
    btn.disabled = true;
    try {
      var r = await api('/admin/seasons', 'POST', { id: v('mkSid'), name: v('mkSname'), startDate: v('mkSstart'), endDate: v('mkSend'), notice: v('mkSnotice'),
        creditMode: (document.getElementById('mkScredit') || {}).value });
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
    pendChipHtml: pendChipHtml, pendListHtml: pendListHtml, histOrderHtml: histOrderHtml, toggleFills: toggleFills,
    join: join, openJoinFlow: openJoinFlow, joinStep2: joinStep2, closeJoin: closeJoin, cancel: cancel, loadHistory: loadHistory,
    openSheet: openSheet, closeSheet: closeSheet, tryCloseSheet: tryCloseSheet, setSheet: setSheet, input: input, step: step, pct: pct, submit: submit,
    askReview: askReview,
    openAmend: openAmend, closeAux: closeAux,
    setMarginMode: setMarginMode, repayLot: repayLot, loadLedger: loadLedger, openLoan: openLoan,
    aiToggle: aiToggle, aiRun: aiRun, aiPrev: aiPrev, aiHist: aiHist, aiMore: aiMore, rankSub: rankSub,
    auxInput: auxInput, auxStep: auxStep, auxSet: auxSet, auxSel: auxSel, auxSubmit: auxSubmit,
    loadCorpAdmin: loadCorpAdmin, caApply: caApply, caDismiss: caDismiss,
    mountAdmin: mountAdmin,
    saveSeason: saveSeason, loadSeasons: loadSeasons, pickSeason: pickSeason,
    newSeasonForm: newSeasonForm, onSeasonIdInput: onSeasonIdInput,
    addHoliday: addHoliday, removeHoliday: removeHoliday,
    openShare: openShare, closeShare: closeShare, shareKind: shareKind, shareCode: shareCode, shareInput: shareInput, submitShare: submitShare,
    sharePhotos: sharePhotos, removePhoto: removePhoto, viewPhoto: viewPhoto,
    editNick: editNick, saveNick: saveNick, attend: attend, attendInfo: attendInfo,
    rankView: rankView, shareSeason: shareSeason, toggleShare: toggleShare, fullShare: fullShare, moreShares: moreShares, deleteShare: deleteShare, submitComment: submitComment, deleteComment: deleteComment
  };
})();
