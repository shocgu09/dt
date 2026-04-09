// DT 법률 도우미 — Anthropic Claude API + MCP 커넥터 (네이티브)
// Claude가 MCP 서버에 직접 연결하여 도구 호출 (데스크톱과 동일)
// Cloudflare Pages Function

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_MCP_URL = 'https://korean-law-mcp.fly.dev/mcp?oc=mylaw2026';
const SYSTEM_PROMPT = '한국 법률 질문에 답변합니다. korean-law MCP 도구를 적극 활용하여 실제 법령과 판례를 검색하고 답변하세요. 한국어로 답변하세요.';

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { ANTHROPIC_API_KEY, LAW_MCP_URL } = context.env;
  if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, 500);
  const mcpUrl = LAW_MCP_URL || DEFAULT_MCP_URL;

  let question, history;
  try { ({ question, history } = await context.request.json()); }
  catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (!question || question.length > 1000) return json({ error: '질문이 비어있거나 너무 깁니다' }, 400);

  try {
    // 대화 메시지 구성
    const messages = [];
    if (history && history.length) {
      for (const h of history.slice(-6)) {
        messages.push({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content
        });
      }
    }
    messages.push({ role: 'user', content: question });

    // Anthropic Messages API + MCP 커넥터 (네이티브)
    const resp = await fetch('https://api.anthropic.com/v1/messages?beta=mcp-client-2025-11-20', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-11-20',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages,
        mcp_servers: [{
          type: 'url',
          url: mcpUrl,
          name: 'korean-law'
        }],
        tools: [{
          type: 'mcp_toolset',
          mcp_server_name: 'korean-law'
        }]
      })
    });

    const rawText = await resp.text();
    let data;
    try { data = JSON.parse(rawText); }
    catch { return json({ error: 'API 응답 파싱 실패: ' + rawText.substring(0, 200) }, 500); }
    if (data.error) return json({ error: data.error.message || 'Claude API 오류' }, 500);

    // 최종 텍스트 추출
    const answer = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return json({ answer });

  } catch (e) {
    return json({ error: e.message || '서버 오류' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
