/* ===== 회원 마지막 접속 시간·위치 기록 (모든 페이지 공용) =====
 * 예전에는 메인 홈(app.js)을 새로 열 때만 users/{uid}.lastSeen 을 갱신해서,
 * 재테크·스팟 같은 하위 페이지에서만 머문 회원이나 백그라운드에서 다시 켠 PWA 는 접속 시간이 멈춰 있었다.
 * 이제 페이지를 열 때, 앱·탭으로 돌아올 때, 그리고 쓰고 있는 동안 5분마다 갱신한다.
 * 페이지 스크립트(app.js 등)가 firebase.initializeApp 을 부른 뒤에 실행되도록 그 뒤에 넣는다. */
var DtLastSeen = (function () {
  var WRITE_GAP = 5 * 60 * 1000;   // 같은 기기에서 이보다 자주 쓰지 않는다
  var LOC_TTL = 30 * 60 * 1000;    // 위치(IP 조회)는 30분에 한 번만 새로 묻는다
  var LOOKUP_TIMEOUT = 5000;       // 위치 조회가 멈춰도 접속 시간 기록은 기다리지 않는다

  var inflight = null;
  var lastInput = Date.now();

  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, ms);
    })]);
  }

  function lookupLocation() {
    var cached = null;
    try { cached = JSON.parse(load('dt_last_loc') || 'null'); } catch (e) {}
    if (cached && cached.loc && Date.now() - cached.at < LOC_TTL) return Promise.resolve(cached.loc);
    return withTimeout(fetch('https://ipapi.co/json/').then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) { return [d.city, d.region].filter(Boolean).join(', ') || d.country_name || ''; }), LOOKUP_TIMEOUT)
      .catch(function () {
        return withTimeout(fetch('https://api.ip.sb/geoip').then(function (r) { return r.json(); })
          .then(function (d) { return [d.city, d.region].filter(Boolean).join(', ') || d.country || ''; }), LOOKUP_TIMEOUT);
      })
      .catch(function () { return ''; })
      .then(function (loc) {
        if (loc) save('dt_last_loc', JSON.stringify({ loc: loc, at: Date.now() }));
        return loc;
      });
  }

  // 접속 시간(+위치)을 기록한다. 실패해도 조용히 넘어가고, 항상 resolve 되는 Promise 를 돌려준다.
  function touch(uid) {
    if (!uid) return Promise.resolve();
    if (inflight) return inflight;
    var key = 'dt_last_seen_' + uid;
    if (Date.now() - (Number(load(key)) || 0) < WRITE_GAP) return Promise.resolve();
    inflight = lookupLocation().then(function (loc) {
      var update = { lastSeen: new Date().toISOString() };
      if (loc) update.lastLocation = loc;
      return firebase.firestore().collection('users').doc(uid).update(update);
    }).then(function () {
      save(key, String(Date.now()));
    }).catch(function () {}).then(function () {
      inflight = null;
    });
    return inflight;
  }

  function currentMemberUid() {
    var user = firebase.auth().currentUser;
    return user && !user.isAnonymous && user.emailVerified ? user.uid : null;
  }

  function start() {
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
    firebase.auth().onAuthStateChanged(function () { touch(currentMemberUid()); });
    // PWA·탭으로 돌아오면 새로 연 것으로 본다
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      lastInput = Date.now();
      touch(currentMemberUid());
    });
    // 화면을 켜 두고 실제로 쓰는 동안(최근 5분 안에 조작)만 주기적으로 갱신한다
    ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(function (type) {
      window.addEventListener(type, function () { lastInput = Date.now(); }, { capture: true, passive: true });
    });
    setInterval(function () {
      if (document.visibilityState === 'visible' && Date.now() - lastInput < WRITE_GAP) touch(currentMemberUid());
    }, 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return { touch: touch };
})();
