// ===== DT Club AI Workspace =====
var ws = {
  db: null,
  auth: null,
  user: null,
  userRole: null,
  tunnelUrl: '',
  online: false,
  history: [],
  members: [],
  events: [],
  model: 'dt-assistant'
};

// --- Init ---
firebase.initializeApp(firebaseConfig);
ws.db = firebase.firestore();
ws.auth = firebase.auth();

ws.auth.onAuthStateChanged(async function(user) {
  if (!user || user.isAnonymous) {
    document.getElementById('authGate').style.display = 'flex';
    document.getElementById('workspace').style.display = 'none';
    return;
  }
  ws.user = user;
  // Check role
  try {
    var uDoc = await ws.db.collection('users').doc(user.uid).get();
    if (uDoc.exists) {
      ws.userRole = uDoc.data().role || 'member';
    }
  } catch(e) {}

  document.getElementById('authGate').style.display = 'none';
  document.getElementById('workspace').style.display = 'flex';
  document.getElementById('wsUser').textContent = user.displayName || user.email;

  // Load data
  await wsLoadData();
  await wsLoadTunnel();
  wsCheckHealth();
  setInterval(wsCheckHealth, 30000);

  // Show quick stats on load
  wsShowQuickStats();

  // Mobile: hide result panel initially
  if (window.innerWidth <= 900) {
    document.getElementById('wsResultPanel').classList.add('ws-hidden');
  }
});

// --- Auth ---
async function wsLogin() {
  var email = document.getElementById('authEmail').value.trim();
  var pw = document.getElementById('authPw').value;
  var errEl = document.getElementById('authError');
  errEl.textContent = '';
  try {
    await ws.auth.signInWithEmailAndPassword(email, pw);
  } catch(e) {
    errEl.textContent = '로그인 실패: 이메일 또는 비밀번호를 확인하세요.';
  }
}

function wsLogout() {
  ws.auth.signOut();
  location.reload();
}

// --- Data ---
async function wsLoadData() {
  // Members
  ws.db.collection('members').onSnapshot(function(snap) {
    ws.members = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
  });
  // Events
  ws.db.collection('events').onSnapshot(function(snap) {
    ws.events = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
  });
}

// --- Tunnel ---
async function wsLoadTunnel() {
  try {
    var doc = await ws.db.collection('config').doc('chatbot').get();
    if (doc.exists) {
      ws.tunnelUrl = (doc.data().tunnelUrl || '').replace(/\/+$/, '');
    }
  } catch(e) {}
}

var _wsFailCount = 0;
async function wsCheckHealth() {
  var statusEl = document.getElementById('wsStatus');
  try {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 10000);
    var resp = await fetch(ws.tunnelUrl + '/api/tags', { signal: controller.signal, mode: 'cors' });
    clearTimeout(timer);
    if (resp.ok) {
      ws.online = true;
      _wsFailCount = 0;
      statusEl.textContent = 'AI 온라인';
      statusEl.className = 'ws-status online';
      return;
    }
  } catch(e) {}
  _wsFailCount++;
  if (_wsFailCount >= 2) {
    ws.online = false;
    statusEl.textContent = 'AI 오프라인';
    statusEl.className = 'ws-status offline';
  }
}

// --- Quick Stats ---
function wsShowQuickStats() {
  setTimeout(function() {
    var el = document.getElementById('wsQuickStats');
    if (!el) return;
    var drivers = ws.members.filter(function(m) { return m.role === 'driver'; }).length;
    var passengers = ws.members.length - drivers;
    var now = new Date(); now.setHours(0,0,0,0);
    var upcoming = ws.events.filter(function(e) { return new Date(e.date) >= now; }).length;
    el.innerHTML = '<div class="ws-stat-grid" style="margin-top:24px">' +
      '<div class="ws-stat-item"><div class="ws-stat-num">' + ws.members.length + '</div><div class="ws-stat-label">전체 회원</div></div>' +
      '<div class="ws-stat-item"><div class="ws-stat-num driver">' + drivers + '</div><div class="ws-stat-label">드라이버</div></div>' +
      '<div class="ws-stat-item"><div class="ws-stat-num passenger">' + passengers + '</div><div class="ws-stat-label">패신저</div></div>' +
      '<div class="ws-stat-item"><div class="ws-stat-num warning">' + upcoming + '</div><div class="ws-stat-label">예정 이벤트</div></div>' +
      '</div>';
  }, 1500);
}

// --- Chat ---
var _wsSending = false;

function wsSendPreset(text) {
  if (_wsSending) return;
  document.getElementById('wsInput').value = text;
  wsSend();
}

async function wsSend() {
  var input = document.getElementById('wsInput');
  var text = input.value.trim();
  if (!text || _wsSending) return;
  input.value = '';

  if (!ws.online) {
    wsAppendMsg('bot', '현재 AI 서버가 오프라인입니다. 관리자의 PC가 켜져 있을 때 이용 가능합니다.');
    return;
  }

  wsAppendMsg('user', text);
  ws.history.push({ role: 'user', content: text });

  _wsSending = true;
  var sendBtn = document.getElementById('wsSendBtn');
  sendBtn.disabled = true;
  input.disabled = true;

  var typingEl = wsShowTyping();

  try {
    var recentHistory = ws.history.slice(-10);
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 60000);
    var resp = await fetch(ws.tunnelUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ws.model,
        messages: recentHistory,
        stream: false,
        _user: ws.user ? (ws.user.displayName || ws.user.email || 'unknown') : 'guest'
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    var data = await resp.json();
    var rawReply = (data.message && data.message.content) || '응답을 생성할 수 없습니다.';

    // Parse action
    var parsed = wsParseAction(rawReply);
    var reply = parsed.text;

    // CJK filter
    if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(reply)) {
      reply = reply.replace(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g, '').replace(/\s{2,}/g, ' ').trim();
      if (!reply || reply.length < 5) reply = '죄송합니다, 다시 질문해 주시겠어요?';
    }

    ws.history.push({ role: 'assistant', content: reply });
    typingEl.remove();
    wsAppendMsg('bot', reply);

    // Execute action → result panel
    if (parsed.action) {
      await wsExecuteAction(parsed.action);
      wsAutoSwitchToResult();
    }
  } catch(e) {
    typingEl.remove();
    if (e.name === 'AbortError') {
      wsAppendMsg('bot', '응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.');
    } else {
      wsAppendMsg('bot', 'AI 서버와 연결할 수 없습니다.');
    }
  }
  _wsSending = false;
  sendBtn.disabled = false;
  input.disabled = false;
  input.focus();
}

// --- Action Parser ---
function wsParseAction(rawReply) {
  var match = rawReply.match(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/);
  var action = null;
  var text = rawReply;
  if (match) {
    text = rawReply.replace(match[0], '').trim();
    try { action = JSON.parse(match[1].trim()); } catch(e) { action = null; }
  }
  return { text: text, action: action };
}

// --- Action Executor (Result Panel) ---
async function wsExecuteAction(action) {
  if (!action || !action.type) return;
  var resultBody = document.getElementById('wsResultBody');
  var resultTitle = document.getElementById('wsResultTitle');

  switch (action.type) {
    case 'navigate': {
      resultTitle.textContent = '페이지 이동';
      var pageNames = { home:'홈', members:'회원', cars:'차량', events:'이벤트', anon:'게시판' };
      resultBody.innerHTML = '<div class="ws-card"><div class="ws-card-title">페이지 이동</div>' +
        '<p style="font-size:.9rem;color:var(--text2)">DT Club "' + (pageNames[action.target] || action.target) + '" 페이지로 이동합니다.</p>' +
        '<a href="https://dt-1js.pages.dev/#/' + action.target + '" target="_blank" style="display:inline-block;margin-top:12px;padding:8px 20px;background:var(--primary);color:#fff;text-decoration:none;font-weight:700;font-size:.85rem">열기</a></div>';
      break;
    }

    case 'query_members': {
      var members = ws.members;
      if (action.search) {
        var q = action.search.toLowerCase();
        members = members.filter(function(m) {
          return m.name.toLowerCase().includes(q) || (m.nickname || '').toLowerCase().includes(q);
        });
      }
      var drivers = members.filter(function(m) { return m.role === 'driver'; });
      var passengers = members.filter(function(m) { return m.role !== 'driver'; });

      resultTitle.textContent = '회원 통계';
      var html = '<div class="ws-card"><div class="ws-card-title">회원 현황</div>' +
        '<div class="ws-stat-grid">' +
        '<div class="ws-stat-item"><div class="ws-stat-num">' + members.length + '</div><div class="ws-stat-label">전체</div></div>' +
        '<div class="ws-stat-item"><div class="ws-stat-num driver">' + drivers.length + '</div><div class="ws-stat-label">드라이버</div></div>' +
        '<div class="ws-stat-item"><div class="ws-stat-num passenger">' + passengers.length + '</div><div class="ws-stat-label">패신저</div></div>' +
        '</div></div>';

      // Bar chart
      var total = members.length || 1;
      html += '<div class="ws-card"><div class="ws-card-title">드라이버 / 패신저 비율</div>' +
        '<div class="ws-bar-row"><div class="ws-bar-label">드라이버</div><div class="ws-bar-track"><div class="ws-bar-fill" style="width:' + (drivers.length/total*100) + '%;background:var(--driver)"></div><div class="ws-bar-value">' + drivers.length + '명 (' + Math.round(drivers.length/total*100) + '%)</div></div></div>' +
        '<div class="ws-bar-row"><div class="ws-bar-label">패신저</div><div class="ws-bar-track"><div class="ws-bar-fill" style="width:' + (passengers.length/total*100) + '%;background:var(--passenger)"></div><div class="ws-bar-value">' + passengers.length + '명 (' + Math.round(passengers.length/total*100) + '%)</div></div></div>' +
        '</div>';

      // Member list
      html += '<div class="ws-card"><div class="ws-card-title">회원 목록 (' + members.length + '명)</div><ul class="ws-list">';
      members.forEach(function(m) {
        var badge = m.role === 'driver' ? '<span class="ws-list-badge driver">드라이버</span>' : '<span class="ws-list-badge passenger">패신저</span>';
        var car = (m.car && m.car.brand) ? m.car.brand + ' ' + (m.car.model || '') : '';
        html += '<li><div><span class="ws-list-name">' + escHtml(m.name) + '</span>' + (car ? ' <span class="ws-list-sub">' + escHtml(car) + '</span>' : '') + '</div>' + badge + '</li>';
      });
      html += '</ul></div>';
      resultBody.innerHTML = html;
      break;
    }

    case 'query_events': {
      var now = new Date(); now.setHours(0,0,0,0);
      var events = ws.events.filter(function(e) { return new Date(e.date) >= now; })
        .sort(function(a,b) { return new Date(a.date) - new Date(b.date); });
      var past = ws.events.filter(function(e) { return new Date(e.date) < now; }).length;

      resultTitle.textContent = '이벤트 조회';
      var html = '<div class="ws-card"><div class="ws-card-title">이벤트 현황</div>' +
        '<div class="ws-stat-grid">' +
        '<div class="ws-stat-item"><div class="ws-stat-num">' + ws.events.length + '</div><div class="ws-stat-label">전체</div></div>' +
        '<div class="ws-stat-item"><div class="ws-stat-num warning">' + events.length + '</div><div class="ws-stat-label">예정</div></div>' +
        '<div class="ws-stat-item"><div class="ws-stat-num accent">' + past + '</div><div class="ws-stat-label">지난</div></div>' +
        '</div></div>';

      html += '<div class="ws-card"><div class="ws-card-title">예정된 이벤트</div>';
      if (!events.length) {
        html += '<p style="color:var(--text3);font-size:.85rem;padding:12px">예정된 이벤트가 없습니다.</p>';
      } else {
        events.slice(0, 10).forEach(function(e) {
          var typeClass = e.type === 'lightning' ? 'lightning' : 'regular';
          var typeName = e.type === 'lightning' ? '번개' : (e.type === 'quiz' ? '퀴즈' : '정모');
          var votes = e.votes || {};
          var attending = (votes.attending || []).length;
          html += '<div class="ws-event-item">' +
            '<div class="ws-event-title">' + escHtml(e.title) + '<span class="ws-event-type ' + typeClass + '">' + typeName + '</span></div>' +
            '<div class="ws-event-meta"><span>' + e.date + '</span>' + (e.time ? '<span>' + e.time + '</span>' : '') + (e.location ? '<span>' + escHtml(e.location) + '</span>' : '') + '<span>참여 ' + attending + '명</span></div>' +
            '</div>';
        });
      }
      html += '</div>';
      resultBody.innerHTML = html;
      break;
    }

    case 'query_notices': {
      resultTitle.textContent = '공지사항';
      try {
        var snap = await ws.db.collection('notices').orderBy('createdAt', 'desc').limit(10).get();
        var html = '<div class="ws-card"><div class="ws-card-title">공지사항 (' + snap.size + '개)</div>';
        if (snap.empty) {
          html += '<p style="color:var(--text3);font-size:.85rem;padding:12px">등록된 공지가 없습니다.</p>';
        } else {
          snap.docs.forEach(function(d) {
            var n = d.data();
            html += '<div class="ws-notice-item"><div class="ws-notice-title">' + escHtml(n.title || '') + '</div>' +
              '<div class="ws-notice-date">' + (n.createdAt || '') + '</div>' +
              (n.content ? '<p style="font-size:.82rem;color:var(--text2);margin-top:4px">' + escHtml(n.content) + '</p>' : '') +
              '</div>';
          });
        }
        html += '</div>';
        resultBody.innerHTML = html;
      } catch(e) {
        resultBody.innerHTML = '<div class="ws-card"><p style="color:var(--accent)">공지를 불러올 수 없습니다.</p></div>';
      }
      break;
    }

    case 'create_notice': {
      if (ws.userRole !== 'admin' && ws.userRole !== 'superadmin') {
        resultBody.innerHTML = '<div class="ws-card"><p style="color:var(--accent)">공지 생성은 관리자만 가능합니다.</p></div>';
        return;
      }
      resultTitle.textContent = '공지 생성';
      try {
        var expDate = new Date();
        expDate.setDate(expDate.getDate() + 7);
        await ws.db.collection('notices').add({
          title: action.title || '제목 없음',
          subtitle: '',
          content: action.content || '',
          expiresAt: expDate.toISOString().slice(0,16),
          createdAt: new Date().toISOString().slice(0,16),
          updatedAt: new Date().toISOString().slice(0,16),
        });
        resultBody.innerHTML = '<div class="ws-card"><div class="ws-card-title">공지 등록 완료</div>' +
          '<div class="ws-stat-grid"><div class="ws-stat-item"><div class="ws-stat-num" style="font-size:1.2rem;color:var(--success)">' + escHtml(action.title) + '</div><div class="ws-stat-label">7일 후 자동 만료</div></div></div></div>';
      } catch(e) {
        resultBody.innerHTML = '<div class="ws-card"><p style="color:var(--accent)">공지 생성에 실패했습니다.</p></div>';
      }
      break;
    }

    case 'search_member': {
      if (!action.name) return;
      var sq = action.name.toLowerCase();
      var found = ws.members.filter(function(m) { return m.name.toLowerCase().includes(sq); });
      resultTitle.textContent = '회원 검색: ' + action.name;
      if (!found.length) {
        resultBody.innerHTML = '<div class="ws-card"><p style="color:var(--text3)">"' + escHtml(action.name) + '" 회원을 찾을 수 없습니다.</p></div>';
        return;
      }
      var html = '';
      found.forEach(function(m) {
        var badge = m.role === 'driver' ? '<span class="ws-list-badge driver" style="font-size:.8rem">드라이버</span>' : '<span class="ws-list-badge passenger" style="font-size:.8rem">패신저</span>';
        html += '<div class="ws-card">' +
          '<div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">' +
          (m.image ? '<img src="' + m.image + '" style="width:64px;height:64px;object-fit:cover;border:2px solid var(--border)">' : '<div style="width:64px;height:64px;background:var(--bg3);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.5rem">&#x1f464;</div>') +
          '<div><div style="font-size:1.1rem;font-weight:700">' + escHtml(m.name) + ' ' + badge + '</div>' +
          (m.bio ? '<div style="font-size:.82rem;color:var(--text2);margin-top:4px">' + escHtml(m.bio) + '</div>' : '') +
          '</div></div>';
        if (m.car && m.car.brand) {
          html += '<div class="ws-card-title" style="margin-top:12px">차량 정보</div>' +
            '<div class="ws-stat-grid">' +
            '<div class="ws-stat-item"><div class="ws-stat-num" style="font-size:1rem">' + escHtml(m.car.brand) + '</div><div class="ws-stat-label">브랜드</div></div>' +
            '<div class="ws-stat-item"><div class="ws-stat-num" style="font-size:1rem">' + escHtml(m.car.model || '-') + '</div><div class="ws-stat-label">모델</div></div>' +
            '<div class="ws-stat-item"><div class="ws-stat-num" style="font-size:1rem">' + (m.car.year || '-') + '</div><div class="ws-stat-label">연식</div></div>' +
            '<div class="ws-stat-item"><div class="ws-stat-num" style="font-size:1rem">' + escHtml(m.car.color || '-') + '</div><div class="ws-stat-label">색상</div></div>' +
            '</div>';
        }
        html += '</div>';
      });
      resultBody.innerHTML = html;
      break;
    }
  }
}

// --- UI Helpers ---
function wsAppendMsg(role, text) {
  var container = document.getElementById('wsMessages');
  var div = document.createElement('div');
  div.className = 'ws-msg ws-' + (role === 'user' ? 'user' : 'bot');
  var bubble = document.createElement('div');
  bubble.className = 'ws-bubble';
  bubble.textContent = text;
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function wsShowTyping() {
  var container = document.getElementById('wsMessages');
  var div = document.createElement('div');
  div.className = 'ws-msg ws-bot';
  div.innerHTML = '<div class="ws-typing"><span></span><span></span><span></span></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function wsClearResult() {
  document.getElementById('wsResultTitle').textContent = '결과 패널';
  document.getElementById('wsResultBody').innerHTML = '<div class="ws-result-empty"><div class="ws-result-empty-icon">&#x1f4ca;</div><p>AI에게 데이터를 요청하면<br>여기에 시각화됩니다</p></div>';
}

// --- Mobile Tab ---
function wsTab(tab) {
  var chatPanel = document.getElementById('wsChatPanel');
  var resultPanel = document.getElementById('wsResultPanel');
  var tabs = document.querySelectorAll('#wsTabs button');
  tabs.forEach(function(t, i) { t.className = (i === 0 && tab === 'chat') || (i === 1 && tab === 'result') ? 'active' : ''; });
  if (tab === 'chat') {
    chatPanel.classList.remove('ws-hidden');
    resultPanel.classList.add('ws-hidden');
  } else {
    chatPanel.classList.add('ws-hidden');
    resultPanel.classList.remove('ws-hidden');
  }
}

function wsAutoSwitchToResult() {
  if (window.innerWidth <= 900) {
    wsTab('result');
  }
}

function escHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
