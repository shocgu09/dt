// ===== DT 법률 도우미 =====
const LEGAL_WORKER_URL = 'https://dt-legal.shocguna.workers.dev';

const legal = {
  db: null,
  auth: null,
  user: null,
  isGuest: false,
  history: [],
  _sending: false,
};

// --- Firebase Init ---
firebase.initializeApp(firebaseConfig);
legal.db = firebase.firestore();
legal.auth = firebase.auth();

legal.auth.onAuthStateChanged(async function (user) {
  if (!user) {
    document.getElementById('authGate').style.display = 'flex';
    document.getElementById('legalApp').style.display = 'none';
    return;
  }
  legal.user = user;
  legal.isGuest = user.isAnonymous;

  document.getElementById('authGate').style.display = 'none';
  document.getElementById('legalApp').style.display = 'flex';
  document.getElementById('legalUser').textContent =
    user.isAnonymous ? '게스트' : (user.displayName || user.email);

  if (window.innerWidth <= 900) {
    document.getElementById('legalSourcePanel').classList.add('legal-hidden');
  }
});

// --- Auth ---
async function legalLogin() {
  var email = document.getElementById('authEmail').value.trim();
  var pw = document.getElementById('authPw').value;
  document.getElementById('authError').textContent = '';
  try {
    await legal.auth.signInWithEmailAndPassword(email, pw);
  } catch (e) {
    document.getElementById('authError').textContent = '로그인 실패: 이메일 또는 비밀번호를 확인하세요.';
  }
}

async function legalGuestLogin() {
  document.getElementById('authError').textContent = '';
  try {
    await legal.auth.signInAnonymously();
  } catch (e) {
    document.getElementById('authError').textContent = '게스트 로그인에 실패했습니다.';
  }
}

function legalLogout() {
  legal.auth.signOut();
  location.reload();
}

// --- Preset ---
function legalPreset(text) {
  if (legal._sending) return;
  document.getElementById('legalInput').value = text;
  legalSend();
}

// --- Send ---
async function legalSend() {
  var input = document.getElementById('legalInput');
  var text = input.value.trim();
  if (!text || legal._sending) return;
  input.value = '';

  appendMsg('user', text);
  legal.history.push({ role: 'user', content: text });

  legal._sending = true;
  var sendBtn = document.getElementById('legalSendBtn');
  sendBtn.disabled = true;
  input.disabled = true;
  setPresetsDisabled(true);

  var typingEl = showTyping();

  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 90000);

    var resp = await fetch(LEGAL_WORKER_URL + '/api/legal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: text,
        history: legal.history.slice(-6)
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    var data = await resp.json();
    typingEl.remove();

    if (data.error) {
      appendMsg('bot', '죄송합니다. 오류가 발생했습니다: ' + data.error);
    } else {
      renderAnswer(data);
      renderSourcePanel(data);
      legal.history.push({ role: 'assistant', content: data.answer || '' });
      autoSwitchToSource();
    }
  } catch (e) {
    typingEl.remove();
    if (e.name === 'AbortError') {
      appendMsg('bot', '응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.');
    } else {
      appendMsg('bot', '서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  legal._sending = false;
  sendBtn.disabled = false;
  input.disabled = false;
  input.focus();
  setPresetsDisabled(false);
}

// --- 답변 렌더링 (채팅 버블) ---
function renderAnswer(data) {
  var html = '';

  // 메인 답변
  if (data.answer) {
    html += '<div class="legal-answer">' + formatText(data.answer) + '</div>';
  }

  // 핵심 요약
  if (data.summary && data.summary.length) {
    html += '<div class="legal-section"><div class="legal-section-title">📋 핵심 요약</div><ul class="legal-summary-list">';
    data.summary.forEach(function (s) {
      html += '<li>' + escHtml(s) + '</li>';
    });
    html += '</ul></div>';
  }

  // 실용 팁
  if (data.tips && data.tips.length) {
    html += '<div class="legal-section legal-tips"><div class="legal-section-title">💡 실용 팁</div><ul>';
    data.tips.forEach(function (t) {
      html += '<li>' + escHtml(t) + '</li>';
    });
    html += '</ul></div>';
  }

  // 근거 법령 미리보기 (간략)
  if (data.laws && data.laws.length) {
    html += '<div class="legal-section"><div class="legal-section-title">📖 근거 법령</div>';
    data.laws.forEach(function (l) {
      html += '<div class="legal-law-chip">' + escHtml(l.name) + ' ' + escHtml(l.article) + '</div>';
    });
    html += '<div class="legal-see-source">👉 우측 패널에서 원문 확인</div></div>';
  }

  appendBubble('bot', html);
}

// --- 소스 패널 렌더링 (법령 원문 + 판례) ---
function renderSourcePanel(data) {
  var body = document.getElementById('legalSourceBody');
  var title = document.getElementById('legalSourceTitle');
  title.textContent = '📖 법령 · 판례';
  var html = '';

  // 근거 법령 (접기/펼치기)
  if (data.laws && data.laws.length) {
    html += '<div class="legal-card"><div class="legal-card-title">📖 근거 법령</div>';
    data.laws.forEach(function (l, i) {
      var hasText = l.text && l.text.trim();
      html += '<div class="legal-law-item">';
      html += '<button class="legal-law-toggle" onclick="toggleLaw(this)">';
      html += '<span>▶ ' + escHtml(l.name) + ' ' + escHtml(l.article);
      if (l.title) html += ' (' + escHtml(l.title) + ')';
      html += '</span></button>';
      if (hasText) {
        html += '<div class="legal-law-text" style="display:none"><pre>' + escHtml(l.text) + '</pre></div>';
      } else {
        html += '<div class="legal-law-text" style="display:none"><p class="legal-no-data">조문 원문을 불러오지 못했습니다.</p></div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // 판례
  if (data.precedents && data.precedents.length) {
    html += '<div class="legal-card"><div class="legal-card-title">⚖️ 관련 판례</div>';
    data.precedents.forEach(function (p) {
      html += '<div class="legal-prec-item">';
      html += '<div class="legal-prec-court">' + escHtml(p.court || '법원') + '</div>';
      html += '<div class="legal-prec-case">' + escHtml(p.caseNumber || '') + '</div>';
      if (p.date) html += '<div class="legal-prec-date">' + escHtml(p.date) + '</div>';
      if (p.summary) {
        var summaryText = p.summary.length > 300 ? p.summary.slice(0, 300) + '...' : p.summary;
        html += '<div class="legal-prec-summary">' + escHtml(summaryText) + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  if (!html) {
    html = '<div class="legal-card"><p style="color:var(--text3);font-size:.85rem;padding:12px">관련 법령 및 판례를 찾지 못했습니다.</p></div>';
  }

  body.innerHTML = html;
}

// --- 법령 원문 접기/펼치기 ---
function toggleLaw(btn) {
  var textDiv = btn.parentElement.querySelector('.legal-law-text');
  if (!textDiv) return;
  var visible = textDiv.style.display !== 'none';
  textDiv.style.display = visible ? 'none' : 'block';
  var span = btn.querySelector('span');
  if (span) {
    span.textContent = span.textContent.replace(/^[▶▼]/, visible ? '▶' : '▼');
  }
}

// --- 소스 패널 초기화 ---
function legalClearSource() {
  document.getElementById('legalSourceTitle').textContent = '📖 법령 · 판례';
  document.getElementById('legalSourceBody').innerHTML =
    '<div class="legal-source-empty"><div class="legal-source-empty-icon">⚖️</div><p>질문하시면 관련 법령과 판례가<br>여기에 표시됩니다</p></div>';
}

// --- UI 헬퍼 ---
function appendMsg(role, text) {
  appendBubble(role, escHtml(text));
}

function appendBubble(role, html) {
  var container = document.getElementById('legalMessages');
  var div = document.createElement('div');
  div.className = 'legal-msg legal-' + (role === 'user' ? 'user' : 'bot');
  var bubble = document.createElement('div');
  bubble.className = 'legal-bubble';
  bubble.innerHTML = html;
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showTyping() {
  var container = document.getElementById('legalMessages');
  var div = document.createElement('div');
  div.className = 'legal-msg legal-bot';
  div.innerHTML = '<div class="legal-typing"><span></span><span></span><span></span></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function setPresetsDisabled(disabled) {
  document.querySelectorAll('#legalPresets button').forEach(function (b) {
    b.disabled = disabled;
    b.style.opacity = disabled ? '.4' : '1';
  });
}

function formatText(text) {
  // 간단한 마크다운: **bold**, 줄바꿈
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function escHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// --- Mobile Tab ---
function legalTab(tab) {
  var chatPanel = document.getElementById('legalChatPanel');
  var sourcePanel = document.getElementById('legalSourcePanel');
  var tabs = document.querySelectorAll('#legalTabs button');
  tabs[0].className = tab === 'chat' ? 'active' : '';
  tabs[1].className = tab === 'source' ? 'active' : '';
  if (tab === 'chat') {
    chatPanel.classList.remove('legal-hidden');
    sourcePanel.classList.add('legal-hidden');
  } else {
    chatPanel.classList.add('legal-hidden');
    sourcePanel.classList.remove('legal-hidden');
  }
}

function autoSwitchToSource() {
  if (window.innerWidth <= 900) {
    legalTab('source');
  }
}
