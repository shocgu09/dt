// OPINET API CORS Proxy Worker
// 클라이언트에서 직접 호출 시 CORS 문제를 해결하기 위한 프록시

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

async function handleGasSearch(params) {
  const lat = params.get('lat');
  const lng = params.get('lng');
  const radius = params.get('radius') || '3000'; // 기본 3km
  const fuel = params.get('fuel') || 'B027'; // 기본 휘발유
  const sort = params.get('sort') || '1'; // 1=가격순, 2=거리순

  if (!lat || !lng) {
    return new Response(JSON.stringify({ error: '위치 정보가 필요합니다 (lat, lng)' }), {
      status: 400,
      headers: CORS_HEADERS
    });
  }

  try {
    const apiUrl = `${OPINET_BASE}/aroundAll.do?code=${OPINET_API_KEY}&out=json&x=${lng}&y=${lat}&radius=${radius}&prodcd=${fuel}&sort=${sort}`;
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'DTClub/1.0' }
    });

    if (!response.ok) {
      throw new Error(`OPINET API error: ${response.status}`);
    }

    const data = await response.json();
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
