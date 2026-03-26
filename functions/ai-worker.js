// AI 글 정리 Worker (OpenAI API 프록시)
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/refine' && request.method === 'POST') {
      try {
        const { text } = await request.json();
        if (!text || text.length > 2000) {
          return new Response(JSON.stringify({ error: '텍스트가 비어있거나 너무 깁니다 (최대 2000자)' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: '당신은 한국어 글 교정 도우미입니다. 사용자의 글을 맞춤법, 띄어쓰기, 문장 구조를 교정하고 가독성을 높여주세요. 원래 의미와 톤을 유지하면서 자연스럽게 다듬어주세요. 교정된 글만 출력하세요. 설명은 하지 마세요.'
              },
              { role: 'user', content: text }
            ],
            max_tokens: 2000,
            temperature: 0.3
          })
        });

        const data = await response.json();
        const refined = data.choices?.[0]?.message?.content || text;

        return new Response(JSON.stringify({ refined }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
