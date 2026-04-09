// ===== DT 법률 도우미 — 스트리밍 =====
// API는 같은 도메인의 Pages Functions로 호출 (/api/legal)

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

// --- Send (스트리밍) ---
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

  // 상태 말풍선 (MCP 도구 호출 표시용) — 별도 버블
  var statusBubble = null;
  // 답변 말풍선 — 텍스트 스트리밍용
  var answerBubble = null;
  var fullText = '';

  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 120000);

    var resp = await fetch('/api/legal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: text,
        history: legal.history.slice(-3)
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    // 비스트리밍 에러 응답 처리
    var contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      var data = await resp.json();
      var errBubble = createBotBubble();
      if (data.error) {
        errBubble.innerHTML = escHtml('죄송합니다. 오류가 발생했습니다: ' + data.error);
      } else {
        errBubble.innerHTML = '<div class="legal-answer">' + renderMarkdown(data.answer || '') + '</div>';
        fullText = data.answer || '';
      }
      finishSend(fullText);
      return;
    }

    // SSE 스트리밍 수신
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.startsWith('data: ')) continue;
        var jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        var event;
        try { event = JSON.parse(jsonStr); } catch (e) { continue; }

        if (event.type === 'text') {
          // 텍스트 시작 → 상태 말풍선 숨기고, 답변 말풍선 생성
          if (statusBubble) {
            statusBubble.parentElement.remove();
            statusBubble = null;
          }
          if (!answerBubble) {
            answerBubble = createBotBubble();
          }
          fullText += event.text;
          answerBubble.innerHTML = '<div class="legal-answer">' + renderMarkdown(fullText) + '</div>';
          scrollToBottom();
        }
        else if (event.type === 'status') {
          // MCP 도구 호출 → 별도 상태 말풍선
          if (statusBubble) {
            // 기존 상태 말풍선 업데이트
            statusBubble.textContent = event.text;
          } else {
            statusBubble = createBotBubble();
            statusBubble.className = 'legal-bubble legal-status-bubble';
            statusBubble.textContent = event.text;
          }
          scrollToBottom();
        }
        else if (event.type === 'error') {
          if (statusBubble) { statusBubble.parentElement.remove(); statusBubble = null; }
          var errBbl = answerBubble || createBotBubble();
          errBbl.innerHTML = escHtml('죄송합니다. 오류가 발생했습니다: ' + event.text);
        }
        else if (event.type === 'done') {
          if (statusBubble) { statusBubble.parentElement.remove(); statusBubble = null; }
        }
      }
    }
  } catch (e) {
    if (statusBubble) { statusBubble.parentElement.remove(); statusBubble = null; }
    var errTarget = answerBubble || createBotBubble();
    if (e.name === 'AbortError') {
      errTarget.innerHTML = escHtml('응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.');
    } else if (!fullText) {
      errTarget.innerHTML = escHtml('서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  finishSend(fullText);
}

function finishSend(fullText) {
  if (fullText) {
    legal.history.push({ role: 'assistant', content: fullText });
  }
  legal._sending = false;
  var sendBtn = document.getElementById('legalSendBtn');
  var input = document.getElementById('legalInput');
  sendBtn.disabled = false;
  input.disabled = false;
  input.focus();
  setPresetsDisabled(false);
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
  scrollToBottom();
}

function createBotBubble() {
  var container = document.getElementById('legalMessages');
  var div = document.createElement('div');
  div.className = 'legal-msg legal-bot';
  var bubble = document.createElement('div');
  bubble.className = 'legal-bubble';
  div.appendChild(bubble);
  container.appendChild(div);
  scrollToBottom();
  return bubble;
}

function scrollToBottom() {
  var container = document.getElementById('legalMessages');
  container.scrollTop = container.scrollHeight;
}

function setPresetsDisabled(disabled) {
  document.querySelectorAll('#legalPresets button').forEach(function (b) {
    b.disabled = disabled;
    b.style.opacity = disabled ? '.4' : '1';
  });
}

// 마크다운 렌더러 — AI 원문을 그대로 HTML로 변환
function renderMarkdown(text) {
  if (!text) return '';
  var lines = text.split('\n');
  var html = '';
  var inList = false;
  var inCode = false;
  var codeBlock = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // 코드 블록
    if (line.trim().startsWith('```')) {
      if (inCode) {
        html += '<pre><code>' + escHtml(codeBlock) + '</code></pre>';
        codeBlock = '';
        inCode = false;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBlock += (codeBlock ? '\n' : '') + line; continue; }

    // 빈 줄
    if (!line.trim()) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<br>';
      continue;
    }

    // 제목
    if (/^### (.+)/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<h4>' + inlineFormat(line.replace(/^### /, '')) + '</h4>';
      continue;
    }
    if (/^## (.+)/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<h3>' + inlineFormat(line.replace(/^## /, '')) + '</h3>';
      continue;
    }
    if (/^# (.+)/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<h2>' + inlineFormat(line.replace(/^# /, '')) + '</h2>';
      continue;
    }

    // 리스트
    if (/^[\-\*] (.+)/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + inlineFormat(line.replace(/^[\-\*] /, '')) + '</li>';
      continue;
    }
    if (/^\d+\. (.+)/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + inlineFormat(line.replace(/^\d+\. /, '')) + '</li>';
      continue;
    }

    // 일반 텍스트
    if (inList) { html += '</ul>'; inList = false; }
    html += '<p>' + inlineFormat(line) + '</p>';
  }
  if (inList) html += '</ul>';
  if (inCode) html += '<pre><code>' + escHtml(codeBlock) + '</code></pre>';
  return html;
}

// 인라인 마크다운: **bold**, *italic*, `code`
function inlineFormat(text) {
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}

function escHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
