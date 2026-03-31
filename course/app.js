/* ===== 드라이브 코스 가이드 - DT Club ===== */

var db = null, currentUser = null, isAdmin = false;
var courseData = { region: null, season: null, theme: null };
var editingDocId = null;
var adminMode = 'visual';

var REGION_CATS = ['전체', '수도권', '강원', '부산·경남', '전라', '충청', '제주'];
var SEASON_CATS = ['전체', '봄', '여름', '가을', '겨울'];
var THEME_CATS  = ['전체', '야경', '해안도로', '산악', '카페로드'];

/* ===== Firebase 초기화 ===== */
try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  firebase.auth().onAuthStateChanged(function(user) {
    currentUser = user;
    isAdmin = false;
    if (user && !user.isAnonymous) {
      db.collection('users').doc(user.uid).get().then(function(doc) {
        var role = doc.data() && doc.data().role;
        isAdmin = (role === 'admin' || role === 'superadmin');
        if (isAdmin) document.querySelectorAll('.admin-edit-btn').forEach(function(b) { b.style.display = ''; });
      }).catch(function() {});
    }
    loadCourseData();
  });
} catch(e) {
  console.log('Firebase 미연결');
  renderAll();
}

/* ===== 데이터 로드 ===== */
async function loadCourseData() {
  if (!db) { renderAll(); return; }
  try {
    var docs = ['region', 'season', 'theme'];
    for (var i = 0; i < docs.length; i++) {
      var snap = await db.collection('course_data').doc(docs[i]).get();
      if (snap.exists) courseData[docs[i]] = snap.data();
    }
  } catch(e) {
    console.log('Firestore 로드 실패');
  }
  renderAll();
}

/* ===== 렌더링 ===== */
function renderAll() {
  renderTab('region', REGION_CATS, 'region');
  renderTab('season', SEASON_CATS, 'season');
  renderTab('theme', THEME_CATS, 'theme');
}

function renderTab(tabId, cats, docId) {
  renderFilter(tabId + 'Filter', cats, docId);
  renderCourseList(tabId + 'List', docId, 'all');
}

function renderFilter(filterId, cats, docId) {
  var el = document.getElementById(filterId);
  if (!el) return;
  el.innerHTML = cats.map(function(c) {
    return '<button class="filter-btn' + (c === '전체' ? ' active' : '') + '" onclick="setFilter(this, \'' + docId + '\')">' + c + '</button>';
  }).join('');
}

function setFilter(btn, docId) {
  var bar = btn.parentElement;
  bar.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  renderCourseList(docId + 'List', docId, btn.textContent);
}

function renderCourseList(listId, docId, filter) {
  var el = document.getElementById(listId);
  if (!el) return;
  var data = courseData[docId];

  if (!data || !data.items || data.items.length === 0) {
    el.innerHTML = '<div class="coming-soon">' +
      '<div class="coming-soon-icon">🗺️</div>' +
      '<h3>코스 준비 중</h3>' +
      '<p>멋진 드라이브 코스를 큐레이션 중입니다.<br>곧 업데이트될 예정입니다.</p>' +
      '</div>';
    return;
  }

  var items = filter === '전체' ? data.items : data.items.filter(function(it) {
    return it.region === filter || (it.seasons && it.seasons.includes(filter)) || (it.themes && it.themes.includes(filter));
  });

  if (items.length === 0) {
    el.innerHTML = '<div class="coming-soon"><div class="coming-soon-icon">🔍</div><h3>해당 코스가 없습니다</h3></div>';
    return;
  }

  el.innerHTML = items.map(function(it) {
    var tags = [];
    if (it.region) tags.push('<span class="course-tag tag-region">' + it.region + '</span>');
    (it.seasons || []).forEach(function(s) { tags.push('<span class="course-tag tag-season">' + s + '</span>'); });
    (it.themes || []).forEach(function(t) { tags.push('<span class="course-tag tag-theme">' + t + '</span>'); });
    return '<button class="course-card" onclick="openCourseModal(\'' + docId + '\', \'' + it.id + '\')">' +
      '<div class="course-emoji">' + (it.emoji || '🗺️') + '</div>' +
      '<div class="course-title">' + escHtml(it.title) + '</div>' +
      '<div class="course-meta">' + tags.join('') + '</div>' +
      '<div class="course-info">' +
        (it.distance ? '<span>📍 ' + it.distance + 'km</span>' : '') +
        (it.duration ? '<span>⏱️ ' + it.duration + '</span>' : '') +
      '</div>' +
      '</button>';
  }).join('');
}

function filterCourses(docId) {
  var search = (document.getElementById(docId + 'Search')?.value || '').trim().toLowerCase();
  var filter = document.querySelector('#' + docId + 'Filter .filter-btn.active')?.textContent || '전체';
  var el = document.getElementById(docId + 'List');
  var data = courseData[docId];
  if (!data || !data.items) return;

  var items = data.items.filter(function(it) {
    var matchFilter = filter === '전체' || it.region === filter || (it.seasons && it.seasons.includes(filter)) || (it.themes && it.themes.includes(filter));
    var matchSearch = !search || it.title.toLowerCase().includes(search) || (it.summary && it.summary.toLowerCase().includes(search));
    return matchFilter && matchSearch;
  });
  // re-render with filtered items (simple approach)
  renderCourseListItems(el, docId, items);
}

function renderCourseListItems(el, docId, items) {
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="coming-soon"><div class="coming-soon-icon">🔍</div><h3>검색 결과가 없습니다</h3></div>';
    return;
  }
  el.innerHTML = items.map(function(it) {
    var tags = [];
    if (it.region) tags.push('<span class="course-tag tag-region">' + it.region + '</span>');
    (it.seasons || []).forEach(function(s) { tags.push('<span class="course-tag tag-season">' + s + '</span>'); });
    (it.themes || []).forEach(function(t) { tags.push('<span class="course-tag tag-theme">' + t + '</span>'); });
    return '<button class="course-card" onclick="openCourseModal(\'' + docId + '\', \'' + it.id + '\')">' +
      '<div class="course-emoji">' + (it.emoji || '🗺️') + '</div>' +
      '<div class="course-title">' + escHtml(it.title) + '</div>' +
      '<div class="course-meta">' + tags.join('') + '</div>' +
      '<div class="course-info">' +
        (it.distance ? '<span>📍 ' + it.distance + 'km</span>' : '') +
        (it.duration ? '<span>⏱️ ' + it.duration + '</span>' : '') +
      '</div></button>';
  }).join('');
}

/* ===== 코스 상세 모달 ===== */
function openCourseModal(docId, id) {
  var data = courseData[docId];
  var it = data && data.items && data.items.find(function(x) { return x.id === id; });
  if (!it) return;

  var tags = [];
  if (it.region) tags.push('<span class="course-tag tag-region">' + it.region + '</span>');
  (it.seasons || []).forEach(function(s) { tags.push('<span class="course-tag tag-season">' + s + '</span>'); });
  (it.themes || []).forEach(function(t) { tags.push('<span class="course-tag tag-theme">' + t + '</span>'); });

  var spotsHtml = (it.spots || []).map(function(s, i) {
    return '<li>' + (i === 0 ? '🚩' : i === (it.spots.length - 1) ? '🏁' : '→') + ' ' + escHtml(s) + '</li>';
  }).join('');

  var tipsHtml = (it.tips || []).map(function(t) { return '<li>' + escHtml(t) + '</li>'; }).join('');

  document.getElementById('courseModalContent').innerHTML =
    '<div class="detail-header">' +
      '<div class="detail-emoji">' + (it.emoji || '🗺️') + '</div>' +
      '<div><div class="detail-title">' + escHtml(it.title) + '</div>' +
      '<div class="detail-tags">' + tags.join('') + '</div></div>' +
    '</div>' +
    (it.distance || it.duration || it.difficulty ? '<div class="detail-stats">' +
      (it.distance ? '<div class="stat-item"><div class="stat-value">' + it.distance + 'km</div><div class="stat-label">거리</div></div>' : '') +
      (it.duration ? '<div class="stat-item"><div class="stat-value">' + it.duration + '</div><div class="stat-label">소요</div></div>' : '') +
      (it.difficulty ? '<div class="stat-item"><div class="stat-value">' + ({easy:'쉬움',medium:'보통',hard:'어려움'}[it.difficulty]||it.difficulty) + '</div><div class="stat-label">난이도</div></div>' : '') +
    '</div>' : '') +
    (it.summary ? '<div class="detail-section"><div class="detail-label">코스 소개</div><div class="detail-text">' + escHtml(it.summary) + '</div></div>' : '') +
    (spotsHtml ? '<div class="detail-section"><div class="detail-label">📍 추천 경유지</div><ul class="detail-spots">' + spotsHtml + '</ul></div>' : '') +
    (tipsHtml ? '<div class="detail-section"><div class="detail-label">꿀팁</div><ul class="detail-tips">' + tipsHtml + '</ul></div>' : '') +
    (it.map_url ? '<a href="' + it.map_url + '" target="_blank" rel="noopener" style="display:block;text-align:center;padding:10px;background:var(--bg);border:1px solid var(--border);color:var(--primary);text-decoration:none;font-weight:700;font-size:.88rem;margin-top:8px">🗺️ 네이버 지도로 보기</a>' : '');

  document.getElementById('courseModal').style.display = 'flex';
}

function closeCourseModal() {
  document.getElementById('courseModal').style.display = 'none';
}

/* ===== 탭 전환 ===== */
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ===== 관리자 모달 ===== */
function setAdminMode(mode) {
  adminMode = mode;
  document.querySelectorAll('.admin-mode-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelector('.admin-mode-btn:' + (mode === 'visual' ? 'first-child' : 'last-child')).classList.add('active');
  var visual = document.getElementById('adminVisualEditor');
  var json = document.getElementById('adminModalData');
  if (mode === 'visual') {
    try { buildVisualEditor(editingDocId, JSON.parse(json.value)); } catch(e) {}
    visual.style.display = ''; json.style.display = 'none';
  } else {
    var d = collectVisualData(); if (d) json.value = JSON.stringify(d, null, 2);
    visual.style.display = 'none'; json.style.display = '';
  }
}

function openAdminModal(docId) {
  editingDocId = docId;
  adminMode = 'visual';
  var data = JSON.parse(JSON.stringify(courseData[docId] || { items: [] }));
  var titles = { region: '지역별 코스 관리', season: '계절별 코스 관리', theme: '테마별 코스 관리' };
  document.getElementById('adminModalTitle').textContent = titles[docId] || docId;
  document.getElementById('adminModalData').value = JSON.stringify(data, null, 2);
  buildVisualEditor(docId, data);
  document.getElementById('adminVisualEditor').style.display = '';
  document.getElementById('adminModalData').style.display = 'none';
  document.querySelectorAll('.admin-mode-btn').forEach(function(b, i) { b.classList.toggle('active', i === 0); });
  document.getElementById('adminModal').style.display = 'flex';
}

function buildVisualEditor(docId, data) {
  var el = document.getElementById('adminVisualEditor');
  var items = (data && data.items) || [];
  var html = '<div class="ve-section"><div class="ve-label">코스 목록 (' + items.length + '개)</div><div id="ve-items">';
  items.forEach(function(it, i) {
    html += buildCourseItemEditor(it, i);
  });
  html += '</div><button class="ve-add" onclick="veAddCourse()">+ 코스 추가</button></div>';
  el.innerHTML = html;
}

function buildCourseItemEditor(it, i) {
  return '<div class="ve-item" data-idx="' + i + '">' +
    '<div class="ve-item-row">' +
      '<input class="ve-input" style="width:50px" data-field="emoji" value="' + escHtml(it.emoji||'🗺️') + '" placeholder="이모지">' +
      '<input class="ve-input ve-flex" data-field="title" value="' + escHtml(it.title||'') + '" placeholder="코스 이름">' +
      '<button class="ve-del" onclick="veRemoveItem(this)" title="삭제">✕</button>' +
    '</div>' +
    '<div class="ve-item-row">' +
      '<input class="ve-input" style="flex:1" data-field="region" value="' + escHtml(it.region||'') + '" placeholder="지역">' +
      '<input class="ve-input" style="width:70px" data-field="distance" value="' + escHtml(String(it.distance||'')) + '" placeholder="km">' +
      '<input class="ve-input" style="width:90px" data-field="duration" value="' + escHtml(it.duration||'') + '" placeholder="소요시간">' +
    '</div>' +
    '<input class="ve-input" data-field="seasons" value="' + escHtml((it.seasons||[]).join(', ')) + '" placeholder="계절 (쉼표 구분: 봄, 여름)" style="margin-top:4px">' +
    '<input class="ve-input" data-field="themes" value="' + escHtml((it.themes||[]).join(', ')) + '" placeholder="테마 (쉼표 구분: 야경, 해안도로)" style="margin-top:4px">' +
    '<textarea class="ve-textarea" data-field="summary" placeholder="코스 소개" style="margin-top:4px;min-height:50px">' + escHtml(it.summary||'') + '</textarea>' +
    '<input class="ve-input" data-field="spots" value="' + escHtml((it.spots||[]).join(', ')) + '" placeholder="경유지 (쉼표 구분)" style="margin-top:4px">' +
    '<input class="ve-input" data-field="tips" value="' + escHtml((it.tips||[]).join(', ')) + '" placeholder="꿀팁 (쉼표 구분)" style="margin-top:4px">' +
    '<input class="ve-input" data-field="map_url" value="' + escHtml(it.map_url||'') + '" placeholder="네이버 지도 URL (선택)" style="margin-top:4px">' +
    '</div>';
}

function veRemoveItem(btn) {
  if (!confirm('삭제할까요?')) return;
  btn.closest('.ve-item').remove();
}

function veAddCourse() {
  var container = document.getElementById('ve-items');
  var idx = container.children.length;
  container.insertAdjacentHTML('beforeend', buildCourseItemEditor({ emoji:'🗺️', title:'', region:'', distance:'', duration:'', seasons:[], themes:[], summary:'', spots:[], tips:[], map_url:'' }, idx));
}

function collectVisualData() {
  var items = [];
  document.querySelectorAll('#ve-items .ve-item').forEach(function(el, i) {
    var g = function(f) { return (el.querySelector('[data-field="' + f + '"]')?.value || '').trim(); };
    var title = g('title');
    if (!title) return;
    items.push({
      id: editingDocId + (i + 1),
      emoji: g('emoji') || '🗺️',
      title: title,
      region: g('region'),
      distance: parseFloat(g('distance')) || null,
      duration: g('duration'),
      seasons: g('seasons').split(',').map(function(s){return s.trim();}).filter(Boolean),
      themes: g('themes').split(',').map(function(s){return s.trim();}).filter(Boolean),
      summary: g('summary'),
      spots: g('spots').split(',').map(function(s){return s.trim();}).filter(Boolean),
      tips: g('tips').split(',').map(function(s){return s.trim();}).filter(Boolean),
      map_url: g('map_url') || null
    });
  });
  return { items: items };
}

function closeAdminModal() {
  document.getElementById('adminModal').style.display = 'none';
  editingDocId = null;
}

async function saveAdminData() {
  if (!editingDocId || !db || !isAdmin) return;
  try {
    var parsed = adminMode === 'visual' ? collectVisualData() : JSON.parse(document.getElementById('adminModalData').value);
    if (!parsed) { alert('데이터 수집 실패'); return; }
    await db.collection('course_data').doc(editingDocId).set(parsed);
    courseData[editingDocId] = parsed;
    closeAdminModal();
    renderAll();
    alert('저장 완료!');
  } catch(e) { alert('오류: ' + e.message); }
}

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
