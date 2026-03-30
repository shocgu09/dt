/* ===== DT 스팟 - DT Club ===== */

var db = null, currentUser = null, isAdmin = false;
var kakaoMap = null;
var allSpots = [], allCourses = [];
var overlays = [], polylines = [];
var currentCategory = 'all';
var searchQuery = '';
var _spotSearchResults = [];
var _waypointSearchResults = {};
var _waypoints = [];
var _editingSpotId = null;
var _editingCourseId = null;


var CATEGORY_COLOR = { '맛집': '#e74c5a', '카페': '#c0772a', '명소': '#4a90d9', '기타': '#888888' };
var CATEGORY_EMOJI = { '맛집': '🍽️', '카페': '☕', '명소': '🏛️', '기타': '📍' };
var COURSE_COLOR = '#7c6fff';
var ROUTE_WORKER = 'https://dt-route.shocguna.workers.dev';


// ===== Firebase 초기화 =====
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
        renderAll();
      }).catch(function() {});
    }
    updateAuthUI();
  });
} catch(e) { console.log('Firebase 미연결'); }

// ===== 테마 =====
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

// ===== 인증 UI =====
function updateAuthUI() {
  var fab = document.getElementById('fabContainer');
  var status = document.getElementById('authStatus');
  var isLoggedIn = currentUser && !currentUser.isAnonymous;
  if (fab) fab.style.display = isLoggedIn ? '' : 'none';
  if (status) status.textContent = isLoggedIn ? '' : '로그인하면 장소를 등록할 수 있습니다';
}

// ===== 지도 초기화 =====
function initMap() {
  kakao.maps.load(function() {
    var container = document.getElementById('map');
    kakaoMap = new kakao.maps.Map(container, {
      center: new kakao.maps.LatLng(36.5, 127.9),
      level: 12
    });
    loadData();
  });
}

// ===== 데이터 로드 =====
async function loadData() {
  if (!db) {
    document.getElementById('spotList').innerHTML = '<div class="empty">Firebase 연결 필요</div>';
    return;
  }
  try {
    var results = await Promise.all([
      db.collection('spots').orderBy('createdAt', 'desc').get(),
      db.collection('drive_courses').orderBy('createdAt', 'desc').get()
    ]);
    allSpots = results[0].docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    allCourses = results[1].docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    renderAll();

    // 데이터 있으면 지도 범위 맞춤
    var allLats = allSpots.filter(function(s) { return s.lat; }).map(function(s) { return s.lat; });
    var allLngs = allSpots.filter(function(s) { return s.lng; }).map(function(s) { return s.lng; });
    allCourses.forEach(function(c) {
      (c.waypoints || []).forEach(function(wp) {
        if (wp.lat) { allLats.push(wp.lat); allLngs.push(wp.lng); }
      });
    });
    if (allLats.length) {
      var bounds = new kakao.maps.LatLngBounds();
      allLats.forEach(function(lat, i) { bounds.extend(new kakao.maps.LatLng(lat, allLngs[i])); });
      kakaoMap.setBounds(bounds, 80);
    }
  } catch(e) {
    document.getElementById('spotList').innerHTML = '<div class="empty">데이터를 불러올 수 없습니다</div>';
  }
}

// ===== 필터 =====
function filterCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('[data-cat]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.cat === cat);
  });
  renderAll();
}

function matchesSearch(text) {
  if (!searchQuery) return true;
  return (text || '').toLowerCase().indexOf(searchQuery) !== -1;
}

function spotMatchesSearch(s) {
  return matchesSearch(s.name) || matchesSearch(s.address) || matchesSearch(s.memo);
}

function courseMatchesSearch(c) {
  if (matchesSearch(c.name) || matchesSearch(c.description)) return true;
  return (c.waypoints || []).some(function(wp) {
    return matchesSearch(wp.name) || matchesSearch(wp.address) || matchesSearch(wp.memo);
  });
}

function getFiltered() {
  var spots, courses;
  if (currentCategory === 'all') { spots = allSpots; courses = allCourses; }
  else if (currentCategory === '코스') { spots = []; courses = allCourses; }
  else { spots = allSpots.filter(function(s) { return s.category === currentCategory; }); courses = []; }

  if (searchQuery) {
    spots = spots.filter(spotMatchesSearch);
    courses = courses.filter(courseMatchesSearch);
  }
  return { spots: spots, courses: courses };
}

function onSearchInput(val) {
  searchQuery = val.trim().toLowerCase();
  document.getElementById('searchClearBtn').style.display = searchQuery ? '' : 'none';
  renderAll();
}

function clearSearch() {
  searchQuery = '';
  document.getElementById('spotSearchBar').value = '';
  document.getElementById('searchClearBtn').style.display = 'none';
  renderAll();
}

// ===== 전체 렌더링 =====
function renderAll() {
  clearMapOverlays();
  var filtered = getFiltered();
  renderMapOverlays(filtered.spots, filtered.courses);
  renderList(filtered.spots, filtered.courses);
  document.getElementById('listCount').textContent = '총 ' + (filtered.spots.length + filtered.courses.length) + '개';
}

// ===== 지도 오버레이 =====
function clearMapOverlays() {
  overlays.forEach(function(o) { o.setMap(null); });
  polylines.forEach(function(p) { p.setMap(null); });
  overlays = [];
  polylines = [];
}

function renderMapOverlays(spots, courses) {
  spots.forEach(function(spot) {
    if (!spot.lat || !spot.lng) return;
    var color = CATEGORY_COLOR[spot.category] || '#888';
    var emoji = CATEGORY_EMOJI[spot.category] || '📍';
    var content = '<div class="map-marker" style="background:' + color + '" onclick="selectSpot(\'' + spot.id + '\')" title="' + escapeHtml(spot.name) + '">' + emoji + '</div>';
    var overlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(spot.lat, spot.lng),
      content: content, yAnchor: 1.2
    });
    overlay.setMap(kakaoMap);
    overlays.push(overlay);
  });

  courses.forEach(function(course) { renderCourseOverlay(course); });
}

function renderCourseOverlay(course) {
  if (!course.waypoints || course.waypoints.length < 2) return;
  var validWps = course.waypoints.filter(function(wp) { return wp.lat && wp.lng; });
  if (validWps.length < 2) return;

  validWps.forEach(function(wp, i) {
    var content = '<div class="map-marker course-wp" onclick="selectCourse(\'' + course.id + '\')" title="' + escapeHtml(course.name) + '">' + (i + 1) + '</div>';
    var overlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(wp.lat, wp.lng),
      content: content, yAnchor: 1.2
    });
    overlay.setMap(kakaoMap);
    overlays.push(overlay);
  });

  if (course.routePath && course.routePath.length) {
    drawPolyline(course.routePath);
  } else {
    fetchAndDrawRoute(course);
  }
}

async function fetchAndDrawRoute(course) {
  var wps = (course.waypoints || []).filter(function(wp) { return wp.lat && wp.lng; });
  if (wps.length < 2) return;
  try {
    var origin = wps[0].lng + ',' + wps[0].lat;
    var destination = wps[wps.length - 1].lng + ',' + wps[wps.length - 1].lat;
    var middle = wps.slice(1, -1).map(function(wp) { return wp.lng + ',' + wp.lat; }).join('|');
    var url = ROUTE_WORKER + '/api/route?origin=' + encodeURIComponent(origin) + '&destination=' + encodeURIComponent(destination);
    if (middle) url += '&waypoints=' + encodeURIComponent(middle);

    var resp = await fetch(url);
    var data = await resp.json();

    if (data.path && data.path.length) {
      drawPolyline(data.path);
      // 경로 캐시 저장
      db.collection('drive_courses').doc(course.id).update({
        routePath: data.path,
        distance: data.distance || null,
        duration: data.duration || null
      }).catch(function() {});
      var idx = allCourses.findIndex(function(c) { return c.id === course.id; });
      if (idx !== -1) {
        allCourses[idx].routePath = data.path;
        allCourses[idx].distance = data.distance;
        allCourses[idx].duration = data.duration;
      }
    } else {
      drawStraightLine(wps);
    }
  } catch(e) {
    var wps2 = (course.waypoints || []).filter(function(wp) { return wp.lat && wp.lng; });
    if (wps2.length >= 2) drawStraightLine(wps2);
  }
}

function drawPolyline(path) {
  var latlngs = [];
  for (var i = 0; i + 1 < path.length; i += 2) {
    latlngs.push(new kakao.maps.LatLng(path[i + 1], path[i]));
  }
  var polyline = new kakao.maps.Polyline({
    path: latlngs, strokeWeight: 5, strokeColor: COURSE_COLOR,
    strokeOpacity: 0.85, strokeStyle: 'solid'
  });
  polyline.setMap(kakaoMap);
  polylines.push(polyline);
}

function drawStraightLine(waypoints) {
  var latlngs = waypoints.map(function(wp) { return new kakao.maps.LatLng(wp.lat, wp.lng); });
  var polyline = new kakao.maps.Polyline({
    path: latlngs, strokeWeight: 3, strokeColor: COURSE_COLOR,
    strokeOpacity: 0.6, strokeStyle: 'shortdash'
  });
  polyline.setMap(kakaoMap);
  polylines.push(polyline);
}

// ===== 리스트 렌더링 =====
function renderList(spots, courses) {
  var el = document.getElementById('spotList');
  var html = '';
  courses.forEach(function(c) { html += renderCourseCard(c); });
  spots.forEach(function(s) { html += renderSpotCard(s); });
  el.innerHTML = html || '<div class="empty">등록된 장소가 없습니다<br><span style="font-size:.78rem">로그인 후 첫 번째 스팟을 추가해보세요!</span></div>';
}

function renderSpotCard(spot) {
  var color = CATEGORY_COLOR[spot.category] || '#888';
  var emoji = CATEGORY_EMOJI[spot.category] || '📍';
  var photo = spot.photo || '';
  return '<div class="spot-card" id="card-spot-' + spot.id + '" onclick="selectSpot(\'' + spot.id + '\')">'
    + (photo
      ? '<img class="spot-card-img" src="' + escapeHtml(photo) + '" alt="" onerror="this.className=\'spot-card-img no-photo\';this.outerHTML=\'<div class=&quot;spot-card-img no-photo&quot;>' + emoji + '</div>\'">'
      : '<div class="spot-card-img no-photo">' + emoji + '</div>')
    + '<div class="spot-card-info">'
    + '<div class="spot-card-name">' + escapeHtml(spot.name) + '</div>'
    + '<div class="spot-card-meta"><span style="color:' + color + '">' + emoji + ' ' + escapeHtml(spot.category) + '</span>'
    + (spot.address ? ' · ' + escapeHtml(spot.address) : '') + '</div>'
    + (spot.memo ? '<div class="spot-card-memo">' + escapeHtml(spot.memo) + '</div>' : '')
    + '</div>'
    + (isAdmin ? '<button class="spot-edit-btn" onclick="event.stopPropagation();openEditSpotModal(\'' + spot.id + '\')">✎</button>' : '')
    + (isAdmin ? '<button class="spot-del-btn" onclick="event.stopPropagation();deleteSpot(\'' + spot.id + '\')">✕</button>' : '')
    + '</div>';
}

function renderCourseCard(course) {
  var wpCount = (course.waypoints || []).length;
  var photo = course.photo || '';
  return '<div class="spot-card" id="card-course-' + course.id + '" onclick="selectCourse(\'' + course.id + '\')">'
    + (photo
      ? '<img class="spot-card-img" src="' + escapeHtml(photo) + '" alt="" onerror="this.className=\'spot-card-img no-photo\';this.outerHTML=\'<div class=&quot;spot-card-img no-photo&quot;>🛣️</div>\'">'
      : '<div class="spot-card-img no-photo">🛣️</div>')
    + '<div class="spot-card-info">'
    + '<div class="spot-card-name">' + escapeHtml(course.name) + '</div>'
    + '<div class="spot-card-meta"><span style="color:' + COURSE_COLOR + '">🛣️ 드라이브 코스</span>'
    + ' · ' + wpCount + '개 경유지'
    + (course.distance ? ' · ' + course.distance + 'km' : '')
    + (course.duration ? ' · 약 ' + course.duration + '분' : '') + '</div>'
    + (course.description ? '<div class="spot-card-memo">' + escapeHtml(course.description) + '</div>' : '')
    + '</div>'
    + (isAdmin || (currentUser && currentUser.uid === course.addedBy) ? '<button class="spot-edit-btn" onclick="event.stopPropagation();openEditCourseModal(\'' + course.id + '\')">✎</button>' : '')
    + (isAdmin ? '<button class="spot-del-btn" onclick="event.stopPropagation();deleteCourse(\'' + course.id + '\')">✕</button>' : '')
    + '</div>';
}

// ===== 선택 =====
function selectSpot(id) {
  var spot = allSpots.find(function(s) { return s.id === id; });
  if (!spot || !spot.lat) return;
  kakaoMap.setCenter(new kakao.maps.LatLng(spot.lat, spot.lng));
  kakaoMap.setLevel(4);
  document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.spot-card').forEach(function(c) { c.classList.remove('active'); });
  var card = document.getElementById('card-spot-' + id);
  if (card) { card.classList.add('active'); }
  openSpotDetail(spot);
}

function selectCourse(id) {
  var course = allCourses.find(function(c) { return c.id === id; });
  if (!course || !course.waypoints) return;
  var validWps = course.waypoints.filter(function(wp) { return wp.lat && wp.lng; });
  if (validWps.length) {
    var bounds = new kakao.maps.LatLngBounds();
    validWps.forEach(function(wp) { bounds.extend(new kakao.maps.LatLng(wp.lat, wp.lng)); });
    kakaoMap.setBounds(bounds, 80);
  }
  document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.spot-card').forEach(function(c) { c.classList.remove('active'); });
  var card = document.getElementById('card-course-' + id);
  if (card) { card.classList.add('active'); }
  openCourseDetail(course);
}

// ===== 상세 모달 =====
function openSpotDetail(spot) {
  var color = CATEGORY_COLOR[spot.category] || '#888';
  var emoji = CATEGORY_EMOJI[spot.category] || '📍';
  document.getElementById('detailTitle').textContent = spot.name;
  var html = '';
  if (spot.photo) html += '<img class="detail-photo" src="' + escapeHtml(spot.photo) + '" alt="" onerror="this.style.display=\'none\'">';
  html += '<div class="detail-category" style="background:' + color + '20;color:' + color + '">' + emoji + ' ' + escapeHtml(spot.category) + '</div>';
  html += '<div class="detail-name">' + escapeHtml(spot.name) + '</div>';
  if (spot.address) html += '<div class="detail-address">📍 ' + escapeHtml(spot.address) + '</div>';
  if (spot.memo) html += '<div class="detail-memo">' + escapeHtml(spot.memo) + '</div>';
  if (spot.lat && spot.lng) {
    html += '<div class="open-map-btns">'
      + '<a href="https://map.kakao.com/link/to/' + encodeURIComponent(spot.name) + ',' + spot.lat + ',' + spot.lng + '" target="_blank">카카오맵</a>'
      + '<a href="https://map.naver.com/v5/search/' + encodeURIComponent(spot.name) + '?c=' + spot.lng + ',' + spot.lat + ',15,0,0,0,dh" target="_blank">네이버맵</a>'
      + '</div>';
  }
  document.getElementById('detailBody').innerHTML = html;
  document.getElementById('detailModal').style.display = 'flex';
}

function openCourseDetail(course) {
  document.getElementById('detailTitle').textContent = course.name;
  var html = '';
  if (course.photo) html += '<img class="detail-photo" src="' + escapeHtml(course.photo) + '" alt="" onerror="this.style.display=\'none\'">';
  html += '<div class="detail-category" style="background:#7c6fff20;color:#7c6fff">🛣️ 드라이브 코스</div>';
  html += '<div class="detail-name">' + escapeHtml(course.name) + '</div>';
  if (course.distance || course.duration) {
    html += '<div class="route-info">';
    if (course.distance) html += '<div class="route-info-item"><span class="route-info-label">총 거리</span><span class="route-info-value">' + course.distance + 'km</span></div>';
    if (course.duration) html += '<div class="route-info-item"><span class="route-info-label">예상 시간</span><span class="route-info-value">' + course.duration + '분</span></div>';
    html += '</div>';
  }
  if (course.description) html += '<div class="detail-memo">' + escapeHtml(course.description) + '</div>';
  if (course.waypoints && course.waypoints.length) {
    html += '<div style="font-size:.8rem;font-weight:700;color:var(--text2);margin-bottom:8px">경유지</div>';
    html += '<div class="detail-waypoints">';
    course.waypoints.forEach(function(wp, i) {
      html += '<div class="detail-wp-item">'
        + '<div class="detail-wp-num">' + (i + 1) + '</div>'
        + '<div><div class="detail-wp-name">' + escapeHtml(wp.name) + '</div>'
        + (wp.address ? '<div class="detail-wp-sub">📍 ' + escapeHtml(wp.address) + '</div>' : '')
        + (wp.memo ? '<div class="detail-wp-sub">' + escapeHtml(wp.memo) + '</div>' : '')
        + '</div></div>';
    });
    html += '</div>';
  }
  document.getElementById('detailBody').innerHTML = html;
  document.getElementById('detailModal').style.display = 'flex';
}

// ===== 장소 추가/수정 =====
function openAddSpotModal() {
  if (!currentUser || currentUser.isAnonymous) { alert('로그인이 필요합니다.'); return; }
  _editingSpotId = null;
  ['spotName', 'spotAddress', 'spotMemo', 'spotSearchInput'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('spotCategory').value = '맛집';
  document.getElementById('spotLat').value = '';
  document.getElementById('spotLng').value = '';
  document.getElementById('spotSearchResults').style.display = 'none';
  document.getElementById('spotSaveMsg').style.display = 'none';
  document.querySelector('#addSpotModal .modal-title').textContent = '📍 장소 추가';
  document.getElementById('spotSaveBtn').textContent = '저장';
  _spotSearchResults = [];
  document.getElementById('addSpotModal').style.display = 'flex';
}

function openEditSpotModal(id) {
  var spot = allSpots.find(function(s) { return s.id === id; });
  if (!spot) return;
  _editingSpotId = id;
  document.getElementById('spotCategory').value = spot.category || '맛집';
  document.getElementById('spotName').value = spot.name || '';
  document.getElementById('spotAddress').value = spot.address || '';
  document.getElementById('spotLat').value = spot.lat || '';
  document.getElementById('spotLng').value = spot.lng || '';
  document.getElementById('spotMemo').value = spot.memo || '';
  document.getElementById('spotSearchInput').value = '';
  document.getElementById('spotSearchResults').style.display = 'none';
  document.getElementById('spotSaveMsg').style.display = 'none';
  document.querySelector('#addSpotModal .modal-title').textContent = '📍 장소 수정';
  document.getElementById('spotSaveBtn').textContent = '수정';
  _spotSearchResults = [];
  closeModal('detailModal');
  document.getElementById('addSpotModal').style.display = 'flex';
}

function searchSpotPlace() {
  var query = document.getElementById('spotSearchInput').value.trim();
  if (!query) return;
  var ps = new kakao.maps.services.Places();
  ps.keywordSearch(query, function(data, status) {
    var el = document.getElementById('spotSearchResults');
    if (status !== kakao.maps.services.Status.OK || !data.length) {
      el.innerHTML = '<div class="search-result-item" style="color:var(--text3)">검색 결과가 없습니다</div>';
      el.style.display = '';
      return;
    }
    _spotSearchResults = data.slice(0, 6);
    var html = '';
    _spotSearchResults.forEach(function(place, i) {
      html += '<div class="search-result-item" onclick="selectSpotPlace(' + i + ')">'
        + '<div>' + escapeHtml(place.place_name) + '</div>'
        + '<div class="search-result-addr">' + escapeHtml(place.address_name) + '</div>'
        + '</div>';
    });
    el.innerHTML = html;
    el.style.display = '';
  });
}

function selectSpotPlace(idx) {
  var place = _spotSearchResults[idx];
  if (!place) return;
  document.getElementById('spotName').value = place.place_name;
  document.getElementById('spotAddress').value = place.address_name;
  document.getElementById('spotLat').value = place.y;
  document.getElementById('spotLng').value = place.x;
  document.getElementById('spotSearchResults').style.display = 'none';
  kakaoMap.panTo(new kakao.maps.LatLng(parseFloat(place.y), parseFloat(place.x)));
  kakaoMap.setLevel(4);
}

async function saveSpot() {
  var name = document.getElementById('spotName').value.trim();
  var category = document.getElementById('spotCategory').value;
  var address = document.getElementById('spotAddress').value.trim();
  var lat = parseFloat(document.getElementById('spotLat').value);
  var lng = parseFloat(document.getElementById('spotLng').value);
  var memo = document.getElementById('spotMemo').value.trim();
  var msg = document.getElementById('spotSaveMsg');
  var btn = document.getElementById('spotSaveBtn');

  if (!name) { msg.textContent = '장소명을 입력하세요.'; msg.style.display = ''; return; }
  if (!lat || !lng) { msg.textContent = '장소를 검색해서 선택해주세요.'; msg.style.display = ''; return; }

  btn.disabled = true; btn.textContent = _editingSpotId ? '수정 중...' : '저장 중...';
  try {
    if (_editingSpotId) {
      await db.collection('spots').doc(_editingSpotId).update({
        name: name, category: category, address: address,
        lat: lat, lng: lng, memo: memo,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await db.collection('spots').add({
        name: name, category: category, address: address,
        lat: lat, lng: lng, memo: memo,
        addedBy: currentUser.uid,
        addedByName: currentUser.displayName || (currentUser.email || '').split('@')[0] || '익명',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    _editingSpotId = null;
    closeModal('addSpotModal');
    await loadData();
  } catch(e) {
    msg.textContent = '저장 실패: ' + e.message;
    msg.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = _editingSpotId ? '수정' : '저장';
  }
}

// ===== 코스 추가/수정 =====
function openAddCourseModal() {
  if (!currentUser || currentUser.isAnonymous) { alert('로그인이 필요합니다.'); return; }
  _editingCourseId = null;
  document.getElementById('courseName').value = '';
  document.getElementById('courseDesc').value = '';
  document.getElementById('courseSaveMsg').style.display = 'none';
  document.querySelector('#addCourseModal .modal-title').textContent = '🛣️ 드라이브 코스 추가';
  document.getElementById('courseSaveBtn').textContent = '저장';
  _waypoints = [];
  _waypointSearchResults = {};
  addWaypointField();
  addWaypointField();
  document.getElementById('addCourseModal').style.display = 'flex';
}

function openEditCourseModal(id) {
  var course = allCourses.find(function(c) { return c.id === id; });
  if (!course) return;
  _editingCourseId = id;
  document.getElementById('courseName').value = course.name || '';
  document.getElementById('courseDesc').value = course.description || '';
  document.getElementById('courseSaveMsg').style.display = 'none';
  document.querySelector('#addCourseModal .modal-title').textContent = '🛣️ 드라이브 코스 수정';
  document.getElementById('courseSaveBtn').textContent = '수정';
  _waypoints = (course.waypoints || []).map(function(wp) {
    return { name: wp.name || '', address: wp.address || '', lat: wp.lat || null, lng: wp.lng || null, memo: wp.memo || '' };
  });
  if (_waypoints.length < 2) {
    while (_waypoints.length < 2) _waypoints.push({ name: '', address: '', lat: null, lng: null, memo: '' });
  }
  _waypointSearchResults = {};
  renderWaypointFields();
  closeModal('detailModal');
  document.getElementById('addCourseModal').style.display = 'flex';
}

function renderWaypointFields() {
  var el = document.getElementById('waypointList');
  var html = '';
  _waypoints.forEach(function(wp, i) {
    var confirmed = wp.lat && wp.lng;
    html += '<div class="waypoint-item">'
      + '<div class="waypoint-num">' + (i + 1) + '</div>'
      + '<div class="waypoint-inputs">'
      + '<input type="text" class="form-input" id="wp-name-' + i + '" placeholder="장소명" value="' + escapeHtml(wp.name || '') + '" style="font-size:.84rem">'
      + '<div class="form-row">'
      + '<input type="text" class="form-input" id="wp-search-' + i + '" placeholder="장소 검색" style="font-size:.82rem" onkeydown="if(event.key===\'Enter\')searchWaypoint(' + i + ')">'
      + '<button class="map-btn" onclick="searchWaypoint(' + i + ')" style="white-space:nowrap;font-size:.75rem;padding:8px 10px">검색</button>'
      + '</div>'
      + '<div id="wp-results-' + i + '" class="search-results" style="display:none"></div>'
      + (confirmed ? '<div style="font-size:.72rem;color:var(--primary);margin-top:2px">✓ ' + escapeHtml(wp.address || wp.name) + '</div>' : '')
      + '<input type="text" class="form-input" id="wp-memo-' + i + '" placeholder="메모 (선택)" value="' + escapeHtml(wp.memo || '') + '" style="font-size:.78rem">'
      + '</div>'
      + (_waypoints.length > 2 ? '<button class="waypoint-del" onclick="removeWaypoint(' + i + ')">✕</button>' : '')
      + '</div>';
  });
  el.innerHTML = html;
}

function addWaypointField() {
  _waypoints.push({ name: '', address: '', lat: null, lng: null, memo: '' });
  renderWaypointFields();
}

function removeWaypoint(idx) {
  if (_waypoints.length <= 2) return;
  _waypoints.splice(idx, 1);
  renderWaypointFields();
}

function searchWaypoint(idx) {
  var query = document.getElementById('wp-search-' + idx).value.trim();
  if (!query) return;
  var ps = new kakao.maps.services.Places();
  ps.keywordSearch(query, function(data, status) {
    var el = document.getElementById('wp-results-' + idx);
    if (status !== kakao.maps.services.Status.OK || !data.length) {
      el.innerHTML = '<div class="search-result-item" style="color:var(--text3)">검색 결과 없음</div>';
      el.style.display = '';
      return;
    }
    _waypointSearchResults[idx] = data.slice(0, 5);
    var html = '';
    _waypointSearchResults[idx].forEach(function(place, ri) {
      html += '<div class="search-result-item" onclick="selectWaypoint(' + idx + ',' + ri + ')">'
        + '<div>' + escapeHtml(place.place_name) + '</div>'
        + '<div class="search-result-addr">' + escapeHtml(place.address_name) + '</div>'
        + '</div>';
    });
    el.innerHTML = html;
    el.style.display = '';
  });
}

function selectWaypoint(idx, resultIdx) {
  var place = (_waypointSearchResults[idx] || [])[resultIdx];
  if (!place) return;
  _waypoints[idx] = {
    name: place.place_name,
    address: place.address_name,
    lat: parseFloat(place.y),
    lng: parseFloat(place.x),
    memo: ''
  };
  renderWaypointFields();
}

async function saveCourse() {
  // 현재 입력값 반영
  _waypoints.forEach(function(wp, i) {
    var nameEl = document.getElementById('wp-name-' + i);
    var memoEl = document.getElementById('wp-memo-' + i);
    if (nameEl && nameEl.value.trim()) wp.name = nameEl.value.trim();
    if (memoEl) wp.memo = memoEl.value.trim();
  });

  var name = document.getElementById('courseName').value.trim();
  var desc = document.getElementById('courseDesc').value.trim();
  var msg = document.getElementById('courseSaveMsg');
  var btn = document.getElementById('courseSaveBtn');
  var validWps = _waypoints.filter(function(wp) { return wp.lat && wp.lng; });

  if (!name) { msg.textContent = '코스명을 입력하세요.'; msg.style.display = ''; return; }
  if (validWps.length < 2) { msg.textContent = '경유지를 검색해서 최소 2개 이상 선택해주세요.'; msg.style.display = ''; return; }

  btn.disabled = true; btn.textContent = _editingCourseId ? '수정 중...' : '저장 중...';
  try {
    var firstWp = validWps[0];
    if (_editingCourseId) {
      await db.collection('drive_courses').doc(_editingCourseId).update({
        name: name, description: desc,
        waypoints: _waypoints,
        routePath: firebase.firestore.FieldValue.delete(),
        distance: firebase.firestore.FieldValue.delete(),
        duration: firebase.firestore.FieldValue.delete(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await db.collection('drive_courses').add({
        name: name, description: desc,
        waypoints: _waypoints,
        addedBy: currentUser.uid,
        addedByName: currentUser.displayName || (currentUser.email || '').split('@')[0] || '익명',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    _editingCourseId = null;
    closeModal('addCourseModal');
    await loadData();
  } catch(e) {
    msg.textContent = '저장 실패: ' + e.message;
    msg.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = _editingCourseId ? '수정' : '저장';
  }
}

// ===== 삭제 =====
async function deleteSpot(id) {
  if (!isAdmin || !confirm('이 장소를 삭제하시겠습니까?')) return;
  await db.collection('spots').doc(id).delete();
  allSpots = allSpots.filter(function(s) { return s.id !== id; });
  renderAll();
}

async function deleteCourse(id) {
  if (!isAdmin || !confirm('이 코스를 삭제하시겠습니까?')) return;
  await db.collection('drive_courses').doc(id).delete();
  allCourses = allCourses.filter(function(c) { return c.id !== id; });
  renderAll();
}

// ===== 내 위치 =====
function goToMyLocation() {
  if (!navigator.geolocation) { alert('위치 정보를 사용할 수 없습니다.'); return; }
  navigator.geolocation.getCurrentPosition(function(pos) {
    kakaoMap.panTo(new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude));
    kakaoMap.setLevel(5);
  }, function() { alert('위치 정보를 가져올 수 없습니다.'); });
}

// ===== 유틸 =====
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== 시작 =====
document.addEventListener('DOMContentLoaded', function() {
  if (typeof kakao !== 'undefined') {
    initMap();
  } else {
    document.getElementById('spotList').innerHTML = '<div class="empty">카카오맵을 불러올 수 없습니다</div>';
  }
});
