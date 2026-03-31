/* ===== 운전 계산기 - DT Club ===== */

var db = null, currentUser = null, isAdmin = false;
var toolData = {};
var editingDocId = null;

/* ===== 기본 데이터 (Firestore 로드 실패 시 폴백) ===== */
var DEFAULT_DATA = {
  speed_fine: {
    general: [
      { over: 20, fine: 30000, point: 15, label: '20km/h 이하' },
      { over: 40, fine: 60000, point: 30, label: '20~40km/h' },
      { over: 60, fine: 90000, point: 60, label: '40~60km/h' },
      { over: 999, fine: 120000, point: 120, label: '60km/h 초과' }
    ],
    highway: [
      { over: 20, fine: 30000, point: 0, label: '20km/h 이하' },
      { over: 40, fine: 60000, point: 15, label: '20~40km/h' },
      { over: 60, fine: 90000, point: 60, label: '40~60km/h' },
      { over: 999, fine: 120000, point: 120, label: '60km/h 초과' }
    ],
    school_multiplier: 2,
    suspension_point: 40,
    revoke_point: 121,
    note: '도로교통법 기준. 어린이보호구역은 일반도로 기준 2배 가중.'
  },
  car_tax: {
    passenger: [
      { maxCC: 1000, rate: 80, label: '1,000cc 이하' },
      { maxCC: 1600, rate: 140, label: '1,600cc 이하' },
      { maxCC: 99999, rate: 200, label: '1,600cc 초과' }
    ],
    electric: 100000,
    van: 65000,
    truck: 28500,
    education_tax_rate: 0.3,
    age_discount: [
      { year: 3, rate: 0.05 },
      { year: 4, rate: 0.10 },
      { year: 5, rate: 0.15 },
      { year: 6, rate: 0.20 },
      { year: 7, rate: 0.25 },
      { year: 8, rate: 0.30 },
      { year: 9, rate: 0.35 },
      { year: 10, rate: 0.40 },
      { year: 11, rate: 0.45 },
      { year: 12, rate: 0.50 }
    ],
    note: '지방세법 기준. 비영업 승용차 기준이며, 실제 세액은 지자체에 따라 다를 수 있습니다.'
  },
  insurance: {
    base: { small: 450000, mid: 600000, large: 800000, suv: 700000 },
    age_factor: [
      { min: 18, max: 25, factor: 1.8, label: '18~25세' },
      { min: 26, max: 30, factor: 1.3, label: '26~30세' },
      { min: 31, max: 40, factor: 1.0, label: '31~40세' },
      { min: 41, max: 50, factor: 0.95, label: '41~50세' },
      { min: 51, max: 60, factor: 1.0, label: '51~60세' },
      { min: 61, max: 99, factor: 1.2, label: '61세 이상' }
    ],
    gender_factor: { male: 1.05, female: 0.95 },
    exp_factor: [
      { val: 0, factor: 1.5, label: '1년 미만' },
      { val: 1, factor: 1.2, label: '1~3년' },
      { val: 3, factor: 1.05, label: '3~5년' },
      { val: 5, factor: 1.0, label: '5~10년' },
      { val: 10, factor: 0.9, label: '10년 이상' }
    ],
    accident_factor: [
      { val: 0, factor: 0.9, label: '무사고' },
      { val: 1, factor: 1.1, label: '1회' },
      { val: 2, factor: 1.3, label: '2회' },
      { val: 3, factor: 1.6, label: '3회 이상' }
    ],
    note: '참고용 추정치입니다. 실제 보험료는 보험사, 차량 모델, 특약 등에 따라 크게 달라질 수 있습니다. 정확한 보험료는 보험사에 문의하세요.'
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
    loadToolData();
  });
} catch(e) {
  console.log('Firebase 미연결 — 기본 데이터 사용');
  toolData = JSON.parse(JSON.stringify(DEFAULT_DATA));
}

/* ===== 데이터 로드 ===== */
async function loadToolData() {
  if (!db) {
    toolData = JSON.parse(JSON.stringify(DEFAULT_DATA));
    return;
  }
  try {
    var docs = ['speed_fine', 'car_tax', 'insurance'];
    for (var i = 0; i < docs.length; i++) {
      var snap = await db.collection('tool_data').doc(docs[i]).get();
      if (snap.exists) {
        toolData[docs[i]] = snap.data();
      } else {
        toolData[docs[i]] = DEFAULT_DATA[docs[i]];
        // 초기 데이터 Firestore에 저장
        await db.collection('tool_data').doc(docs[i]).set(DEFAULT_DATA[docs[i]]);
      }
    }
  } catch(e) {
    console.log('Firestore 로드 실패, 기본 데이터 사용');
    toolData = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function showAdminButtons() {
  var btns = document.querySelectorAll('.admin-edit-btn');
  btns.forEach(function(b) { b.style.display = ''; });
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

/* ===== 라디오 버튼 ===== */
document.querySelectorAll('.radio-group').forEach(function(group) {
  group.addEventListener('click', function(e) {
    var btn = e.target.closest('.radio-btn');
    if (!btn) return;
    group.querySelectorAll('.radio-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    // 전기차 선택 시 배기량 숨기기
    if (group.id === 'carType') {
      var ccGroup = document.getElementById('ccGroup');
      ccGroup.style.display = btn.dataset.value === 'electric' ? 'none' : '';
    }
  });
});

/* ===== 셀렉트 초기화 ===== */
(function() {
  // 등록연도
  var regSel = document.getElementById('regYear');
  var thisYear = new Date().getFullYear();
  for (var y = thisYear; y >= thisYear - 25; y--) {
    var opt = document.createElement('option');
    opt.value = y; opt.textContent = y + '년';
    if (y === thisYear - 3) opt.selected = true;
    regSel.appendChild(opt);
  }
  // 출생연도
  var birthSel = document.getElementById('birthYear');
  for (var y = thisYear - 18; y >= thisYear - 80; y--) {
    var opt = document.createElement('option');
    opt.value = y; opt.textContent = y + '년';
    if (y === thisYear - 30) opt.selected = true;
    birthSel.appendChild(opt);
  }
})();

/* ===== 과속벌금 계산 ===== */
function calcSpeedFine() {
  var data = toolData.speed_fine || DEFAULT_DATA.speed_fine;
  var roadActive = document.querySelector('#roadType .radio-btn.active');
  var roadType = roadActive ? roadActive.dataset.value : 'general';
  var limit = parseInt(document.getElementById('speedLimit').value);
  var actual = parseInt(document.getElementById('actualSpeed').value);

  if (!actual || actual <= 0) {
    showResult('speedResult', '<div class="result-card"><p style="color:var(--accent);font-weight:700;text-align:center">주행속도를 입력해주세요.</p></div>');
    return;
  }

  var excess = actual - limit;
  if (excess <= 0) {
    showResult('speedResult',
      '<div class="result-card">' +
      '<div class="result-highlight"><span class="big-num" style="color:var(--success)">안전 운전 👍</span>' +
      '<span class="big-label">제한속도 이내입니다</span></div></div>'
    );
    return;
  }

  var isSchool = roadType === 'school';
  var table = isSchool ? data.general : data[roadType] || data.general;
  var fine = 0, point = 0, rangeLabel = '';

  for (var i = 0; i < table.length; i++) {
    if (excess <= table[i].over) {
      fine = table[i].fine;
      point = table[i].point;
      rangeLabel = table[i].label;
      break;
    }
    if (i === table.length - 1) {
      fine = table[i].fine;
      point = table[i].point;
      rangeLabel = table[i].label;
    }
  }

  if (isSchool) {
    fine *= (data.school_multiplier || 2);
    point = Math.min(point * 2, 120);
  }

  var suspensionWarning = '';
  if (point >= (data.revoke_point || 121)) {
    suspensionWarning = '<div class="result-row"><span class="result-label">⚠️ 면허 취소</span><span class="result-value danger">면허취소 기준 초과</span></div>';
  } else if (point >= (data.suspension_point || 40)) {
    suspensionWarning = '<div class="result-row"><span class="result-label">⚠️ 면허 정지</span><span class="result-value warning">면허정지 대상 (1회 기준 ' + point + '점 이상)</span></div>';
  }

  var roadLabel = roadType === 'general' ? '일반도로' : roadType === 'highway' ? '고속도로' : '어린이보호구역';

  showResult('speedResult',
    '<div class="result-card">' +
    '<div class="result-title">📋 계산 결과</div>' +
    '<div class="result-row"><span class="result-label">도로 유형</span><span class="result-value">' + roadLabel + '</span></div>' +
    '<div class="result-row"><span class="result-label">속도 초과</span><span class="result-value danger">' + excess + 'km/h 초과 (' + rangeLabel + ')</span></div>' +
    '<div class="result-row"><span class="result-label">벌점</span><span class="result-value warning">' + point + '점</span></div>' +
    suspensionWarning +
    '<div class="result-highlight"><span class="big-num">' + formatMoney(fine) + '원</span><span class="big-label">예상 범칙금</span></div>' +
    '<p class="result-notice">※ ' + (data.note || '') + '</p>' +
    '</div>'
  );
}

/* ===== 자동차세 계산 ===== */
function calcCarTax() {
  var data = toolData.car_tax || DEFAULT_DATA.car_tax;
  var carActive = document.querySelector('#carType .radio-btn.active');
  var carType = carActive ? carActive.dataset.value : 'passenger';
  var cc = parseInt(document.getElementById('engineCC').value) || 0;
  var regYear = parseInt(document.getElementById('regYear').value);
  var thisYear = new Date().getFullYear();
  var age = thisYear - regYear;

  var baseTax = 0, taxLabel = '';

  if (carType === 'electric') {
    baseTax = data.electric || 100000;
    taxLabel = '전기차 정액';
  } else if (carType === 'van') {
    baseTax = data.van || 65000;
    taxLabel = '승합차 정액';
  } else if (carType === 'truck') {
    baseTax = data.truck || 28500;
    taxLabel = '화물차 정액';
  } else {
    if (cc <= 0) {
      showResult('taxResult', '<div class="result-card"><p style="color:var(--accent);font-weight:700;text-align:center">배기량을 입력해주세요.</p></div>');
      return;
    }
    var rates = data.passenger || DEFAULT_DATA.car_tax.passenger;
    for (var i = 0; i < rates.length; i++) {
      if (cc <= rates[i].maxCC) {
        baseTax = cc * rates[i].rate;
        taxLabel = rates[i].label + ' (cc당 ' + rates[i].rate + '원)';
        break;
      }
    }
  }

  // 교육세 (승용차만)
  var eduTax = 0;
  if (carType === 'passenger') {
    eduTax = Math.round(baseTax * (data.education_tax_rate || 0.3));
  }

  // 경감률
  var discountRate = 0;
  var discounts = data.age_discount || DEFAULT_DATA.car_tax.age_discount;
  for (var i = discounts.length - 1; i >= 0; i--) {
    if (age >= discounts[i].year) {
      discountRate = discounts[i].rate;
      break;
    }
  }

  var totalBeforeDiscount = baseTax + eduTax;
  var discountAmount = Math.round(totalBeforeDiscount * discountRate);
  var totalTax = totalBeforeDiscount - discountAmount;

  showResult('taxResult',
    '<div class="result-card">' +
    '<div class="result-title">📋 계산 결과</div>' +
    '<div class="result-row"><span class="result-label">기본 세액</span><span class="result-value">' + formatMoney(baseTax) + '원</span></div>' +
    '<div class="result-row"><span class="result-label">산출 근거</span><span class="result-value info" style="font-size:.8rem">' + taxLabel + '</span></div>' +
    (eduTax > 0 ? '<div class="result-row"><span class="result-label">교육세 (30%)</span><span class="result-value">' + formatMoney(eduTax) + '원</span></div>' : '') +
    (discountRate > 0 ? '<div class="result-row"><span class="result-label">경감 (' + age + '년, ' + Math.round(discountRate * 100) + '%)</span><span class="result-value success">-' + formatMoney(discountAmount) + '원</span></div>' : '') +
    '<div class="result-highlight"><span class="big-num">' + formatMoney(totalTax) + '원</span><span class="big-label">연간 자동차세 (예상)</span></div>' +
    '<p class="result-notice">※ ' + (data.note || '') + '</p>' +
    '</div>'
  );
}

/* ===== 보험료 계산 ===== */
function calcInsurance() {
  var data = toolData.insurance || DEFAULT_DATA.insurance;
  var birthYear = parseInt(document.getElementById('birthYear').value);
  var genderActive = document.querySelector('#gender .radio-btn.active');
  var gender = genderActive ? genderActive.dataset.value : 'male';
  var carActive = document.querySelector('#insCarType .radio-btn.active');
  var carType = carActive ? carActive.dataset.value : 'mid';
  var exp = parseInt(document.getElementById('drivingExp').value);
  var accident = parseInt(document.getElementById('accident').value);
  var thisYear = new Date().getFullYear();
  var age = thisYear - birthYear;

  var base = (data.base || DEFAULT_DATA.insurance.base)[carType] || 600000;

  // 연령 계수
  var ageFactor = 1.0;
  var ageFactors = data.age_factor || DEFAULT_DATA.insurance.age_factor;
  for (var i = 0; i < ageFactors.length; i++) {
    if (age >= ageFactors[i].min && age <= ageFactors[i].max) {
      ageFactor = ageFactors[i].factor;
      break;
    }
  }

  // 성별 계수
  var genderFactor = (data.gender_factor || DEFAULT_DATA.insurance.gender_factor)[gender] || 1.0;

  // 경력 계수
  var expFactor = 1.0;
  var expFactors = data.exp_factor || DEFAULT_DATA.insurance.exp_factor;
  for (var i = expFactors.length - 1; i >= 0; i--) {
    if (exp >= expFactors[i].val) {
      expFactor = expFactors[i].factor;
      break;
    }
  }

  // 사고 계수
  var accFactor = 1.0;
  var accFactors = data.accident_factor || DEFAULT_DATA.insurance.accident_factor;
  for (var i = accFactors.length - 1; i >= 0; i--) {
    if (accident >= accFactors[i].val) {
      accFactor = accFactors[i].factor;
      break;
    }
  }

  var estimated = Math.round(base * ageFactor * genderFactor * expFactor * accFactor);
  var low = Math.round(estimated * 0.85);
  var high = Math.round(estimated * 1.15);

  var carLabel = { small: '소형', mid: '중형', large: '대형', suv: 'SUV' }[carType] || carType;

  showResult('insuranceResult',
    '<div class="result-card">' +
    '<div class="result-title">📋 조회 결과</div>' +
    '<div class="result-row"><span class="result-label">나이</span><span class="result-value">' + age + '세 (×' + ageFactor + ')</span></div>' +
    '<div class="result-row"><span class="result-label">차종</span><span class="result-value">' + carLabel + '</span></div>' +
    '<div class="result-row"><span class="result-label">운전경력</span><span class="result-value">×' + expFactor + '</span></div>' +
    '<div class="result-row"><span class="result-label">사고이력</span><span class="result-value">×' + accFactor + '</span></div>' +
    '<div class="result-highlight"><span class="big-num">' + formatMoney(low) + ' ~ ' + formatMoney(high) + '원</span><span class="big-label">예상 연간 보험료 범위</span></div>' +
    '<p class="result-notice">※ ' + (data.note || '') + '</p>' +
    '</div>'
  );
}

/* ===== 관리자 모달 ===== */
function openAdminModal(docId) {
  editingDocId = docId;
  var data = toolData[docId] || DEFAULT_DATA[docId];
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
    await db.collection('tool_data').doc(editingDocId).set(parsed);
    toolData[editingDocId] = parsed;
    closeAdminModal();
    alert('저장 완료!');
  } catch(e) {
    alert('JSON 형식 오류: ' + e.message);
  }
}

/* ===== 유지비 계산기 ===== */

// 유종 전환 시 UI 변경
(function() {
  var fuelGroup = document.getElementById('fuelType');
  if (!fuelGroup) return;
  fuelGroup.addEventListener('click', function(e) {
    var btn = e.target.closest('.radio-btn');
    if (!btn) return;
    var val = btn.dataset.value;
    var isElec = val === 'electric';
    document.getElementById('fuelPriceGroup').style.display = isElec ? 'none' : '';
    document.getElementById('elecPriceGroup').style.display = isElec ? '' : 'none';
    document.getElementById('efficiencyLabel').textContent = isElec ? '전비 (km/kWh)' : '연비 (km/L)';
    document.getElementById('fuelEfficiency').placeholder = isElec ? '예: 5.5' : '예: 12';

    var hints = { gasoline: '전국 평균 참고: 휘발유 ~1,650원', diesel: '전국 평균 참고: 경유 ~1,500원', lpg: '전국 평균 참고: LPG ~1,050원' };
    var hint = document.getElementById('fuelPriceHint');
    if (hint) hint.textContent = hints[val] || '';
  });
})();

function calcMaintain() {
  var fuelActive = document.querySelector('#fuelType .radio-btn.active');
  var fuelType = fuelActive ? fuelActive.dataset.value : 'gasoline';
  var isElec = fuelType === 'electric';

  var efficiency = parseFloat(document.getElementById('fuelEfficiency').value) || 0;
  var monthlyKm = parseInt(document.getElementById('monthlyKm').value) || 0;
  var insuranceYear = parseInt(document.getElementById('insuranceCost').value) || 0;
  var taxYear = parseInt(document.getElementById('taxCost').value) || 0;
  var etcMonth = parseInt(document.getElementById('etcCost').value) || 0;

  if (efficiency <= 0) {
    showResult('maintainResult', '<div class="result-card"><p style="color:var(--accent);font-weight:700;text-align:center">' + (isElec ? '전비' : '연비') + '를 입력해주세요.</p></div>');
    return;
  }

  var unitPrice = 0;
  var fuelLabel = '';
  if (isElec) {
    unitPrice = parseFloat(document.getElementById('elecPrice').value) || 350;
    fuelLabel = '전기 (' + unitPrice + '원/kWh)';
  } else {
    unitPrice = parseFloat(document.getElementById('fuelPrice').value) || 0;
    if (unitPrice <= 0) {
      showResult('maintainResult', '<div class="result-card"><p style="color:var(--accent);font-weight:700;text-align:center">유류 단가를 입력해주세요.</p></div>');
      return;
    }
    var labels = { gasoline: '휘발유', diesel: '경유', lpg: 'LPG' };
    fuelLabel = (labels[fuelType] || fuelType) + ' (' + formatMoney(unitPrice) + '원/L)';
  }

  // 월 연료비 계산
  var monthlyConsumption = monthlyKm / efficiency; // L or kWh
  var monthlyFuelCost = Math.round(monthlyConsumption * unitPrice);

  // 월 보험료, 세금
  var monthlyInsurance = Math.round(insuranceYear / 12);
  var monthlyTax = Math.round(taxYear / 12);

  // 월 합계
  var monthlyTotal = monthlyFuelCost + monthlyInsurance + monthlyTax + etcMonth;
  var yearlyTotal = monthlyTotal * 12;

  // km당 비용
  var costPerKm = monthlyKm > 0 ? Math.round(monthlyTotal / monthlyKm) : 0;

  var consumptionUnit = isElec ? 'kWh' : 'L';
  var effLabel = isElec ? '전비' : '연비';

  showResult('maintainResult',
    '<div class="result-card">' +
    '<div class="result-title">📋 계산 결과</div>' +
    '<div class="result-row"><span class="result-label">유종</span><span class="result-value">' + fuelLabel + '</span></div>' +
    '<div class="result-row"><span class="result-label">' + effLabel + '</span><span class="result-value">' + efficiency + ' km/' + consumptionUnit + '</span></div>' +
    '<div class="result-row"><span class="result-label">월 주행거리</span><span class="result-value">' + formatMoney(monthlyKm) + ' km</span></div>' +
    '<div class="result-row"><span class="result-label">월 소모량</span><span class="result-value">' + monthlyConsumption.toFixed(1) + ' ' + consumptionUnit + '</span></div>' +
    '<div class="result-row" style="border-top:2px solid var(--border);padding-top:12px;margin-top:4px"><span class="result-label">⛽ 월 연료비</span><span class="result-value warning">' + formatMoney(monthlyFuelCost) + '원</span></div>' +
    (monthlyInsurance > 0 ? '<div class="result-row"><span class="result-label">🛡️ 월 보험료</span><span class="result-value">' + formatMoney(monthlyInsurance) + '원</span></div>' : '') +
    (monthlyTax > 0 ? '<div class="result-row"><span class="result-label">💰 월 자동차세</span><span class="result-value">' + formatMoney(monthlyTax) + '원</span></div>' : '') +
    (etcMonth > 0 ? '<div class="result-row"><span class="result-label">📦 월 기타 비용</span><span class="result-value">' + formatMoney(etcMonth) + '원</span></div>' : '') +
    '<div class="result-highlight"><span class="big-num">' + formatMoney(monthlyTotal) + '원 / 월</span><span class="big-label">월 유지비 합계</span></div>' +
    '<div class="result-row" style="margin-top:12px"><span class="result-label">연간 유지비</span><span class="result-value info">' + formatMoney(yearlyTotal) + '원</span></div>' +
    '<div class="result-row"><span class="result-label">km당 비용</span><span class="result-value info">' + formatMoney(costPerKm) + '원/km</span></div>' +
    '<p class="result-notice">※ 유류비는 입력한 단가 기준이며 실제 가격은 변동됩니다. 정비비(엔진오일, 타이어 등)는 포함되지 않았습니다.</p>' +
    '</div>'
  );
}

/* ===== 유틸 ===== */
function formatMoney(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function showResult(id, html) {
  document.getElementById(id).innerHTML = html;
}
