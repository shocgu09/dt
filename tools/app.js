/* ===== 유지비 계산 - DT Club ===== */

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

/* ===== 라디오 버튼 ===== */
document.querySelectorAll('.radio-group').forEach(function(group) {
  group.addEventListener('click', function(e) {
    var btn = e.target.closest('.radio-btn');
    if (!btn) return;
    group.querySelectorAll('.radio-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  });
});

/* ===== 유지비 계산기 ===== */

var avgFuelPrices = { gasoline: 0, premium: 0, diesel: 0, lpg: 0 };

// 오피넷 전국 평균 유가 로드
(function() {
  fetch('https://dt-opinet.shocguna.workers.dev/api/avg')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var oils = data.RESULT && data.RESULT.OIL;
      if (!oils) return;
      oils.forEach(function(o) {
        var price = Math.round(parseFloat(o.PRICE));
        if (o.PRODCD === 'B027') avgFuelPrices.gasoline = price;
        else if (o.PRODCD === 'B034') avgFuelPrices.premium = price;
        else if (o.PRODCD === 'D047') avgFuelPrices.diesel = price;
        else if (o.PRODCD === 'K015') avgFuelPrices.lpg = price;
      });
      // 초기 로드 시 휘발유 단가 자동 입력
      applyAvgPrice('gasoline');
    })
    .catch(function() { console.log('오피넷 평균유가 로드 실패'); });
})();

function applyAvgPrice(fuelType) {
  var price = avgFuelPrices[fuelType];
  var input = document.getElementById('fuelPrice');
  var hint = document.getElementById('fuelPriceHint');
  if (price > 0) {
    input.value = price;
    input.placeholder = price + '';
    if (hint) hint.textContent = '오피넷 전국 평균가 자동 적용 (' + formatMoney(price) + '원/L)';
  } else {
    var fallback = { gasoline: '휘발유 ~1,650원', premium: '고급휘발유 ~2,100원', diesel: '경유 ~1,500원', lpg: 'LPG ~1,050원' };
    if (hint) hint.textContent = '전국 평균 참고: ' + (fallback[fuelType] || '');
  }
}

// 유종 전환 시 UI 변경 + 평균가 자동 입력
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
    if (!isElec) applyAvgPrice(val);
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
    var labels = { gasoline: '휘발유', premium: '고급휘발유', diesel: '경유', lpg: 'LPG' };
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
