/* ===== DT 재테크 — 모의투자 모드 =====
 * 헤더의 모의투자 버튼을 켤 때 처음 불러온다. 끄면 재테크 화면은 예전과 완전히 같다.
 * 장부는 dt-stock 워커(D1)에만 있고, 여기서는 주문을 "요청"하고 결과를 그릴 뿐이다.
 * 시세·포맷·폴링은 market.js / market-ui.js 의 것을 그대로 쓴다.
 */

var Mock = (function () {
  var on = false;
  var season = null;        // /season 응답
  var account = null;       // /account 응답
  var sheet = null;         // 열려 있는 주문창 상태 { code, name, side, type, price, qty, taxFree }
  var watchingOrder = null; // 체결을 기다리는 주문 폴링 타이머
  var histNext = null;

  /* ===== 워커 호출 ===== */
  async function api(path, method, body) {
    if (!currentUser) throw new Error('로그인이 필요합니다');
    var token = await currentUser.getIdToken();
    var res = await fetch(MARKET_API + '/api/mock' + path, {
      method: method || 'GET',
      headers: body ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { Authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || '요청을 처리하지 못했습니다 (' + res.status + ')');
      err.code = data && data.code; err.status = res.status;
      throw err;
    }
    return data;
  }

  function modeKey() { return 'dt-invest-mock:' + (currentUser ? currentUser.uid : ''); }
  function won(n) { return fmtNum(Math.round(n)) + '원'; }
  function rateHtml(r) { return '<span class="' + signClass(r) + '">' + fmtRate(r) + '</span>'; }

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

  /* ===== 모드 켜기/끄기 ===== */
  async function setMode(next) {
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
      Poller.remove('mock-acc');
      document.getElementById('mockBar').style.display = 'none';
      renderTradeBar();
      if (currentTab === 'account' || currentTab === 'ranking') switchTab('market');
      return;
    }
    await refreshSeason();
    renderTradeBar();
    // 아직 참가 전이면 참가 여부부터 묻는다 (닫아도 계좌 탭에 참가 안내가 남는다)
    if (season && season.season && !season.joined) { switchTab('account'); openJoinFlow(); }
  }

  async function refreshSeason() {
    try { season = await api('/season'); }
    catch (e) { season = { error: e.message }; }
    if (season && season.joined) await refreshAccount();
    else renderBar();
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

  /* ===== 계좌 ===== */
  function renderAccount(errMsg) {
    var el = document.getElementById('tab-account');
    if (!el) return;
    if (!season) { el.innerHTML = '<div class="loading">불러오는 중...</div>'; return; }
    if (season.error) { el.innerHTML = '<div class="empty">' + escapeHtml(season.error) + '</div>'; return; }

    if (!season.season) {
      el.innerHTML = '<div class="mk-card"><h3>지금은 진행 중인 시즌이 없습니다</h3>'
        + (season.next
            ? '<p>다음 시즌 <b>' + escapeHtml(season.next.name) + '</b> — ' + escapeHtml(season.next.start_date) + ' 시작</p>'
            : '<p>다음 시즌 일정이 정해지면 여기에 표시됩니다.</p>')
        + '<button class="mini-btn" onclick="switchTab(\'ranking\')">지난 시즌 결과 보기</button></div>'
        + adminHtml();
      return;
    }

    if (!season.joined) { el.innerHTML = joinHtml() + adminHtml(); return; }
    if (!account) { el.innerHTML = '<div class="empty">' + escapeHtml(errMsg || '계좌를 불러오는 중...') + '</div>'; return; }

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
      + '<div class="mk-note">' + (a.live ? '08:00~20:00 실시간 평가 — 프리·애프터마켓 가격 포함' : '장 마감 — 마지막 체결가로 평가')
      +   ' · 순위 확정은 15:30 종가 기준</div>'
      + '</div>';

    h += '<section class="m-section"><div class="m-head"><h3>📦 보유 종목</h3><span class="m-hint">' + a.positions.length + '종목</span></div>';
    h += a.positions.length ? a.positions.map(function (p) {
      return '<button class="mk-pos" onclick="openStock(\'' + escapeJsArg(p.code) + '\',\'' + escapeJsArg(p.name) + '\')">'
        + stockLogoHtml(p.code, p.name, null, 'sm')
        + '<span class="mk-pos-main"><span class="mk-pos-name">' + escapeHtml(p.name) + (p.halted ? ' <i class="mk-tag">정지</i>' : '') + '</span>'
        +   '<span class="mk-pos-sub">' + fmtNum(p.qty) + '주 · 평단 ' + fmtNum(p.avgPrice) + '</span></span>'
        + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(p.value) + '</span>'
        +   '<span class="mk-pos-pnl ' + signClass(p.pnl) + '">' + (p.pnl > 0 ? '+' : '') + fmtNum(p.pnl) + ' (' + fmtRate(p.pnlRate) + ')</span></span>'
        + '</button>';
    }).join('') : '<div class="empty">아직 보유한 종목이 없습니다.<br><b>시세</b> 탭에서 종목을 골라 매수해 보세요.</div>';
    h += '</section>';

    if (a.openOrders.length) {
      h += '<section class="m-section"><div class="m-head"><h3>⏳ 미체결 주문</h3></div>'
        + a.openOrders.map(orderRowHtml).join('') + '</section>';
    }

    h += '<section class="m-section"><div class="m-head"><h3>🧾 체결 내역</h3>'
      + '<button class="mini-btn" onclick="Mock.loadHistory(true)">불러오기</button></div>'
      + '<div id="mkHistory"></div></section>'
      + '<div class="disclaimer">⚠️ 가상의 자금으로 하는 모의투자이며 실제 매매·투자 권유가 아닙니다. 모의 체결가는 KRX 정규시장 가격 기준이고 '
      + 'NXT·애프터마켓 가격은 반영하지 않습니다. 수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2)
      + '%(ETF·ETN 면제). 가상 자산은 어떤 것으로도 교환되지 않습니다.</div>'
      + adminHtml();
    el.innerHTML = h;
  }

  function cell(k, v) { return '<div class="mk-cell"><span class="mk-cell-k">' + k + '</span><span class="mk-cell-v">' + v + '</span></div>'; }

  function orderRowHtml(o) {
    var sideTxt = o.side === 'buy' ? '매수' : '매도';
    return '<div class="mk-ord">'
      + '<span class="mk-side ' + o.side + '">' + sideTxt + '</span>'
      + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(o.name) + '</span>'
      +   '<span class="mk-pos-sub">' + (o.type === 'market' ? '시장가' : '지정가 ' + fmtNum(o.limitPrice))
      +   ' · ' + fmtNum(o.filledQty) + '/' + fmtNum(o.qty) + '주</span></span>'
      + '<button class="mini-btn danger" onclick="Mock.cancel(\'' + o.id + '\', this)">취소</button>'
      + '</div>';
  }

  function joinHtml() {
    var s = season.season;
    return '<div class="mk-card mk-join">'
      + '<h3>🏁 ' + escapeHtml(s.name) + '</h3>'
      + '<p class="mk-join-lead">가상 <b>' + fmtCompact(s.seed) + '원</b>으로 실제 주가에 맞춰 매매하고,<br>'
      +   escapeHtml(s.endDate) + ' 종가 기준 <b>최종 자산</b>으로 순위를 가립니다.</p>'
      + '<ul class="mk-rules">'
      +   '<li>국내 상장 종목 전부 (ETF·레버리지·인버스 포함)</li>'
      +   '<li>정규장 08:30~15:30 지정가 / 시장가 · 시간외 08:00~08:30, 15:40~20:00 지정가</li>'
      +   '<li>수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2) + '% (ETF·ETN 면제) — 실전과 동일</li>'
      +   '<li>주문 뒤에 실제로 거래된 가격으로 체결됩니다</li>'
      +   '<li>참가자 ' + fmtNum(season.participants) + '명 · 분기마다 초기화</li>'
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
      + '<div class="mk-sheet mk-joinflow" role="dialog" aria-modal="true" aria-label="시즌 참가">' + inner + '</div>';
  }

  function closeJoin() {
    var el = document.getElementById('mkJoin');
    if (el) el.remove();
    if (!document.getElementById('mkSheet')) document.body.classList.remove('mk-noscroll');
  }

  function openJoinFlow() {
    if (!season || !season.season || season.joined) return;
    var s = season.season;
    joinShell(
        '<div class="mk-jf-step">1 / 2</div>'
      + '<h3 class="mk-jf-title">🏁 ' + escapeHtml(s.name) + '에<br>참여하시겠습니까?</h3>'
      + '<p class="mk-jf-lead">가상 시드머니 <b>' + fmtCompact(s.seed) + '원</b>으로 실제 주가에 맞춰 매매하고, '
      +   '<b>' + escapeHtml(s.endDate) + '</b> 종가 기준 최종 자산으로 순위를 가립니다.</p>'
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
      + (s.notice ? '<div class="mk-jf-h">📢 운영진 전달사항</div><div class="mk-jf-notice">' + escapeHtml(s.notice) + '</div>' : '')
      + '<div class="mk-jf-h">⚠️ 주의사항</div>'
      + li([
          '<b>가상의 자금</b>입니다. 실제 돈과 무관하며 현금·포인트·상품 등 어떤 것으로도 교환되지 않습니다.',
          '실제 매매·투자 권유가 아닙니다. 모의 결과는 실제 투자 성과와 다를 수 있습니다.',
          '시세는 네이버 증권 기준이며 지연·오류가 있을 수 있습니다. 시세 오류로 생긴 체결은 운영진이 바로잡을 수 있습니다.',
          '순위표에 <b>이름 · 총자산 · 수익률 · 체결 건수</b>가 회원들에게 공개됩니다. 보유 종목은 공개되지 않습니다.',
          '1인 1계정입니다. 부정한 방법이 확인되면 순위에서 제외됩니다.'
        ])
      + '<div class="mk-jf-h">📌 매매 규칙</div>'
      + li([
          '시드머니 <b>' + fmtCompact(s.seed) + '원</b> · 분기마다 초기화 · 순위는 <b>실시간</b>, 최종 순위는 ' + escapeHtml(s.endDate) + ' 15:30 종가 기준',
          '국내 상장 <b>전 종목</b> — 주식 · ETF(레버리지 · 인버스 포함) · ETN',
          '정규장 08:30~15:30 지정가 / 시장가 · 시간외 08:00~08:30, 15:40~20:00 지정가만',
          '수수료 ' + (s.feeRate * 100).toFixed(3) + '% · 매도세 ' + (s.taxRate * 100).toFixed(2) + '% (ETF · ETN 면제) — 실전과 동일',
          '주문 뒤에 <b>실제로 거래된 가격과 수량</b>으로 체결됩니다. 거래가 적은 종목은 여러 번에 나눠 체결될 수 있습니다.',
          '신용 · 미수 · 공매도는 없고, 배당은 반영되지 않습니다.'
        ])
      + '<label class="mk-jf-check"><input type="checkbox" id="mkAgree" onchange="document.getElementById(\'mkJoinGo\').disabled = !this.checked"> 위 내용을 확인했습니다</label>'
      + '<div class="mk-jf-btns"><button class="btn-ghost" onclick="Mock.closeJoin()">취소</button>'
      + '<button class="btn-submit" id="mkJoinGo" disabled onclick="Mock.join(this)">' + fmtCompact(s.seed) + '원 받고 시작하기</button></div>');
  }

  function joinDone(cash) {
    joinShell(
        '<div class="mk-jf-done">🎉</div>'
      + '<h3 class="mk-jf-title" style="text-align:center">시드머니 ' + fmtCompact(cash) + '원이<br>지급됐습니다</h3>'
      + '<p class="mk-jf-lead" style="text-align:center">시세 탭에서 종목을 고르면 아래에 <b>매수 · 매도</b> 버튼이 나옵니다.</p>'
      + '<div class="mk-jf-btns"><button class="btn-ghost" onclick="Mock.closeJoin()">계좌 보기</button>'
      + '<button class="btn-submit" onclick="Mock.closeJoin(); switchTab(\'market\')">종목 보러 가기</button></div>');
  }

  async function join(btn) {
    btn.disabled = true; btn.textContent = '참가 중...';
    try {
      var r = await api('/join', 'POST');
      await refreshSeason();
      renderAccount();
      joinDone(r.cash);
    } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = '다시 시도'; }
  }

  async function cancel(id, btn) {
    if (btn) btn.disabled = true;
    try { await api('/orders/' + id, 'DELETE'); }
    catch (e) { alert(e.message); }
    await refreshAccount();
  }

  async function loadHistory(reset) {
    var el = document.getElementById('mkHistory');
    if (!el) return;
    if (reset) { histNext = null; el.innerHTML = '<div class="loading">불러오는 중...</div>'; }
    try {
      var d = await api('/history' + (histNext ? '?before=' + histNext : ''));
      var rows = d.items.map(function (f) {
        var t = new Date(f.at);
        var p = function (n) { return String(n).padStart(2, '0'); };
        return '<div class="mk-ord">'
          + '<span class="mk-side ' + f.side + '">' + (f.side === 'buy' ? '매수' : '매도') + '</span>'
          + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(f.name) + '</span>'
          +   '<span class="mk-pos-sub">' + (t.getMonth() + 1) + '.' + t.getDate() + ' ' + p(t.getHours()) + ':' + p(t.getMinutes())
          +   ' · ' + fmtNum(f.qty) + '주 × ' + fmtNum(f.price) + '</span></span>'
          + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(f.qty * f.price) + '</span>'
          +   '<span class="mk-pos-sub">비용 ' + fmtNum(f.fee + f.tax) + '</span></span>'
          + '</div>';
      }).join('');
      if (reset) el.innerHTML = rows || '<div class="empty">아직 체결된 주문이 없습니다.</div>';
      else { var more = el.querySelector('.mk-more'); if (more) more.remove(); el.insertAdjacentHTML('beforeend', rows); }
      histNext = d.next;
      if (histNext) el.insertAdjacentHTML('beforeend', '<button class="mini-btn mk-more" onclick="Mock.loadHistory(false)">더 보기</button>');
    } catch (e) {
      if (reset) el.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
    }
  }

  /* ===== 랭킹 ===== */
  var _rankBuilt = false, _hallHtml = null, _prevRank = {};

  async function loadRanking() {
    var el = document.getElementById('tab-ranking');
    if (!el) return;
    // 갱신할 때마다 "불러오는 중"으로 깜빡이지 않게 첫 번만 표시한다
    if (!_rankBuilt) el.innerHTML = '<div class="loading">순위를 불러오는 중...</div>';
    var h = '';
    try {
      var d = await api('/leaderboard');
      var t = new Date(d.asOf), p = function (n) { return String(n).padStart(2, '0'); };
      h += '<section class="m-section"><div class="m-head"><h3>🏆 ' + escapeHtml(d.season.name) + '</h3>'
        + '<span class="m-hint">' + p(t.getHours()) + ':' + p(t.getMinutes()) + ' 기준 · ' + (d.live ? '장중' : '종가') + '</span></div>';
      h += d.rows.length ? d.rows.map(function (r) {
        var rr = (r.equity - d.season.seed) / d.season.seed * 100;
        var medal = r.rank === 1 ? '🥇' : (r.rank === 2 ? '🥈' : (r.rank === 3 ? '🥉' : r.rank));
        // 직전 갱신보다 순위가 오르내렸으면 잠깐 표시한다
        var was = _prevRank[r.nickname], move = (was && was !== r.rank) ? (was > r.rank ? ' moved-up' : ' moved-down') : '';
        _prevRank[r.nickname] = r.rank;
        return '<div class="mk-rank' + (r.me ? ' me' : '') + move + '">'
          + '<span class="mk-rank-no">' + medal + '</span>'
          + '<span class="mk-ord-main"><span class="mk-pos-name">' + escapeHtml(r.nickname) + (r.me ? ' <i class="mk-tag">나</i>' : '') + '</span>'
          +   '<span class="mk-pos-sub">체결 ' + fmtNum(r.fills) + '건</span></span>'
          + '<span class="mk-pos-num"><span class="mk-pos-val">' + fmtNum(r.equity) + '</span>'
          +   '<span class="mk-pos-pnl ' + signClass(rr) + '">' + fmtRate(rr) + '</span></span>'
          + '</div>';
      }).join('') : '<div class="empty">아직 참가자가 없습니다.</div>';
      h += '<div class="mk-note">실시간 순위입니다 — 장중 10초마다 다시 매깁니다. 최종 순위는 ' + escapeHtml(d.season.endDate) + ' KRX 정규장 종가 기준 총자산으로 확정됩니다.</div></section>';
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
          : '<button class="mk-buy" onclick="switchTab(\'account\')">모의투자 참가하고 매수하기</button>')
      + '</div>';
    host.appendChild(bar);
  }

  /* ===== 주문창 ===== */
  async function openSheet(side) {
    if (!curStock) return;
    var q = (typeof _lastQuote !== 'undefined' && _lastQuote && _lastQuote.code === curStock.code) ? _lastQuote : null;
    // 시간외에는 화면에 보이는 그 시장의 가격(q.price), 정규장에는 KRX 가격을 기본값으로
    var px = q ? (phaseInfo().limitOnly ? (q.price || (q.krx && q.krx.price)) : ((q.krx && q.krx.price) || q.price)) : 0;
    sheet = { code: curStock.code, name: curStock.name, side: side, type: 'limit', price: px, qty: '', taxFree: false, busy: false };
    renderSheet();
    // 장 구간(정규장·시간외)이 바뀌었을 수 있으니 열 때마다 최신 상태를 받아 다시 그린다
    refreshAccount().then(function () { if (sheet && !sheet.busy) renderSheet(); });
    try {
      var k = await api('/kind?code=' + encodeURIComponent(sheet.code));
      if (sheet && sheet.code === k.code) { sheet.taxFree = k.taxFree; renderSheet(); }
    } catch (e) { /* 호가단위는 서버가 다시 확인한다 */ }
  }

  function closeSheet() {
    sheet = null;
    var el = document.getElementById('mkSheet');
    if (el) el.remove();
    document.body.classList.remove('mk-noscroll');
  }

  /** 지금이 어느 구간인지 — 계좌 응답이 더 최신이면 그쪽을 쓴다 */
  function phaseInfo() {
    var src = (account && account.phase) ? account : (season || {});
    return { phase: src.phase || 'closed', canOrder: !!src.canOrder, limitOnly: !!src.limitOnly };
  }

  function sessionNote() {
    var p = phaseInfo();
    if (p.phase === 'break') return '<div class="mk-warn">15:30~15:40 에는 주문을 받지 않습니다 — 15:40 부터 애프터마켓</div>';
    if (!p.canOrder) return '<div class="mk-warn">지금은 주문할 수 없습니다 — 평일 08:00~20:00</div>';
    if (p.phase === 'pre_market') return '<div class="mk-info"><b>프리마켓(NXT)</b> — 지정가만 가능 · 08:50 까지 체결되지 않으면 취소됩니다</div>';
    if (p.phase === 'after_market') return '<div class="mk-info"><b>애프터마켓</b> — 지정가만 가능 · 20:00 까지 체결되지 않으면 취소됩니다. ETF·ETN 은 대상이 아닙니다</div>';
    if (p.phase === 'pre_open') return '<div class="mk-info">장 시작 전입니다 — 09:00 <b>시가</b>에 체결됩니다</div>';
    if (p.phase === 'close_auction') return '<div class="mk-info">장 마감 동시호가입니다 — 15:30 <b>종가</b>에 체결됩니다</div>';
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

  function renderSheet() {
    if (!sheet) return;
    var s = sheet, n = sheetNumbers(), a = account;
    var el = document.getElementById('mkSheet');
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
      + '<div class="mk-sheet ' + s.side + '" role="dialog" aria-modal="true" aria-label="주문">'
      + '<div class="mk-sheet-head"><span class="mk-sheet-title">' + escapeHtml(s.name) + ' <i>' + escapeHtml(s.code) + '</i></span>'
      +   '<button class="mini-btn" onclick="Mock.closeSheet()" aria-label="닫기">✕</button></div>'
      + '<div class="seg-row mk-seg2">'
      +   '<button class="seg' + (isBuy ? ' on buy' : '') + '" onclick="Mock.setSheet(\'side\',\'buy\')">매수</button>'
      +   '<button class="seg' + (!isBuy ? ' on sell' : '') + '" onclick="Mock.setSheet(\'side\',\'sell\')">매도</button>'
      + '</div>'
      + '<div class="seg-row sub mk-seg2">'
      +   '<button class="seg' + (s.type === 'limit' ? ' on' : '') + '" onclick="Mock.setSheet(\'type\',\'limit\')">지정가</button>'
      +   '<button class="seg' + (s.type === 'market' ? ' on' : '') + '" onclick="Mock.setSheet(\'type\',\'market\')"' + (limitOnly ? ' disabled' : '') + '>시장가</button>'
      + '</div>'
      + sessionNote()
      + '<label class="mk-field"><span>가격</span>'
      + (s.type === 'market'
          ? '<div class="mk-market">시장가 — 주문 뒤 실제로 거래되는 가격에 체결</div>'
          : '<div class="mk-stepper"><button onclick="Mock.step(-1)" aria-label="한 호가 내리기">−</button>'
            + '<input id="mkPrice" type="text" inputmode="numeric" value="' + (n.price ? fmtNum(n.price) : '') + '" oninput="Mock.input(\'price\', this)">'
            + '<button onclick="Mock.step(1)" aria-label="한 호가 올리기">+</button></div>')
      + '</label>'
      + '<label class="mk-field"><span>수량</span>'
      +   '<div class="mk-stepper"><input id="mkQty" type="text" inputmode="numeric" placeholder="0" value="' + (n.qty ? fmtNum(n.qty) : '') + '" oninput="Mock.input(\'qty\', this)"><em>주</em></div>'
      + '</label>'
      + '<div class="mk-pct">' + [10, 25, 50, 100].map(function (p) {
          return '<button class="mini-btn" onclick="Mock.pct(' + p + ')">' + (p === 100 ? '최대' : p + '%') + '</button>';
        }).join('') + '<span class="mk-dim">' + (isBuy ? '최대 ' : '보유 ') + fmtNum(n.maxQty) + '주</span></div>'
      + '<div class="mk-calc">'
      +   row('주문 금액', won(n.amount))
      +   row('수수료' + (n.tax || !isBuy ? ' · 세금' : ''), won(n.fee + n.tax))
      +   (a ? row(isBuy ? '주문 후 주문 가능 금액' : '받을 금액', won(isBuy ? a.available - n.amount - n.fee : n.amount - n.fee - n.tax)) : '')
      + '</div>'
      + '<div class="mk-sheet-msg" id="mkMsg"></div>'
      + '<button class="mk-submit ' + s.side + '" id="mkSubmit" onclick="Mock.submit()"' + (s.busy ? ' disabled' : '') + '>'
      +   (isBuy ? '매수' : '매도') + ' 주문</button>'
      + '</div>';
  }
  function row(k, v) { return '<div class="mk-calc-row"><span>' + k + '</span><b>' + v + '</b></div>'; }

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
    var n = sheetNumbers(), calc = document.querySelector('#mkSheet .mk-calc');
    if (calc) {
      var isBuy = sheet.side === 'buy', a = account;
      calc.innerHTML = row('주문 금액', won(n.amount))
        + row('수수료' + (n.tax || !isBuy ? ' · 세금' : ''), won(n.fee + n.tax))
        + (a ? row(isBuy ? '주문 후 주문 가능 금액' : '받을 금액', won(isBuy ? a.available - n.amount - n.fee : n.amount - n.fee - n.tax)) : '');
    }
  }

  function step(dir) {
    if (!sheet || sheet.busy) return;
    var p = Number(sheet.price) || 0;
    // 내릴 때는 한 단계 아래 가격대의 호가단위를 따른다 (예: 200,000 → 199,900)
    var t = dir > 0 ? tickSize(p, sheet.taxFree) : tickSize(Math.max(1, p - 1), sheet.taxFree);
    var np = dir > 0 ? Math.floor(p / t) * t + t : Math.ceil(p / t) * t - t;
    sheet.price = Math.max(t, np);
    renderSheet();
  }

  function pct(p) {
    if (!sheet || sheet.busy) return;
    sheet.qty = Math.floor(sheetNumbers().maxQty * p / 100);
    renderSheet();
  }

  function msg(text, cls) {
    var el = document.getElementById('mkMsg');
    if (el) { el.textContent = text || ''; el.className = 'mk-sheet-msg ' + (cls || ''); }
  }

  async function submit() {
    if (!sheet || sheet.busy) return;
    var n = sheetNumbers();
    if (n.qty <= 0) { msg('수량을 입력해 주세요', 'err'); return; }
    if (sheet.type === 'limit' && n.price <= 0) { msg('가격을 입력해 주세요', 'err'); return; }
    sheet.busy = true;
    var btn = document.getElementById('mkSubmit');
    if (btn) { btn.disabled = true; btn.textContent = '주문 접수 중...'; }
    // 같은 주문이 두 번 들어가지 않도록 주문마다 고유값을 붙인다 (서버가 재전송을 같은 주문으로 본다)
    var cid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    try {
      var d = await api('/orders', 'POST', {
        clientOrderId: cid, code: sheet.code, side: sheet.side, type: sheet.type, qty: n.qty,
        limitPrice: sheet.type === 'limit' ? n.price : undefined
      });
      msg('주문을 접수했습니다. 실제 거래가 발생하면 체결됩니다…', 'ok');
      if (btn) btn.textContent = '체결 대기 중...';
      watchOrder(d.order.id, 0);
    } catch (e) {
      sheet.busy = false;
      msg(e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = (sheet.side === 'buy' ? '매수' : '매도') + ' 주문'; }
    }
  }

  /** 주문 직후 2초마다 상태를 물어본다 — 물어볼 때 서버가 체결을 시도한다. 1분 넘으면 크론에 맡긴다 */
  function watchOrder(id, tries) {
    clearTimeout(watchingOrder);
    watchingOrder = setTimeout(async function () {
      try {
        var d = await api('/orders/' + id);
        var o = d.order;
        if (o.status === 'filled' || o.status === 'cancelled' || o.status === 'expired' || o.status === 'rejected') {
          await refreshAccount();
          var done = o.filledQty > 0
            ? (o.name + ' ' + fmtNum(o.filledQty) + '주 ' + (o.side === 'buy' ? '매수' : '매도') + ' 체결' + (d.fill ? ' @ ' + fmtNum(d.fill.price) : ''))
            : ('주문이 ' + (o.status === 'cancelled' ? '취소' : '만료') + '됐습니다' + (o.reason ? ' — ' + o.reason : ''));
          closeSheet();
          toast(done, o.filledQty > 0 ? o.side : '');
          return;
        }
        if (o.filledQty > 0) msg(fmtNum(o.filledQty) + '/' + fmtNum(o.qty) + '주 체결 — 나머지는 거래가 생기는 대로 체결됩니다', 'ok');
        if (tries >= 30 || !sheet) {
          await refreshAccount();
          if (sheet) { closeSheet(); toast('주문이 대기 중입니다 — 계좌 탭의 미체결 주문에서 확인하세요', ''); }
          return;
        }
        watchOrder(id, tries + 1);
      } catch (e) { if (tries < 30 && sheet) watchOrder(id, tries + 1); }
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

  /* ===== 관리자: 시즌 만들기 ===== */
  function adminHtml() {
    if (!season || !season.isAdmin) return '';
    return '<details class="mk-admin"><summary>⚙️ 시즌 관리 (운영진)</summary>'
      + '<div class="form-grid">'
      + '<input class="f-input" id="mkSid" placeholder="시즌 ID (예: 2026PRE, 2027Q1)">'
      + '<input class="f-input" id="mkSname" placeholder="이름 (예: 프리시즌, 2027년 1분기)">'
      + '<div class="form-row"><input type="date" class="f-input" id="mkSstart" aria-label="시작일">'
      + '<input type="date" class="f-input" id="mkSend" aria-label="종료일"></div>'
      + '<textarea class="f-textarea" id="mkSnotice" maxlength="1000" placeholder="전달사항 (선택) — 참가 안내 창에 표시됩니다" style="min-height:80px"></textarea>'
      + '<button class="btn-submit" onclick="Mock.saveSeason(this)">시즌 저장</button>'
      + '<div class="status-msg" id="mkSstatus"></div>'
      + '<p class="mk-note">시드 1억원 · 수수료 0.015% · 매도세 0.20% 로 만들어집니다. 시작일이 되면 자동으로 열리고, 종료일 장 마감 후 최종 순위가 확정됩니다.</p>'
      + '</div></details>';
  }

  async function saveSeason(btn) {
    var st = document.getElementById('mkSstatus');
    var v = function (id) { return document.getElementById(id).value.trim(); };
    btn.disabled = true;
    try {
      await api('/admin/seasons', 'POST', { id: v('mkSid'), name: v('mkSname'), startDate: v('mkSstart'), endDate: v('mkSend'), notice: v('mkSnotice') });
      st.innerHTML = '<span class="ok">✅ 저장했습니다.</span>';
      await refreshSeason();
      renderAccount();
    } catch (e) { st.innerHTML = '<span class="err">❌ ' + escapeHtml(e.message) + '</span>'; }
    btn.disabled = false;
  }

  return {
    isOn: function () { return on; },
    setMode: setMode, onTab: onTab, renderTradeBar: renderTradeBar,
    join: join, openJoinFlow: openJoinFlow, joinStep2: joinStep2, closeJoin: closeJoin, cancel: cancel, loadHistory: loadHistory,
    openSheet: openSheet, closeSheet: closeSheet, setSheet: setSheet, input: input, step: step, pct: pct, submit: submit,
    saveSeason: saveSeason
  };
})();
