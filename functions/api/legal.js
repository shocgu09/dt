// DT 법률 도우미 — OpenAI Responses API + MCP 직접 연동
// korean-law MCP 서버를 OpenAI가 직접 호출하는 방식
// Cloudflare Pages Function

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MCP_SERVER_URL = 'https://korean-law-mcp.fly.dev/mcp?oc=mylaw2026';

const SYSTEM_PROMPT = `당신은 DT Club의 AI 법률 도우미입니다. 한국의 모든 법률 분야 질문에 답변합니다.

MCP 도구를 적극적으로 사용하여 실제 법령과 판례를 검색하고, 그 결과를 근거로 답변하세요.

작업 방식:
1. search_law로 법령을 찾고 MST를 획득합니다
2. get_law_text로 관련 조문 원문을 가져옵니다
3. 필요하면 search_precedents로 판례도 검색합니다
4. 수집한 데이터를 바탕으로 정확하고 쉽게 답변합니다

답변 원칙:
- 반드시 도구로 조회한 실제 법령/판례를 근거로 답변합니다
- 조문 번호와 항/호를 명시하여 인용합니다
- 법률 용어는 일반인이 이해할 수 있게 풀어서 설명합니다
- 도구로 찾지 못한 내용은 "정확한 확인이 필요합니다"로 안내합니다

최종 답변은 반드시 아래 JSON 형식으로 작성하세요:
{
  "answer": "메인 답변 (**굵게** 활용, 조문 인용 포함)",
  "summary": ["핵심 요약 1", "핵심 요약 2", "핵심 요약 3"],
  "tips": ["실용적 팁 1", "실용적 팁 2"]
}`;

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { OPENAI_API_KEY } = context.env;
  if (!OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, 500);

  let question, history;
  try { ({ question, history } = await context.request.json()); }
  catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (!question || question.length > 1000) return json({ error: '질문이 비어있거나 너무 깁니다' }, 400);

  try {
    // 대화 이력 구성
    const input = [
      { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
      ...(history || []).slice(-6).map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: h.role === 'assistant' ? 'output_text' : 'input_text', text: h.content }]
      })),
      { role: 'user', content: [{ type: 'input_text', text: question }] }
    ];

    // OpenAI Responses API + MCP 도구 — 이게 전부입니다!
    const aiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        input,
        tools: [{
          type: 'mcp',
          server_label: 'korean-law',
          server_url: MCP_SERVER_URL,
          require_approval: 'never'
        }],
        text: { format: { type: 'text' } },
        temperature: 0.3,
        max_output_tokens: 4096,
        top_p: 1,
        store: true
      })
    });

    const aiData = await aiResp.json();
    if (aiData.error) return json({ error: aiData.error.message || 'AI 오류' }, 500);

    // 응답에서 최종 텍스트와 MCP 호출 결과 추출
    let answerText = '';
    const laws = [];
    const precedents = [];

    if (aiData.output) {
      for (const item of aiData.output) {
        // AI 최종 답변
        if (item.type === 'message' && item.role === 'assistant') {
          for (const c of (item.content || [])) {
            if (c.type === 'output_text') answerText = c.text;
          }
        }
        // MCP 도구 호출 결과에서 법령/판례 수집
        if (item.type === 'mcp_tool_call') {
          try {
            const result = JSON.parse(item.output || '{}');
            // get_law_text 결과
            if (item.name === 'get_law_text' && result.articles) {
              for (const a of result.articles) {
                laws.push({
                  name: result.lawName || '',
                  article: `제${a.number}조`,
                  title: a.title || '',
                  text: a.content || ''
                });
              }
            }
            // search_precedents 결과
            if (item.name === 'search_precedents' && Array.isArray(result)) {
              precedents.push(...result);
            }
          } catch {}
        }
      }
    }

    // JSON 파싱
    let parsed;
    try { parsed = JSON.parse(answerText); }
    catch { parsed = { answer: answerText, summary: [], tips: [] }; }

    return json({
      answer: parsed.answer || '',
      summary: parsed.summary || [],
      tips: parsed.tips || [],
      laws,
      precedents
    });

  } catch (e) {
    return json({ error: e.message || '서버 오류' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
