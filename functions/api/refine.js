// AI 글 정리 — Cloudflare Pages Function
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const OPENAI_KEY = context.env.OPENAI_API_KEY_REFINE || context.env.OPENAI_API_KEY;

  if (!OPENAI_KEY) {
    return json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, 500);
  }

  let text;
  try {
    ({ text } = await context.request.json());
  } catch {
    return json({ error: '요청 형식이 올바르지 않습니다.' }, 400);
  }

  if (!text || text.length > 2000) {
    return json({ error: '텍스트가 비어있거나 너무 깁니다 (최대 2000자)' }, 400);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        input: [
          {
            role: 'system',
            content: [{
              type: 'input_text',
              text: '당신은 한국어 글 교정 도우미입니다. 사용자의 글을 맞춤법, 띄어쓰기, 문장 구조를 교정하고 가독성을 높여주세요. 원래 의미와 톤을 유지하면서 자연스럽게 다듬어주세요. 교정된 글만 출력하세요. 설명은 하지 마세요.'
            }]
          },
          {
            role: 'user',
            content: [{
              type: 'input_text',
              text
            }]
          }
        ],
        text: { format: { type: 'text' } },
        temperature: 1,
        max_output_tokens: 2048,
        top_p: 1
      })
    });

    const data = await response.json();

    let refined = text;
    if (data.output && data.output.length > 0) {
      const msg = data.output.find(o => o.role === 'assistant');
      if (msg && msg.content && msg.content.length > 0) {
        refined = msg.content[0].text || text;
      }
    } else if (data.error) {
      return json({ error: data.error.message || 'OpenAI API 오류' }, 500);
    }

    return json({ refined });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
