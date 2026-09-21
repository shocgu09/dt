/* ===== DT 재테크 — 국내주식 (시황 브리핑 + 댓글 / 시세는 market*.js) ===== */

var db = null;
var currentUser = null;
var isAdmin = false;
var isMember = false;
var myName = '';
var currentTab = 'briefing';

var briefings = [];
var openComments = {};     // briefingId -> true (댓글 섹션 펼침 상태)
var commentCache = {};     // briefingId -> [comment]
var commentError = {};     // briefingId -> true (로드 실패)
var editingId = null;      // 수정 중인 브리핑 id
var formSentiment = 'neutral';
var formTickers = [];

/* ===== 테마 ===== */
function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme');
  var next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dt-theme', next);
  document.getElementById('themeToggle').textContent = next === 'light' ? '☀️' : '🌙';
  // 차트(canvas)는 CSS 변수를 따라가지 못한다 — 그릴 때 읽은 색이 굳어 있으므로 다시 그리게 한다
  if (typeof onThemeChanged === 'function') onThemeChanged();
}
(function() {
  var saved = localStorage.getItem('dt-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  var btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = saved === 'light' ? '☀️' : '🌙';
})();

/* ===== Firebase 초기화 + 회원 게이트 ===== */
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  firebase.auth().onAuthStateChanged(function(user) {
    currentUser = user;
    if (!user || user.isAnonymous) { showGate(); return; }
    db.collection('users').doc(user.uid).get().then(function(doc) {
      var data = doc.exists ? doc.data() : null;
      var role = data && data.role;
      if (!role) { showGate(); return; }
      isMember = true;
      isAdmin = (role === 'admin' || role === 'superadmin');
      if (typeof purgeLegacyRecent === 'function') purgeLegacyRecent();
      myName = (data && (data.name || data.displayName)) || user.displayName || '회원';
      showMain();
    }).catch(function() { showGate(); });
  });
} catch (e) {
  console.log('Firebase 미연결', e);
  showGate();
}

function showGate() {
  document.getElementById('bootLoading').style.display = 'none';
  document.getElementById('gate').style.display = '';
  document.getElementById('main').style.display = 'none';
}

function showMain() {
  document.getElementById('bootLoading').style.display = 'none';
  document.getElementById('gate').style.display = 'none';
  document.getElementById('main').style.display = '';
  if (isAdmin) document.getElementById('tabAdmin').style.display = '';
  loadBriefings();
  loadConfig();
  initMockMode();
}

/* ===== 모의투자 모드 =====
 * 코드(mock.js · mock.css)는 모드를 켤 때 처음 불러온다 — 쓰지 않는 회원에게는 아무 변화가 없다.
 */
var MOCK_VER = '3';
var _mockLoading = null;

function loadMockAssets() {
  if (window.Mock) return Promise.resolve();
  if (_mockLoading) return _mockLoading;
  _mockLoading = new Promise(function (resolve, reject) {
    var css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'mock.css?v=' + MOCK_VER;
    document.head.appendChild(css);
    var s = document.createElement('script');
    s.src = 'mock.js?v=' + MOCK_VER;
    s.onload = resolve;
    s.onerror = function () { _mockLoading = null; reject(new Error('모의투자를 불러오지 못했습니다')); };
    document.head.appendChild(s);
  });
  return _mockLoading;
}

/** 회원 확인 뒤 버튼을 보여 주고, 지난번에 켜 둔 회원은 그대로 켠다 */
function initMockMode() {
  var btn = document.getElementById('mockToggle');
  if (!btn || !currentUser) return;
  btn.style.display = '';
  var saved = null;
  try { saved = localStorage.getItem('dt-invest-mock:' + currentUser.uid); } catch (e) {}
  if (saved === '1') loadMockAssets().then(function () { Mock.setMode(true); }).catch(function () {});
}

async function toggleMockMode() {
  var btn = document.getElementById('mockToggle');
  btn.disabled = true;
  try {
    await loadMockAssets();
    await Mock.setMode(!Mock.isOn());
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ===== 탭 ===== */
function switchTab(tab) {
  var prev = currentTab;
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === tab); });
  document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.toggle('active', c.id === 'tab-' + tab); });

  // 시세 탭을 벗어나면 폴링을 반드시 멈춘다 (배터리·네이버 트래픽)
  if (prev === 'market' && tab !== 'market' && typeof leaveMarketTab === 'function') leaveMarketTab();
  if (tab === 'market' && typeof enterMarketTab === 'function') enterMarketTab();

  if (window.Mock) Mock.onTab(tab);

  if (tab === 'admin') {
    var d = document.getElementById('bDate');
    if (d && !d.value) d.value = todayStr();
    renderAdminBriefingList();
  }
}

/* ===== 브리핑 로드 ===== */
async function loadBriefings() {
  if (!db) return;
  var el = document.getElementById('briefingList');
  try {
    // 단일 orderBy만 사용 → 복합 인덱스 불필요. 고정(pinned) 정렬은 클라이언트에서 처리
    var snap = await db.collection('invest_briefings').orderBy('createdAt', 'desc').limit(50).get();
    briefings = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    briefings.sort(function(a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.createdAt && b.createdAt.seconds || 0) - (a.createdAt && a.createdAt.seconds || 0);
    });
    renderBriefings();
    renderAdminBriefingList();
  } catch (e) {
    el.innerHTML = '<div class="empty">브리핑을 불러오지 못했습니다.<br>잠시 후 다시 시도해 주세요.</div>';
  }
}

function renderBriefings() {
  var el = document.getElementById('briefingList');
  if (!briefings.length) {
    el.innerHTML = '<div class="empty">아직 등록된 시황 브리핑이 없습니다.'
      + '<br>AI 에이전트의 첫 브리핑을 기다려 주세요.'
      + (isAdmin ? '<br><span style="font-size:.78rem">관리 탭에서 직접 작성할 수도 있습니다.</span>' : '') + '</div>';
    return;
  }
  el.innerHTML = briefings.map(briefingCardHtml).join('');

  // 구버전 브리핑은 코드만 저장돼 있어 이름을 조회해 채운 뒤 한 번 더 그린다
  var legacy = [];
  briefings.forEach(function(p) {
    (p.tickers || []).forEach(function(t) {
      if (typeof t === 'string' && !_tickerNameCache[t]) legacy.push(t);
    });
  });
  if (legacy.length) {
    resolveTickerNames(legacy).then(function(found) {
      if (found) el.innerHTML = briefings.map(briefingCardHtml).join('');
    });
  }
  // 펼쳐둔 댓글 섹션 복원
  Object.keys(openComments).forEach(function(id) {
    if (openComments[id]) renderComments(id);
  });
}

var SENT_LABEL = { bull: '🔴 강세', bear: '🔵 약세', neutral: '⚪ 중립' };
var MARKET_LABEL = { all: '전체', kospi: '코스피', kosdaq: '코스닥' };

function briefingCardHtml(p) {
  var sent = p.sentiment || 'neutral';
  var bodyHtml = linkifyBody(escapeHtml(p.body || ''));
  var isLong = (p.body || '').length > 180;
  var preview = escapeHtml(plainPreview(p.body || '', 180)) + (isLong ? '…' : '');

  var h = '<div class="briefing-card' + (p.pinned ? ' pinned' : '') + '" id="bc-' + p.id + '">';
  h += '<div class="briefing-card-header">';
  var byAi = p.generatedBy === 'ai';
  h += p.pinned ? '<span class="briefing-badge pin">📌 고정</span>' : '';
  h += byAi
    ? '<span class="briefing-badge ai">🤖 AI 시황</span>'
    : (p.pinned ? '' : '<span class="briefing-badge">📋 시황</span>');
  h += '<span class="sentiment-badge sentiment-' + sent + '">' + SENT_LABEL[sent] + '</span>';
  if (p.market && p.market !== 'all') h += '<span class="sentiment-badge sentiment-neutral">' + MARKET_LABEL[p.market] + '</span>';
  h += '<span class="briefing-date">' + escapeHtml(p.date || '') + '</span>';
  h += '</div>';
  h += '<div class="briefing-title">' + escapeHtml(p.title || '') + '</div>';

  if (isLong) {
    h += '<div class="briefing-preview" id="bp-' + p.id + '">' + preview + '</div>';
    h += '<div class="briefing-body" id="bb-' + p.id + '" style="display:none">' + bodyHtml + '</div>';
    h += '<button class="briefing-toggle-btn" onclick="toggleBody(\'' + p.id + '\', this)">더보기 ▾</button>';
  } else {
    h += '<div class="briefing-body">' + bodyHtml + '</div>';
  }

  if (Array.isArray(p.tickers) && p.tickers.length) {
    h += '<div class="ticker-row">';
    h += p.tickers.map(function(t) {
      var n = normalizeTicker(t);
      return '<button type="button" class="ticker-chip" onclick="goStock(\'' + n.code + '\',\'' + escapeJsArg(n.name) + '\')">'
        + (typeof stockLogoHtml === 'function' ? stockLogoHtml(n.code, n.name, null, 'sm') : '📈 ')
        + escapeHtml(n.name) + ' <span class="code">' + escapeHtml(n.code) + '</span></button>';
    }).join('');
    h += '</div>';
  }

  // 작성자 표기·수정·고정·삭제는 카드에 두지 않는다 — ai-trend / car-trend 처럼 관리 탭에서만 다룬다
  h += '<div class="briefing-footer">';
  h += '<button class="comment-toggle" onclick="toggleComments(\'' + p.id + '\')">💬 댓글 '
     + (p.commentCount || 0) + ' <span id="ct-' + p.id + '">▾</span></button>';
  h += '</div>';

  h += '<div class="comment-section" id="cs-' + p.id + '" style="display:none"></div>';
  h += '</div>';
  return h;
}

function toggleBody(id, btn) {
  var prev = document.getElementById('bp-' + id);
  var body = document.getElementById('bb-' + id);
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  prev.style.display = open ? '' : 'none';
  btn.textContent = open ? '더보기 ▾' : '접기 ▴';
}

/* ===== 댓글 ===== */
function toggleComments(id) {
  var sec = document.getElementById('cs-' + id);
  var caret = document.getElementById('ct-' + id);
  var open = sec.style.display !== 'none';
  if (open) {
    sec.style.display = 'none';
    caret.textContent = '▾';
    openComments[id] = false;
  } else {
    sec.style.display = '';
    caret.textContent = '▴';
    openComments[id] = true;
    renderComments(id);
    loadComments(id);
  }
}

async function loadComments(id) {
  if (!db) return;
  try {
    var snap = await db.collection('invest_briefings').doc(id)
      .collection('comments').orderBy('createdAt', 'asc').limit(300).get();
    commentCache[id] = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    commentError[id] = false;
    renderComments(id);
  } catch (e) {
    // 폼까지 날리지 않도록 목록 영역만 에러 상태로 렌더
    commentError[id] = true;
    renderComments(id);
  }
}

function renderComments(id) {
  var sec = document.getElementById('cs-' + id);
  if (!sec) return;
  var list = commentCache[id];

  var h = '<div class="comment-form">';
  h += '<textarea class="comment-input" id="ci-' + id + '" maxlength="1000" placeholder="시황에 대한 생각을 남겨 보세요"></textarea>';
  h += '<div class="comment-submit-row">';
  h += '<span class="comment-count-hint">최대 1000자</span>';
  h += '<button class="btn-submit" onclick="submitComment(\'' + id + '\', null, this)">등록</button>';
  h += '</div></div>';

  if (commentError[id]) {
    h += '<div class="empty">댓글을 불러오지 못했습니다.<br>'
      + '<button class="mini-btn" style="margin-top:8px" onclick="retryComments(\'' + id + '\')">다시 시도</button></div>';
  } else if (!list) {
    h += '<div class="loading">댓글 로딩 중...</div>';
  } else if (!list.length) {
    h += '<div class="empty">첫 댓글을 남겨 보세요.</div>';
  } else {
    var roots = list.filter(function(c) { return !c.parentId; });
    var byParent = {};
    list.forEach(function(c) {
      if (c.parentId) { (byParent[c.parentId] = byParent[c.parentId] || []).push(c); }
    });
    // 부모 댓글이 삭제돼도 답글은 남는다 (남의 답글은 지울 권한이 없다).
    // 자리표시자를 세워 답글이 화면에서 사라지지 않게 하고, 댓글 수와도 맞춘다.
    var rootIds = {};
    roots.forEach(function(c) { rootIds[c.id] = true; });
    var items = roots.map(function(c) { return { c: c, at: c.createdAt }; });
    Object.keys(byParent).forEach(function(pid) {
      if (!rootIds[pid]) items.push({ c: null, pid: pid, at: byParent[pid][0].createdAt });
    });
    items.sort(function(a, b) { return (a.at && a.at.seconds || 0) - (b.at && b.at.seconds || 0); });

    items.forEach(function(it) {
      if (it.c) {
        h += commentHtml(id, it.c, false);
        (byParent[it.c.id] || []).forEach(function(r) { h += commentHtml(id, r, true); });
        h += '<div id="rf-' + it.c.id + '"></div>';
      } else {
        h += '<div class="comment-item"><div class="comment-body deleted">삭제된 댓글입니다.</div></div>';
        byParent[it.pid].forEach(function(r) { h += commentHtml(id, r, true); });
      }
    });
  }
  sec.innerHTML = h;
}

function retryComments(id) {
  commentError[id] = false;
  renderComments(id);
  loadComments(id);
}

function commentHtml(briefingId, c, isReply) {
  var liked = Array.isArray(c.likedBy) && currentUser && c.likedBy.indexOf(currentUser.uid) !== -1;
  var mine = currentUser && c.authorUid === currentUser.uid;

  var h = '<div class="comment-item' + (isReply ? ' reply' : '') + '">';
  h += '<div class="comment-head">';
  h += '<span class="comment-author">' + escapeHtml(c.authorName || '회원') + '</span>';
  if (c.isAdmin) h += '<span class="admin-tag">운영진</span>';
  h += '<span class="comment-time">' + timeAgo(c.createdAt) + '</span>';
  h += '</div>';
  h += '<div class="comment-body" id="cb-' + c.id + '">' + linkifyBody(escapeHtml(c.body || ''))
     + (c.editedAt ? ' <span class="edited-mark">(수정됨)</span>' : '') + '</div>';
  h += '<div class="comment-edit" id="ce-' + c.id + '" style="display:none"></div>';
  h += '<div class="comment-actions" id="ca-' + c.id + '">';
  h += '<button class="comment-action' + (liked ? ' liked' : '') + '" onclick="toggleLike(\'' + briefingId + '\',\'' + c.id + '\')">'
     + (liked ? '❤️' : '🤍') + ' ' + (c.likes || 0) + '</button>';
  if (!isReply) h += '<button class="comment-action" onclick="showReplyForm(\'' + briefingId + '\',\'' + c.id + '\')">답글</button>';
  // 내용 수정은 작성자 본인만 (관리자는 삭제만 — 남의 말을 고치면 안 된다)
  if (mine) h += '<button class="comment-action" onclick="startEditComment(\'' + briefingId + '\',\'' + c.id + '\')">수정</button>';
  if (mine || isAdmin) h += '<button class="comment-action danger" onclick="deleteComment(\'' + briefingId + '\',\'' + c.id + '\')">삭제</button>';
  h += '</div></div>';
  return h;
}

function showReplyForm(briefingId, parentId) {
  var slot = document.getElementById('rf-' + parentId);
  if (!slot) return;
  if (slot.innerHTML) { slot.innerHTML = ''; return; }
  slot.innerHTML = '<div class="reply-form">'
    + '<textarea class="comment-input" id="ri-' + parentId + '" maxlength="1000" placeholder="답글을 입력하세요"></textarea>'
    + '<div class="comment-submit-row" style="margin-top:8px">'
    + '<button class="btn-ghost" onclick="document.getElementById(\'rf-' + parentId + '\').innerHTML=\'\'">취소</button>'
    + '<button class="btn-submit" onclick="submitComment(\'' + briefingId + '\',\'' + parentId + '\', this)">답글 등록</button>'
    + '</div></div>';
  document.getElementById('ri-' + parentId).focus();
}

async function submitComment(briefingId, parentId, btn) {
  if (!db || !currentUser || !isMember) return;
  var inputId = parentId ? 'ri-' + parentId : 'ci-' + briefingId;
  var input = document.getElementById(inputId);
  if (!input) return;
  var body = input.value.trim();
  if (!body) { alert('내용을 입력해 주세요.'); return; }
  if (body.length > 1000) { alert('댓글은 1000자를 넘을 수 없습니다.'); return; }

  btn.disabled = true;
  var label = btn.textContent;
  btn.textContent = '등록 중...';
  try {
    var ref = db.collection('invest_briefings').doc(briefingId);
    // 댓글과 댓글 수를 한 배치로 쓴다 — 하나만 성공해 숫자가 어긋나는 일을 막는다
    var batch = db.batch();
    batch.set(ref.collection('comments').doc(), {
      authorUid: currentUser.uid,
      authorName: myName,
      isAdmin: isAdmin,
      body: body,
      parentId: parentId || null,
      likes: 0,
      likedBy: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    batch.update(ref, { commentCount: firebase.firestore.FieldValue.increment(1) });
    await batch.commit();
    input.value = '';
    var slot = parentId && document.getElementById('rf-' + parentId);
    if (slot) slot.innerHTML = '';
    bumpCommentCount(briefingId, 1);
    await loadComments(briefingId);
  } catch (e) {
    alert('댓글 등록에 실패했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function startEditComment(briefingId, commentId) {
  var list = commentCache[briefingId] || [];
  var c = list.filter(function(x) { return x.id === commentId; })[0];
  if (!c) return;

  var bodyEl = document.getElementById('cb-' + commentId);
  var editEl = document.getElementById('ce-' + commentId);
  var actEl = document.getElementById('ca-' + commentId);
  if (!bodyEl || !editEl || !actEl) return;

  bodyEl.style.display = 'none';
  actEl.style.display = 'none';
  editEl.style.display = '';
  editEl.innerHTML =
      '<textarea class="comment-input" id="ci-edit-' + commentId + '" maxlength="1000"></textarea>'
    + '<div class="comment-submit-row" style="margin-top:8px">'
    +   '<button class="btn-ghost" onclick="cancelEditComment(\'' + commentId + '\')">취소</button>'
    +   '<button class="btn-submit" onclick="saveEditComment(\'' + briefingId + '\',\'' + commentId + '\', this)">저장</button>'
    + '</div>';

  var ta = document.getElementById('ci-edit-' + commentId);
  ta.value = c.body || '';
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function cancelEditComment(commentId) {
  var bodyEl = document.getElementById('cb-' + commentId);
  var editEl = document.getElementById('ce-' + commentId);
  var actEl = document.getElementById('ca-' + commentId);
  if (editEl) { editEl.style.display = 'none'; editEl.innerHTML = ''; }
  if (bodyEl) bodyEl.style.display = '';
  if (actEl) actEl.style.display = '';
}

async function saveEditComment(briefingId, commentId, btn) {
  if (!db || !currentUser) return;
  var ta = document.getElementById('ci-edit-' + commentId);
  if (!ta) return;
  var body = ta.value.trim();
  if (!body) { alert('내용을 입력해 주세요.'); return; }
  if (body.length > 1000) { alert('댓글은 1000자를 넘을 수 없습니다.'); return; }

  var list = commentCache[briefingId] || [];
  var c = list.filter(function(x) { return x.id === commentId; })[0];
  if (c && c.body === body) { cancelEditComment(commentId); return; }

  btn.disabled = true;
  btn.textContent = '저장 중...';
  try {
    await db.collection('invest_briefings').doc(briefingId)
      .collection('comments').doc(commentId).update({
        body: body,
        editedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    if (c) { c.body = body; c.editedAt = { seconds: Math.floor(Date.now() / 1000) }; }
    cancelEditComment(commentId);
    renderComments(briefingId);
  } catch (e) {
    alert('수정에 실패했습니다.');
    btn.disabled = false;
    btn.textContent = '저장';
  }
}

async function deleteComment(briefingId, commentId) {
  if (!db || !confirm('이 댓글을 삭제할까요?')) return;
  try {
    var ref = db.collection('invest_briefings').doc(briefingId);
    var batch = db.batch();
    batch.delete(ref.collection('comments').doc(commentId));
    batch.update(ref, { commentCount: firebase.firestore.FieldValue.increment(-1) });
    await batch.commit();
    bumpCommentCount(briefingId, -1);
    await loadComments(briefingId);
  } catch (e) {
    alert('삭제에 실패했습니다.');
  }
}

async function toggleLike(briefingId, commentId) {
  if (!db || !currentUser || !isMember) return;
  var list = commentCache[briefingId] || [];
  var c = list.filter(function(x) { return x.id === commentId; })[0];
  if (!c) return;
  var liked = Array.isArray(c.likedBy) && c.likedBy.indexOf(currentUser.uid) !== -1;
  var FV = firebase.firestore.FieldValue;
  try {
    await db.collection('invest_briefings').doc(briefingId).collection('comments').doc(commentId).update({
      likes: FV.increment(liked ? -1 : 1),
      likedBy: liked ? FV.arrayRemove(currentUser.uid) : FV.arrayUnion(currentUser.uid)
    });
    // 로컬 상태 갱신 (전체 재조회 없이 즉시 반영)
    c.likes = (c.likes || 0) + (liked ? -1 : 1);
    c.likedBy = c.likedBy || [];
    if (liked) c.likedBy = c.likedBy.filter(function(u) { return u !== currentUser.uid; });
    else c.likedBy.push(currentUser.uid);
    renderComments(briefingId);
  } catch (e) {
    alert('처리에 실패했습니다.');
  }
}

function bumpCommentCount(briefingId, delta) {
  var b = briefings.filter(function(x) { return x.id === briefingId; })[0];
  if (b) b.commentCount = Math.max(0, (b.commentCount || 0) + delta);
  var btn = document.querySelector('#bc-' + briefingId + ' .comment-toggle');
  if (btn && b) btn.innerHTML = '💬 댓글 ' + (b.commentCount || 0) + ' <span id="ct-' + briefingId + '">▴</span>';
}

/* ===== 관리자: 브리핑 작성/수정 ===== */
function setSentiment(s) {
  formSentiment = s;
  document.querySelectorAll('.radio-btn').forEach(function(b) { b.classList.toggle('on', b.dataset.sent === s); });
}

/* ===== 언급 종목 선택 (종목명·초성 검색) =====
 * 저장 형식: [{ code, name }]  — 구버전은 ["005930"] 문자열 배열이라 양쪽 다 받는다.
 */
var _tickerSearchTimer = null;
var _tickerNameCache = {};     // code -> name (구버전 코드 표시용)

function normalizeTicker(t) {
  if (t && typeof t === 'object') return { code: t.code, name: t.name || _tickerNameCache[t.code] || t.code };
  return { code: String(t), name: _tickerNameCache[String(t)] || String(t) };
}

function onTickerSearch(v) {
  clearTimeout(_tickerSearchTimer);
  var q = (v || '').trim();
  var box = document.getElementById('bTickerResults');
  if (!q) { box.innerHTML = ''; box.style.display = 'none'; return; }
  _tickerSearchTimer = setTimeout(function () { runTickerSearch(q); }, 250);
}

async function runTickerSearch(q) {
  var box = document.getElementById('bTickerResults');
  box.style.display = '';
  box.innerHTML = '<div class="tr-empty">검색 중...</div>';
  try {
    var d = await Market.search(q);
    if (!d.items || !d.items.length) { box.innerHTML = '<div class="tr-empty">검색 결과가 없습니다</div>'; return; }
    box.innerHTML = d.items.map(function (i) {
      return '<button type="button" class="tr-item" onclick="pickTicker(\'' + i.code + '\',\'' + escapeJsArg(i.name) + '\')">'
        + '<span class="tr-name">' + escapeHtml(i.name) + '</span>'
        + '<span class="tr-meta">' + escapeHtml(i.market || '') + ' · ' + i.code + '</span>'
        + '</button>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<div class="tr-empty">' + escapeHtml(e.message) + '</div>';
  }
}

function pickTicker(code, name) {
  _tickerNameCache[code] = name;
  if (!formTickers.some(function (t) { return normalizeTicker(t).code === code; })) {
    formTickers.push({ code: code, name: name });
  }
  document.getElementById('bTickerInput').value = '';
  var box = document.getElementById('bTickerResults');
  box.innerHTML = ''; box.style.display = 'none';
  renderFormTickers();
}

function removeTicker(code) {
  formTickers = formTickers.filter(function (t) { return normalizeTicker(t).code !== code; });
  renderFormTickers();
}

function renderFormTickers() {
  document.getElementById('bTickerList').innerHTML = formTickers.map(function (t) {
    var n = normalizeTicker(t);
    return '<button type="button" class="chip-del" onclick="removeTicker(\'' + n.code + '\')">'
      + escapeHtml(n.name) + ' ✕</button>';
  }).join('');
}

/** 구버전 브리핑(코드만 저장)의 종목명을 채워 넣고 다시 그린다 */
async function resolveTickerNames(codes) {
  var todo = codes.filter(function (c) { return !_tickerNameCache[c]; });
  if (!todo.length || !currentUser) return false;
  var found = false;
  await Promise.all(todo.map(async function (c) {
    try {
      var d = await Market.search(c);
      var hit = (d.items || []).filter(function (i) { return i.code === c; })[0];
      if (hit) { _tickerNameCache[c] = hit.name; found = true; }
    } catch (e) { /* 실패하면 코드 그대로 표시 */ }
  }));
  return found;
}

async function submitBriefing() {
  if (!db || !isAdmin) return;
  var date = document.getElementById('bDate').value;
  var title = document.getElementById('bTitle').value.trim();
  var body = document.getElementById('bBody').value.trim();
  var market = document.getElementById('bMarket').value;
  var pinned = document.getElementById('bPinned').checked;
  var status = document.getElementById('bStatus');
  if (!date || !title || !body) { alert('날짜, 제목, 내용을 모두 입력해 주세요.'); return; }

  var btn = document.getElementById('bSubmitBtn');
  btn.disabled = true;
  btn.textContent = editingId ? '수정 중...' : '게시 중...';
  try {
    var payload = {
      date: date, title: title, body: body, market: market,
      sentiment: formSentiment, tickers: formTickers.map(normalizeTicker), pinned: pinned,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (editingId) {
      // 출처(generatedBy·authorName)는 건드리지 않는다 — AI 브리핑의 오탈자를 고쳐도 🤖 배지가 유지되도록
      await db.collection('invest_briefings').doc(editingId).update(payload);
      status.innerHTML = '<span class="ok">✅ 브리핑이 수정되었습니다.</span>';
    } else {
      payload.authorName = myName || '운영진';
      payload.generatedBy = 'admin';
      payload.commentCount = 0;
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('invest_briefings').add(payload);
      status.innerHTML = '<span class="ok">✅ 브리핑이 게시되었습니다.</span>';
    }
    resetBriefingForm();
    await loadBriefings();
  } catch (e) {
    status.innerHTML = '<span class="err">❌ 실패: ' + escapeHtml(e.message || '') + '</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = editingId ? '📋 브리핑 수정' : '📋 브리핑 게시';
  }
}

function resetBriefingForm() {
  editingId = null;
  formTickers = [];
  formSentiment = 'neutral';
  document.getElementById('bDate').value = todayStr();
  document.getElementById('bTitle').value = '';
  document.getElementById('bBody').value = '';
  document.getElementById('bMarket').value = 'all';
  document.getElementById('bPinned').checked = false;
  document.getElementById('bTickerInput').value = '';
  // index.html 의 초기 제목과 동일하게 되돌린다
  document.getElementById('briefingFormTitle').innerHTML = '✍️ 시황 브리핑 직접 작성 '
    + '<span style="font-size:.74rem;color:var(--text3);font-weight:600">(AI 브리핑 보완용)</span>';
  document.getElementById('bSubmitBtn').textContent = '📋 브리핑 게시';
  document.getElementById('bCancelBtn').style.display = 'none';
  setSentiment('neutral');
  renderFormTickers();
}

function editBriefing(id) {
  var p = briefings.filter(function(x) { return x.id === id; })[0];
  if (!p) return;
  editingId = id;
  document.getElementById('bDate').value = p.date || todayStr();
  document.getElementById('bTitle').value = p.title || '';
  document.getElementById('bBody').value = p.body || '';
  document.getElementById('bMarket').value = p.market || 'all';
  document.getElementById('bPinned').checked = !!p.pinned;
  formTickers = Array.isArray(p.tickers) ? p.tickers.map(normalizeTicker) : [];
  setSentiment(p.sentiment || 'neutral');
  renderFormTickers();
  document.getElementById('briefingFormTitle').textContent = '✏️ 시황 브리핑 수정';
  document.getElementById('bSubmitBtn').textContent = '📋 브리핑 수정';
  document.getElementById('bCancelBtn').style.display = '';
  switchTab('admin');
  document.getElementById('bTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function togglePin(id) {
  if (!db || !isAdmin) return;
  var p = briefings.filter(function(x) { return x.id === id; })[0];
  if (!p) return;
  try {
    await db.collection('invest_briefings').doc(id).update({ pinned: !p.pinned });
    await loadBriefings();
  } catch (e) { alert('처리에 실패했습니다.'); }
}

async function deleteBriefing(id) {
  if (!db || !isAdmin) return;
  if (!confirm('이 브리핑을 삭제할까요? 달린 댓글도 함께 정리됩니다.')) return;
  try {
    var ref = db.collection('invest_briefings').doc(id);
    // 서브컬렉션은 자동 삭제되지 않으므로 댓글을 먼저 배치 삭제
    var snap = await ref.collection('comments').limit(400).get();
    while (!snap.empty) {
      var batch = db.batch();
      snap.docs.forEach(function(d) { batch.delete(d.ref); });
      await batch.commit();
      snap = await ref.collection('comments').limit(400).get();
    }
    await ref.delete();
    delete commentCache[id];
    delete openComments[id];
    await loadBriefings();
  } catch (e) {
    alert('삭제에 실패했습니다.');
  }
}

function renderAdminBriefingList() {
  var el = document.getElementById('adminBriefingList');
  if (!el) return;
  if (!briefings.length) { el.innerHTML = '<div class="empty">게시된 브리핑이 없습니다.</div>'; return; }
  el.innerHTML = briefings.map(function(p) {
    return '<div class="admin-list-item">'
      + '<div class="admin-list-info">'
      + '<div class="admin-list-title">' + (p.pinned ? '📌 ' : '') + escapeHtml(p.title || '') + '</div>'
      + '<div class="admin-list-sub">' + escapeHtml(p.date || '') + ' · 댓글 ' + (p.commentCount || 0) + '</div>'
      + '</div>'
      + '<button class="mini-btn" onclick="editBriefing(\'' + p.id + '\')">수정</button>'
      + '<button class="mini-btn" onclick="togglePin(\'' + p.id + '\')">' + (p.pinned ? '고정 해제' : '고정') + '</button>'
      + '<button class="mini-btn danger" onclick="deleteBriefing(\'' + p.id + '\')">삭제</button>'
      + '</div>';
  }).join('');
}

/* ===== 관리자: 설정 ===== */
async function loadConfig() {
  if (!db) return;
  try {
    var doc = await db.collection('invest_config').doc('settings').get();
    var d = doc.exists ? doc.data() : {};
    var notice = document.getElementById('cfgNotice');
    if (notice) notice.value = d.notice || '';
    renderNotice(d.notice);
  } catch (e) { /* 설정 없음 — 기본값 사용 */ }
}

/** 관리자가 설정한 재테크 공지를 시황 탭 상단에 띄운다 */
function renderNotice(text) {
  var el = document.getElementById('investNotice');
  if (!el) return;
  var t = (text || '').trim();
  if (!t) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = '<span class="notice-icon">📢</span><span class="notice-text">'
    + linkifyBody(escapeHtml(t)) + '</span>';
}

async function saveConfig() {
  if (!db || !isAdmin) return;
  var status = document.getElementById('cfgStatus');
  try {
    await db.collection('invest_config').doc('settings').set({
      notice: document.getElementById('cfgNotice').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    renderNotice(document.getElementById('cfgNotice').value);
    status.innerHTML = '<span class="ok">✅ 저장했습니다. 시황 탭 상단에 표시됩니다.</span>';
  } catch (e) {
    status.innerHTML = '<span class="err">❌ 저장 실패</span>';
  }
}

/* ===== 헬퍼 ===== */
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function plainPreview(body, len) {
  return String(body || '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .substring(0, len || 180);
}

function linkifyBody(escaped) {
  // 마크다운 링크와 맨 URL 을 한 번에 훑는다. 두 번에 나눠 돌리면 이미 만든 <a href> 안의 주소를
  // 다시 잡지 않으려고 lookbehind 가 필요한데, iOS 16.3 이하 사파리는 lookbehind 를 파싱하지 못해
  // 이 파일 전체가 SyntaxError 로 죽는다.
  var A = '<a target="_blank" rel="noopener noreferrer" style="color:var(--primary-light);text-decoration:underline';
  return escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s<>"'）\)]+)\)|\b(https?:\/\/[^\s<>"'，）\)]+)/g,
    function (m, label, mdUrl, bareUrl) {
      if (mdUrl) return A + '" href="' + mdUrl + '">' + label + '</a>';
      return A + ';word-break:break-all" href="' + bareUrl + '">' + bareUrl + '</a>';
    }
  );
}

function todayStr() {
  var d = new Date();
  var off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

function timeAgo(ts) {
  if (!ts || !ts.seconds) return '방금';
  var diff = Date.now() / 1000 - ts.seconds;
  if (diff < 60) return '방금';
  if (diff < 3600) return Math.floor(diff / 60) + '분 전';
  if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
  if (diff < 604800) return Math.floor(diff / 86400) + '일 전';
  var d = new Date(ts.seconds * 1000);
  return (d.getMonth() + 1) + '.' + d.getDate();
}

/** 브리핑의 종목 칩 → 시세 탭의 종목 상세로 이동 */
function goStock(code, name) {
  if (typeof openStock !== 'function') return;
  openStock(code, name);
}

/** onclick 인자 이스케이프 — 본체는 market-ui.js. 미로드 시에만 같은 동작으로 대비한다 */
if (typeof escapeJsArg !== 'function') {
  window.escapeJsArg = function (s) {
    return escapeHtml(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' '))
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
}
