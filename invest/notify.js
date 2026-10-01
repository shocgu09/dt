/* ===== 재테크 알림 =====
 * 헤더의 🔔 → 알림 설정 창. 알림 허용·구독은 기기마다, 종류별 켜기/끄기는 계정 기준(모든 기기)이다.
 * 보내는 쪽
 *  - 시황 브리핑 새 글: 관리자가 게시하면 이 화면이 dt-push 에 일괄 발송을 맡긴다 (AI 브리핑은 dt-digest 가 직접)
 *  - 내 댓글에 답글: 답글을 단 화면이 dt-push 에 알린다 (dt-push 가 Firestore 에서 원댓글 작성자를 확인)
 *  - 내 공유글 댓글 · 체결 · 미수/담보부족/반대매매: dt-stock 워커가 보낸다
 * 구독 정보는 메인 화면과 같은 곳(dt-push KV)에 둔다 — DM 알림과 같은 구독을 함께 쓴다.
 */
var InvestNotify = (function () {
  var PUSH_URL = 'https://dt-push.shocguna.workers.dev';
  var VAPID = 'BKwd57WtNgaA_SPFMaKdlVMQd_-VMDspL0P8n32PXdaFW2NKDn1MOZi3vCkCAnu2v0yzwurjxoPt3zzmom90FVM';
  var KINDS = [
    ['briefing', '📰 새 시황 브리핑', '시황 탭에 브리핑이 올라오면'],
    ['reply', '💬 내 댓글에 답글', '시황 브리핑에 단 내 댓글'],
    ['share', '💬 내 공유글에 댓글', '랭킹 탭 커뮤니티에 올린 글'],
    ['fill', '✅ 주문 체결', '화면을 보고 있지 않을 때 체결되면'],
    ['margin', '⚠️ 미수 · 담보부족 · 반대매매', '결제일 밤 정산 결과와 반대매매 예정']
  ];
  var prefs = null, devices = 0, here = false, loadErr = '';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent); }
  function standalone() { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }

  async function call(path, method, body) {
    if (!currentUser) throw new Error('로그인이 필요합니다');
    var token = await currentUser.getIdToken();
    var r = await fetch(PUSH_URL + path, {
      method: method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || '알림 서버 오류');
    return d;
  }

  async function swReg() {
    var reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    return reg;
  }

  /** 이 기기가 이미 구독돼 있는지 */
  async function checkHere() {
    here = false;
    if (!supported() || Notification.permission !== 'granted') return;
    try { var reg = await navigator.serviceWorker.getRegistration('/'); here = !!(reg && await reg.pushManager.getSubscription()); } catch (e) {}
  }

  async function open() {
    paint('<div class="nt-loading">불러오는 중</div>');
    loadErr = '';
    try { var d = await call('/api/prefs'); prefs = d.prefs; devices = d.devices || 0; }
    catch (e) { loadErr = e.message; }
    await checkHere();
    render();
  }

  function deviceHtml() {
    if (isIOS() && !standalone()) {
      return '<div class="nt-dev warn">iPhone·iPad 는 Safari 에서 <b>공유 → 홈 화면에 추가</b>한 앱으로 열어야 알림을 받을 수 있습니다.</div>';
    }
    if (!supported()) return '<div class="nt-dev warn">이 브라우저는 알림을 지원하지 않습니다.</div>';
    if (Notification.permission === 'denied') return '<div class="nt-dev warn">이 기기에서 알림이 차단되어 있습니다. 브라우저(또는 휴대폰) 설정에서 DT Club 알림을 허용해 주세요.</div>';
    if (here) return '<div class="nt-dev on"><i class="nt-dot"></i><span class="nt-on-txt">이 기기에서 알림을 받고 있습니다</span></div>';
    return '<div class="nt-dev"><span>이 기기는 아직 알림을 받지 않습니다</span>'
      + '<button class="btn-submit nt-enable" onclick="InvestNotify.enable(this)">이 기기에서 알림 받기</button></div>';
  }

  function render() {
    var h = '<div class="nt-head"><h3>🔔 재테크 알림</h3><button class="mini-btn" onclick="InvestNotify.close()" aria-label="닫기">✕</button></div>'
      + deviceHtml();
    if (loadErr) h += '<div class="nt-dev warn">' + esc(loadErr) + '</div>';
    else if (prefs) {
      h += '<div class="nt-list" role="group" aria-label="받을 알림">' + KINDS.map(function (k) {
        return '<label class="nt-row"><span class="nt-txt"><b>' + k[1] + '</b><em>' + k[2] + '</em></span>'
          + '<input type="checkbox" class="nt-sw" ' + (prefs[k[0]] !== false ? 'checked' : '') + ' onchange="InvestNotify.setPref(\'' + k[0] + '\', this)">'
          + '<i class="nt-switch" aria-hidden="true"></i></label>';
      }).join('') + '</div>'
        + '<p class="nt-note">종류별 설정은 계정에 저장돼 알림을 켠 모든 기기에 함께 적용됩니다'
        + (devices ? ' · 알림 받는 기기 ' + devices + '대' : '') + '.</p>';
    }
    paint(h);
  }

  function paint(inner) {
    var el = document.getElementById('ntSheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ntSheet';
      el.className = 'nt-wrap';
      document.body.appendChild(el);
      document.addEventListener('keydown', onKey);
    }
    el.innerHTML = '<div class="nt-dim" onclick="InvestNotify.close()"></div><div class="nt-sheet" role="dialog" aria-modal="true" aria-label="재테크 알림">' + inner + '</div>';
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() {
    var el = document.getElementById('ntSheet');
    if (el) el.remove();
    document.removeEventListener('keydown', onKey);
  }

  async function enable(btn) {
    if (btn) btn.disabled = true;
    try {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { showToast('알림이 허용되지 않았습니다'); render(); return; }
      var reg = await swReg();
      var sub = await reg.pushManager.getSubscription();
      if (!sub) {
        var key = Uint8Array.from(atob(VAPID.replace(/-/g, '+').replace(/_/g, '/')), function (c) { return c.charCodeAt(0); });
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      var token = await currentUser.getIdToken();
      var r = await fetch(PUSH_URL + '/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ uid: currentUser.uid, subscription: sub.toJSON() })
      });
      if (!r.ok) throw new Error('알림 등록에 실패했습니다');
      showToast('🔔 이 기기에서 재테크 알림을 받습니다');
      await open();
    } catch (e) {
      showToast(e.message || '알림을 켜지 못했습니다');
      if (btn) btn.disabled = false;
    }
  }

  async function setPref(kind, el) {
    if (!prefs) return;
    var on = !!el.checked, patch = {};
    patch[kind] = on;
    el.disabled = true;
    try { var d = await call('/api/prefs', 'POST', { prefs: patch }); prefs = d.prefs; }
    catch (e) { el.checked = !on; showToast(e.message); }
    finally { el.disabled = false; }
  }

  /** 관리자가 브리핑을 새로 게시한 뒤 — 회원들에게 일괄 발송 (한 번에 40건씩 이어서). 받은 회원 수를 돌려준다 */
  async function briefingPosted(id) {
    var cursor = 0, members = 0;
    try {
      for (var i = 0; i < 30 && cursor != null; i++) {
        var d = await call('/api/notify/briefing', 'POST', { briefingId: id, cursor: cursor });
        members += d.members || 0;
        cursor = d.next;
      }
      return members;
    } catch (e) { console.warn('briefing notify failed', e && e.message); return null; }
  }

  /** 시황 댓글을 단 뒤 — 답글이면 원댓글 작성자에게 (서버가 확인한다) */
  function commentPosted(briefingId, commentId) {
    call('/api/notify/comment', 'POST', { briefingId: briefingId, commentId: commentId }).catch(function () {});
  }

  return { open: open, close: close, enable: enable, setPref: setPref, briefingPosted: briefingPosted, commentPosted: commentPosted };
})();
