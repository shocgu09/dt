// DT 법률 도우미 — Anthropic Claude API + MCP 커넥터 (스트리밍)
// Cloudflare Pages Function — SSE 스트리밍으로 실시간 응답
// 참고: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_MCP_URL = 'https://korean-law-mcp.fly.dev/mcp?oc=mylaw2026';
const SYSTEM_PROMPT = `한국 법률 질문에 답변하는 AI 법률 도우미입니다.
- korean-law MCP 도구를 적극 활용하여 실제 법령과 판례를 검색하고 답변하세요.
- 한국어로 답변하세요.
- 중간 과정 설명("조회하겠습니다", "검색하겠습니다", "확보했습니다" 등)은 절대 포함하지 마세요.
- 도구 호출 결과를 바탕으로 최종 정리된 답변만 출력하세요.
- 답변은 제목, 표, 목록 등을 활용하여 읽기 쉽게 구조화하세요.`;

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
  if (!question || question.length > 2000) return json({ error: '질문이 비어있거나 너무 깁니다' }, 400);

  // 대화 메시지 구성 (히스토리 3개로 제한 — 토큰 절약)
  const messages = [];
  if (history && history.length) {
    for (const h of history.slice(-3)) {
      messages.push({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content
      });
    }
  }
  messages.push({ role: 'user', content: [{ type: 'text', text: question }] });

  try {
    // Anthropic Messages API — 스트리밍 모드
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-11-20',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        temperature: 1,
        stream: true,
        system: SYSTEM_PROMPT,
        messages,
        mcp_servers: [{
          type: 'url',
          url: mcpUrl,
          name: 'korean-law'
        }],
        tools: [{
          type: 'mcp_toolset',
          mcp_server_name: 'korean-law',
          cache_control: { type: 'ephemeral' }
        }]
      })
    });

    // API 에러 (non-stream 응답)
    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg = 'Claude API 오류';
      try { errMsg = JSON.parse(errText).error?.message || errMsg; } catch {}
      return json({ error: errMsg }, resp.status);
    }

    // SSE 스트림을 클라이언트로 전달
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // 백그라운드에서 Anthropic SSE → 클라이언트 SSE 변환
    // 전략: 텍스트는 항상 전달하되, 새 도구 호출이 오면 clear로 이전 텍스트 리셋
    // → 중간 텍스트("조회하겠습니다")는 잠깐 보였다가 자동 삭제됨
    // → 최종 답변만 남음
    context.waitUntil((async () => {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let blockTypes = {};

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            let event;
            try { event = JSON.parse(data); } catch { continue; }

            if (event.type === 'content_block_start') {
              const btype = event.content_block?.type || '';
              blockTypes[event.index] = btype;

              if (btype === 'mcp_tool_use') {
                const toolName = event.content_block.name || '';
                // 이전 텍스트 초기화 + 상태 표시
                await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'clear' })}\n\n`));
                await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'status', text: `🔍 ${toolName} 호출 중...` })}\n\n`));
              }
            }
            // text delta → 항상 전달
            else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              if (blockTypes[event.index] === 'text') {
                await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`));
              }
            }
            // 스트림 종료
            else if (event.type === 'message_stop') {
              await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
            }
          }
        }
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      } catch (e) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', text: e.message || '스트림 오류' })}\n\n`));
      } finally {
        await writer.close();
      }
    })());

    return new Response(readable, {
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
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
