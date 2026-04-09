// DT 법률 도우미 — Anthropic Claude API + korean-law MCP 연동
// Claude가 MCP 도구를 직접 호출하는 방식 (데스크톱과 동일)
// Cloudflare Pages Function

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_MCP_URL = 'https://korean-law-mcp.fly.dev/mcp?oc=mylaw2026';
const SYSTEM_PROMPT = '한국 법률 질문에 답변합니다. korean-law MCP 도구를 적극 활용하여 실제 법령과 판례를 검색하고 답변하세요. 한국어로 답변하세요.';
const MAX_TOOL_ROUNDS = 10;

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
    // 1. MCP 세션 초기화 + 도구 목록 획득
    const mcp = await initMCP(mcpUrl);
    if (!mcp.tools.length) return json({ error: 'MCP 서버에서 도구를 불러올 수 없습니다.' }, 500);

    // 2. MCP 도구를 Anthropic tool 형식으로 변환
    const tools = mcp.tools.map(t => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.inputSchema || { type: 'object', properties: {} }
    }));

    // 3. 대화 메시지 구성
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

    // 4. Claude API 호출 + 도구 루프
    let response = await callClaude(ANTHROPIC_API_KEY, messages, tools);
    let rounds = 0;

    while (response.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
      // assistant 메시지 추가
      messages.push({ role: 'assistant', content: response.content });

      // 도구 호출 실행
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await callMCPTool(mcpUrl, mcp.sessionId, block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });

      // Claude 재호출
      response = await callClaude(ANTHROPIC_API_KEY, messages, tools);
      rounds++;
    }

    // 5. 최종 텍스트 추출
    const answer = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return json({ answer });

  } catch (e) {
    return json({ error: e.message || '서버 오류' }, 500);
  }
}

// ===== MCP 헬퍼 =====

async function mcpRequest(url, sessionId, payload) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const newSessionId = resp.headers.get('mcp-session-id') || sessionId;
  const contentType = resp.headers.get('content-type') || '';

  let data;
  if (contentType.includes('text/event-stream')) {
    // SSE 응답 파싱
    const text = await resp.text();
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try { data = JSON.parse(line.slice(6)); } catch {}
      }
    }
    if (!data) throw new Error('MCP SSE 파싱 실패');
  } else {
    data = await resp.json();
  }

  if (data.error) throw new Error(data.error.message || 'MCP 오류');
  return { data, sessionId: newSessionId };
}

async function initMCP(url) {
  // 세션 초기화
  const init = await mcpRequest(url, null, {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dt-legal', version: '1.0' }
    },
    id: 1
  });

  // 도구 목록 요청
  const toolsResp = await mcpRequest(url, init.sessionId, {
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 2
  });

  const tools = toolsResp.data.result?.tools || [];
  return { sessionId: init.sessionId, tools };
}

async function callMCPTool(url, sessionId, toolName, args) {
  try {
    const resp = await mcpRequest(url, sessionId, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args || {} },
      id: Date.now()
    });

    const result = resp.data.result;
    if (!result) return '결과 없음';

    // content 배열에서 텍스트 추출
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
    return JSON.stringify(result);
  } catch (e) {
    return '도구 호출 실패: ' + e.message;
  }
}

// ===== Claude API =====

async function callClaude(apiKey, messages, tools) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages,
      tools
    })
  });

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || 'Claude API 오류');
  return data;
}

// ===== 유틸 =====

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
