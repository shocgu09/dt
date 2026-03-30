// YouTube Data API 프록시 Worker
// 다중 채널 최신 영상을 가져와서 캐싱
// playlistItems.list (1 unit) 사용 — search.list (100 units) 대비 100배 절약
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const apiKey = env.YOUTUBE_API_KEY;
    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

    // 다중 채널 영상 조회
    if (url.pathname === '/api/videos') {
      try {
        const channelIds = url.searchParams.get('channels')?.split(',').filter(Boolean) || [];
        const maxPerChannel = parseInt(url.searchParams.get('max') || '3');

        if (!channelIds.length) {
          return new Response(JSON.stringify({ videos: [] }), { headers: jsonHeaders });
        }

        // 각 채널별 영상 병렬 조회 (playlistItems — 1 unit per call)
        // 채널 ID "UCxxxx" → 업로드 플레이리스트 "UUxxxx"
        const results = await Promise.all(channelIds.map(async (chId) => {
          const uploadsId = 'UU' + chId.slice(2);
          const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?key=${apiKey}&playlistId=${uploadsId}&part=snippet&maxResults=${maxPerChannel}`;
          const resp = await fetch(apiUrl, { cf: { cacheTtl: 3600 } });
          const data = await resp.json();
          if (data.error) return [];
          return (data.items || []).map(item => ({
            id: item.snippet.resourceId.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
          }));
        }));

        // 모든 채널 영상 합치고 날짜순 정렬
        let videos = results.flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

        // 쇼츠 판별: /shorts/ID URL 200 체크 (가장 정확)
        videos = await Promise.all(videos.map(async (v) => {
          try {
            const resp = await fetch('https://www.youtube.com/shorts/' + v.id, { redirect: 'manual' });
            return { ...v, isShort: resp.status === 200 };
          } catch(e) {
            return { ...v, isShort: /\#shorts/i.test(v.title) };
          }
        }));

        return new Response(JSON.stringify({ videos }), {
          headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

    // 채널 핸들로 채널 ID 조회
    if (url.pathname === '/api/channel') {
      try {
        const handle = url.searchParams.get('handle')?.replace('@', '') || '';
        if (!handle) {
          return new Response(JSON.stringify({ error: '핸들을 입력하세요' }), { status: 400, headers: jsonHeaders });
        }
        const apiUrl = `https://www.googleapis.com/youtube/v3/channels?key=${apiKey}&forHandle=${handle}&part=snippet,statistics`;
        const resp = await fetch(apiUrl);
        const data = await resp.json();

        if (!data.items?.length) {
          return new Response(JSON.stringify({ error: '채널을 찾을 수 없습니다' }), { status: 404, headers: jsonHeaders });
        }
        const ch = data.items[0];
        return new Response(JSON.stringify({
          channelId: ch.id,
          title: ch.snippet.title,
          thumbnail: ch.snippet.thumbnails.default?.url,
          subscribers: ch.statistics.subscriberCount,
        }), { headers: jsonHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // 접속 위치 조회 (ip-api.com 한글, Worker에서 HTTP 가능)
    if (url.pathname === '/api/location') {
      try {
        const ip = request.headers.get('CF-Connecting-IP') || '';
        const r = await fetch(`http://ip-api.com/json/${ip}?lang=ko&fields=city,regionName`);
        const d = await r.json();
        const region = d.regionName || '';
        const city = d.city || '';
        const loc = region === city ? region : [region, city].filter(Boolean).join(' ');
        return new Response(JSON.stringify({ loc }), { headers: { ...jsonHeaders, 'Cache-Control': 'no-store' } });
      } catch(e) {
        return new Response(JSON.stringify({ loc: '' }), { headers: jsonHeaders });
      }
    }

    return new Response(JSON.stringify({ status: 'ok', service: 'dt-youtube' }), { headers: jsonHeaders });
  }
};
