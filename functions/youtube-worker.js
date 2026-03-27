// YouTube Data API 프록시 Worker
// 채널 최신 영상을 가져와서 캐싱
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (url.pathname === '/api/videos') {
      try {
        const channelId = 'UCkRsqZF8M0Qxu8pcA9efoPQ';
        const maxResults = url.searchParams.get('max') || '6';
        const apiKey = env.YOUTUBE_API_KEY;

        const apiUrl = `https://www.googleapis.com/youtube/v3/search?key=${apiKey}&channelId=${channelId}&part=snippet&maxResults=${maxResults}&type=video&order=date`;
        const resp = await fetch(apiUrl, { cf: { cacheTtl: 3600 } });
        const data = await resp.json();

        if (data.error) {
          return new Response(JSON.stringify({ error: data.error.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const videos = (data.items || []).map(item => ({
          id: item.id.videoId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
          publishedAt: item.snippet.publishedAt,
        }));

        return new Response(JSON.stringify({ videos }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ status: 'ok', service: 'dt-youtube' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
