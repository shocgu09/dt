/* ===== DT 공통 — 폰 키보드 대응 =====
 * 폰에서 키보드가 올라와도 화면(레이아웃)은 그대로라, 아래에 붙은 창·입력줄이 키보드 뒤로 숨는다.
 * visualViewport 로 실제 보이는 영역을 재서 :root 에 두 값을 둔다 — 각 페이지 CSS 가 이 값으로 창을 올린다.
 *   --kb  : 키보드(+주소창 변화)로 가려진 아래쪽 높이 (키보드가 없으면 0px)
 *   --vvh : 지금 보이는 영역의 높이 (창 최대 높이를 여기에 맞춘다)
 *   --vvt : 보이는 영역이 위로 밀려 올라간 만큼 — 아이폰은 키보드를 띄우며 화면 전체를 위로 끌어올리기도 한다.
 *           위에 붙은 전체 화면(그룹 이름 입력·법률 도우미)은 이만큼 내려야 머리글이 잘리지 않는다.
 * 입력칸에 초점이 가면 키보드가 다 올라온 뒤 그 칸이 보이도록 (창 안에서) 스크롤한다.
 * 키보드가 레이아웃까지 줄이는 브라우저(안드로이드 일부)에서는 차이가 0 이라 아무것도 바뀌지 않는다.
 */
(function () {
  var vv = window.visualViewport;
  var root = document.documentElement;

  // 채팅 목록(data-kb-stick)은 키보드로 높이가 줄어도 아래쪽을 기준으로 유지한다.
  // 줄어든 만큼 위로 스크롤해 주지 않으면 보던 최신 메시지가 입력줄 뒤로 밀려 내려간다.
  var sticks = [];
  function keepBottom(el) {
    var h = el.clientHeight, prev = el._kbH || 0;
    el._kbH = h;
    if (prev > 0 && h > 0 && prev !== h) el.scrollTop += prev - h;   // 처음 보일 때(숨김→표시)는 건드리지 않는다
  }
  function keepAll() { sticks.forEach(keepBottom); }

  function update() {
    if (!vv) return;
    var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb', kb + 'px');
    root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    root.style.setProperty('--vvt', Math.max(0, Math.round(vv.offsetTop)) + 'px');
    // 키보드가 떠 있는가 — 화면이 끌어올려지면 --kb 는 작아지므로 전체 높이 차이로 본다(확대 중일 때는 제외)
    root.classList.toggle('kb-open', window.innerHeight - vv.height > 80 && (vv.scale || 1) < 1.05);
    keepAll();
  }
  if (vv) {
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
  }
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t || !t.matches || !t.matches('input, textarea, select')) return;
    if (t.type === 'checkbox' || t.type === 'radio' || t.type === 'range') return;
    keepAll();   // 키보드가 뜨기 전 높이를 기억해 둔다
    // 키보드가 올라오는 애니메이션(약 0.3초) 뒤에 — 그 전에 스크롤하면 다시 가려진다
    setTimeout(function () {
      if (document.activeElement !== t) return;
      update();
      try { t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (err) { t.scrollIntoView(false); }
    }, 350);
  });

  // 목록 높이가 다른 이유(사진 미리보기 등)로 바뀔 때도 같은 처리
  var ro = window.ResizeObserver ? new ResizeObserver(function (entries) {
    entries.forEach(function (en) { keepBottom(en.target); });
  }) : null;
  function watch() {
    document.querySelectorAll('[data-kb-stick]').forEach(function (el) {
      if (el._kbWatched) return;
      el._kbWatched = true; el._kbH = el.clientHeight; sticks.push(el);
      if (ro) ro.observe(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
