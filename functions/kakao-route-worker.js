// Kakao Mobility 경로 안내 프록시 Worker
// Kakao Directions API (실제 도로 경로)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
    const apiKey = env.KAKAO_REST_KEY;

    if (url.pathname === '/api/route') {
      const origin = url.searchParams.get('origin');
      const destination = url.searchParams.get('destination');
      const waypoints = url.searchParams.get('waypoints');

      if (!origin || !destination) {
        return new Response(JSON.stringify({ error: 'origin, destination 필수' }), { status: 400, headers: jsonHeaders });
      }

      try {
        let apiUrl = `https://apis-navi.kakaomobility.com/v1/directions?origin=${origin}&destination=${destination}&priority=RECOMMEND`;
        if (waypoints) apiUrl += `&waypoints=${waypoints}`;

        const resp = await fetch(apiUrl, {
          headers: { Authorization: `KakaoAK ${apiKey}` },
          cf: { cacheTtl: 3600 }
        });
        const data = await resp.json();

        if (!data.routes || !data.routes[0] || data.routes[0].result_code !== 0) {
          return new Response(JSON.stringify({ error: '경로를 찾을 수 없습니다', code: data.routes?.[0]?.result_code }), { headers: jsonHeaders });
        }

        // 경로 좌표 추출 (lng, lat 교대로)
        const path = [];
        for (const section of data.routes[0].sections) {
          for (const road of section.roads) {
            for (let i = 0; i + 1 < road.vertexes.length; i += 2) {
              path.push(road.vertexes[i], road.vertexes[i + 1]);
            }
          }
        }

        const summary = data.routes[0].summary;
        return new Response(JSON.stringify({
          path,
          distance: summary ? Math.round(summary.distance / 100) / 10 : null,   // km
          duration: summary ? Math.round(summary.duration / 60) : null,          // 분
        }), {
          headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=3600' }
        });

      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    return new Response(JSON.stringify({ status: 'ok', service: 'dt-route' }), { headers: jsonHeaders });
  }
};
