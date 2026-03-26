// 날씨 + 드라이브 지수 Worker (기상청 단기예보 API 프록시)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

// WGS84 → 기상청 격자좌표 변환
function toGrid(lat, lng) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0;
  const OLAT = 38.0, OLON = 126.0, XO = 43, YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = re * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = re * sf / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

// 기상청 API용 base_date, base_time 계산
function getBaseDateTime() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const h = now.getHours(), m = now.getMinutes();
  // 단기예보 발표시각: 0200,0500,0800,1100,1400,1700,2000,2300
  const bases = [23, 20, 17, 14, 11, 8, 5, 2];
  let baseH = 2, baseDate = new Date(now);
  for (const b of bases) {
    if (h > b || (h === b && m >= 10)) { baseH = b; break; }
  }
  if (h < 2 || (h === 2 && m < 10)) {
    baseDate.setDate(baseDate.getDate() - 1);
    baseH = 23;
  }
  const y = baseDate.getFullYear();
  const mon = String(baseDate.getMonth() + 1).padStart(2, '0');
  const d = String(baseDate.getDate()).padStart(2, '0');
  return { base_date: `${y}${mon}${d}`, base_time: String(baseH).padStart(2, '0') + '00' };
}

// 하늘상태 코드 → 텍스트
function skyText(code) {
  if (code === '1') return '맑음';
  if (code === '3') return '구름많음';
  if (code === '4') return '흐림';
  return '맑음';
}
function skyEmoji(code, pty) {
  if (pty && pty !== '0') {
    if (pty === '1' || pty === '4') return '🌧️';
    if (pty === '2') return '🌨️';
    if (pty === '3') return '❄️';
  }
  if (code === '1') return '☀️';
  if (code === '3') return '⛅';
  if (code === '4') return '☁️';
  return '☀️';
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);

    if (url.pathname === '/api/weather') {
      const lat = parseFloat(url.searchParams.get('lat'));
      const lng = parseFloat(url.searchParams.get('lng'));
      if (!lat || !lng) return new Response(JSON.stringify({ error: 'lat, lng 필요' }), { status: 400, headers: CORS_HEADERS });

      try {
        const { nx, ny } = toGrid(lat, lng);
        const { base_date, base_time } = getBaseDateTime();
        const apiKey = encodeURIComponent(env.WEATHER_API_KEY);

        const apiUrl = `http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${apiKey}&pageNo=1&numOfRows=900&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;

        const res = await fetch(apiUrl);
        const data = await res.json();
        const items = data?.response?.body?.items?.item || [];

        // 현재 시각에 가장 가까운 예보 추출
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const nowH = String(now.getHours()).padStart(2, '0') + '00';

        let tmp = '-', sky = '1', pop = '0', wsd = '0', pty = '0';
        // 향후 3일 비/눈 예보 (드리프트 데이용)
        let rainDays = [];

        for (const item of items) {
          if (item.fcstTime === nowH || (!tmp || tmp === '-')) {
            if (item.category === 'TMP') tmp = item.fcstValue;
            if (item.category === 'SKY') sky = item.fcstValue;
            if (item.category === 'POP') pop = item.fcstValue;
            if (item.category === 'WSD') wsd = item.fcstValue;
            if (item.category === 'PTY') pty = item.fcstValue;
          }
          // 비/눈 예보 수집
          if (item.category === 'PTY' && item.fcstValue !== '0') {
            const dateStr = item.fcstDate;
            if (rainDays.indexOf(dateStr) === -1) rainDays.push(dateStr);
          }
        }

        // 드라이브 지수 계산
        let score = 3; // 기본 3점
        const skyN = parseInt(sky), popN = parseInt(pop), wsdN = parseFloat(wsd), tmpN = parseFloat(tmp);
        if (skyN === 1) score += 2;
        else if (skyN === 3) score += 1;
        else if (skyN === 4) score += 0;
        if (pty !== '0') score -= 2;
        if (popN < 30) score += 1;
        else if (popN >= 60) score -= 1;
        if (wsdN < 4) score += 1;
        else if (wsdN >= 9) score -= 1;
        if (tmpN >= 15 && tmpN <= 25) score += 1;
        else if (tmpN < 0 || tmpN > 35) score -= 1;
        score = Math.max(1, Math.min(5, score));

        const labels = ['', '비추 😢', '아쉬움 😐', '괜찮음 🙂', '좋음 😊', '최고! 🤩'];

        return new Response(JSON.stringify({
          temp: tmp,
          sky: skyText(sky),
          skyEmoji: skyEmoji(sky, pty),
          pop: pop,
          wind: wsd,
          pty: pty,
          driveScore: score,
          driveLabel: labels[score],
          rainDays: rainDays,
          nx, ny, base_date, base_time
        }), { headers: CORS_HEADERS });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS_HEADERS });
      }
    }

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok' }), { headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS_HEADERS });
  }
};
