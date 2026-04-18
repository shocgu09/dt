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

  // 단일 로딩 버블 — 요청 시작 시 표시, 첫 답변 도착 시 답변 버블로 전환
  var loadingBubble = createLoadingBubble();
  var answerBubble = null;
  var fullText = '';

  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 120000);

    // Firebase ID Token 획득 (게스트 포함 모든 인증 유저)
    var idToken = '';
    try { idToken = await legal.user.getIdToken(); } catch (e) {}

    var resp = await fetch('/api/legal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken,
      },
      body: JSON.stringify({
        question: text,
        history: legal.history.slice(-3)
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    // 429 (Rate Limit) / 401 (인증 실패) 특별 처리
    if (resp.status === 429 || resp.status === 401) {
      var errData = await resp.json().catch(function () { return {}; });
      if (loadingBubble) { loadingBubble.parentElement.remove(); loadingBubble = null; }
      var errBubble = createBotBubble();
      errBubble.innerHTML = escHtml(errData.error || (resp.status === 429 ? '요청이 너무 많습니다.' : '로그인이 필요합니다.'));
      finishSend('');
      return;
    }

    // 비스트리밍 에러 응답 처리
    var contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      var data = await resp.json();
      if (loadingBubble) { loadingBubble.parentElement.remove(); loadingBubble = null; }
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

        if (event.type === 'clear') {
          // 도구 호출 감지 → 이전 중간 텍스트 폐기, 로딩만 남김
          if (answerBubble) {
            answerBubble.parentElement.remove();
            answerBubble = null;
          }
          fullText = '';
          if (!loadingBubble) loadingBubble = createLoadingBubble();
        }
        else if (event.type === 'text') {
          // 첫 텍스트 도착 → 로딩 제거, 답변 버블 생성
          if (loadingBubble) {
            loadingBubble.parentElement.remove();
            loadingBubble = null;
          }
          if (!answerBubble) answerBubble = createBotBubble();
          fullText += event.text;
          answerBubble.innerHTML = '<div class="legal-answer">' + renderMarkdown(fullText) + '</div>';
          scrollToBottom();
        }
        else if (event.type === 'error') {
          if (loadingBubble) { loadingBubble.parentElement.remove(); loadingBubble = null; }
          var errBbl = answerBubble || createBotBubble();
          errBbl.innerHTML = escHtml('죄송합니다. 오류가 발생했습니다: ' + event.text);
        }
        else if (event.type === 'done') {
          if (loadingBubble) { loadingBubble.parentElement.remove(); loadingBubble = null; }
        }
      }
    }
  } catch (e) {
    if (loadingBubble) { loadingBubble.parentElement.remove(); loadingBubble = null; }
    var errTarget = answerBubble || createBotBubble();
    if (e.name === 'AbortError') {
      errTarget.innerHTML = escHtml('응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.');
    } else if (!fullText) {
      errTarget.innerHTML = escHtml('서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  // 스트림 종료 시 로딩 버블이 남아있으면 정리
  if (loadingBubble) { loadingBubble.parentElement.remove(); loadingBubble = null; }
  finishSend(fullText);
}

// 로딩 버블: 점 3개 애니메이션 + "법령을 찾고 있어요..." 텍스트
function createLoadingBubble() {
  var container = document.getElementById('legalMessages');
  var div = document.createElement('div');
  div.className = 'legal-msg legal-bot legal-loading-msg';
  var bubble = document.createElement('div');
  bubble.className = 'legal-bubble legal-loading-bubble';
  bubble.innerHTML =
    '<div class="legal-loading-content">' +
      '<div class="legal-loading-dots"><span></span><span></span><span></span></div>' +
      '<span class="legal-loading-text">법령을 찾고 있어요</span>' +
    '</div>';
  div.appendChild(bubble);
  container.appendChild(div);
  scrollToBottom();
  return bubble;
}

function finishSend(fullText) {
  if (fullText) {
    legal.history.push({ role: 'assistant', content: fullText });
    appendCompletionFooter(fullText);
  }
  legal._sending = false;
  var sendBtn = document.getElementById('legalSendBtn');
  var input = document.getElementById('legalInput');
  sendBtn.disabled = false;
  input.disabled = false;
  input.focus();
  setPresetsDisabled(false);
}

// 답변 완료 표시 + 후속 질문 제안 (중복 방지)
function appendCompletionFooter(fullText) {
  var container = document.getElementById('legalMessages');
  // 이미 완료 푸터가 있으면 기존 것 제거
  var oldFooter = document.getElementById('legalCompletionFooter');
  if (oldFooter) oldFooter.remove();

  var div = document.createElement('div');
  div.className = 'legal-msg legal-bot legal-completion';
  div.id = 'legalCompletionFooter';

  var bubble = document.createElement('div');
  bubble.className = 'legal-bubble legal-completion-bubble';

  // 완료 배지 + 메시지
  var header = document.createElement('div');
  header.className = 'legal-completion-header';
  header.innerHTML =
    '<span class="legal-completion-badge">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
      '답변 완료' +
    '</span>' +
    '<span class="legal-completion-text">추가로 궁금한 점이 있으신가요?</span>';
  bubble.appendChild(header);

  // 후속 질문 제안 버튼 (AI 답변 맥락 기반 + 기본)
  var suggestions = buildFollowupSuggestions(fullText);
  if (suggestions.length) {
    var chips = document.createElement('div');
    chips.className = 'legal-followup-chips';
    suggestions.forEach(function (s) {
      var btn = document.createElement('button');
      btn.className = 'legal-followup-chip';
      btn.textContent = s;
      btn.onclick = function () {
        if (legal._sending) return;
        document.getElementById('legalInput').value = s;
        legalSend();
      };
      chips.appendChild(btn);
    });
    bubble.appendChild(chips);
  }

  // "대화 초기화" 액션
  var actions = document.createElement('div');
  actions.className = 'legal-completion-actions';
  var resetBtn = document.createElement('button');
  resetBtn.className = 'legal-completion-action';
  resetBtn.innerHTML = '🔄 새 상담 시작';
  resetBtn.onclick = function () {
    if (legal._sending) return;
    legal.history = [];
    document.getElementById('legalMessages').innerHTML =
      '<div class="legal-msg legal-bot"><div class="legal-bubble">새 상담을 시작합니다. 법률 질문을 입력해주세요.</div></div>';
  };
  actions.appendChild(resetBtn);
  bubble.appendChild(actions);

  div.appendChild(bubble);
  container.appendChild(div);
  scrollToBottom();
}

// 답변 내용에서 후속 질문 후보 추출
function buildFollowupSuggestions(answer) {
  var text = (answer || '').toLowerCase();
  var suggestions = [];

  // 답변에 등장한 법률 키워드로 자연스러운 후속 질문 생성
  if (/처벌|벌금|징역|형량/.test(text)) suggestions.push('이 처벌을 감경할 수 있는 사유가 있나요?');
  if (/판례|대법원|선고/.test(text)) suggestions.push('관련 최신 판례를 더 알려주세요');
  if (/조항|제\s*\d+조/.test(text)) suggestions.push('이 조항의 시행령도 알려주세요');
  if (/과실|비율|사고/.test(text)) suggestions.push('과실 비율 판단 기준을 더 자세히 알려주세요');
  if (/면허|정지|취소/.test(text)) suggestions.push('면허 구제 절차(이의신청)가 있나요?');

  // 기본 후속 질문 (최대 3개까지)
  if (suggestions.length < 3) {
    var defaults = [
      '예시 사례로 설명해주세요',
      '실무에서 어떻게 적용되나요?',
      '유사 법률과의 차이는 무엇인가요?',
    ];
    for (var i = 0; i < defaults.length && suggestions.length < 3; i++) {
      if (suggestions.indexOf(defaults[i]) === -1) suggestions.push(defaults[i]);
    }
  }
  return suggestions.slice(0, 3);
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
