// YouTube Data API 프록시 Worker
// 다중 채널 최신 영상을 가져와서 캐싱
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

        // 각 채널별 영상 병렬 조회
        const results = await Promise.all(channelIds.map(async (chId) => {
          const apiUrl = `https://www.googleapis.com/youtube/v3/search?key=${apiKey}&channelId=${chId}&part=snippet&maxResults=${maxPerChannel}&type=video&order=date`;
          const resp = await fetch(apiUrl, { cf: { cacheTtl: 3600 } });
          const data = await resp.json();
          if (data.error) return [];
          return (data.items || []).map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
          }));
        }));

        // 모든 채널 영상 합치고 날짜순 정렬
        const videos = results.flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

        return new Response(JSON.stringify({ videos }), {
          headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=3600' }
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

    return new Response(JSON.stringify({ status: 'ok', service: 'dt-youtube' }), { headers: jsonHeaders });
  }
};
