/* ===== 새 기능 NEW 꼬리표 (모든 페이지 공용) =====
 * 새로 생긴 기능의 버튼·제목 옆에 빨간 'NEW' 를 붙인다. 생긴 날부터 14일 동안 모든 회원에게 보이고, 그 뒤엔 저절로 사라진다.
 * 열어 봐도 사라지지 않는다 (회원들이 새 기능이 있는지 몰라서 붙이는 표시라, 기간 동안은 계속 보이게).
 *
 * 새 표시를 달 때
 *   1) 아래 FEATURES 에 '이름': '생긴 날(한국 날짜)' 을 넣는다
 *   2-a) 정적 HTML:   <button data-new="이름">…</button>      → 페이지가 뜰 때 글자 뒤에 NEW 가 붙는다
 *   2-b) JS 로 그리는 화면:  '…' + DtNew.html('이름') + '…'   → 기간이 지났으면 빈 문자열
 *        (JS 로 그린 뒤 data-new 를 썼다면 DtNew.apply(그 영역) 을 한 번 부른다)
 * 이 파일은 페이지 스크립트보다 먼저(head 의 tokens.css 바로 뒤) 불러온다 — 템플릿이 DtNew 를 바로 쓸 수 있게.
 * 색은 tokens.css 의 --accent(사이트 빨강)를 따른다. */
var DtNew = (function () {
  var DAYS = 14;
  var FEATURES = {
    'invest-ai-league': '2026-10-02',     // 재테크 · 랭킹 · 회원/AI 전환의 AI 버튼
    'invest-credit': '2026-10-01',        // 재테크 · 주문창 '신용' 버튼 · 계좌 '💳 예수금 · 신용' 카드 제목 (미수·신용·담보대출 전체 회원 개방)
    'invest-attend': '2026-10-01',        // 재테크 · 계좌의 '📅 출석' 버튼 (출석 보상)
    'invest-watch-groups': '2026-09-29'   // 재테크 · 시세 · 관심종목의 '+ 그룹 추가' 버튼 (관심종목 그룹)
  };

  /** 지금 NEW 를 보일 기간인가 — 목록에 없거나 날짜가 잘못됐으면 보이지 않는다 */
  function on(id) {
    var since = FEATURES[id];
    if (!since) return false;
    var start = Date.parse(since + 'T00:00:00+09:00');
    if (!isFinite(start)) return false;
    var now = Date.now();
    return now >= start && now < start + DAYS * 86400000;      // 10/2 → 10/16 00:00 부터 숨김
  }

  function html(id) {
    return on(id) ? '<span class="dt-new" aria-label="새 기능">NEW</span>' : '';
  }

  /** root 안의 [data-new] 요소 뒤에 NEW 를 붙인다 (두 번 불러도 한 번만 붙는다) */
  function apply(root) {
    var list = (root || document).querySelectorAll('[data-new]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.getAttribute('data-new-done')) continue;
      el.setAttribute('data-new-done', '1');
      if (on(el.getAttribute('data-new'))) el.insertAdjacentHTML('beforeend', html(el.getAttribute('data-new')));
    }
  }

  // 스타일을 여기서 넣는다 — 페이지마다 CSS 를 고치지 않아도 어디서나 같은 모양
  var css = '.dt-new{display:inline-flex;align-items:center;height:16px;padding:0 5px;margin-left:5px;'
    + 'background:var(--accent,#e05252);color:#fff;font-size:10px;font-weight:800;font-style:normal;'
    + 'letter-spacing:.3px;line-height:1;vertical-align:2px;flex:0 0 auto;white-space:nowrap}';
  var st = document.createElement('style');
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(); });
  else apply();

  return { on: on, html: html, apply: apply };
})();
