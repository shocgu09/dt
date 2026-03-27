// RSS 피드 파싱 프록시 Worker
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

    if (url.pathname === '/api/rss') {
      const feedUrl = url.searchParams.get('url');
      if (!feedUrl) {
        return new Response(JSON.stringify({ error: 'url 파라미터 필요' }), { status: 400, headers: jsonHeaders });
      }

      try {
        const resp = await fetch(feedUrl, {
          headers: { 'User-Agent': 'DT-Club-RSS/1.0' },
          cf: { cacheTtl: 1800 }
        });
        const xml = await resp.text();
        const items = parseRSS(xml);

        return new Response(JSON.stringify({ items }), {
          headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=1800' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    return new Response(JSON.stringify({ status: 'ok', service: 'dt-rss' }), { headers: jsonHeaders });
  }
};

function parseRSS(xml) {
  const items = [];
  // <item> 또는 <entry> 태그 파싱
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
    const content = match[1] || match[2];
    const title = extractTag(content, 'title');
    const link = extractLink(content);
    const pubDate = extractTag(content, 'pubDate') || extractTag(content, 'published') || extractTag(content, 'updated');
    const description = extractTag(content, 'description') || extractTag(content, 'summary') || '';

    if (title) {
      items.push({
        title: stripHtml(title),
        link: link,
        pubDate: pubDate,
        description: stripHtml(description).slice(0, 200),
      });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'));
  if (cdataMatch) return cdataMatch[1].trim();
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function extractLink(xml) {
  // <link href="..."/> (Atom)
  const atomMatch = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (atomMatch) return atomMatch[1];
  // <link>...</link> (RSS)
  return extractTag(xml, 'link');
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
