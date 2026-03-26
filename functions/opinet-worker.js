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

// WGS84 → KATEC 좌표 변환
function wgs84ToKatec(lat, lng) {
  const PI = Math.PI;
  const DEGRAD = PI / 180.0;

  // GRS80 타원체
  const a = 6378137.0;
  const f = 1.0 / 298.257222101;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ep2 = (a * a - b * b) / (b * b);

  // KATEC 투영 파라미터 (TM 투영)
  const lon0 = 128.0 * DEGRAD; // 중앙 경선
  const lat0 = 38.0 * DEGRAD;  // 원점 위도
  const k0 = 0.9999;           // 축척 계수
  const x0 = 400000.0;         // 가산 X
  const y0 = 600000.0;         // 가산 Y

  const phi = lat * DEGRAD;
  const lam = lng * DEGRAD;
  const dlam = lam - lon0;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = ep2 * cosPhi * cosPhi;
  const A = cosPhi * dlam;

  // 자오선 호 길이
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi));

  const M0 = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat0
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat0)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat0)
    - (35 * e6 / 3072) * Math.sin(6 * lat0));

  const x = k0 * N * (A + (1 - T + C) * A * A * A / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A * A * A * A * A / 120) + x0;

  const y = k0 * (M - M0 + N * tanPhi * (A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A * A * A * A * A * A / 720)) + y0;

  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

// KATEC → WGS84 좌표 변환 (결과 좌표를 GPS로 변환)
function katecToWgs84(x, y) {
  const PI = Math.PI;
  const RADDEG = 180.0 / PI;

  const a = 6378137.0;
  const f = 1.0 / 298.257222101;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ep2 = (a * a - b * b) / (b * b);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const lon0 = 128.0 * PI / 180.0;
  const lat0 = 38.0 * PI / 180.0;
  const k0 = 0.9999;
  const x0 = 400000.0;
  const y0 = 600000.0;

  const e4 = e2 * e2;
  const e6 = e4 * e2;

  const M0 = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat0
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat0)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat0)
    - (35 * e6 / 3072) * Math.sin(6 * lat0));

  const M = M0 + (y - y0) / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));

  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = ep2 * cosPhi1 * cosPhi1;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = (x - x0) / (N1 * k0);

  const lat = (phi1 - (N1 * tanPhi1 / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D * D * D * D * D * D / 720)) * RADDEG;

  const lng = (lon0 + (D - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D / 120) / cosPhi1) * RADDEG;

  return { lat: Math.round(lat * 1000000) / 1000000, lng: Math.round(lng * 1000000) / 1000000 };
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
