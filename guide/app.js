/* ===== 드라이브 가이드 - DT Club ===== */

var db = null, currentUser = null, isAdmin = false;
var guideData = {};
var editingDocId = null;
var currentChecklistFilter = 'all';
var currentBeginnerFilter = 'all';
var currentWarningFilter = 'all';

/* ===== 기본 데이터 ===== */
var DEFAULT_DATA = {
  drive_checklist: {
    categories: ['출발 전', '차량 점검', '비상용품', '편의용품'],
    items: [
      { id: 'c1', category: '출발 전', text: '목적지 및 경유지 네비 설정' },
      { id: 'c2', category: '출발 전', text: '날씨 및 도로 상황 확인' },
      { id: 'c3', category: '출발 전', text: '예상 소요시간 및 휴게소 확인' },
      { id: 'c4', category: '출발 전', text: '동승자에게 출발 시간 안내' },
      { id: 'c5', category: '출발 전', text: '하이패스 카드 잔액 확인' },
      { id: 'c6', category: '출발 전', text: '주유 또는 충전 상태 확인' },
      { id: 'c7', category: '차량 점검', text: '타이어 공기압 및 마모 상태' },
      { id: 'c8', category: '차량 점검', text: '엔진오일 레벨 확인' },
      { id: 'c9', category: '차량 점검', text: '냉각수 레벨 확인' },
      { id: 'c10', category: '차량 점검', text: '워셔액 보충 여부' },
      { id: 'c11', category: '차량 점검', text: '브레이크 패드 상태' },
      { id: 'c12', category: '차량 점검', text: '전조등·후미등·방향지시등 작동' },
      { id: 'c13', category: '차량 점검', text: '와이퍼 블레이드 상태' },
      { id: 'c14', category: '비상용품', text: '삼각대 (안전삼각표지판)' },
      { id: 'c15', category: '비상용품', text: '소화기' },
      { id: 'c16', category: '비상용품', text: '안전조끼 (야간용)' },
      { id: 'c17', category: '비상용품', text: '점프 케이블 또는 보조배터리' },
      { id: 'c18', category: '비상용품', text: '응급 구급함' },
      { id: 'c19', category: '비상용품', text: '긴급 연락처 메모 (보험사, 긴급출동)' },
      { id: 'c20', category: '편의용품', text: '휴대폰 충전 케이블' },
      { id: 'c21', category: '편의용품', text: '간식 및 음료' },
      { id: 'c22', category: '편의용품', text: '담요 또는 여분의 겉옷' },
      { id: 'c23', category: '편의용품', text: '선글라스' },
      { id: 'c24', category: '편의용품', text: '휴지 및 물티슈' },
      { id: 'c25', category: '편의용품', text: '차량용 방향제 또는 환기' }
    ]
  },
  beginner_guide: {
    categories: ['주차', '고속도로', '야간운전', '날씨', '기본매너'],
    items: [
      {
        id: 'b1', category: '주차', emoji: '🅿️',
        title: '직각 주차 (후진) 요령',
        content: [
          '주차 공간 옆 차량과 나란히 정렬합니다',
          '사이드미러에 옆 차 뒷범퍼가 보이면 핸들을 끝까지 꺾습니다',
          '후방카메라의 가이드라인을 참고하며 천천히 후진합니다',
          '양쪽 간격이 비슷해지면 핸들을 정렬합니다',
          '처음엔 넓은 주차장에서 연습하세요'
        ]
      },
      {
        id: 'b2', category: '주차', emoji: '🔄',
        title: '평행 주차 (종렬 주차) 요령',
        content: [
          '앞 차와 나란히 약 1m 간격으로 정지합니다',
          '후진하며 핸들을 주차 공간 쪽으로 끝까지 꺾습니다',
          '차체가 45도쯤 들어가면 핸들을 반대로 끝까지 꺾습니다',
          '뒤 차와의 간격을 확인하며 정렬합니다',
          '앞뒤 차와 균등한 간격을 맞춥니다'
        ]
      },
      {
        id: 'b3', category: '고속도로', emoji: '🛣️',
        title: '고속도로 합류 요령',
        content: [
          '가속차로에서 충분히 속도를 올립니다 (80km/h 이상)',
          '사이드미러와 숄더체크로 본선 차량 확인합니다',
          '깜빡이를 미리 켜고 자연스럽게 합류합니다',
          '급정거나 급가속은 절대 금물입니다',
          '합류 실패 시 가속차로 끝까지 가서 재시도합니다'
        ]
      },
      {
        id: 'b4', category: '고속도로', emoji: '🚗',
        title: '안전거리 유지하기',
        content: [
          '시속 100km 기준 최소 100m (약 3초 간격) 유지합니다',
          '앞 차가 특정 지점 통과 후 3초 세기(1001, 1002, 1003)를 활용합니다',
          '비·눈 오는 날은 평소의 1.5~2배 거리를 확보합니다',
          '대형차 뒤에서는 더 넓은 간격을 유지합니다',
          '터널 진입 전 감속하고 전조등을 켭니다'
        ]
      },
      {
        id: 'b5', category: '고속도로', emoji: '🆘',
        title: '고속도로 고장/사고 시 대처',
        content: [
          '비상등(해저드)을 즉시 켭니다',
          '가능하면 갓길로 안전하게 이동합니다',
          '차에서 내려 가드레일 밖으로 대피합니다',
          '삼각대를 차량 후방 200m 지점에 설치합니다',
          '한국도로공사 1588-2504 또는 보험사 긴급출동에 연락합니다'
        ]
      },
      {
        id: 'b6', category: '야간운전', emoji: '🌙',
        title: '야간 운전 주의사항',
        content: [
          '전조등을 반드시 켜고, 시야가 좁아지므로 감속합니다',
          '대향차 상향등에 눈이 부시면 시선을 도로 오른쪽으로 돌립니다',
          '도심에서는 하향등, 교외에서는 상향등을 적절히 전환합니다',
          '피로감이 느껴지면 즉시 휴게소에서 쉽니다',
          '대시보드 밝기를 낮추어 눈 피로를 줄입니다'
        ]
      },
      {
        id: 'b7', category: '날씨', emoji: '🌧️',
        title: '비 오는 날 운전 요령',
        content: [
          '속도를 평소의 20% 정도 줄입니다',
          '안전거리를 평소의 1.5배로 넓힙니다',
          '수막현상(하이드로플레이닝) 주의 — 물 웅덩이 급하게 밟지 않기',
          '전조등을 켜서 시인성을 높입니다',
          '에어컨을 켜서 앞유리 습기를 제거합니다'
        ]
      },
      {
        id: 'b8', category: '날씨', emoji: '❄️',
        title: '겨울철·눈길 운전 요령',
        content: [
          '출발 전 지붕·보닛 위 눈을 제거합니다',
          '급가속·급정거·급핸들 조작을 피합니다',
          '커브길 진입 전 충분히 감속합니다',
          '엔진 브레이크(저단 기어)를 적극 활용합니다',
          '스노우 체인 또는 윈터 타이어를 미리 준비합니다'
        ]
      },
      {
        id: 'b9', category: '기본매너', emoji: '🤝',
        title: '운전 에티켓',
        content: [
          '차선 변경 시 반드시 방향지시등을 켭니다',
          '양보 받으면 비상등을 1~2회 깜박여 감사 인사합니다',
          '추월 차로(1차로)는 추월 후 바로 양보합니다',
          '이중주차 시 연락처를 꼭 남깁니다',
          '보행자, 자전거, 오토바이에 충분한 간격을 둡니다'
        ]
      },
      {
        id: 'b10', category: '기본매너', emoji: '⛽',
        title: '주유소 이용 팁',
        content: [
          '주유구 방향을 확인하고 올바른 쪽으로 진입합니다 (계기판 화살표 확인)',
          '셀프 주유 시 정전기 방지 패드를 먼저 터치합니다',
          '유종(휘발유/경유/LPG)을 반드시 확인합니다',
          '연비 앱으로 주변 최저가 주유소를 찾으면 절약됩니다'
        ]
      }
    ]
  },
  warning_lights: {
    severity_labels: { danger: '긴급', warning: '주의', info: '정보' },
    items: [
      {
        id: 'w1', icon: 'icons/w1.svg', name: '엔진 경고등',
        severity: 'danger', color: '#ef4444',
        description: '엔진 또는 배기가스 관련 이상이 감지되었습니다.',
        action: '즉시 안전한 곳에 정차하고 정비소에 연락하세요. 계속 주행하면 엔진 손상이 커질 수 있습니다.',
        needsRepair: true
      },
      {
        id: 'w2', icon: 'icons/w2.svg', name: '엔진 오일 압력 경고',
        severity: 'danger', color: '#ef4444',
        description: '엔진 오일 압력이 비정상적으로 낮습니다.',
        action: '즉시 정차하고 엔진을 끄세요. 오일 레벨을 확인하고 부족하면 보충 후 정비소 방문이 필요합니다.',
        needsRepair: true
      },
      {
        id: 'w3', icon: 'icons/w3.svg', name: '냉각수 온도 경고',
        severity: 'danger', color: '#ef4444',
        description: '엔진 냉각수 온도가 과열 상태입니다.',
        action: '즉시 안전한 곳에 정차, 에어컨 끄고 히터를 최대로 켜서 열을 분산시키세요. 냉각수가 식은 후 레벨을 확인합니다.',
        needsRepair: true
      },
      {
        id: 'w4', icon: 'icons/w4.svg', name: '배터리 충전 경고',
        severity: 'danger', color: '#ef4444',
        description: '배터리 충전 시스템(발전기)에 이상이 있습니다.',
        action: '불필요한 전기장치를 끄고 가까운 정비소로 이동하세요. 방치하면 시동이 꺼질 수 있습니다.',
        needsRepair: true
      },
      {
        id: 'w5', icon: 'icons/w5.svg', name: '브레이크 경고등',
        severity: 'danger', color: '#ef4444',
        description: '브레이크 시스템 이상 또는 브레이크액 부족입니다.',
        action: '주차 브레이크가 해제되었는지 먼저 확인하세요. 해제 상태인데도 켜져 있으면 즉시 정비소로 가세요.',
        needsRepair: true
      },
      {
        id: 'w6', icon: 'icons/w6.svg', name: '에어백 경고등',
        severity: 'danger', color: '#ef4444',
        description: '에어백 시스템에 문제가 감지되었습니다.',
        action: '사고 시 에어백이 정상 작동하지 않을 수 있습니다. 빠른 시일 내 정비소 점검이 필요합니다.',
        needsRepair: true
      },
      {
        id: 'w7', icon: 'icons/w7.svg', name: 'ABS 경고등',
        severity: 'warning', color: '#fbbf24',
        description: '잠김방지 브레이크 시스템(ABS)에 이상이 있습니다.',
        action: '일반 브레이크는 작동하지만 ABS가 비활성화됩니다. 급제동 시 바퀴 잠김이 발생할 수 있으니 정비소 방문을 권장합니다.',
        needsRepair: true
      },
      {
        id: 'w8', icon: 'icons/w8.svg', name: 'ESC/VDC 경고등',
        severity: 'warning', color: '#fbbf24',
        description: '차체 자세 제어장치에 이상이 있습니다.',
        action: '미끄러운 도로에서 차량 제어력이 떨어질 수 있습니다. 가급적 빨리 정비소를 방문하세요.',
        needsRepair: true
      },
      {
        id: 'w9', icon: 'icons/w9.svg', name: '타이어 공기압 경고 (TPMS)',
        severity: 'warning', color: '#fbbf24',
        description: '하나 이상의 타이어 공기압이 기준 이하입니다.',
        action: '가까운 주유소나 타이어샵에서 공기압을 점검/보충하세요. 펑크 여부도 확인이 필요합니다.',
        needsRepair: false
      },
      {
        id: 'w10', icon: 'icons/w10.svg', name: '연료 부족 경고',
        severity: 'warning', color: '#fbbf24',
        description: '연료가 거의 소진되었습니다 (보통 잔여 50~80km 주행 가능).',
        action: '가까운 주유소에서 주유하세요. 연료가 완전히 바닥나면 연료펌프 손상 위험이 있습니다.',
        needsRepair: false
      },
      {
        id: 'w11', icon: 'icons/w11.svg', name: '전조등/미등 경고',
        severity: 'warning', color: '#fbbf24',
        description: '외부 조명 중 하나 이상이 고장났습니다.',
        action: '야간 운전 전 반드시 수리하세요. 전구 교체로 간단히 해결되는 경우가 많습니다.',
        needsRepair: true
      },
      {
        id: 'w12', icon: 'icons/w12.svg', name: '도어 열림 경고',
        severity: 'warning', color: '#fbbf24',
        description: '문이 완전히 닫히지 않았습니다.',
        action: '모든 문(트렁크 포함)을 다시 확인하고 확실히 닫아주세요.',
        needsRepair: false
      },
      {
        id: 'w13', icon: 'icons/w13.svg', name: '워셔액 부족 경고',
        severity: 'info', color: '#60a5fa',
        description: '앞유리 워셔액이 부족합니다.',
        action: '워셔액을 보충하세요. 마트나 주유소에서 쉽게 구매 가능합니다.',
        needsRepair: false
      },
      {
        id: 'w14', icon: 'icons/w14.svg', name: '이모빌라이저 경고',
        severity: 'warning', color: '#fbbf24',
        description: '스마트키 인식 불량 또는 배터리 부족입니다.',
        action: '스마트키를 시동 버튼에 직접 대고 시동을 걸어보세요. 키 배터리(CR2032 등) 교체가 필요할 수 있습니다.',
        needsRepair: false
      },
      {
        id: 'w15', icon: 'icons/w15.svg', name: '안전벨트 미착용 경고',
        severity: 'warning', color: '#fbbf24',
        description: '운전자 또는 동승자가 안전벨트를 착용하지 않았습니다.',
        action: '모든 탑승자가 안전벨트를 착용해주세요. 미착용 시 범칙금 부과 대상입니다.',
        needsRepair: false
      },
      {
        id: 'w16', icon: 'icons/w16.svg', name: '주차 브레이크 경고',
        severity: 'info', color: '#60a5fa',
        description: '주차 브레이크(사이드 브레이크)가 작동 중입니다.',
        action: '출발 전 주차 브레이크를 완전히 해제하세요. 해제 후에도 경고등이 꺼지지 않으면 브레이크 시스템 점검이 필요합니다.',
        needsRepair: false
      },
      {
        id: 'w17', icon: 'icons/w17.svg', name: 'DPF (매연 필터) 경고',
        severity: 'warning', color: '#fbbf24',
        description: '디젤 차량의 매연 필터가 막혀가고 있습니다.',
        action: '고속도로에서 30분 이상 주행하면 자동 재생됩니다. 반복되면 정비소 방문이 필요합니다.',
        needsRepair: false
      },
      {
        id: 'w18', icon: 'icons/w18.svg', name: 'EV 배터리 경고',
        severity: 'warning', color: '#fbbf24',
        description: '전기차 고전압 배터리 시스템에 이상이 감지되었습니다.',
        action: '안전한 곳에 정차하고 차량을 끈 뒤 서비스센터에 연락하세요. 고전압 부품을 직접 만지지 마세요.',
        needsRepair: true
      },
      {
        id: 'w19', icon: 'icons/w19.svg', name: '변속기(AT) 경고',
        severity: 'danger', color: '#ef4444',
        description: '자동변속기 오일 온도 과열 또는 시스템 이상입니다.',
        action: '즉시 안전한 곳에 정차하고 엔진을 끄세요. 변속기 오일이 식은 후 정비소로 이동합니다.',
        needsRepair: true
      },
      {
        id: 'w20', icon: 'icons/w20.svg', name: '조향장치(MDPS) 경고',
        severity: 'danger', color: '#ef4444',
        description: '전동 파워스티어링 시스템에 이상이 있습니다.',
        action: '핸들이 무거워질 수 있습니다. 저속으로 가까운 정비소에 방문하세요. 고속 주행은 위험합니다.',
        needsRepair: true
      }
    ]
  }
};

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
        if (isAdmin) showAdminButtons();
      }).catch(function() {});
    }
    loadGuideData();
  });
} catch(e) {
  console.log('Firebase 미연결 — 기본 데이터 사용');
  guideData = JSON.parse(JSON.stringify(DEFAULT_DATA));
  renderAll();
}

/* ===== 데이터 로드 ===== */
async function loadGuideData() {
  if (!db) {
    guideData = JSON.parse(JSON.stringify(DEFAULT_DATA));
    renderAll();
    return;
  }
  try {
    var docs = ['drive_checklist', 'beginner_guide', 'warning_lights'];
    for (var i = 0; i < docs.length; i++) {
      var snap = await db.collection('guide_data').doc(docs[i]).get();
      if (snap.exists) {
        guideData[docs[i]] = snap.data();
      } else {
        guideData[docs[i]] = DEFAULT_DATA[docs[i]];
        await db.collection('guide_data').doc(docs[i]).set(DEFAULT_DATA[docs[i]]);
      }
    }
  } catch(e) {
    console.log('Firestore 로드 실패, 기본 데이터 사용');
    guideData = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  renderAll();
}

function showAdminButtons() {
  document.querySelectorAll('.admin-edit-btn').forEach(function(b) { b.style.display = ''; });
}

function renderAll() {
  renderChecklistFilter();
  renderChecklist();
  renderBeginnerFilter();
  renderBeginner();
  renderWarningFilter();
  renderWarning();
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

/* ===== 탭 전환 ===== */
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ===== 체크리스트 ===== */
function getCheckedItems() {
  try { return JSON.parse(localStorage.getItem('dt-checklist') || '{}'); } catch(e) { return {}; }
}
function saveCheckedItems(obj) {
  localStorage.setItem('dt-checklist', JSON.stringify(obj));
}

function renderChecklistFilter() {
  var data = guideData.drive_checklist || DEFAULT_DATA.drive_checklist;
  var cats = ['all'].concat(data.categories || []);
  var html = cats.map(function(c) {
    var label = c === 'all' ? '전체' : c;
    var active = c === currentChecklistFilter ? ' active' : '';
    return '<button class="filter-btn' + active + '" onclick="setChecklistFilter(\'' + c + '\')">' + label + '</button>';
  }).join('');
  document.getElementById('checklistFilter').innerHTML = html;
}

function setChecklistFilter(cat) {
  currentChecklistFilter = cat;
  renderChecklistFilter();
  renderChecklist();
}

function renderChecklist() {
  var data = guideData.drive_checklist || DEFAULT_DATA.drive_checklist;
  var items = data.items || [];
  var checked = getCheckedItems();

  if (currentChecklistFilter !== 'all') {
    items = items.filter(function(it) { return it.category === currentChecklistFilter; });
  }

  var totalAll = (guideData.drive_checklist || DEFAULT_DATA.drive_checklist).items.length;
  var checkedCount = Object.keys(checked).filter(function(k) { return checked[k]; }).length;

  document.getElementById('progressText').textContent = checkedCount + ' / ' + totalAll;
  var pct = totalAll > 0 ? Math.round((checkedCount / totalAll) * 100) : 0;
  document.getElementById('progressFill').style.width = pct + '%';

  var grouped = {};
  items.forEach(function(it) {
    if (!grouped[it.category]) grouped[it.category] = [];
    grouped[it.category].push(it);
  });

  var html = '';
  var cats = currentChecklistFilter === 'all' ? (data.categories || []) : [currentChecklistFilter];
  cats.forEach(function(cat) {
    var catItems = grouped[cat] || [];
    if (catItems.length === 0) return;
    html += '<div class="checklist-category">' + cat + '</div>';
    catItems.forEach(function(it) {
      var isChecked = checked[it.id];
      html += '<div class="checklist-item' + (isChecked ? ' checked' : '') + '" onclick="toggleCheck(\'' + it.id + '\')">' +
        '<span class="check-icon">' + (isChecked ? '✓' : '') + '</span>' +
        '<span class="check-text">' + it.text + '</span>' +
        '</div>';
    });
  });

  document.getElementById('checklistList').innerHTML = html || '<div class="no-result">항목이 없습니다</div>';
}

function toggleCheck(id) {
  var checked = getCheckedItems();
  checked[id] = !checked[id];
  if (!checked[id]) delete checked[id];
  saveCheckedItems(checked);
  renderChecklist();
}

function resetChecklist() {
  if (!confirm('체크리스트를 초기화할까요?')) return;
  localStorage.removeItem('dt-checklist');
  renderChecklist();
}

/* ===== 초보 가이드 ===== */
function renderBeginnerFilter() {
  var data = guideData.beginner_guide || DEFAULT_DATA.beginner_guide;
  var cats = ['all'].concat(data.categories || []);
  var html = cats.map(function(c) {
    var label = c === 'all' ? '전체' : c;
    var active = c === currentBeginnerFilter ? ' active' : '';
    return '<button class="filter-btn' + active + '" onclick="setBeginnerFilter(\'' + c + '\')">' + label + '</button>';
  }).join('');
  document.getElementById('beginnerFilter').innerHTML = html;
}

function setBeginnerFilter(cat) {
  currentBeginnerFilter = cat;
  renderBeginnerFilter();
  renderBeginner();
}

function renderBeginner() {
  var data = guideData.beginner_guide || DEFAULT_DATA.beginner_guide;
  var items = data.items || [];
  var search = (document.getElementById('beginnerSearch')?.value || '').toLowerCase();

  if (currentBeginnerFilter !== 'all') {
    items = items.filter(function(it) { return it.category === currentBeginnerFilter; });
  }
  if (search) {
    items = items.filter(function(it) {
      return it.title.toLowerCase().includes(search) ||
        it.category.toLowerCase().includes(search) ||
        (it.content || []).join(' ').toLowerCase().includes(search);
    });
  }

  var html = items.map(function(it) {
    var contentHtml = '<ul>' + (it.content || []).map(function(c) { return '<li>' + c + '</li>'; }).join('') + '</ul>';
    return '<div class="guide-card" onclick="toggleGuide(this)">' +
      '<div class="guide-header">' +
      '<div class="guide-header-left">' +
      '<span class="guide-emoji">' + (it.emoji || '📖') + '</span>' +
      '<span class="guide-title">' + it.title + '</span>' +
      '</div>' +
      '<span class="guide-arrow">▼</span>' +
      '</div>' +
      '<div class="guide-body"><div class="guide-body-inner">' + contentHtml + '</div></div>' +
      '</div>';
  }).join('');

  document.getElementById('beginnerList').innerHTML = html || '<div class="no-result">검색 결과가 없습니다</div>';
}

function toggleGuide(el) {
  el.classList.toggle('open');
}

function filterBeginner() {
  renderBeginner();
}

/* ===== 경고등 가이드 ===== */
function renderWarningFilter() {
  var filters = [
    { val: 'all', label: '전체' },
    { val: 'danger', label: '🔴 긴급' },
    { val: 'warning', label: '🟡 주의' },
    { val: 'info', label: '🔵 정보' }
  ];
  var html = filters.map(function(f) {
    var active = f.val === currentWarningFilter ? ' active' : '';
    return '<button class="filter-btn' + active + '" onclick="setWarningFilter(\'' + f.val + '\')">' + f.label + '</button>';
  }).join('');
  document.getElementById('warningFilter').innerHTML = html;
}

function setWarningFilter(val) {
  currentWarningFilter = val;
  renderWarningFilter();
  renderWarning();
}

function renderWarning() {
  var data = guideData.warning_lights || DEFAULT_DATA.warning_lights;
  var items = data.items || [];
  var search = (document.getElementById('warningSearch')?.value || '').toLowerCase();

  if (currentWarningFilter !== 'all') {
    items = items.filter(function(it) { return it.severity === currentWarningFilter; });
  }
  if (search) {
    items = items.filter(function(it) {
      return it.name.toLowerCase().includes(search) || it.description.toLowerCase().includes(search);
    });
  }

  var html = items.map(function(it) {
    var sevClass = 'severity-' + it.severity;
    var sevLabel = (data.severity_labels || {})[it.severity] || it.severity;
    return '<div class="warning-card" onclick="openWarningDetail(\'' + it.id + '\')">' +
      '<span class="warning-icon"><img src="' + it.icon + '" alt="' + it.name + '" onerror="this.outerHTML=\'⚠️\'"></span>' +
      '<div class="warning-name">' + it.name + '</div>' +
      '<span class="warning-severity ' + sevClass + '">' + sevLabel + '</span>' +
      '</div>';
  }).join('');

  document.getElementById('warningList').innerHTML = html || '<div class="no-result">검색 결과가 없습니다</div>';
}

function filterWarning() {
  renderWarning();
}

function openWarningDetail(id) {
  var data = guideData.warning_lights || DEFAULT_DATA.warning_lights;
  var item = (data.items || []).find(function(it) { return it.id === id; });
  if (!item) return;

  var sevClass = 'severity-' + item.severity;
  var sevLabel = (data.severity_labels || {})[item.severity] || item.severity;

  document.getElementById('warningModalContent').innerHTML =
    '<div class="warning-detail-icon"><img src="' + item.icon + '" alt="' + item.name + '" onerror="this.outerHTML=\'⚠️\'"></div>' +
    '<div class="warning-detail-name">' + item.name + '</div>' +
    '<div class="warning-detail-severity"><span class="warning-severity ' + sevClass + '">' + sevLabel + (item.needsRepair ? ' · 정비 필요' : '') + '</span></div>' +
    '<div class="warning-detail-section"><div class="warning-detail-label">설명</div><div class="warning-detail-text">' + item.description + '</div></div>' +
    '<div class="warning-detail-section"><div class="warning-detail-label">대처 방법</div><div class="warning-detail-text">' + item.action + '</div></div>';

  document.getElementById('warningModal').style.display = 'flex';
}

function closeWarningModal() {
  document.getElementById('warningModal').style.display = 'none';
}

/* ===== 관리자 모달 ===== */
function openAdminModal(docId) {
  editingDocId = docId;
  var data = guideData[docId] || DEFAULT_DATA[docId];
  document.getElementById('adminModalTitle').textContent = docId + ' 데이터 수정';
  document.getElementById('adminModalData').value = JSON.stringify(data, null, 2);
  document.getElementById('adminModal').style.display = 'flex';
}

function closeAdminModal() {
  document.getElementById('adminModal').style.display = 'none';
  editingDocId = null;
}

async function saveAdminData() {
  if (!editingDocId || !db || !isAdmin) return;
  try {
    var raw = document.getElementById('adminModalData').value;
    var parsed = JSON.parse(raw);
    await db.collection('guide_data').doc(editingDocId).set(parsed);
    guideData[editingDocId] = parsed;
    closeAdminModal();
    renderAll();
    alert('저장 완료!');
  } catch(e) {
    alert('JSON 형식 오류: ' + e.message);
  }
}
