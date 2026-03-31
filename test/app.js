/* ===== 운전 성향 테스트 - DT Club ===== */

var TYPES = {
  eagle: {
    emoji: '🦅', name: '칼날 매', title: '효율 최우선 전략가',
    color: '#d97706',
    desc: '막힘 없이 빠르고 정확하게. 당신에게 드라이브는 \'A에서 B까지의 최적화\'입니다. GPS보다 빠른 교통 감지 능력으로 항상 가장 빠른 길을 찾아냅니다. 목적지 도착이 곧 성취감.',
    traits: ['⚡ 빠른 상황 판단', '🎯 목적지 집중형', '🗺️ 최단경로 본능', '😤 정체 구간 스트레스'],
    compat: '💚 궁합: 여유 거북 (정반대 매력으로 균형)',
    driving: '"저 앞에 막힌다" — 차선 변경은 이미 시작됐다'
  },
  turtle: {
    emoji: '🐢', name: '여유 거북', title: '드라이브 힐링러',
    color: '#4ade80',
    desc: '드라이브는 목적지가 아니라 과정입니다. 창문 내리고 바람 맞으며 달리는 게 인생의 낙. 뷰 좋은 곳 발견하면 자연스럽게 속도가 줄어들고, 동승자들이 가장 좋아하는 운전자입니다.',
    traits: ['🌿 여유로운 페이스', '🎵 감성 드라이브 장인', '☕ 카페 투어 고수', '🐌 추월은 남의 일'],
    compat: '💚 궁합: 칼날 매 (서로의 부족함을 채워주는 관계)',
    driving: '뷰 좋은 곳 발견 → 자동으로 속도 감소 → 자연스럽게 정차'
  },
  fox: {
    emoji: '🦊', name: '눈치 여우', title: '상황대처 고수',
    color: '#f59e0b',
    desc: '도로의 흐름을 읽고 한 발 앞서 움직이는 전술가. 교통정보·날씨·도로 상황을 종합 분석하며 최적 루트를 실시간으로 계산합니다. 항상 차 한 대 앞의 상황을 예측하고 있습니다.',
    traits: ['📡 실시간 상황 파악', '🔄 유연한 루트 변경', '🧠 분석형 드라이버', '🕐 도착시간 예측 정확'],
    compat: '💚 궁합: 돌진 사자 (즉흥성으로 당신의 분석력을 보완)',
    driving: '"이 차가 곧 끼어든다" — 이미 준비가 되어 있다'
  },
  lion: {
    emoji: '🦁', name: '돌진 사자', title: '본능형 드라이버',
    color: '#ef4444',
    desc: '계획보다 감각. 지도보다 방향감각. 달리면 길은 열립니다. 즉흥적이고 대담한 드라이빙 스타일로 가장 짜릿한 드라이브를 경험하는 타입. 처음 가는 길인데도 자신감이 넘칩니다.',
    traits: ['🎲 즉흥 드라이브', '🔥 대담한 판단력', '🧭 방향감각 천재', '😅 내비 없이도 어떻게든 됨'],
    compat: '💚 궁합: 눈치 여우 (계획성으로 당신의 본능을 뒷받침)',
    driving: '"처음 와본 길인데요?" — 아무도 믿지 않는다'
  },
  hawk: {
    emoji: '🏅', name: '정석 독수리', title: '모범운전의 화신',
    color: '#60a5fa',
    desc: '안전벨트, 방어운전, 차간거리 확보. 교과서에 나온 운전법을 실제로 지키는 희귀 종. 동승자가 가장 믿고 맡길 수 있는 운전자이며, 무사고 기록을 자랑스럽게 생각합니다.',
    traits: ['✅ 교통법규 완벽 준수', '🛡️ 방어 운전 장인', '📋 출발 전 점검 필수', '😌 가장 안전한 운전자'],
    compat: '💚 궁합: 돌진 사자 (서로에게서 배울 점이 있는 관계)',
    driving: '깜빡이 3초 전 → 사이드미러 확인 → 차선 변경 (교과서 그대로)'
  },
  tiger: {
    emoji: '⚡', name: '질주 호랑이', title: '스피드 마니아',
    color: '#a78bfa',
    desc: '속도가 곧 해방입니다. 고속도로 진입과 동시에 본능적으로 가속 페달을 밟습니다. 운전 자체가 즐거운 퍼포먼스이며, EDM 없는 드라이브는 드라이브가 아닙니다.',
    traits: ['🚀 가속 = 힐링', '🎶 EDM 드라이브 필수', '💨 바람 가르는 맛', '🏁 고속도로 장악력'],
    compat: '💚 궁합: 정석 독수리 (안전과 스피드의 완벽한 조화)',
    driving: '고속도로 진입로 — 이미 100km/h 달성 중'
  }
};

var QUESTIONS = [
  {
    q: '고속도로에서 앞차가 답답하게 느리다. 나는?',
    opts: [
      { text: '즉시 차선 변경해서 추월한다', type: 'eagle' },
      { text: '깜빡이 켜고 기다리다 타이밍에 추월', type: 'fox' },
      { text: '어차피 막히니까 그냥 따라간다', type: 'turtle' },
      { text: '그냥 달린다. 왜 저렇게 느리지', type: 'lion' }
    ]
  },
  {
    q: '드라이브 목적지를 정하는 나만의 스타일은?',
    opts: [
      { text: '전날 코스·경유지·맛집까지 완벽 계획', type: 'hawk' },
      { text: '대충 지역만 정하고 그날 분위기에 맡김', type: 'lion' },
      { text: '빠른 경로 + 교통 상황 분석 후 결정', type: 'eagle' },
      { text: '가고 싶은 뷰맛집·카페 찾고 거기로 결정', type: 'turtle' }
    ]
  },
  {
    q: '운전 중 어떤 음악을 고르는가?',
    opts: [
      { text: 'EDM·댄스 — 신나고 텐션 UP', type: 'tiger' },
      { text: '잔잔한 재즈·팝 — 드라이브 감성 충만', type: 'turtle' },
      { text: '라디오 — 교통정보 놓치면 안 돼', type: 'fox' },
      { text: '아무거나. 음악보다 운전에 집중', type: 'hawk' }
    ]
  },
  {
    q: '처음 가는 길인데 내비가 신호를 잡지 못한다!',
    opts: [
      { text: '감으로 달린다. 어떻게든 됨', type: 'lion' },
      { text: '미리 외워뒀으니 괜찮다', type: 'hawk' },
      { text: '표지판 보며 방향 잡고 조금씩 수정', type: 'fox' },
      { text: '이건 있어야 함. 바로 데이터 켠다', type: 'turtle' }
    ]
  },
  {
    q: '주유 경고등이 켜졌다. 나의 반응은?',
    opts: [
      { text: '이미 경고등 뜨기 전에 채웠지', type: 'hawk' },
      { text: '가까운 주유소 바로 들어감', type: 'eagle' },
      { text: '저렴한 주유소 검색하고 조금 더 달림', type: 'fox' },
      { text: '어 켜졌네... 아직 좀 더 가겠지', type: 'lion' }
    ]
  },
  {
    q: '비가 많이 오는 날 운전, 나는?',
    opts: [
      { text: '차간거리 넉넉히 확보하고 조심조심', type: 'hawk' },
      { text: '조금 조심하는 정도, 크게 다르지 않음', type: 'eagle' },
      { text: '비 오면 가급적 운전 안 하는 편', type: 'turtle' },
      { text: '비 와도 뭐. 달리는 느낌 오히려 좋음', type: 'tiger' }
    ]
  },
  {
    q: '드라이브를 마치고 나서 드는 감정은?',
    opts: [
      { text: '시원하게 뻥 뚫린 느낌, 스트레스 해소', type: 'tiger' },
      { text: '오늘 코스·루트 어땠는지 자동으로 분석 중', type: 'fox' },
      { text: '든든함. 오늘도 사고 없이 잘 왔다', type: 'hawk' },
      { text: '다음에 또 오고 싶다. 여운이 남음', type: 'turtle' }
    ]
  },
  {
    q: '동승자가 "좀 천천히 가줄래?"라고 한다면?',
    opts: [
      { text: '나 빨리 안 가는데? (당황)', type: 'eagle' },
      { text: '알겠어, 바로 속도 줄임', type: 'hawk' },
      { text: '어 미안, 적당히 맞춰볼게', type: 'fox' },
      { text: '이게 느린 거야? (진심으로 모름)', type: 'tiger' }
    ]
  },
  {
    q: '고속도로 1차선(추월선)에 대한 내 생각은?',
    opts: [
      { text: '추월 후 즉시 복귀. 규정대로', type: 'hawk' },
      { text: '앞이 뚫리면 계속 달려도 되지', type: 'tiger' },
      { text: '상황 봐가며. 딱 정답은 없음', type: 'fox' },
      { text: '굳이? 2~3차선이 훨씬 편함', type: 'turtle' }
    ]
  },
  {
    q: '나에게 이상적인 드라이브란?',
    opts: [
      { text: '막힘 없이 빠르게, 목적지 도착', type: 'eagle' },
      { text: '뷰 좋은 곳에서 커피 한 잔', type: 'turtle' },
      { text: '코스 최적화 완벽, 계획대로 실행', type: 'fox' },
      { text: '아무 계획 없이 달리다 발견하는 숨은 명소', type: 'lion' }
    ]
  }
];

/* ===== 상태 ===== */
var currentQ = 0;
var scores = { eagle: 0, turtle: 0, fox: 0, lion: 0, hawk: 0, tiger: 0 };
var myType = null;

/* ===== 화면 전환 ===== */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('screen-' + id).classList.add('active');
}

/* ===== 테스트 시작 ===== */
function startTest() {
  currentQ = 0;
  scores = { eagle: 0, turtle: 0, fox: 0, lion: 0, hawk: 0, tiger: 0 };
  showScreen('question');
  renderQuestion();
}

function renderQuestion() {
  var q = QUESTIONS[currentQ];
  var total = QUESTIONS.length;
  var pct = Math.round((currentQ / total) * 100);

  document.getElementById('qNum').textContent = (currentQ + 1) + ' / ' + total;
  document.getElementById('qPercent').textContent = pct + '%';
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('qText').textContent = q.q;

  var letters = ['A', 'B', 'C', 'D'];
  document.getElementById('optionList').innerHTML = q.opts.map(function(opt, i) {
    return '<button class="option-btn" onclick="selectOption(\'' + opt.type + '\')">' +
      '<span class="option-letter">' + letters[i] + '</span>' +
      '<span>' + opt.text + '</span>' +
      '</button>';
  }).join('');

  document.getElementById('questionCard').style.animation = 'none';
  requestAnimationFrame(function() { document.getElementById('questionCard').style.animation = ''; });
}

function selectOption(type) {
  scores[type] += 2;

  var btns = document.querySelectorAll('.option-btn');
  // 어떤 버튼이 눌렸는지 시각적 피드백
  event.currentTarget.classList.add('selected');

  setTimeout(function() {
    currentQ++;
    if (currentQ >= QUESTIONS.length) {
      showResult();
    } else {
      renderQuestion();
    }
  }, 280);
}

/* ===== 결과 ===== */
function showResult() {
  // 최고 점수 타입 찾기
  var topType = Object.keys(scores).reduce(function(a, b) { return scores[a] >= scores[b] ? a : b; });
  myType = topType;
  var t = TYPES[topType];

  // CSS 변수로 결과 색상 설정
  document.getElementById('resultCard').style.setProperty('--result-color', t.color);

  document.getElementById('resultBadge').textContent = '나의 운전 성향';
  document.getElementById('resultEmoji').textContent = t.emoji;
  document.getElementById('resultType').textContent = t.name;
  document.getElementById('resultTitle').textContent = t.title;
  document.getElementById('resultDesc').textContent = t.desc;
  document.getElementById('resultTraits').innerHTML = t.traits.map(function(tr) {
    return '<span class="trait-tag">' + tr + '</span>';
  }).join('');
  document.getElementById('resultCompat').textContent = t.compat;
  document.getElementById('resultDriving').textContent = '"' + t.driving + '"';

  // 다른 유형 카드
  document.getElementById('otherTypes').innerHTML =
    '<h4>다른 유형 보기</h4>' +
    '<div class="other-grid">' +
    Object.keys(TYPES).map(function(key) {
      var ot = TYPES[key];
      return '<div class="other-card' + (key === topType ? ' mine' : '') + '" onclick="peekType(\'' + key + '\')">' +
        '<div class="other-emoji">' + ot.emoji + '</div>' +
        '<div class="other-name">' + ot.name + '</div>' +
        '</div>';
    }).join('') +
    '</div>';

  // URL에 결과 반영 (공유 가능)
  var url = new URL(window.location.href);
  url.searchParams.set('result', topType);
  history.replaceState(null, '', url.toString());

  showScreen('result');
  document.getElementById('progressFill').style.width = '100%';
  document.getElementById('qNum').textContent = QUESTIONS.length + ' / ' + QUESTIONS.length;
  document.getElementById('qPercent').textContent = '100%';
}

function peekType(key) {
  var t = TYPES[key];
  document.getElementById('resultCard').style.setProperty('--result-color', t.color);
  document.getElementById('resultEmoji').textContent = t.emoji;
  document.getElementById('resultType').textContent = t.name;
  document.getElementById('resultTitle').textContent = t.title;
  document.getElementById('resultDesc').textContent = t.desc;
  document.getElementById('resultTraits').innerHTML = t.traits.map(function(tr) {
    return '<span class="trait-tag">' + tr + '</span>';
  }).join('');
  document.getElementById('resultCompat').textContent = t.compat;
  document.getElementById('resultDriving').textContent = '"' + t.driving + '"';
  document.getElementById('resultBadge').textContent = key === myType ? '나의 운전 성향' : '다른 유형 미리보기';
  document.querySelectorAll('.other-card').forEach(function(c) { c.classList.remove('mine'); });
  document.querySelectorAll('.other-card')[Object.keys(TYPES).indexOf(key)].classList.add('mine');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===== 공유 ===== */
function shareResult() {
  var t = TYPES[myType];
  var url = window.location.origin + window.location.pathname + '?result=' + myType;
  var text = '나의 운전 성향은 ' + t.emoji + ' ' + t.name + ' — ' + t.title + '!\n내 유형은 뭘까? DT Club 운전 성향 테스트';

  if (navigator.share) {
    navigator.share({ title: '내 운전 성향 테스트', text: text, url: url }).catch(function() {});
  } else {
    navigator.clipboard.writeText(url).then(function() {
      showToast('링크가 복사됐습니다! 🔗');
    }).catch(function() {
      prompt('링크를 복사하세요:', url);
    });
  }
}

function showToast(msg) {
  var old = document.querySelector('.toast');
  if (old) old.remove();
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 2200);
}

function restartTest() {
  var url = new URL(window.location.href);
  url.searchParams.delete('result');
  history.replaceState(null, '', url.toString());
  showScreen('intro');
}

/* ===== URL 파라미터로 결과 바로 보기 ===== */
(function() {
  var params = new URLSearchParams(window.location.search);
  var r = params.get('result');
  if (r && TYPES[r]) {
    myType = r;
    scores[r] = 20; // 가상 점수
    showResult();
  }
})();

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
