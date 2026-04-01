/* ===== 드라이브 코스 - DT Club ===== */

var db = null, storage = null, currentUser = null, isAdmin = false;
var allPosts = [];
var currentFilter = 'all';
var editingPostId = null;
var selectedFiles = []; // {file, previewUrl}
var existingImages = []; // already-uploaded URLs (edit mode)
var lastDoc = null;
var PAGE_SIZE = 12;

var SEASON_TAGS = ['봄', '여름', '가을', '겨울'];
var THEME_TAGS  = ['야경', '해안도로', '산악', '카페로드', '드라이브'];

/* ===== Firebase 초기화 ===== */
try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  storage = firebase.storage();
  firebase.auth().onAuthStateChanged(function(user) {
    currentUser = user;
    isAdmin = false;
    if (user && !user.isAnonymous) {
      db.collection('users').doc(user.uid).get().then(function(doc) {
        var role = doc.data() && doc.data().role;
        isAdmin = (role === 'admin' || role === 'superadmin');
      }).catch(function() {});
      document.getElementById('writeBtn').style.display = '';
    } else {
      document.getElementById('writeBtn').style.display = 'none';
    }
    loadPosts();
  });
} catch(e) {
  console.log('Firebase 미연결');
  renderPosts([]);
}

/* ===== 필터 바 렌더링 ===== */
(function() {
  var tags = ['전체'].concat(SEASON_TAGS).concat(THEME_TAGS);
  document.getElementById('courseFilter').innerHTML = tags.map(function(t) {
    return '<button class="filter-btn' + (t === '전체' ? ' active' : '') + '" onclick="setFilter(this, \'' + t + '\')">' + t + '</button>';
  }).join('');
})();

function setFilter(btn, tag) {
  document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  currentFilter = tag === '전체' ? 'all' : tag;
  renderFilteredPosts();
}

/* ===== 데이터 로드 ===== */
async function loadPosts() {
  if (!db) { renderPosts([]); return; }
  try {
    var snap = await db.collection('course_posts')
      .orderBy('createdAt', 'desc')
      .limit(PAGE_SIZE)
      .get();
    allPosts = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    lastDoc = snap.docs[snap.docs.length - 1] || null;
    document.getElementById('loadMoreWrap').style.display = snap.docs.length === PAGE_SIZE ? '' : 'none';
    renderFilteredPosts();
  } catch(e) {
    console.log('로드 실패', e);
    renderPosts([]);
  }
}

async function loadMore() {
  if (!db || !lastDoc) return;
  try {
    var snap = await db.collection('course_posts')
      .orderBy('createdAt', 'desc')
      .startAfter(lastDoc)
      .limit(PAGE_SIZE)
      .get();
    var more = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    allPosts = allPosts.concat(more);
    lastDoc = snap.docs[snap.docs.length - 1] || null;
    if (snap.docs.length < PAGE_SIZE) document.getElementById('loadMoreWrap').style.display = 'none';
    renderFilteredPosts();
  } catch(e) {}
}

/* ===== 렌더링 ===== */
function renderFilteredPosts() {
  var posts = currentFilter === 'all' ? allPosts : allPosts.filter(function(p) {
    return (p.seasons && p.seasons.includes(currentFilter)) ||
           (p.themes && p.themes.includes(currentFilter));
  });
  renderPosts(posts);
}

function renderPosts(posts) {
  var el = document.getElementById('courseList');
  if (!posts || posts.length === 0) {
    el.innerHTML = '<div class="empty-state">' +
      '<div class="empty-state-icon">🗺️</div>' +
      '<h3>아직 작성된 코스가 없습니다</h3>' +
      '<p>첫 번째 드라이브 코스를 소개해보세요!</p>' +
      '</div>';
    return;
  }
  el.innerHTML = posts.map(function(p) { return buildPostCard(p); }).join('');
}

function buildPostCard(p) {
  var thumb = '';
  if (p.images && p.images.length > 0) {
    thumb = '<img class="post-thumb" src="' + escHtml(p.images[0]) + '" alt="' + escHtml(p.title) + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\"post-thumb-placeholder\\">🗺️</div>\'">';
  } else {
    thumb = '<div class="post-thumb-placeholder">🗺️</div>';
  }
  var tags = [];
  (p.seasons || []).forEach(function(s) { tags.push('<span class="post-tag tag-season">' + s + '</span>'); });
  (p.themes || []).forEach(function(t) { tags.push('<span class="post-tag tag-theme">' + t + '</span>'); });
  var date = p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '';
  return '<div class="post-card" onclick="openDetailModal(\'' + p.id + '\')">' +
    thumb +
    '<div class="post-body">' +
      '<div class="post-title">' + escHtml(p.title) + '</div>' +
      (tags.length ? '<div class="post-tags">' + tags.join('') + '</div>' : '') +
      '<div class="post-meta">' + escHtml(p.authorName || '익명') + ' · ' + date + '</div>' +
    '</div>' +
    '</div>';
}

/* ===== 상세 모달 ===== */
function openDetailModal(postId) {
  var p = allPosts.find(function(x) { return x.id === postId; });
  if (!p) return;

  // 이미지
  var galleryHtml = '';
  if (p.images && p.images.length > 0) {
    galleryHtml = '<div class="detail-gallery">' +
      p.images.map(function(url) {
        return '<img class="detail-gallery-img" src="' + escHtml(url) + '" alt="" loading="lazy">';
      }).join('') +
      '</div>';
    if (p.images.length > 1) {
      galleryHtml += '<div class="detail-gallery-count">← 스크롤하여 ' + p.images.length + '장 보기 →</div>';
    }
  } else {
    galleryHtml = '<div class="detail-gallery-placeholder">🗺️</div>';
  }

  // 태그
  var tags = [];
  (p.seasons || []).forEach(function(s) { tags.push('<span class="post-tag tag-season">' + s + '</span>'); });
  (p.themes || []).forEach(function(t) { tags.push('<span class="post-tag tag-theme">' + t + '</span>'); });

  // 날짜
  var date = p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  // 통계
  var statsHtml = '';
  if (p.distance || p.duration) {
    statsHtml = '<div class="detail-stats">' +
      (p.distance ? '<div class="stat-item"><div class="stat-value">' + p.distance + 'km</div><div class="stat-label">거리</div></div>' : '') +
      (p.duration ? '<div class="stat-item"><div class="stat-value">' + escHtml(p.duration) + '</div><div class="stat-label">소요시간</div></div>' : '') +
      '</div>';
  }

  // 경유지
  var spotsHtml = '';
  if (p.spots && p.spots.length > 0) {
    spotsHtml = '<div class="detail-spots"><div class="detail-spots-label">📍 주요 경유지</div><ul class="detail-spots-list">' +
      p.spots.map(function(s, i) {
        var icon = i === 0 ? '🚩' : i === p.spots.length - 1 ? '🏁' : '→';
        return '<li>' + icon + ' ' + escHtml(s) + '</li>';
      }).join('') +
      '</ul></div>';
  }

  document.getElementById('detailContent').innerHTML =
    galleryHtml +
    '<div class="detail-body">' +
      '<div class="detail-title">' + escHtml(p.title) + '</div>' +
      (tags.length ? '<div class="detail-tags">' + tags.join('') + '</div>' : '') +
      '<div class="detail-meta">' + escHtml(p.authorName || '익명') + ' · ' + date + '</div>' +
      statsHtml +
      '<div class="detail-content">' + escHtml(p.content || '') + '</div>' +
      spotsHtml +
    '</div>';

  // 작성자/관리자 버튼
  var actionsHtml = '';
  if (currentUser && (isAdmin || currentUser.uid === p.authorUid)) {
    actionsHtml =
      '<button class="btn-edit" onclick="openEditModal(\'' + p.id + '\')">✏️ 수정</button>' +
      '<button class="btn-delete" onclick="deletePost(\'' + p.id + '\')">🗑️ 삭제</button>';
  }
  document.getElementById('detailActions').innerHTML = actionsHtml;

  document.getElementById('detailModal').style.display = 'flex';
}

function closeDetailModal() {
  document.getElementById('detailModal').style.display = 'none';
}

/* ===== 글 작성 모달 ===== */
function openWriteModal() {
  if (!currentUser || currentUser.isAnonymous) { alert('로그인이 필요합니다.'); return; }
  editingPostId = null;
  selectedFiles = [];
  existingImages = [];
  document.getElementById('writeModalTitle').textContent = '드라이브 코스 작성';
  document.getElementById('wTitle').value = '';
  document.getElementById('wContent').value = '';
  document.getElementById('wDistance').value = '';
  document.getElementById('wDuration').value = '';
  document.getElementById('wSpots').value = '';
  document.getElementById('imgInput').value = '';
  document.querySelectorAll('.switch-group input[type="checkbox"]').forEach(function(c) { c.checked = false; });
  renderImgPreviews();
  document.getElementById('writeModal').style.display = 'flex';
  setTimeout(function() { document.getElementById('wTitle').focus(); }, 100);
}

function openEditModal(postId) {
  var p = allPosts.find(function(x) { return x.id === postId; });
  if (!p) return;
  closeDetailModal();

  editingPostId = postId;
  selectedFiles = [];
  existingImages = (p.images || []).slice();

  document.getElementById('writeModalTitle').textContent = '코스 수정';
  document.getElementById('wTitle').value = p.title || '';
  document.getElementById('wContent').value = p.content || '';
  document.getElementById('wDistance').value = p.distance || '';
  document.getElementById('wDuration').value = p.duration || '';
  document.getElementById('wSpots').value = (p.spots || []).join(', ');
  document.getElementById('imgInput').value = '';

  // 스위치 활성화
  document.querySelectorAll('#wSeasons input[type="checkbox"]').forEach(function(c) {
    c.checked = (p.seasons || []).includes(c.dataset.val);
  });
  document.querySelectorAll('#wThemes input[type="checkbox"]').forEach(function(c) {
    c.checked = (p.themes || []).includes(c.dataset.val);
  });

  renderImgPreviews();
  document.getElementById('writeModal').style.display = 'flex';
}

function closeWriteModal() {
  document.getElementById('writeModal').style.display = 'none';
  selectedFiles.forEach(function(f) { URL.revokeObjectURL(f.previewUrl); });
  selectedFiles = [];
  existingImages = [];
}

/* ===== 이미지 처리 ===== */
function handleImageSelect(input) {
  var files = Array.from(input.files);
  var remaining = 5 - existingImages.length - selectedFiles.length;
  if (remaining <= 0) { alert('최대 5장까지 첨부할 수 있습니다.'); return; }
  files = files.slice(0, remaining);
  files.forEach(function(file) {
    if (file.size > 10 * 1024 * 1024) { alert(file.name + ' 파일이 너무 큽니다 (최대 10MB).'); return; }
    selectedFiles.push({ file: file, previewUrl: URL.createObjectURL(file) });
  });
  input.value = '';
  renderImgPreviews();
}

function renderImgPreviews() {
  var total = existingImages.length + selectedFiles.length;
  var list = document.getElementById('imgPreviewList');
  var placeholder = document.getElementById('imgPlaceholder');
  placeholder.style.display = total > 0 ? 'none' : '';

  var html = '';
  existingImages.forEach(function(url, i) {
    html += '<div class="img-preview-wrap">' +
      '<img class="img-preview" src="' + escHtml(url) + '">' +
      '<button class="img-preview-del" onclick="removeExistingImage(' + i + ')">✕</button>' +
      '</div>';
  });
  selectedFiles.forEach(function(f, i) {
    html += '<div class="img-preview-wrap">' +
      '<img class="img-preview" src="' + f.previewUrl + '">' +
      '<button class="img-preview-del" onclick="removeNewImage(' + i + ')">✕</button>' +
      '</div>';
  });
  if (total < 5) {
    html += '<button class="img-add-btn" onclick="document.getElementById(\'imgInput\').click()">+</button>';
  }
  list.innerHTML = html;
}

function removeExistingImage(i) {
  existingImages.splice(i, 1);
  renderImgPreviews();
}

function removeNewImage(i) {
  URL.revokeObjectURL(selectedFiles[i].previewUrl);
  selectedFiles.splice(i, 1);
  renderImgPreviews();
}

/* ===== 글 제출 ===== */
async function submitPost() {
  if (!currentUser || !db) return;
  var title = document.getElementById('wTitle').value.trim();
  var content = document.getElementById('wContent').value.trim();
  if (!title) { alert('제목을 입력해주세요.'); document.getElementById('wTitle').focus(); return; }
  if (!content) { alert('내용을 입력해주세요.'); document.getElementById('wContent').focus(); return; }

  var seasons = Array.from(document.querySelectorAll('#wSeasons input:checked')).map(function(c) { return c.dataset.val; });
  var themes = Array.from(document.querySelectorAll('#wThemes input:checked')).map(function(c) { return c.dataset.val; });
  var distance = parseFloat(document.getElementById('wDistance').value) || null;
  var duration = document.getElementById('wDuration').value.trim() || null;
  var spots = document.getElementById('wSpots').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = '업로드 중...';

  try {
    // 새 이미지 업로드
    var newUrls = [];
    for (var i = 0; i < selectedFiles.length; i++) {
      btn.textContent = '사진 업로드 중 (' + (i + 1) + '/' + selectedFiles.length + ')...';
      var f = selectedFiles[i].file;
      var path = 'course_images/' + currentUser.uid + '/' + Date.now() + '_' + i + '_' + f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var ref = storage.ref(path);
      var snap = await ref.put(f);
      var url = await snap.ref.getDownloadURL();
      newUrls.push(url);
    }

    var images = existingImages.concat(newUrls);
    var postData = {
      title: title,
      content: content,
      images: images,
      seasons: seasons,
      themes: themes,
      spots: spots,
      distance: distance,
      duration: duration,
      authorUid: currentUser.uid,
      authorName: currentUser.displayName || currentUser.email || '익명',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (editingPostId) {
      await db.collection('course_posts').doc(editingPostId).update(postData);
      // 로컬 업데이트
      var idx = allPosts.findIndex(function(p) { return p.id === editingPostId; });
      if (idx >= 0) allPosts[idx] = Object.assign(allPosts[idx], postData);
    } else {
      postData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      postData.likeCount = 0;
      var ref2 = await db.collection('course_posts').add(postData);
      // 로컬에 임시 추가
      allPosts.unshift(Object.assign({ id: ref2.id }, postData, { createdAt: { seconds: Date.now() / 1000 } }));
    }

    closeWriteModal();
    renderFilteredPosts();
  } catch(e) {
    alert('오류가 발생했습니다: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '등록하기';
  }
}

/* ===== 삭제 ===== */
async function deletePost(postId) {
  if (!confirm('정말 삭제할까요?')) return;
  try {
    await db.collection('course_posts').doc(postId).delete();
    allPosts = allPosts.filter(function(p) { return p.id !== postId; });
    closeDetailModal();
    renderFilteredPosts();
  } catch(e) {
    alert('삭제 실패: ' + e.message);
  }
}

/* 스위치는 checkbox 기본 동작으로 처리 — 별도 JS 불필요 */

/* ===== 테마 ===== */
function toggleTheme() {
  var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dt-theme', next);
  document.getElementById('themeToggle').textContent = next === 'light' ? '☀️' : '🌙';
}
(function() {
  var saved = localStorage.getItem('dt-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  var btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = saved === 'light' ? '☀️' : '🌙';
})();

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
