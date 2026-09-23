/* ===== DT 재테크 — 종목별 커뮤니티 =====
 * 종목 상세의 "커뮤니티" 탭. 데이터는 Firestore stock_boards/{code}/posts/{postId} (+ comments 하위 컬렉션),
 * 신고는 stock_reports/{postId_uid}. 규칙(firestore.rules)이 작성자·좋아요·댓글수·신고수 변경을 제한한다.
 *  - 글 본문 3,000자 · 댓글 1,000자 (규칙과 동일)
 *  - 신고 3건 이상이면 일반 회원에게는 가려서 보여 주고, 관리자는 관리 탭에서 처리한다
 * 헬퍼(escapeHtml · linkifyBody · timeAgo · escapeJsArg)는 app.js / market-ui.js 의 것을 쓴다.
 */

var Community = (function () {
  var code = null, name = null;
  var posts = [];               // 현재 종목의 글 (최신순)
  var loadedFor = null;         // 글 목록을 받아 둔 종목코드
  var lastDoc = null;           // 페이지네이션 커서
  var hasMore = false;
  var openC = {};               // postId -> 댓글 펼침
  var cCache = {};              // postId -> [comment]
  var shown = {};               // postId -> 가려진 글을 펼쳐 봄
  var expanded = {};            // postId -> 긴 글 전체 보기
  var _seq = 0;
  var _lastPostAt = 0;
  var PAGE = 20, BLIND_AT = 3, BODY_MAX = 3000, COMMENT_MAX = 1000;

  function isCode(c) { return /^[0-9A-Z]{6}$/.test(String(c || '')); }

  /* ===== 자랑하기 =====
   * 수익률·수익금은 워커가 모의투자 장부에서 직접 읽어 만든다. 글에는 id 만 저장된다.
   * 그래서 개발자도구로 숫자를 고쳐 올릴 수 없다.
   */
  var pendingBrag = null;     // 글쓰기 칸에 붙여 둔 스냅샷
  var bragCache = {};         // id -> 스냅샷 (한 번 받으면 다시 받지 않는다)
  var bragMiss = {};          // 못 찾은 id (지워진 스냅샷) — 매번 다시 부르지 않게
  function postsRef() { return db.collection('stock_boards').doc(code).collection('posts'); }
  function panel() { return document.getElementById('sdCommunity'); }
  function mine(x) { return currentUser && x.authorUid === currentUser.uid; }

  /** 종목이 바뀌면 이전 종목의 글을 버린다 (market-ui.openStock 에서 부른다) */
  function reset() {
    code = null; name = null; posts = []; loadedFor = null; lastDoc = null; hasMore = false;
    openC = {}; cCache = {}; shown = {}; expanded = {};
    pendingBrag = null;     // 다른 종목 게시판으로 첨부가 딸려가면 안 된다
  }

  /** 커뮤니티 탭을 열 때 — 같은 종목이면 다시 받지 않는다 */
  function open(c, n) {
    if (!isCode(c) || !db || !currentUser) return;
    if (loadedFor === c) { code = c; name = n; render(); return; }
    code = c; name = n;
    load(false);
  }

  async function load(more) {
    if (!code) return;
    var el = panel();
    if (!el) return;
    var seq = ++_seq, forCode = code;
    if (!more) { el.innerHTML = '<div class="loading">글을 불러오는 중...</div>'; posts = []; lastDoc = null; }
    try {
      var q = postsRef().orderBy('createdAt', 'desc').limit(PAGE);
      if (more && lastDoc) q = q.startAfter(lastDoc);
      var snap = await q.get();
      if (seq !== _seq || forCode !== code) return;
      var rows = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      posts = more ? posts.concat(rows) : rows;
      lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : lastDoc;
      hasMore = snap.docs.length === PAGE;
      loadedFor = code;
      render();
    } catch (e) {
      if (seq !== _seq) return;
      el.innerHTML = '<div class="empty">글을 불러오지 못했습니다.<br><button class="mini-btn" style="margin-top:8px" onclick="Community.reload()">다시 시도</button></div>';
    }
  }

  function reload() { loadedFor = null; load(false); }

  /* ===== 렌더 ===== */
  function render() {
    var el = panel();
    if (!el || !code) return;
    var h = '<div class="cm-write">'
      + '<textarea class="comment-input cm-input" id="cmBody" maxlength="' + BODY_MAX + '" placeholder="' + escapeHtml(name || '') + ' 에 대한 생각을 남겨 보세요 (투자 판단은 각자의 몫입니다)"'
      +   ' oninput="Community.count(this)"></textarea>'
      + '<div id="cmBragSlot">' + pendingBragHtml() + '</div>'
      + '<div class="comment-submit-row"><span class="comment-count-hint" id="cmCount">0 / ' + fmtNum(BODY_MAX) + '</span>'
      + (window.Mock && Mock.isOn() && !pendingBrag
          ? '<button class="mini-btn cm-brag-btn" onclick="Community.attachBrag(this)">📊 내 수익률</button>' : '')
      + '<button class="btn-submit" onclick="Community.submitPost(this)">글 올리기</button></div>'
      + '<div class="cm-guide">매수·매도 권유, 리딩방 홍보, 근거 없는 루머는 신고 대상입니다.</div>'
      + '</div>';

    if (!posts.length) {
      h += '<div class="empty">아직 글이 없습니다.<br>' + escapeHtml(name || '') + ' 의 첫 글을 남겨 보세요.</div>';
    } else {
      h += '<div class="cm-list">' + posts.map(postHtml).join('') + '</div>';
      if (hasMore) h += '<button class="mini-btn cm-more" onclick="Community.loadMore()">더 보기</button>';
    }
    h += '<div class="cm-foot">회원 글은 DT Club 의 입장과 무관하며 투자 권유가 아닙니다.</div>';
    el.innerHTML = h;
    // 펼쳐 둔 댓글 복원
    Object.keys(openC).forEach(function (id) { if (openC[id]) renderComments(id); });
    fillBrags();
  }

  function postHtml(p) {
    var blinded = (p.reportCount || 0) >= BLIND_AT && !isAdmin && !mine(p) && !shown[p.id];
    var h = '<div class="cm-post" id="cp-' + p.id + '">';
    h += '<div class="comment-head">'
      + '<span class="comment-author">' + escapeHtml(p.authorName || '회원') + '</span>'
      + '<span class="comment-time">' + timeAgo(p.createdAt) + (p.editedAt ? ' · 수정됨' : '') + '</span>'
      + '</div>';
    if (blinded) {
      h += '<div class="cm-blind">🚫 신고가 누적되어 가려진 글입니다. '
        + '<button class="comment-action" onclick="Community.reveal(\'' + p.id + '\')">그래도 보기</button></div>';
      h += '</div>';
      return h;
    }
    var body = String(p.body || '');
    var long = body.length > 300 && !expanded[p.id];
    h += '<div class="comment-body cm-body" id="cpb-' + p.id + '">' + linkifyBody(escapeHtml(long ? body.slice(0, 300) + '…' : body)) + '</div>';
    if (long) h += '<button class="comment-action" onclick="Community.expand(\'' + p.id + '\')">더보기 ▾</button>';
    if (p.bragId) h += '<div class="brag-slot" id="bg-' + p.id + '">' + bragCardHtml(bragCache[p.bragId]) + '</div>';
    h += '<div class="comment-edit" id="cpe-' + p.id + '" style="display:none"></div>';
    var liked = Array.isArray(p.likedBy) && currentUser && p.likedBy.indexOf(currentUser.uid) !== -1;
    h += '<div class="comment-actions" id="cpa-' + p.id + '">'
      + '<button class="comment-action' + (liked ? ' liked' : '') + '" onclick="Community.like(\'' + p.id + '\')">' + (liked ? '❤️' : '🤍') + ' ' + fmtNum(p.likes || 0) + '</button>'
      + '<button class="comment-action" onclick="Community.toggleComments(\'' + p.id + '\')">💬 ' + fmtNum(p.commentCount || 0) + ' <span id="cpc-' + p.id + '">' + (openC[p.id] ? '▴' : '▾') + '</span></button>'
      + (mine(p) ? '<button class="comment-action" onclick="Community.startEdit(\'' + p.id + '\')">수정</button>' : '')
      + (mine(p) || isAdmin ? '<button class="comment-action danger" onclick="Community.remove(\'' + p.id + '\')">삭제</button>' : '')
      + (!mine(p) ? '<button class="comment-action" onclick="Community.report(\'' + p.id + '\')">신고</button>' : '')
      + (isAdmin && p.reportCount ? '<span class="cm-rc">신고 ' + fmtNum(p.reportCount) + '</span>' : '')
      + '</div>';
    h += '<div class="comment-section cm-comments" id="cpcs-' + p.id + '" style="' + (openC[p.id] ? '' : 'display:none') + '"></div>';
    h += '</div>';
    return h;
  }

  /** 글쓰기 칸에 붙여 둔 스냅샷 미리보기 */
  function pendingBragHtml() {
    if (!pendingBrag) return '';
    return '<div class="brag-pending">' + bragCardHtml(pendingBrag)
      + '<button class="brag-remove" onclick="Community.removeBrag()" aria-label="첨부 취소">✕</button></div>';
  }

  /** 자랑 카드 — 스냅샷이 아직 없으면 자리만 잡아 둔다 */
  function bragCardHtml(b) {
    if (!b) return '<div class="brag-card loading-sm">수익률 불러오는 중...</div>';
    if (b.gone) return '';
    var cls = b.pnl > 0 ? 'up' : (b.pnl < 0 ? 'down' : 'flat');
    var sign = b.pnl > 0 ? '+' : '';
    return '<div class="brag-card ' + cls + '">'
      + '<div class="brag-top">'
      +   '<span class="brag-name">' + escapeHtml(b.name) + '</span>'
      +   '<span class="brag-qty">' + fmtNum(b.qty) + '주</span>'
      + '</div>'
      + '<div class="brag-pnl ' + cls + '">' + sign + fmtNum(b.pnl) + '원'
      +   '<span class="brag-rate">' + sign + Number(b.pnlRate).toFixed(2) + '%</span>'
      + '</div>'
      + '<div class="brag-sub">평단 ' + fmtNum(b.avgPrice) + ' → ' + fmtNum(b.price)
      +   ' · ' + escapeHtml(b.nickname)
      +   (b.seasonName ? ' · ' + escapeHtml(b.seasonName) : '')
      +   ' · ' + bragTime(b.createdAt) + ' 기준</div>'
      + '</div>';
  }

  function bragTime(ms) {
    var d = new Date(Number(ms) || 0);
    if (isNaN(d)) return '';
    try {
      return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
    } catch (e) { return ''; }
  }

  /** [📊 내 수익률] — 워커가 장부를 읽어 스냅샷을 만들어 준다 */
  async function attachBrag(btn) {
    if (!window.Mock || !Mock.isOn() || !code) return;
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = '불러오는 중...';
    try {
      var r = await Mock.brag(code);
      pendingBrag = r.brag;
      bragCache[pendingBrag.id] = pendingBrag;
      var slot = document.getElementById('cmBragSlot');
      if (slot) slot.innerHTML = pendingBragHtml();
      btn.remove();
      return;
    } catch (e) {
      alert(e && e.message ? e.message : '수익률을 가져오지 못했습니다.');
    } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  }

  function removeBrag() {
    pendingBrag = null;
    render();
  }

  /** 화면에 있는 자랑 카드 중 아직 못 받은 것들을 한 번에 받아 채운다 */
  async function fillBrags() {
    var need = posts.filter(function (p) { return p.bragId && !bragCache[p.bragId] && !bragMiss[p.bragId]; })
      .map(function (p) { return p.bragId; });
    need = need.filter(function (v, i) { return need.indexOf(v) === i; }).slice(0, 30);
    if (!need.length || !window.Mock) return;
    try {
      var r = await Mock.brags(need);
      (r.items || []).forEach(function (b) { bragCache[b.id] = b; });
      // 응답에 없는 id 는 지워진 스냅샷 — 카드를 비우고 다시 부르지 않는다
      need.forEach(function (id) { if (!bragCache[id]) bragMiss[id] = true; });
    } catch (e) {
      return;      // 다음 렌더에서 다시 — '불러오는 중'이 남지만 숫자를 지어내지는 않는다
    }
    posts.forEach(function (p) {
      if (!p.bragId) return;
      var slot = document.getElementById('bg-' + p.id);
      if (slot) slot.innerHTML = bragCardHtml(bragCache[p.bragId] || { gone: true });
    });
  }

  function count(ta) {
    var el = document.getElementById('cmCount');
    if (el) el.textContent = fmtNum(ta.value.length) + ' / ' + fmtNum(BODY_MAX);
  }
  function reveal(id) { shown[id] = true; render(); }
  function expand(id) { expanded[id] = true; render(); }
  function loadMore() { load(true); }

  /* ===== 글 쓰기·수정·삭제 ===== */
  async function submitPost(btn) {
    if (!db || !currentUser || !isMember || !code) return;
    var ta = document.getElementById('cmBody');
    if (!ta) return;
    var body = ta.value.trim();
    if (!body) { alert('내용을 입력해 주세요.'); return; }
    if (body.length > BODY_MAX) { alert('글은 ' + fmtNum(BODY_MAX) + '자를 넘을 수 없습니다.'); return; }
    if (Date.now() - _lastPostAt < 10000) { alert('잠시 후 다시 올려 주세요.'); return; }
    btn.disabled = true; var label = btn.textContent; btn.textContent = '올리는 중...';
    try {
      await postsRef().add({
        code: code, stockName: name || code,
        authorUid: currentUser.uid, authorName: myName, isAdmin: isAdmin,
        body: body, likes: 0, likedBy: [], commentCount: 0, reportCount: 0,
        bragId: pendingBrag ? pendingBrag.id : '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      _lastPostAt = Date.now();
      ta.value = '';
      pendingBrag = null;
      loadedFor = null;
      await load(false);
    } catch (e) {
      alert('글을 올리지 못했습니다.');
    } finally { btn.disabled = false; btn.textContent = label; }
  }

  function findPost(id) { return posts.filter(function (p) { return p.id === id; })[0]; }

  function startEdit(id) {
    var p = findPost(id);
    var bodyEl = document.getElementById('cpb-' + id), editEl = document.getElementById('cpe-' + id), actEl = document.getElementById('cpa-' + id);
    if (!p || !bodyEl || !editEl || !actEl) return;
    bodyEl.style.display = 'none'; actEl.style.display = 'none'; editEl.style.display = '';
    editEl.innerHTML = '<textarea class="comment-input" id="cpi-' + id + '" maxlength="' + BODY_MAX + '"></textarea>'
      + '<div class="comment-submit-row" style="margin-top:8px">'
      + '<button class="btn-ghost" onclick="Community.cancelEdit(\'' + id + '\')">취소</button>'
      + '<button class="btn-submit" onclick="Community.saveEdit(\'' + id + '\', this)">저장</button></div>';
    var ta = document.getElementById('cpi-' + id);
    ta.value = p.body || ''; ta.focus();
  }
  function cancelEdit(id) {
    var bodyEl = document.getElementById('cpb-' + id), editEl = document.getElementById('cpe-' + id), actEl = document.getElementById('cpa-' + id);
    if (editEl) { editEl.style.display = 'none'; editEl.innerHTML = ''; }
    if (bodyEl) bodyEl.style.display = '';
    if (actEl) actEl.style.display = '';
  }
  async function saveEdit(id, btn) {
    var ta = document.getElementById('cpi-' + id);
    var p = findPost(id);
    if (!ta || !p) return;
    var body = ta.value.trim();
    if (!body) { alert('내용을 입력해 주세요.'); return; }
    if (body.length > BODY_MAX) { alert('글은 ' + fmtNum(BODY_MAX) + '자를 넘을 수 없습니다.'); return; }
    if (body === p.body) { cancelEdit(id); return; }
    btn.disabled = true;
    try {
      await postsRef().doc(id).update({ body: body, editedAt: firebase.firestore.FieldValue.serverTimestamp() });
      p.body = body; p.editedAt = { seconds: Math.floor(Date.now() / 1000) };
      render();
    } catch (e) { alert('수정에 실패했습니다.'); btn.disabled = false; }
  }

  async function remove(id) {
    if (!db || !confirm('이 글을 삭제할까요? 달린 댓글도 함께 지워집니다.')) return;
    try {
      var ref = postsRef().doc(id);
      var snap = await ref.collection('comments').limit(400).get();
      while (!snap.empty) {
        var batch = db.batch();
        snap.docs.forEach(function (d) { batch.delete(d.ref); });
        await batch.commit();
        snap = await ref.collection('comments').limit(400).get();
      }
      await ref.delete();
      posts = posts.filter(function (p) { return p.id !== id; });
      delete cCache[id]; delete openC[id];
      render();
    } catch (e) { alert('삭제에 실패했습니다.'); }
  }

  async function like(id) {
    if (!db || !currentUser || !isMember) return;
    var p = findPost(id);
    if (!p) return;
    var liked = Array.isArray(p.likedBy) && p.likedBy.indexOf(currentUser.uid) !== -1;
    var FV = firebase.firestore.FieldValue;
    try {
      await postsRef().doc(id).update({
        likes: FV.increment(liked ? -1 : 1),
        likedBy: liked ? FV.arrayRemove(currentUser.uid) : FV.arrayUnion(currentUser.uid)
      });
      p.likes = (p.likes || 0) + (liked ? -1 : 1);
      p.likedBy = (p.likedBy || []).filter(function (u) { return u !== currentUser.uid; });
      if (!liked) p.likedBy.push(currentUser.uid);
      render();
    } catch (e) { alert('처리에 실패했습니다.'); }
  }

  /* ===== 신고 ===== */
  var REASONS = ['매수·매도 권유 / 리딩방 홍보', '허위 사실 · 근거 없는 루머', '욕설 · 비방', '광고 · 도배', '기타'];
  async function report(id) {
    if (!db || !currentUser || !isMember) return;
    var p = findPost(id);
    if (!p || mine(p)) return;
    var pick = prompt('신고 사유를 번호로 골라 주세요\n' + REASONS.map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n'), '1');
    if (pick == null) return;
    var idx = parseInt(pick, 10) - 1;
    var reason = REASONS[idx] || String(pick).slice(0, 100);
    try {
      var rid = id + '_' + currentUser.uid;      // 회원당 글 하나에 신고 한 번 — 규칙이 이 ID 형식을 요구한다
      var batch = db.batch();
      batch.set(db.collection('stock_reports').doc(rid), {
        postId: id, code: code, stockName: name || code, authorUid: p.authorUid || null,
        reporterUid: currentUser.uid, reporterName: myName, reason: reason, status: 'open',
        excerpt: String(p.body || '').slice(0, 120),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.update(postsRef().doc(id), { reportCount: firebase.firestore.FieldValue.increment(1) });
      await batch.commit();
      p.reportCount = (p.reportCount || 0) + 1;
      render();
      alert('신고가 접수되었습니다.');
    } catch (e) {
      alert('이미 신고한 글이거나 처리에 실패했습니다.');
    }
  }

  /* ===== 댓글 (글마다 1단계, 최신순 아님 — 등록순) ===== */
  function commentsRef(postId) { return postsRef().doc(postId).collection('comments'); }

  function toggleComments(id) {
    openC[id] = !openC[id];
    var sec = document.getElementById('cpcs-' + id), caret = document.getElementById('cpc-' + id);
    if (sec) sec.style.display = openC[id] ? '' : 'none';
    if (caret) caret.textContent = openC[id] ? '▴' : '▾';
    if (openC[id]) { renderComments(id); loadComments(id); }
  }

  async function loadComments(id) {
    try {
      var snap = await commentsRef(id).orderBy('createdAt', 'asc').limit(200).get();
      cCache[id] = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (e) { cCache[id] = cCache[id] || []; }
    renderComments(id);
  }

  function renderComments(id) {
    var sec = document.getElementById('cpcs-' + id);
    if (!sec) return;
    var list = cCache[id];
    var h = '<div class="comment-form">'
      + '<textarea class="comment-input" id="cci-' + id + '" maxlength="' + COMMENT_MAX + '" placeholder="댓글을 남겨 보세요"></textarea>'
      + '<div class="comment-submit-row"><span class="comment-count-hint">최대 ' + fmtNum(COMMENT_MAX) + '자</span>'
      + '<button class="btn-submit" onclick="Community.submitComment(\'' + id + '\', this)">등록</button></div></div>';
    if (!list) h += '<div class="loading">댓글 로딩 중...</div>';
    else if (!list.length) h += '<div class="empty">첫 댓글을 남겨 보세요.</div>';
    else h += list.map(function (c) { return commentHtml(id, c); }).join('');
    sec.innerHTML = h;
  }

  function commentHtml(postId, c) {
    var liked = Array.isArray(c.likedBy) && currentUser && c.likedBy.indexOf(currentUser.uid) !== -1;
    return '<div class="comment-item">'
      + '<div class="comment-head"><span class="comment-author">' + escapeHtml(c.authorName || '회원') + '</span>'
      + '<span class="comment-time">' + timeAgo(c.createdAt) + '</span></div>'
      + '<div class="comment-body">' + linkifyBody(escapeHtml(c.body || '')) + (c.editedAt ? ' <span class="edited-mark">(수정됨)</span>' : '') + '</div>'
      + '<div class="comment-actions">'
      + '<button class="comment-action' + (liked ? ' liked' : '') + '" onclick="Community.likeComment(\'' + postId + '\',\'' + c.id + '\')">' + (liked ? '❤️' : '🤍') + ' ' + fmtNum(c.likes || 0) + '</button>'
      + (mine(c) || isAdmin ? '<button class="comment-action danger" onclick="Community.removeComment(\'' + postId + '\',\'' + c.id + '\')">삭제</button>' : '')
      + '</div></div>';
  }

  async function submitComment(postId, btn) {
    if (!db || !currentUser || !isMember) return;
    var input = document.getElementById('cci-' + postId);
    if (!input) return;
    var body = input.value.trim();
    if (!body) { alert('내용을 입력해 주세요.'); return; }
    if (body.length > COMMENT_MAX) { alert('댓글은 ' + fmtNum(COMMENT_MAX) + '자를 넘을 수 없습니다.'); return; }
    btn.disabled = true; var label = btn.textContent; btn.textContent = '등록 중...';
    try {
      var batch = db.batch();
      batch.set(commentsRef(postId).doc(), {
        authorUid: currentUser.uid, authorName: myName, isAdmin: isAdmin, body: body,
        parentId: null, likes: 0, likedBy: [], createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.update(postsRef().doc(postId), { commentCount: firebase.firestore.FieldValue.increment(1) });
      await batch.commit();
      input.value = '';
      var p = findPost(postId); if (p) p.commentCount = (p.commentCount || 0) + 1;
      await loadComments(postId);
      bumpCount(postId);
    } catch (e) { alert('댓글 등록에 실패했습니다.'); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  async function removeComment(postId, commentId) {
    if (!db || !confirm('이 댓글을 삭제할까요?')) return;
    try {
      var batch = db.batch();
      batch.delete(commentsRef(postId).doc(commentId));
      batch.update(postsRef().doc(postId), { commentCount: firebase.firestore.FieldValue.increment(-1) });
      await batch.commit();
      var p = findPost(postId); if (p) p.commentCount = Math.max(0, (p.commentCount || 0) - 1);
      await loadComments(postId);
      bumpCount(postId);
    } catch (e) { alert('삭제에 실패했습니다.'); }
  }

  async function likeComment(postId, commentId) {
    if (!db || !currentUser || !isMember) return;
    var c = (cCache[postId] || []).filter(function (x) { return x.id === commentId; })[0];
    if (!c) return;
    var liked = Array.isArray(c.likedBy) && c.likedBy.indexOf(currentUser.uid) !== -1;
    var FV = firebase.firestore.FieldValue;
    try {
      await commentsRef(postId).doc(commentId).update({
        likes: FV.increment(liked ? -1 : 1),
        likedBy: liked ? FV.arrayRemove(currentUser.uid) : FV.arrayUnion(currentUser.uid)
      });
      c.likes = (c.likes || 0) + (liked ? -1 : 1);
      c.likedBy = (c.likedBy || []).filter(function (u) { return u !== currentUser.uid; });
      if (!liked) c.likedBy.push(currentUser.uid);
      renderComments(postId);
    } catch (e) { alert('처리에 실패했습니다.'); }
  }

  /** 댓글 수 표시만 갱신 (목록 전체를 다시 그리면 펼친 댓글·입력이 날아간다) */
  function bumpCount(postId) {
    var p = findPost(postId);
    var btn = document.querySelector('#cpa-' + postId + ' .comment-action:nth-child(2)');
    if (btn && p) btn.innerHTML = '💬 ' + fmtNum(p.commentCount || 0) + ' <span id="cpc-' + postId + '">' + (openC[postId] ? '▴' : '▾') + '</span>';
  }

  /* ===== 관리자: 신고 접수 목록 (관리 탭) ===== */
  var _reportSeq = 0;
  async function loadReports() {
    var el = document.getElementById('adminReportList');
    if (!el || !db || !isAdmin) return;
    var seq = ++_reportSeq;
    el.innerHTML = '<div class="loading">불러오는 중...</div>';
    try {
      // status 조건과 정렬을 함께 걸면 복합 색인이 필요하다 — 최근 50건을 받아 화면에서 거른다
      var snap = await db.collection('stock_reports').orderBy('createdAt', 'desc').limit(50).get();
      if (seq !== _reportSeq) return;
      var rows = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })
        .filter(function (r) { return (r.status || 'open') === 'open'; });
      if (!rows.length) { el.innerHTML = '<div class="empty">처리할 신고가 없습니다.</div>'; return; }
      // 같은 글에 대한 신고는 묶어서 보여 준다
      var byPost = {};
      rows.forEach(function (r) {
        var k = r.postId;
        if (!byPost[k]) byPost[k] = { postId: r.postId, code: r.code, stockName: r.stockName, excerpt: r.excerpt, reasons: [], ids: [], at: r.createdAt };
        byPost[k].reasons.push(r.reason); byPost[k].ids.push(r.id);
      });
      el.innerHTML = Object.keys(byPost).map(function (k) {
        var g = byPost[k];
        var ok = isCode(g.code) && /^[A-Za-z0-9_-]{1,64}$/.test(String(g.postId || ''));
        return '<div class="admin-list-item">'
          + '<div class="admin-list-info">'
          + '<div class="admin-list-title">' + escapeHtml(g.stockName || g.code || '') + ' · 신고 ' + g.ids.length + '건 — ' + escapeHtml((g.excerpt || '').slice(0, 60)) + '</div>'
          + '<div class="admin-list-sub">' + escapeHtml(g.reasons.slice(0, 3).join(' / ')) + ' · ' + timeAgo(g.at) + '</div>'
          + '</div>'
          + (ok ? '<button class="mini-btn" onclick="Community.gotoPost(\'' + g.code + '\',\'' + escapeJsArg(g.stockName || g.code) + '\')">글 보기</button>'
              + '<button class="mini-btn danger" onclick="Community.adminDelete(\'' + g.code + '\',\'' + g.postId + '\')">글 삭제</button>' : '')
          + '<button class="mini-btn" onclick="Community.dismiss(\'' + g.postId + '\')">무시</button>'
          + '</div>';
      }).join('');
    } catch (e) {
      if (seq === _reportSeq) el.innerHTML = '<div class="empty">신고 목록을 불러오지 못했습니다.</div>';
    }
  }

  function gotoPost(c, n) {
    if (typeof openStock !== 'function') return;
    openStock(c, n);
    setTimeout(function () { if (typeof sdSwitch === 'function') sdSwitch('community'); }, 50);
  }

  /** 신고된 글 삭제 + 그 글의 신고를 처리 완료로 */
  async function adminDelete(c, postId) {
    if (!isAdmin || !confirm('신고된 글을 삭제할까요? 댓글도 함께 지워집니다.')) return;
    try {
      var ref = db.collection('stock_boards').doc(c).collection('posts').doc(postId);
      var snap = await ref.collection('comments').limit(400).get();
      while (!snap.empty) {
        var b = db.batch();
        snap.docs.forEach(function (d) { b.delete(d.ref); });
        await b.commit();
        snap = await ref.collection('comments').limit(400).get();
      }
      await ref.delete();
      await markReports(postId, 'deleted');
      if (code === c) { posts = posts.filter(function (p) { return p.id !== postId; }); if (loadedFor === c) render(); }
      loadReports();
    } catch (e) { alert('삭제에 실패했습니다.'); }
  }

  async function dismiss(postId) {
    if (!isAdmin) return;
    try { await markReports(postId, 'dismissed'); loadReports(); }
    catch (e) { alert('처리에 실패했습니다.'); }
  }

  async function markReports(postId, status) {
    var snap = await db.collection('stock_reports').where('postId', '==', postId).limit(200).get();
    if (snap.empty) return;
    var batch = db.batch();
    snap.docs.forEach(function (d) { batch.update(d.ref, { status: status, handledBy: currentUser.uid, handledAt: firebase.firestore.FieldValue.serverTimestamp() }); });
    await batch.commit();
  }

  return {
    attachBrag: attachBrag, removeBrag: removeBrag,
    open: open, reset: reset, reload: reload, loadMore: loadMore, count: count, reveal: reveal, expand: expand,
    submitPost: submitPost, startEdit: startEdit, cancelEdit: cancelEdit, saveEdit: saveEdit, remove: remove, like: like, report: report,
    toggleComments: toggleComments, submitComment: submitComment, removeComment: removeComment, likeComment: likeComment,
    loadReports: loadReports, gotoPost: gotoPost, adminDelete: adminDelete, dismiss: dismiss
  };
})();
