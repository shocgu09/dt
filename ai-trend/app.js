/* ===== AI 트렌드 - DT Club ===== */

var db = null;
var currentUser = null;
var isAdmin = false;
var allLinks = [];
var currentCategory = 'all';
var currentTab = 'feed';

var CATEGORY_ICONS = { 'X': '𝕏', '뉴스레터': '📰', '유튜브': '▶️' };
var CATEGORY_ORDER = ['X', '뉴스레터', '유튜브'];
var THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

var INITIAL_DATA = [
  { category: 'X', name: '루카스', url: 'https://x.com/lucas_flatwhite', description: 'AI 트렌드 큐레이터', icon: '☕', order: 1 },
  { category: 'X', name: 'Geek News', url: 'https://x.com/GeekNewsHada', description: '기술 뉴스 큐레이션', icon: '🔍', order: 2 },
  { category: 'X', name: 'Claude', url: 'https://x.com/claudeai', description: 'Anthropic Claude 공식', icon: '🤖', order: 3 },
  { category: 'X', name: 'Claude Code Community', url: 'https://x.com/claude_code', description: 'Claude Code 커뮤니티', icon: '💻', order: 4 },
  { category: 'X', name: 'Google AI', url: 'https://x.com/GoogleAI', description: 'Google AI 공식', icon: '🔵', order: 5 },
  { category: 'X', name: 'OpenAI', url: 'https://x.com/OpenAI', description: 'OpenAI 공식', icon: '🟢', order: 6 },
  { category: 'X', name: 'OpenAI Developers', url: 'https://x.com/OpenAIDevs', description: 'OpenAI 개발자 채널', icon: '⚙️', order: 7 },
  { category: 'X', name: 'Journey', url: 'https://x.com/atmostbeautiful', description: 'AI 인사이트', icon: '🌟', order: 8 },
  { category: '뉴스레터', name: "Lenny's Newsletter", url: 'https://www.lennysnewsletter.com/', description: '프로덕트 & 성장 뉴스레터', icon: '📝', order: 1, rss: 'https://www.lennysnewsletter.com/feed' },
  { category: '뉴스레터', name: 'Ali Afridi (Sandhill)', url: 'https://www.sandhill.io/', description: 'AI 스타트업 인사이트', icon: '🏔️', order: 2 },
  { category: '뉴스레터', name: 'Chamath', url: 'https://chamath.substack.com/', description: '테크 & 투자 뉴스레터', icon: '💰', order: 3, rss: 'https://chamath.substack.com/feed' },
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
        if (isAdmin) document.getElementById('tabAdmin').style.display = '';
      }).catch(function() {});
    }
    loadAllData();
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

// 탭 전환
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === tab); });
  document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.toggle('active', c.id === 'tab-' + tab); });
  if (tab === 'feed') loadFeed();
  if (tab === 'admin') renderAdminLinks();
}

// 데이터 로드
async function loadAllData() {
  if (!db) return;
  try {
    var snap = await db.collection('ai_trend_links').orderBy('order', 'asc').get();
    if (snap.empty) {
      await seedInitialData();
      snap = await db.collection('ai_trend_links').orderBy('order', 'asc').get();
    }
    allLinks = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
    renderLinks();
    loadFeed();
  } catch(e) {
    document.getElementById('feedContent').innerHTML = '<div class="loading">데이터를 불러올 수 없습니다</div>';
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

// ===== 피드 탭 =====
async function loadFeed() {
  var el = document.getElementById('feedContent');
  el.innerHTML = '<div class="loading">피드 로딩 중...</div>';

  var html = '';
  var now = Date.now();

  // 1. 유튜브 최근 영상
  var ytLinks = allLinks.filter(function(l) { return l.category === '유튜브'; });
  if (ytLinks.length) {
    html += '<div class="feed-section"><div class="feed-section-title">▶️ 최근 유튜브 영상</div>';
    try {
      var handles = ytLinks.map(function(l) {
        var match = l.url.match(/@([^\/\?]+)/);
        return match ? match[1] : null;
      }).filter(Boolean);

      // 핸들 → 채널 ID 조회
      var channelIds = [];
      for (var i = 0; i < handles.length; i++) {
        try {
          var resp = await fetch('https://dt-youtube.shocguna.workers.dev/api/channel?handle=' + handles[i]);
          var data = await resp.json();
          if (data.channelId) channelIds.push(data.channelId);
        } catch(e) {}
      }

      if (channelIds.length) {
        var vResp = await fetch('https://dt-youtube.shocguna.workers.dev/api/videos?max=3&channels=' + channelIds.join(','));
        var vData = await vResp.json();
        var recentVideos = vData.videos || [];

        if (recentVideos.length) {
          html += '<div class="feed-scroll">';
          recentVideos.forEach(function(v) {
            html += '<a href="https://www.youtube.com/watch?v=' + v.id + '" target="_blank" class="feed-video-card">'
              + '<img class="feed-video-thumb" src="' + v.thumbnail + '" alt="" loading="lazy">'
              + '<div class="feed-video-title">' + escapeHtml(v.title) + '</div>'
              + '<div class="feed-video-channel">' + escapeHtml(v.channelTitle || '') + ' · ' + timeAgo(v.publishedAt) + '</div>'
              + '</a>';
          });
          html += '</div>';
        } else {
          html += '<div class="feed-empty">영상이 없습니다</div>';
        }
      }
    } catch(e) {
      html += '<div class="feed-empty">영상을 불러올 수 없습니다</div>';
    }
    html += '</div>';
  }

  // 2. 뉴스레터 최근 글
  var nlLinks = allLinks.filter(function(l) { return l.category === '뉴스레터' && l.rss; });
  if (nlLinks.length) {
    html += '<div class="feed-section"><div class="feed-section-title">📰 최근 뉴스레터</div>';
    var articles = [];
    for (var i = 0; i < nlLinks.length; i++) {
      try {
        var resp = await fetch('https://dt-rss.shocguna.workers.dev/api/rss?url=' + encodeURIComponent(nlLinks[i].rss));
        var data = await resp.json();
        (data.items || []).forEach(function(item) {
          articles.push({ ...item, source: nlLinks[i].name, icon: nlLinks[i].icon || '📰' });
        });
      } catch(e) {}
    }
    articles.sort(function(a, b) { return new Date(b.pubDate) - new Date(a.pubDate); });

    if (articles.length) {
      articles.forEach(function(a) {
        html += '<a href="' + escapeHtml(a.link) + '" target="_blank" class="feed-article">'
          + '<span class="feed-article-icon">' + a.icon + '</span>'
          + '<div class="feed-article-info">'
          + '<div class="feed-article-title">' + escapeHtml(a.title) + '</div>';
        if (a.description) html += '<div class="feed-article-desc">' + escapeHtml(a.description) + '</div>';
        html += '<div class="feed-article-meta">' + escapeHtml(a.source) + ' · ' + timeAgo(a.pubDate) + '</div>'
          + '</div></a>';
      });
    } else {
      html += '<div class="feed-empty">뉴스레터가 없습니다</div>';
    }
    html += '</div>';
  }

  // 3. X 바로가기
  var xLinks = allLinks.filter(function(l) { return l.category === 'X'; });
  if (xLinks.length) {
    html += '<div class="feed-section"><div class="feed-section-title">𝕏 X 바로가기</div>';
    html += '<div class="feed-x-links">';
    xLinks.forEach(function(l) {
      html += '<a href="' + escapeHtml(l.url) + '" target="_blank" class="feed-x-link">'
        + (l.icon || '🔗') + ' ' + escapeHtml(l.name) + '</a>';
    });
    html += '</div></div>';
  }

  if (!html) html = '<div class="loading">등록된 링크가 없습니다</div>';
  el.innerHTML = html;
}

// ===== 링크 탭 =====
function renderLinks() {
  var query = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  var filtered = allLinks;
  if (currentCategory !== 'all') filtered = filtered.filter(function(l) { return l.category === currentCategory; });
  if (query) filtered = filtered.filter(function(l) {
    return (l.name || '').toLowerCase().indexOf(query) !== -1 || (l.description || '').toLowerCase().indexOf(query) !== -1;
  });

  if (!filtered.length) {
    document.getElementById('linkList').innerHTML = '<div class="loading">검색 결과가 없습니다</div>';
    return;
  }

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
    html += '<div class="category-section"><h2>' + (CATEGORY_ICONS[cat] || '') + ' ' + escapeHtml(cat) + '</h2><div class="category-cards">';
    items.forEach(function(l) {
      html += '<a href="' + escapeHtml(l.url) + '" target="_blank" class="link-card">'
        + '<span class="link-icon">' + (l.icon || '🔗') + '</span>'
        + '<div class="link-info"><div class="link-name">' + escapeHtml(l.name) + '</div>';
      if (l.description) html += '<div class="link-desc">' + escapeHtml(l.description) + '</div>';
      html += '</div><span class="link-arrow">→</span></a>';
    });
    html += '</div></div>';
  });
  document.getElementById('linkList').innerHTML = html;
}

function filterCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('[data-cat]').forEach(function(b) { b.classList.toggle('active', b.dataset.cat === cat); });
  renderLinks();
}

// ===== 관리 탭 =====
function renderAdminLinks() {
  var html = '';
  CATEGORY_ORDER.forEach(function(cat) {
    var items = allLinks.filter(function(l) { return l.category === cat; });
    if (!items.length) return;
    html += '<div style="margin-bottom:12px"><div style="font-size:.78rem;color:var(--text3);margin-bottom:6px;font-weight:600">' + (CATEGORY_ICONS[cat] || '') + ' ' + cat + '</div>';
    items.forEach(function(l) {
      html += '<div class="admin-link-item">'
        + '<span>' + (l.icon || '🔗') + '</span>'
        + '<div class="admin-link-info"><div class="admin-link-name">' + escapeHtml(l.name) + '</div>'
        + '<div class="admin-link-cat">' + escapeHtml(l.url) + '</div></div>'
        + '<button class="link-del" onclick="removeTrendLink(\'' + l.id + '\')">삭제</button>'
        + '</div>';
    });
    html += '</div>';
  });
  if (!html) html = '<div class="loading">등록된 링크가 없습니다</div>';
  document.getElementById('adminLinkList').innerHTML = html;
}

// 카테고리 변경 시 RSS 힌트 표시
document.getElementById('addCategory')?.addEventListener('change', function() {
  var hint = document.getElementById('rssHint');
  var rssInput = document.getElementById('addRss');
  if (this.value === '뉴스레터') {
    hint.style.display = '';
    rssInput.style.display = '';
  } else {
    hint.style.display = 'none';
    rssInput.style.display = 'none';
  }
});

async function addTrendLink() {
  var category = document.getElementById('addCategory').value;
  var name = document.getElementById('addName').value.trim();
  var url = document.getElementById('addUrl').value.trim();
  var desc = document.getElementById('addDesc').value.trim();
  var icon = document.getElementById('addIcon').value.trim();
  var rss = document.getElementById('addRss').value.trim();
  if (!name || !url) { alert('이름과 URL을 입력하세요.'); return; }

  // 뉴스레터: Substack이면 자동 RSS 생성
  if (category === '뉴스레터' && !rss) {
    if (url.indexOf('substack.com') !== -1) {
      rss = url.replace(/\/$/, '') + '/feed';
    }
  }

  try {
    var maxOrder = 0;
    allLinks.filter(function(l) { return l.category === category; }).forEach(function(l) { if (l.order > maxOrder) maxOrder = l.order; });
    var data = { category: category, name: name, url: url, description: desc || '', icon: icon || '🔗', order: maxOrder + 1, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (rss) data.rss = rss;
    await db.collection('ai_trend_links').add(data);
    ['addName','addUrl','addDesc','addIcon','addRss'].forEach(function(id) { document.getElementById(id).value = ''; });
    await loadAllData();
    renderAdminLinks();
  } catch(e) { alert('추가 실패: ' + e.message); }
}

async function removeTrendLink(id) {
  if (!confirm('이 링크를 삭제하시겠습니까?')) return;
  try {
    await db.collection('ai_trend_links').doc(id).delete();
    await loadAllData();
    renderAdminLinks();
  } catch(e) { alert('삭제 실패: ' + e.message); }
}

// 유틸
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function timeAgo(dateStr) {
  var diff = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + '분 전';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + '시간 전';
  var days = Math.floor(hours / 24);
  return days + '일 전';
}
