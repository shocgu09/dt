/* ===== AI 트렌드 - DT Club ===== */

var db = null;
var currentUser = null;
var isAdmin = false;
var allLinks = [];
var currentCategory = 'all';

var CATEGORY_ICONS = { 'X': '𝕏', '뉴스레터': '📰', '유튜브': '▶️' };
var CATEGORY_ORDER = ['X', '뉴스레터', '유튜브'];

// 초기 데이터 (Firestore에 데이터 없을 때 최초 1회 저장)
var INITIAL_DATA = [
  { category: 'X', name: '루카스', url: 'https://x.com/lucas_flatwhite', description: 'AI 트렌드 큐레이터', icon: '☕', order: 1 },
  { category: 'X', name: 'Geek News', url: 'https://x.com/GeekNewsHada', description: '기술 뉴스 큐레이션', icon: '🔍', order: 2 },
  { category: 'X', name: 'Claude', url: 'https://x.com/claudeai', description: 'Anthropic Claude 공식', icon: '🤖', order: 3 },
  { category: 'X', name: 'Claude Code Community', url: 'https://x.com/claude_code', description: 'Claude Code 커뮤니티', icon: '💻', order: 4 },
  { category: 'X', name: 'Google AI', url: 'https://x.com/GoogleAI', description: 'Google AI 공식', icon: '🔵', order: 5 },
  { category: 'X', name: 'OpenAI', url: 'https://x.com/OpenAI', description: 'OpenAI 공식', icon: '🟢', order: 6 },
  { category: 'X', name: 'OpenAI Developers', url: 'https://x.com/OpenAIDevs', description: 'OpenAI 개발자 채널', icon: '⚙️', order: 7 },
  { category: 'X', name: 'Journey', url: 'https://x.com/atmostbeautiful', description: 'AI 인사이트', icon: '🌟', order: 8 },
  { category: '뉴스레터', name: "Lenny's Newsletter", url: 'https://www.lennysnewsletter.com/', description: '프로덕트 & 성장 뉴스레터', icon: '📝', order: 1 },
  { category: '뉴스레터', name: 'Ali Afridi (Sandhill)', url: 'https://www.sandhill.io/', description: 'AI 스타트업 인사이트', icon: '🏔️', order: 2 },
  { category: '뉴스레터', name: 'Chamath', url: 'https://chamath.substack.com/', description: '테크 & 투자 뉴스레터', icon: '💰', order: 3 },
  { category: '유튜브', name: '빌더조쉬', url: 'https://www.youtube.com/@builderjoshkim', description: 'AI 빌더 콘텐츠', icon: '🔨', order: 1 },
  { category: '유튜브', name: 'OpenAI', url: 'https://www.youtube.com/@OpenAI', description: 'OpenAI 공식 채널', icon: '🟢', order: 2 },
  { category: '유튜브', name: 'Anthropic', url: 'https://www.youtube.com/@anthropic-ai', description: 'Anthropic 공식 채널', icon: '🤖', order: 3 },
  { category: '유튜브', name: 'Species', url: 'https://www.youtube.com/@AISpecies', description: 'AI 리뷰 & 튜토리얼', icon: '🧬', order: 4 },
  { category: '유튜브', name: 'Mo Bitar', url: 'https://www.youtube.com/@atmoio', description: 'AI 개발 & 인사이트', icon: '🎯', order: 5 },
];

// Firebase 초기화
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  firebase.auth().onAuthStateChanged(function(user) {
    currentUser = user;
    if (user && !user.isAnonymous) {
      db.collection('users').doc(user.uid).get().then(function(doc) {
        var role = doc.data()?.role;
        isAdmin = (role === 'admin' || role === 'superadmin');
        if (isAdmin) document.getElementById('adminPanel').style.display = '';
      }).catch(function() {});
    }
    loadTrendLinks();
  });
} catch(e) { console.log('Firebase 미연결'); }

// 테마
function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme');
  var next = current === 'light' ? 'dark' : 'light';
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

// 링크 로드
async function loadTrendLinks() {
  if (!db) return;
  try {
    var snap = await db.collection('ai_trend_links').orderBy('order', 'asc').get();
    if (snap.empty) {
      // 초기 데이터 저장
      await seedInitialData();
      snap = await db.collection('ai_trend_links').orderBy('order', 'asc').get();
    }
    allLinks = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
    renderLinks();
  } catch(e) {
    document.getElementById('linkList').innerHTML = '<div class="loading">데이터를 불러올 수 없습니다</div>';
  }
}

async function seedInitialData() {
  var batch = db.batch();
  INITIAL_DATA.forEach(function(item) {
    var ref = db.collection('ai_trend_links').doc();
    batch.set(ref, { ...item, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  });
  await batch.commit();
}

// 렌더링
function renderLinks() {
  var query = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  var filtered = allLinks;

  if (currentCategory !== 'all') {
    filtered = filtered.filter(function(l) { return l.category === currentCategory; });
  }
  if (query) {
    filtered = filtered.filter(function(l) {
      return (l.name || '').toLowerCase().indexOf(query) !== -1
        || (l.description || '').toLowerCase().indexOf(query) !== -1;
    });
  }

  if (!filtered.length) {
    document.getElementById('linkList').innerHTML = '<div class="loading">검색 결과가 없습니다</div>';
    return;
  }

  // 카테고리별 그룹핑
  var grouped = {};
  CATEGORY_ORDER.forEach(function(cat) { grouped[cat] = []; });
  filtered.forEach(function(l) {
    if (!grouped[l.category]) grouped[l.category] = [];
    grouped[l.category].push(l);
  });

  var html = '';
  CATEGORY_ORDER.forEach(function(cat) {
    var items = grouped[cat];
    if (!items || !items.length) return;
    html += '<div class="category-section">';
    html += '<h2>' + (CATEGORY_ICONS[cat] || '') + ' ' + escapeHtml(cat) + '</h2>';
    html += '<div class="category-cards">';
    items.forEach(function(l) {
      html += '<a href="' + escapeHtml(l.url) + '" target="_blank" class="link-card">';
      html += '<span class="link-icon">' + (l.icon || '🔗') + '</span>';
      html += '<div class="link-info">';
      html += '<div class="link-name">' + escapeHtml(l.name) + '</div>';
      if (l.description) html += '<div class="link-desc">' + escapeHtml(l.description) + '</div>';
      html += '</div>';
      html += '<span class="link-arrow">→</span>';
      if (isAdmin) {
        html += '</a><button class="link-del" onclick="event.preventDefault();event.stopPropagation();removeTrendLink(\'' + l.id + '\')" style="margin-left:-40px;position:relative;z-index:2">삭제</button>';
      } else {
        html += '</a>';
      }
    });
    html += '</div></div>';
  });

  document.getElementById('linkList').innerHTML = html;
}

function filterCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('[data-cat]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.cat === cat);
  });
  renderLinks();
}

// 관리자: 추가
async function addTrendLink() {
  var category = document.getElementById('addCategory').value;
  var name = document.getElementById('addName').value.trim();
  var url = document.getElementById('addUrl').value.trim();
  var desc = document.getElementById('addDesc').value.trim();
  var icon = document.getElementById('addIcon').value.trim();

  if (!name || !url) { alert('이름과 URL을 입력하세요.'); return; }

  try {
    var maxOrder = 0;
    allLinks.filter(function(l) { return l.category === category; }).forEach(function(l) {
      if (l.order > maxOrder) maxOrder = l.order;
    });
    await db.collection('ai_trend_links').add({
      category: category,
      name: name,
      url: url,
      description: desc || '',
      icon: icon || '🔗',
      order: maxOrder + 1,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('addName').value = '';
    document.getElementById('addUrl').value = '';
    document.getElementById('addDesc').value = '';
    document.getElementById('addIcon').value = '';
    loadTrendLinks();
  } catch(e) { alert('추가 실패: ' + e.message); }
}

// 관리자: 삭제
async function removeTrendLink(id) {
  if (!confirm('이 링크를 삭제하시겠습니까?')) return;
  try {
    await db.collection('ai_trend_links').doc(id).delete();
    loadTrendLinks();
  } catch(e) { alert('삭제 실패: ' + e.message); }
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
