// DT Club 법률 도우미 Worker (법제처 Open API + OpenAI)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM_PROMPT = `당신은 DT Club의 교통·운전 전문 법률 AI 도우미 "DT 법률 도우미"입니다.

역할:
- 운전/교통 관련 법률 질문에 정확하고 쉽게 답변합니다
- 반드시 [법령 컨텍스트]에 제공된 법령·판례를 근거로 답변합니다
- 법률 용어는 일반인이 이해할 수 있게 풀어서 설명합니다
- 운전자에게 실용적인 조언(팁)을 함께 제공합니다

답변 원칙:
1. 근거 없는 추측 금지 — [법령 컨텍스트]에 없는 내용은 "정확한 확인이 필요합니다"로 안내
2. [법령 컨텍스트] 데이터가 최우선 — AI 자체 지식보다 제공된 법령 우선
3. 한국어로 쉽게 — 법조문 인용 시 핵심만 발췌하여 설명
4. 운전자/교통 외 법률 질문은 정중히 안내: "교통·운전 관련 법률만 상담 가능합니다"

전문 분야:
- 도로교통법 (음주, 신호위반, 속도, 면허)
- 교통사고처리특례법 (12대 중과실, 과실비율)
- 자동차관리법 (등록, 매매, 하자)
- 자동차손해배상보장법 (보험, 손해배상)
- 특정범죄가중처벌법 (도주차량, 위험운전)
- 주차장법, 질서위반행위규제법 (과태료)

반드시 아래 JSON 형식으로만 답변하세요:
{
  "answer": "사용자에게 보여줄 메인 답변 (마크다운 가능, 굵게(**) 활용)",
  "summary": ["핵심 요약 1", "핵심 요약 2", "핵심 요약 3"],
  "tips": ["실용적 팁 1", "실용적 팁 2"]
}`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/legal' && request.method === 'POST') {
      return handleLegalQuery(request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
};

async function handleLegalQuery(request, env) {
  try {
    const { question, history } = await request.json();
    if (!question || question.length > 1000) {
      return jsonResponse({ error: '질문이 비어있거나 너무 깁니다' }, 400);
    }

    // Step 1: 법제처 API 병렬 호출
    const keywords = extractKeywords(question);
    const [aiLawResult, precResult] = await Promise.all([
      searchAILaw(env, question),
      searchPrecedents(env, keywords),
    ]);

    // Step 2: 상위 법령 조문 상세 조회
    const topLaws = parseAILawResult(aiLawResult).slice(0, 3);
    const lawDetails = await Promise.all(
      topLaws.map(l => getLawArticle(env, l.mst, l.joNo))
    );

    // Step 3: 컨텍스트 구성
    const context = buildContext(topLaws, lawDetails, precResult);

    // Step 4: OpenAI Responses API로 종합 답변 생성
    const input = [
      {
        role: 'system',
        content: [{ type: 'input_text', text: SYSTEM_PROMPT }]
      },
      ...(history || []).slice(-6).map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: [{
          type: h.role === 'assistant' ? 'output_text' : 'input_text',
          text: h.content
        }]
      })),
      {
        role: 'user',
        content: [{ type: 'input_text', text: `[법령 컨텍스트]\n${context}\n\n[질문]\n${question}` }]
      }
    ];

    const aiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        input,
        text: { format: { type: 'text' } },
        temperature: 0.3,
        max_output_tokens: 2048,
        top_p: 1,
        store: true
      })
    });

    const aiData = await aiResp.json();
    if (aiData.error) {
      return jsonResponse({ error: aiData.error.message || 'AI 오류' }, 500);
    }

    // Responses API: output[0].content[0].text
    let rawText = '';
    if (aiData.output && aiData.output.length > 0) {
      const msg = aiData.output.find(o => o.role === 'assistant');
      if (msg && msg.content && msg.content.length > 0) {
        rawText = msg.content[0].text || '';
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { answer: rawText, summary: [], tips: [] };
    }

    // 법령/판례 소스 첨부
    const laws = topLaws.map((l, i) => ({
      name: l.lawName || '',
      article: l.joNo ? `제${l.joNo}조` : '',
      title: l.joTitle || '',
      text: lawDetails[i] || ''
    })).filter(l => l.name);

    const precedents = parsePrecedentResult(precResult).slice(0, 3);

    return jsonResponse({
      answer: parsed.answer || '',
      summary: parsed.summary || [],
      tips: parsed.tips || [],
      laws,
      precedents
    });

  } catch (e) {
    return jsonResponse({ error: e.message || '서버 오류' }, 500);
  }
}

// ── 법제처 API 호출 ──

async function searchAILaw(env, query) {
  const params = new URLSearchParams({
    OC: env.LAW_API_KEY || '',
    target: 'law',
    type: 'XML',
    query,
    display: '5',
    mobileYn: 'Y'
  });
  try {
    const resp = await fetch(`https://www.law.go.kr/DRF/lawSearch.do?${params}`, {
      cf: { cacheTtl: 3600 }
    });
    return await resp.text();
  } catch { return ''; }
}

async function searchPrecedents(env, query) {
  const params = new URLSearchParams({
    OC: env.LAW_API_KEY || '',
    target: 'prec',
    type: 'XML',
    query,
    display: '3'
  });
  try {
    const resp = await fetch(`https://www.law.go.kr/DRF/lawSearch.do?${params}`, {
      cf: { cacheTtl: 3600 }
    });
    return await resp.text();
  } catch { return ''; }
}

async function getLawArticle(env, mst, joNo) {
  if (!mst) return '';
  const params = new URLSearchParams({
    OC: env.LAW_API_KEY || '',
    target: 'law',
    MST: mst,
    type: 'XML'
  });
  if (joNo) params.set('JO', joNo);
  try {
    const resp = await fetch(`https://www.law.go.kr/DRF/lawService.do?${params}`, {
      cf: { cacheTtl: 86400 }
    });
    const xml = await resp.text();
    // 조문 내용 추출
    const match = xml.match(/<조문내용>([\s\S]*?)<\/조문내용>/);
    return match ? cleanXml(match[1]) : '';
  } catch { return ''; }
}

// ── XML 파싱 헬퍼 ──

function parseAILawResult(xml) {
  if (!xml) return [];
  const results = [];
  const items = xml.match(/<law>([\s\S]*?)<\/law>/gi) || [];
  for (const item of items) {
    const lawName = extractTag(item, '법령명한글') || extractTag(item, '법령명');
    const mst = extractTag(item, '법령일련번호') || extractTag(item, 'MST');
    const joNo = extractTag(item, '조문번호');
    const joTitle = extractTag(item, '조문제목');
    if (lawName || mst) {
      results.push({ lawName, mst, joNo, joTitle });
    }
  }
  return results;
}

function parsePrecedentResult(xml) {
  if (!xml) return [];
  const results = [];
  const items = xml.match(/<prec>([\s\S]*?)<\/prec>/gi) || [];
  for (const item of items) {
    results.push({
      id: extractTag(item, '판례일련번호'),
      court: extractTag(item, '법원명') || '대법원',
      caseNumber: extractTag(item, '사건번호') || extractTag(item, '사건명'),
      date: extractTag(item, '선고일자'),
      summary: extractTag(item, '판례내용') || extractTag(item, '요지')
    });
  }
  return results;
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? cleanXml(m[1] || m[2] || '') : '';
}

function cleanXml(str) {
  return str.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}

function extractKeywords(question) {
  // 불용어 제거 후 핵심 키워드 추출
  const stopwords = ['은', '는', '이', '가', '을', '를', '의', '에', '에서', '로', '으로', '도', '만', '까지', '부터',
    '인데', '인가요', '일까요', '인지', '건가요', '할까요', '하면', '해도', '되나요', '합니다', '입니다', '어떻게', '얼마',
    '좀', '제가', '저는', '나는', '저', '나', '요', '네', '것', '때', '수', '시', '해서', '하고', '해요', '하나요'];
  const words = question.replace(/[?!.,]/g, '').split(/\s+/).filter(w =>
    w.length > 1 && !stopwords.includes(w)
  );
  return words.slice(0, 5).join(' ');
}

function buildContext(laws, lawDetails, precXml) {
  let ctx = '';

  // 법령 조문
  if (laws.length) {
    ctx += '=== 관련 법령 ===\n';
    laws.forEach((l, i) => {
      ctx += `[${l.lawName} ${l.joNo ? '제' + l.joNo + '조' : ''}${l.joTitle ? ' (' + l.joTitle + ')' : ''}]\n`;
      if (lawDetails[i]) ctx += lawDetails[i].slice(0, 800) + '\n\n';
    });
  }

  // 판례
  const precs = parsePrecedentResult(precXml);
  if (precs.length) {
    ctx += '=== 관련 판례 ===\n';
    precs.forEach(p => {
      ctx += `[${p.court} ${p.caseNumber} (${p.date || ''})]\n`;
      if (p.summary) ctx += p.summary.slice(0, 500) + '\n\n';
    });
  }

  return ctx || '(관련 법령을 찾지 못했습니다)';
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
