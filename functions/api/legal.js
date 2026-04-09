// DT 법률 도우미 — OpenAI Responses API + MCP 직접 연동
// korean-law MCP 서버를 OpenAI가 직접 호출하는 방식
// Cloudflare Pages Function

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// MCP 서버 URL — Firestore config에서 동적으로 가져옴 (터널 URL 변경 대응)
// 기본값은 공용 서버, LAW_MCP_URL 환경변수로 오버라이드 가능
const DEFAULT_MCP_URL = 'https://korean-law-mcp.fly.dev/mcp?oc=mylaw2026';

// 최소 시스템 프롬프트 — MCP 도구 사용 안내만
const SYSTEM_PROMPT = '한국 법률 질문에 답변합니다. MCP 도구(korean-law)를 사용하여 법령과 판례를 검색하세요. 한국어로 답변하세요.';

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { OPENAI_API_KEY, LAW_MCP_URL } = context.env;
  if (!OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, 500);
  const mcpUrl = LAW_MCP_URL || DEFAULT_MCP_URL;

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
          server_url: mcpUrl,
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
    const _debug = [];

    if (aiData.output) {
      for (const item of aiData.output) {
        // 디버그: mcp_call의 output 내용도 확인
        const debugItem = { type: item.type, name: item.name, role: item.role, keys: Object.keys(item) };
        if (item.type === 'mcp_call' && item.output) {
          try { debugItem.outputPreview = item.output.substring(0, 500); } catch {}
        }
        _debug.push(debugItem);

        // AI 최종 답변
        if (item.type === 'message' && item.role === 'assistant') {
          for (const c of (item.content || [])) {
            if (c.type === 'output_text') answerText = c.text;
          }
        }
        // MCP 도구 호출 결과에서 법령/판례 수집 (텍스트 파싱)
        if (item.type === 'mcp_call' && item.output) {
          const out = item.output;

          if (item.name === 'get_law_text') {
            // 텍스트에서 법령명 추출
            const lawNameMatch = out.match(/법령명:\s*(.+)/);
            const lawName = lawNameMatch ? lawNameMatch[1].trim() : '';
            // 조문 블록 파싱: "제N조 제목\n내용..."
            const articleBlocks = out.split(/(?=^제\d+조)/m).filter(b => b.startsWith('제'));
            for (const block of articleBlocks) {
              const headerMatch = block.match(/^(제\d+조(?:의\d+)?)\s*(.*)/);
              if (headerMatch) {
                laws.push({
                  name: lawName,
                  article: headerMatch[1],
                  title: headerMatch[2].split('\n')[0].trim(),
                  text: block.trim()
                });
              }
            }
          }

          if (item.name === 'search_precedents' || item.name === 'find_similar_precedents') {
            // 판례 텍스트 파싱
            const caseBlocks = out.split(/(?=^\d+\.\s)/m).filter(b => b.trim());
            for (const block of caseBlocks) {
              const caseMatch = block.match(/사건번호[:\s]*(.+)/);
              const courtMatch = block.match(/법원[:\s]*(.+)/);
              const dateMatch = block.match(/선고일[:\s]*(.+)/);
              const summaryMatch = block.match(/판시사항[:\s]*([\s\S]*?)(?=\n\n|\n\d+\.|$)/);
              if (caseMatch || courtMatch) {
                precedents.push({
                  caseNumber: caseMatch ? caseMatch[1].trim() : '',
                  court: courtMatch ? courtMatch[1].trim() : '법원',
                  date: dateMatch ? dateMatch[1].trim() : '',
                  summary: summaryMatch ? summaryMatch[1].trim() : block.trim().substring(0, 300)
                });
              }
            }
          }
        }
      }
    }

    // 디버그 포함 반환
    return json({
      answer: answerText,
      laws,
      precedents,
      _debug
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
