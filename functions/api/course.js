const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { OPENAI_API_KEY } = context.env;

  if (!OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, 500);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: '요청 형식이 올바르지 않습니다.' }, 400);
  }

  const { prompt } = body;
  if (!prompt) return json({ error: 'prompt가 필요합니다.' }, 400);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || res.statusText);

    const text = data.choices?.[0]?.message?.content || '';
    return json({ text });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
