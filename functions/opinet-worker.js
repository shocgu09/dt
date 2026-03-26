// OPINET API CORS Proxy Worker
// WGS84(GPS) → KATEC 좌표 변환 포함

const OPINET_API_KEY = 'F260327627';
const OPINET_BASE = 'https://www.opinet.co.kr/api';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/gas') {
      return handleGasSearch(url.searchParams);
    }

    if (url.pathname === '/api/avg') {
      return handleAvgPrice();
    }

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok' }), { headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: CORS_HEADERS
    });
  }
};

// ===== 좌표 변환: Bessel 1841 타원체 + KATEC TM 투영 =====
const BESSEL_A = 6377397.155;
const BESSEL_F = 1.0 / 299.1528128;
const BESSEL_B = BESSEL_A * (1 - BESSEL_F);
const BESSEL_E2 = (BESSEL_A * BESSEL_A - BESSEL_B * BESSEL_B) / (BESSEL_A * BESSEL_A);
const BESSEL_EP2 = (BESSEL_A * BESSEL_A - BESSEL_B * BESSEL_B) / (BESSEL_B * BESSEL_B);

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;
const KATEC_LON0 = 128.0 * DEG2RAD;
const KATEC_LAT0 = 38.0 * DEG2RAD;
const KATEC_K0 = 0.9999;
const KATEC_X0 = 400000.0;
const KATEC_Y0 = 600000.0;

// Molodensky 변환 파라미터 (WGS84 ↔ Bessel)
const DX = -146.43;
const DY = 507.89;
const DZ = 681.46;

// WGS84 → Bessel 경위도 변환 (Molodensky)
function wgs84ToBessel(lat, lng) {
  const WGS_A = 6378137.0, WGS_F = 1/298.257223563;
  const da = BESSEL_A - WGS_A;
  const df = BESSEL_F - WGS_F;
  const phi = lat * DEG2RAD, lam = lng * DEG2RAD;
  const sinP = Math.sin(phi), cosP = Math.cos(phi), sinL = Math.sin(lam), cosL = Math.cos(lam);
  const e2 = 2 * WGS_F - WGS_F * WGS_F;
  const Rn = WGS_A / Math.sqrt(1 - e2 * sinP * sinP);
  const Rm = WGS_A * (1 - e2) / Math.pow(1 - e2 * sinP * sinP, 1.5);
  const dPhi = ((-DX) * sinP * cosL - DY * sinP * sinL + DZ * cosP
    + da * (Rn * e2 * sinP * cosP) / WGS_A
    + df * (Rm / (1 - WGS_F) + Rn * (1 - WGS_F)) * sinP * cosP) / Rm;
  const dLam = ((-DX) * sinL - (-DY) * cosL) / (Rn * cosP);
  // 주의: Molodensky에서 WGS84→Bessel은 dx를 반대로
  const dPhi2 = ((DX) * sinP * cosL + DY * sinP * sinL - DZ * cosP
    + da * (Rn * e2 * sinP * cosP) / WGS_A
    + df * (Rm / (1 - WGS_F) + Rn * (1 - WGS_F)) * sinP * cosP) / Rm;
  const dLam2 = ((DX) * sinL - (DY) * cosL) / (Rn * cosP);
  return { lat: (phi - dPhi2) * RAD2DEG, lng: (lam - dLam2) * RAD2DEG };
}

// Bessel 경위도 → WGS84 변환 (Molodensky)
function besselToWgs84(lat, lng) {
  const phi = lat * DEG2RAD, lam = lng * DEG2RAD;
  const sinP = Math.sin(phi), cosP = Math.cos(phi), sinL = Math.sin(lam), cosL = Math.cos(lam);
  const Rn = BESSEL_A / Math.sqrt(1 - BESSEL_E2 * sinP * sinP);
  const Rm = BESSEL_A * (1 - BESSEL_E2) / Math.pow(1 - BESSEL_E2 * sinP * sinP, 1.5);
  const da = 6378137.0 - BESSEL_A;
  const df = (1/298.257223563) - BESSEL_F;
  const dPhi = ((-DX) * sinP * cosL - DY * sinP * sinL + DZ * cosP
    + da * (Rn * BESSEL_E2 * sinP * cosP) / BESSEL_A
    + df * (Rm / (1 - BESSEL_F) + Rn * (1 - BESSEL_F)) * sinP * cosP) / Rm;
  const dLam = ((-DX) * sinL - (-DY) * cosL) / (Rn * cosP);
  return { lat: (phi + dPhi) * RAD2DEG, lng: (lam + dLam) * RAD2DEG };
}

// TM 정변환: Bessel 경위도 → KATEC XY
function besselToKatecXY(lat, lng) {
  const phi = lat * DEG2RAD, lam = lng * DEG2RAD;
  const dlam = lam - KATEC_LON0;
  const sinP = Math.sin(phi), cosP = Math.cos(phi), tanP = Math.tan(phi);
  const N = BESSEL_A / Math.sqrt(1 - BESSEL_E2 * sinP * sinP);
  const T = tanP * tanP, C = BESSEL_EP2 * cosP * cosP, A = cosP * dlam;
  const e4 = BESSEL_E2 * BESSEL_E2, e6 = e4 * BESSEL_E2;
  const M = BESSEL_A * ((1 - BESSEL_E2/4 - 3*e4/64 - 5*e6/256) * phi
    - (3*BESSEL_E2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*phi)
    + (15*e4/256 + 45*e6/1024) * Math.sin(4*phi)
    - (35*e6/3072) * Math.sin(6*phi));
  const M0 = BESSEL_A * ((1 - BESSEL_E2/4 - 3*e4/64 - 5*e6/256) * KATEC_LAT0
    - (3*BESSEL_E2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*KATEC_LAT0)
    + (15*e4/256 + 45*e6/1024) * Math.sin(4*KATEC_LAT0)
    - (35*e6/3072) * Math.sin(6*KATEC_LAT0));
  const x = KATEC_K0 * N * (A + (1-T+C)*A*A*A/6 + (5-18*T+T*T+72*C-58*BESSEL_EP2)*A*A*A*A*A/120) + KATEC_X0;
  const y = KATEC_K0 * (M - M0 + N * tanP * (A*A/2 + (5-T+9*C+4*C*C)*A*A*A*A/24 + (61-58*T+T*T+600*C-330*BESSEL_EP2)*A*A*A*A*A*A/720)) + KATEC_Y0;
  return { x, y };
}

// TM 역변환: KATEC XY → Bessel 경위도
function katecXYToBessel(x, y) {
  const e4 = BESSEL_E2 * BESSEL_E2, e6 = e4 * BESSEL_E2;
  const e1 = (1 - Math.sqrt(1 - BESSEL_E2)) / (1 + Math.sqrt(1 - BESSEL_E2));
  const M0 = BESSEL_A * ((1 - BESSEL_E2/4 - 3*e4/64 - 5*e6/256) * KATEC_LAT0
    - (3*BESSEL_E2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*KATEC_LAT0)
    + (15*e4/256 + 45*e6/1024) * Math.sin(4*KATEC_LAT0)
    - (35*e6/3072) * Math.sin(6*KATEC_LAT0));
  const M = M0 + (y - KATEC_Y0) / KATEC_K0;
  const mu = M / (BESSEL_A * (1 - BESSEL_E2/4 - 3*e4/64 - 5*e6/256));
  const phi1 = mu + (3*e1/2 - 27*e1*e1*e1/32)*Math.sin(2*mu)
    + (21*e1*e1/16 - 55*e1*e1*e1*e1/32)*Math.sin(4*mu)
    + (151*e1*e1*e1/96)*Math.sin(6*mu);
  const sinP = Math.sin(phi1), cosP = Math.cos(phi1), tanP = Math.tan(phi1);
  const N1 = BESSEL_A / Math.sqrt(1 - BESSEL_E2 * sinP * sinP);
  const T1 = tanP * tanP, C1 = BESSEL_EP2 * cosP * cosP;
  const R1 = BESSEL_A * (1 - BESSEL_E2) / Math.pow(1 - BESSEL_E2 * sinP * sinP, 1.5);
  const D = (x - KATEC_X0) / (N1 * KATEC_K0);
  const lat = (phi1 - (N1*tanP/R1)*(D*D/2 - (5+3*T1+10*C1-4*C1*C1-9*BESSEL_EP2)*D*D*D*D/24
    + (61+90*T1+298*C1+45*T1*T1-252*BESSEL_EP2-3*C1*C1)*D*D*D*D*D*D/720)) * RAD2DEG;
  const lng = (KATEC_LON0 + (D - (1+2*T1+C1)*D*D*D/6
    + (5-2*C1+28*T1-3*C1*C1+8*BESSEL_EP2+24*T1*T1)*D*D*D*D*D/120) / cosP) * RAD2DEG;
  return { lat, lng };
}

// 공개 API: WGS84 → KATEC
function wgs84ToKatec(lat, lng) {
  const bessel = wgs84ToBessel(lat, lng);
  const katec = besselToKatecXY(bessel.lat, bessel.lng);
  return { x: Math.round(katec.x * 100) / 100, y: Math.round(katec.y * 100) / 100 };
}

// 공개 API: KATEC → WGS84
function katecToWgs84(x, y) {
  const bessel = katecXYToBessel(x, y);
  const wgs = besselToWgs84(bessel.lat, bessel.lng);
  return { lat: Math.round(wgs.lat * 1000000) / 1000000, lng: Math.round(wgs.lng * 1000000) / 1000000 };
}

async function handleGasSearch(params) {
  const lat = parseFloat(params.get('lat'));
  const lng = parseFloat(params.get('lng'));
  const radius = params.get('radius') || '3000';
  const fuel = params.get('fuel') || 'B027';
  const sort = params.get('sort') || '1';

  if (!lat || !lng) {
    return new Response(JSON.stringify({ error: '위치 정보가 필요합니다 (lat, lng)' }), {
      status: 400,
      headers: CORS_HEADERS
    });
  }

  try {
    // WGS84 → KATEC 변환
    const katec = wgs84ToKatec(lat, lng);

    const apiUrl = `${OPINET_BASE}/aroundAll.do?code=${OPINET_API_KEY}&out=json&x=${katec.x}&y=${katec.y}&radius=${radius}&prodcd=${fuel}&sort=${sort}`;
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'DTClub/1.0' }
    });

    if (!response.ok) {
      throw new Error(`OPINET API error: ${response.status}`);
    }

    const data = await response.json();

    // 결과 좌표를 KATEC → WGS84로 변환
    if (data.RESULT && data.RESULT.OIL) {
      data.RESULT.OIL = data.RESULT.OIL.map(station => {
        if (station.GIS_X_COOR && station.GIS_Y_COOR) {
          const wgs = katecToWgs84(parseFloat(station.GIS_X_COOR), parseFloat(station.GIS_Y_COOR));
          station.GIS_Y_COOR = wgs.lat; // 위도
          station.GIS_X_COOR = wgs.lng; // 경도
        }
        return station;
      });
    }

    return new Response(JSON.stringify(data), { headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: '주유소 검색 실패: ' + err.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

async function handleAvgPrice() {
  try {
    const apiUrl = `${OPINET_BASE}/avgAllPrice.do?code=${OPINET_API_KEY}&out=json`;
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'DTClub/1.0' }
    });

    if (!response.ok) {
      throw new Error(`OPINET API error: ${response.status}`);
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), { headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: '평균가 조회 실패: ' + err.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}
