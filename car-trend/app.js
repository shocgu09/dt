/* ===== 자동차 트렌드 - DT Club ===== */

// YouTube 인페이지 모달 플레이어
function openYtModal(id, isShort) {
  var existing = document.getElementById('ytModal');
  if (existing) existing.remove();
  var embedUrl = 'https://www.youtube.com/embed/' + id + '?autoplay=1&rel=0';
  var modal = document.createElement('div');
  modal.id = 'ytModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:16px';
  var sizeStyle = isShort ? 'width:min(360px,92vw);aspect-ratio:9/16' : 'width:min(820px,96vw);aspect-ratio:16/9';
  modal.innerHTML = '<div style="position:relative;' + sizeStyle + '">'
    + '<button onclick="document.getElementById(\'ytModal\').remove()" style="position:absolute;top:-40px;right:0;background:none;border:none;color:#fff;font-size:1.6rem;cursor:pointer;line-height:1">✕</button>'
    + '<iframe src="' + embedUrl + '" style="width:100%;height:100%;border:none;border-radius:12px" allowfullscreen allow="autoplay;encrypted-media;picture-in-picture"></iframe>'
    + '</div>';
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', esc); } });
  document.body.appendChild(modal);
}

var db = null;
var currentUser = null;
var isAdmin = false;
var allLinks = [];
var currentCategory = 'all';
var currentTab = 'feed';

var CATEGORY_ICONS = { '뉴스': '📰', '유튜브': '▶️' };
var CATEGORY_ORDER = ['뉴스', '유튜브'];

var INITIAL_DATA = [
  { category: '유튜브', name: '모터그래프', url: 'https://www.youtube.com/@motorgraph', description: '신차 리뷰, 시승기', order: 1 },
  { category: '유튜브', name: '오토뷰', url: 'https://www.youtube.com/@AutoviewTV', description: '시승, 비교 리뷰', order: 2 },
  { category: '뉴스', name: '오토헤럴드', url: 'https://www.autoherald.co.kr', description: '국내 자동차 뉴스', order: 1, rss: 'https://www.autoherald.co.kr/rss/allArticle.xml' },
  { category: '뉴스', name: '모터그래프', url: 'https://www.motorgraph.com', description: '자동차 뉴스 + 리뷰', order: 2, rss: 'https://www.motorgraph.com/rss/allArticle.xml' },
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
    var snap = await db.collection('car_trend_links').orderBy('order', 'asc').get();
    if (snap.empty) {
      await seedInitialData();
      snap = await db.collection('car_trend_links').orderBy('order', 'asc').get();
    }
    allLinks = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
    renderLinks();
    loadFeed();
    fillMissingThumbnails();
  } catch(e) {
    document.getElementById('feedContent').innerHTML = '<div class="loading">데이터를 불러올 수 없습니다</div>';
  }
}

async function seedInitialData() {
  var batch = db.batch();
  INITIAL_DATA.forEach(function(item) {
    var ref = db.collection('car_trend_links').doc();
    batch.set(ref, { ...item, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  });
  await batch.commit();
}

// 프사 없는 유튜브 링크 자동 업데이트
async function fillMissingThumbnails() {
  if (!isAdmin) return;
  var ytLinks = allLinks.filter(function(l) { return l.category === '유튜브' && !l.thumbnail; });
  for (var i = 0; i < ytLinks.length; i++) {
    var handleMatch = ytLinks[i].url.match(/@([^\/\?]+)/);
    if (!handleMatch) continue;
    try {
      var resp = await fetch('https://dt-youtube.shocguna.workers.dev/api/channel?handle=' + handleMatch[1]);
      var data = await resp.json();
      if (data.thumbnail) {
        await db.collection('car_trend_links').doc(ytLinks[i].id).update({ thumbnail: data.thumbnail });
        ytLinks[i].thumbnail = data.thumbnail;
      }
    } catch(e) {}
  }
  if (ytLinks.some(function(l) { return l.thumbnail; })) renderLinks();
}

// ===== 피드 탭 =====
async function loadFeed() {
  var el = document.getElementById('feedContent');
  el.innerHTML = '<div class="loading">피드 로딩 중...</div>';

  var html = '';

  // 1. 유튜브 최근 영상
  var ytLinks = allLinks.filter(function(l) { return l.category === '유튜브'; });
  if (ytLinks.length) {
    html += '<div class="feed-section"><div class="feed-section-title">▶️ 최근 자동차 영상</div>';
    try {
      var handles = ytLinks.map(function(l) {
        var match = l.url.match(/@([^\/\?]+)/);
        return match ? match[1] : null;
      }).filter(Boolean);

      // 핸들 → 채널 ID 조회 (저장된 ID 재사용, 없으면 병렬 fetch 후 저장)
      var channelIds = await Promise.all(ytLinks.map(async function(link) {
        if (link.channelId) return link.channelId;
        var match = link.url.match(/@([^\/\?]+)/);
        if (!match) return null;
        try {
          var resp = await fetch('https://dt-youtube.shocguna.workers.dev/api/channel?handle=' + match[1]);
          var data = await resp.json();
          if (data.channelId) {
            db.collection('car_trend_links').doc(link.id).update({ channelId: data.channelId }).catch(function(){});
            link.channelId = data.channelId;
          }
          return data.channelId || null;
        } catch(e) { return null; }
      }));
      channelIds = channelIds.filter(Boolean);

      if (channelIds.length) {
        var vResp = await fetch('https://dt-youtube.shocguna.workers.dev/api/videos?max=50&channels=' + channelIds.join(','));
        var vData = await vResp.json();
        var recentVideos = vData.videos || [];

        if (recentVideos.length) {
          var rvVideos = recentVideos.filter(function(v) { return !v.isShort; }).slice(0, 15);
          var rvShorts = recentVideos.filter(function(v) { return v.isShort; }).slice(0, 15);
          function renderFeedVideos(list, isShort) {
            html += '<div class="feed-scroll">';
            list.forEach(function(v) {
              html += '<div onclick="openYtModal(\'' + v.id + '\',' + (isShort ? 'true' : 'false') + ')" class="feed-video-card' + (isShort ? ' is-short' : '') + '" style="cursor:pointer">'
                + '<div style="position:relative">'
                + '<img class="feed-video-thumb' + (isShort ? ' is-short' : '') + '" src="' + v.thumbnail + '" alt="" loading="lazy">'
                + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div style="width:40px;height:40px;background:rgba(0,0,0,.6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem">▶</div></div>'
                + '</div>'
                + '<div class="feed-video-title">' + escapeHtml(v.title) + '</div>'
                + '<div class="feed-video-channel">' + escapeHtml(v.channelTitle || '') + ' · ' + timeAgo(v.publishedAt) + '</div>'
                + '</div>';
            });
            html += '</div>';
          }
          if (rvVideos.length) {
            html += '<div style="font-size:.82rem;font-weight:600;color:var(--text2);margin-bottom:6px">▶️ 동영상</div>';
            renderFeedVideos(rvVideos, false);
          }
          if (rvShorts.length) {
            html += '<div style="font-size:.82rem;font-weight:600;color:var(--text2);margin:12px 0 6px">🎬 Shorts</div>';
            renderFeedVideos(rvShorts, true);
          }
        } else {
          html += '<div class="feed-empty">영상이 없습니다</div>';
        }
      }
    } catch(e) {
      html += '<div class="feed-empty">영상을 불러올 수 없습니다</div>';
    }
    html += '</div>';
  }

  // 2. 뉴스 최근 기사
  var newsLinks = allLinks.filter(function(l) { return l.category === '뉴스' && l.rss; });
  if (newsLinks.length) {
    html += '<div class="feed-section"><div class="feed-section-title">📰 최근 자동차 뉴스</div>';
    var articles = [];
    for (var i = 0; i < newsLinks.length; i++) {
      try {
        var resp = await fetch('https://dt-rss.shocguna.workers.dev/api/rss?url=' + encodeURIComponent(newsLinks[i].rss));
        var data = await resp.json();
        (data.items || []).forEach(function(item) {
          articles.push({ ...item, source: newsLinks[i].name });
        });
      } catch(e) {}
    }
    articles.sort(function(a, b) { return new Date(b.pubDate) - new Date(a.pubDate); });

    if (articles.length) {
      var showCount = 5;
      articles.forEach(function(a, idx) {
        var hidden = idx >= showCount ? ' style="display:none" data-news-more' : '';
        html += '<a href="' + escapeHtml(a.link) + '" target="_blank" class="feed-article"' + hidden + '>'
          + '<span class="feed-article-icon">📰</span>'
          + '<div class="feed-article-info">'
          + '<div class="feed-article-title">' + escapeHtml(a.title) + '</div>';
        if (a.description) html += '<div class="feed-article-desc">' + escapeHtml(a.description) + '</div>';
        html += '<div class="feed-article-meta">' + escapeHtml(a.source) + ' · ' + timeAgo(a.pubDate) + '</div>'
          + '</div></a>';
      });
      if (articles.length > showCount) {
        html += '<button class="feed-more-btn" id="newsMoreBtn" onclick="document.querySelectorAll(\'[data-news-more]\').forEach(function(e){e.style.display=\'\'});this.style.display=\'none\';document.getElementById(\'newsLessBtn\').style.display=\'\'">더보기 (' + (articles.length - showCount) + '개)</button>';
        html += '<button class="feed-more-btn" id="newsLessBtn" style="display:none" onclick="document.querySelectorAll(\'[data-news-more]\').forEach(function(e){e.style.display=\'none\'});this.style.display=\'none\';document.getElementById(\'newsMoreBtn\').style.display=\'\'">줄이기</button>';
      }
    } else {
      html += '<div class="feed-empty">뉴스가 없습니다</div>';
    }
    html += '</div>';
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
    var catId = cat.replace(/\s/g, '_');
    var showCount = 3;
    html += '<div class="category-section"><h2>' + (CATEGORY_ICONS[cat] || '') + ' ' + escapeHtml(cat) + '</h2><div class="category-cards">';
    items.forEach(function(l, idx) {
      var hidden = idx >= showCount ? ' data-link-more-' + catId + ' style="display:none"' : '';
      var iconHtml = l.thumbnail
        ? '<img class="link-thumb" src="' + l.thumbnail + '" alt="" onerror="this.outerHTML=\'<span class=link-icon>▶️</span>\'">'
        : '<span class="link-icon">' + (CATEGORY_ICONS[l.category] || '🔗') + '</span>';
      html += '<a href="' + escapeHtml(l.url) + '" target="_blank" class="link-card"' + hidden + '>'
        + iconHtml
        + '<div class="link-info"><div class="link-name">' + escapeHtml(l.name) + '</div>';
      if (l.description) html += '<div class="link-desc">' + escapeHtml(l.description) + '</div>';
      html += '</div><span class="link-arrow">→</span></a>';
    });
    html += '</div>';
    if (items.length > showCount) {
      html += '<button class="feed-more-btn" id="linkMore_' + catId + '" onclick="document.querySelectorAll(\'[data-link-more-' + catId + ']\').forEach(function(e){e.style.display=\'\'});this.style.display=\'none\';document.getElementById(\'linkLess_' + catId + '\').style.display=\'\'">더보기 (' + (items.length - showCount) + '개)</button>';
      html += '<button class="feed-more-btn" id="linkLess_' + catId + '" style="display:none" onclick="document.querySelectorAll(\'[data-link-more-' + catId + ']\').forEach(function(e){e.style.display=\'none\'});this.style.display=\'none\';document.getElementById(\'linkMore_' + catId + '\').style.display=\'\'">줄이기</button>';
    }
    html += '</div>';
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
        + '<span>' + (CATEGORY_ICONS[l.category] || '🔗') + '</span>'
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
  if (this.value === '뉴스') {
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
  var rss = document.getElementById('addRss').value.trim();
  if (!name || !url) { alert('이름과 URL을 입력하세요.'); return; }

  try {
    var maxOrder = 0;
    allLinks.filter(function(l) { return l.category === category; }).forEach(function(l) { if (l.order > maxOrder) maxOrder = l.order; });
    var data = { category: category, name: name, url: url, description: desc || '', order: maxOrder + 1, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (rss) data.rss = rss;

    // 유튜브: 채널 프사 자동 저장
    if (category === '유튜브') {
      var handleMatch = url.match(/@([^\/\?]+)/);
      if (handleMatch) {
        try {
          var chResp = await fetch('https://dt-youtube.shocguna.workers.dev/api/channel?handle=' + handleMatch[1]);
          var chData = await chResp.json();
          if (chData.thumbnail) data.thumbnail = chData.thumbnail;
        } catch(e) {}
      }
    }

    await db.collection('car_trend_links').add(data);
    ['addName','addUrl','addDesc','addRss'].forEach(function(id) { document.getElementById(id).value = ''; });
    await loadAllData();
    renderAdminLinks();
  } catch(e) { alert('추가 실패: ' + e.message); }
}

async function removeTrendLink(id) {
  if (!confirm('이 링크를 삭제하시겠습니까?')) return;
  try {
    await db.collection('car_trend_links').doc(id).delete();
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
