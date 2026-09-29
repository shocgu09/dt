/* ===== DT 공통 — 폰 키보드 대응 =====
 * 폰에서 키보드가 올라와도 화면(레이아웃)은 그대로라, 아래에 붙은 창·입력줄이 키보드 뒤로 숨는다.
 * visualViewport 로 실제 보이는 영역을 재서 :root 에 두 값을 둔다 — 각 페이지 CSS 가 이 값으로 창을 올린다.
 *   --kb  : 키보드(+주소창 변화)로 가려진 아래쪽 높이 (키보드가 없으면 0px)
 *   --vvh : 지금 보이는 영역의 높이 (창 최대 높이를 여기에 맞춘다)
 * 입력칸에 초점이 가면 키보드가 다 올라온 뒤 그 칸이 보이도록 (창 안에서) 스크롤한다.
 * 키보드가 레이아웃까지 줄이는 브라우저(안드로이드 일부)에서는 차이가 0 이라 아무것도 바뀌지 않는다.
 */
(function () {
  var vv = window.visualViewport;
  var root = document.documentElement;
  function update() {
    if (!vv) return;
    var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb', kb + 'px');
    root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    root.classList.toggle('kb-open', kb > 80);
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
    // 키보드가 올라오는 애니메이션(약 0.3초) 뒤에 — 그 전에 스크롤하면 다시 가려진다
    setTimeout(function () {
      if (document.activeElement !== t) return;
      update();
      try { t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (err) { t.scrollIntoView(false); }
    }, 350);
  });
})();
