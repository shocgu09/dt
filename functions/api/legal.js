// DT Club 법률 도우미 — Cloudflare Pages Function
// korean-law MCP와 동일한 법제처 Open API 기능 구현
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM_PROMPT = `당신은 DT Club의 AI 법률 도우미입니다. 모든 분야의 한국 법률 질문에 답변합니다.

역할:
- 사용자의 법률 질문에 [법령 컨텍스트]에 제공된 실제 법령·판례·해석례를 근거로 정확하게 답변합니다
- 법률 용어는 일반인이 이해할 수 있게 풀어서 설명합니다
- 실용적인 조언과 절차 안내를 함께 제공합니다

답변 원칙:
1. [법령 컨텍스트]에 제공된 조문을 반드시 근거로 인용합니다
2. 컨텍스트에 없는 내용은 "정확한 확인이 필요합니다"로 안내합니다
3. 조문 번호와 항/호를 명시하여 인용합니다
4. 한국어로 쉽게 설명합니다

반드시 아래 JSON 형식으로만 답변하세요:
{
  "answer": "메인 답변 (마크다운 가능, **굵게** 활용, 조문 인용 포함)",
  "summary": ["핵심 요약 1", "핵심 요약 2", "핵심 요약 3"],
  "tips": ["실용적 팁 1", "실용적 팁 2"]
}`;

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { OPENAI_API_KEY, LAW_API_KEY } = context.env;
  if (!OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, 500);

  let question, history;
  try {
    ({ question, history } = await context.request.json());
  } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (!question || question.length > 1000) return json({ error: '질문이 비어있거나 너무 깁니다' }, 400);

  try {
    const apiKey = LAW_API_KEY || '';

    // ── Step 1: 질문 분석 — 법령명, 조문번호 추출 ──
    const query = extractLawQuery(question);

    // ── Step 2: 법제처 API 병렬 호출 (MCP chain_full_research와 동일) ──
    const searchKeyword = query.lawName || extractKeywords(question);

    const [lawSearchXml, precSearchXml] = await Promise.all([
      lawAPI(apiKey, 'lawSearch.do', { target: 'law', query: searchKeyword, display: '5' }),
      lawAPI(apiKey, 'lawSearch.do', { target: 'prec', query: searchKeyword, display: '3' }),
    ]);

    // ── Step 3: 법령 MST 획득 → 조문 조회 (MCP search_law → get_law_text) ──
    const lawList = parseLawSearch(lawSearchXml);
    const laws = [];
    const lawTexts = [];

    for (const law of lawList.slice(0, 3)) {
      if (query.joNo) {
        // 특정 조문 조회
        const article = await getArticle(apiKey, law.mst, query.joNo);
        if (article) {
          laws.push({ name: law.name, article: `제${query.joNo}조`, title: article.title, text: article.content });
          lawTexts.push(`[${law.name} 제${query.joNo}조 (${article.title})]\n${article.content}`);
        }
      } else {
        // 조문번호 없으면 법령 전체 주요 조문은 AI에게 맡김
        laws.push({ name: law.name, article: '', title: law.type, text: '' });
      }
    }

    // 조문을 못 찾았으면 법령 전문 텍스트의 앞부분이라도 가져오기
    if (lawTexts.length === 0 && lawList.length > 0 && !query.joNo) {
      // 키워드 관련 조문을 몇 개 가져와봄
      const mainLaw = lawList[0];
      const guessJos = guessArticleNumbers(question);
      for (const jo of guessJos.slice(0, 3)) {
        const article = await getArticle(apiKey, mainLaw.mst, jo);
        if (article) {
          laws.push({ name: mainLaw.name, article: `제${jo}조`, title: article.title, text: article.content });
          lawTexts.push(`[${mainLaw.name} 제${jo}조 (${article.title})]\n${article.content}`);
        }
      }
    }

    // ── Step 4: 판례 파싱 ──
    const precedents = parsePrecSearch(precSearchXml);

    // ── Step 5: 해석례 검색 (추가 컨텍스트) ──
    let interpText = '';
    if (searchKeyword) {
      const interpXml = await lawAPI(apiKey, 'lawSearch.do', { target: 'expc', query: searchKeyword, display: '2' });
      const interps = parseInterpSearch(interpXml);
      if (interps.length) {
        interpText = '=== 관련 해석례 ===\n' + interps.map(i => `[${i.title}]\n${i.summary}`).join('\n\n') + '\n\n';
      }
    }

    // ── Step 6: 컨텍스트 조합 ──
    let fullContext = '';
    if (lawTexts.length) fullContext += '=== 관련 법령 조문 ===\n' + lawTexts.join('\n\n') + '\n\n';
    if (precedents.length) {
      fullContext += '=== 관련 판례 ===\n';
      precedents.forEach(p => { fullContext += `[${p.court} ${p.caseNumber} (${p.date})]\n${p.summary}\n\n`; });
    }
    fullContext += interpText;
    if (!fullContext) fullContext = '(관련 법령을 찾지 못했습니다)';

    // ── Step 7: OpenAI Responses API ──
    const input = [
      { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
      ...(history || []).slice(-6).map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: h.role === 'assistant' ? 'output_text' : 'input_text', text: h.content }]
      })),
      { role: 'user', content: [{ type: 'input_text', text: `[법령 컨텍스트]\n${fullContext}\n\n[질문]\n${question}` }] }
    ];

    const aiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1', input, text: { format: { type: 'text' } }, temperature: 0.3, max_output_tokens: 2048, top_p: 1, store: true })
    });

    const aiData = await aiResp.json();
    if (aiData.error) return json({ error: aiData.error.message || 'AI 오류' }, 500);

    let rawText = '';
    if (aiData.output?.length > 0) {
      const msg = aiData.output.find(o => o.role === 'assistant');
      if (msg?.content?.length > 0) rawText = msg.content[0].text || '';
    }

    let parsed;
    try { parsed = JSON.parse(rawText); }
    catch { parsed = { answer: rawText, summary: [], tips: [] }; }

    return json({ answer: parsed.answer || '', summary: parsed.summary || [], tips: parsed.tips || [], laws, precedents });

  } catch (e) {
    return json({ error: e.message || '서버 오류' }, 500);
  }
}

// ══════════════════════════════════════
// 법제처 Open API 호출
// ══════════════════════════════════════

async function lawAPI(apiKey, endpoint, params) {
  const qs = new URLSearchParams({ OC: apiKey, type: 'XML', ...params });
  try {
    const resp = await fetch(`https://www.law.go.kr/DRF/${endpoint}?${qs}`);
    return await resp.text();
  } catch { return ''; }
}

// ── 법령 검색 파싱 ──

function parseLawSearch(xml) {
  if (!xml) return [];
  const results = [];
  const blocks = xml.match(/<law\s[^>]*>[\s\S]*?<\/law>/gi) || [];
  for (const b of blocks) {
    const mst = tag(b, '법령일련번호');
    const name = cdata(b, '법령명한글');
    const type = tag(b, '법령구분명');
    if (mst && name) results.push({ mst, name, type });
  }
  return results;
}

// ── 조문 조회 (MCP get_law_text에 해당) ──

async function getArticle(apiKey, mst, joNo) {
  if (!mst || !joNo) return null;
  const paddedJo = String(joNo).padStart(4, '0');
  const xml = await lawAPI(apiKey, 'lawService.do', { target: 'law', MST: mst, JO: paddedJo });
  if (!xml) return null;

  const title = cdata(xml, '조문제목') || '';
  let content = '';

  // 조문내용
  const joContent = cdata(xml, '조문내용');
  if (joContent) content += joContent + '\n';

  // 항내용
  const hangRe = /<항내용><!\[CDATA\[([\s\S]*?)\]\]><\/항내용>/gi;
  let m;
  while ((m = hangRe.exec(xml)) !== null) content += m[1].trim() + '\n';

  // 호내용
  const hoRe = /<호내용><!\[CDATA\[([\s\S]*?)\]\]>/gi;
  while ((m = hoRe.exec(xml)) !== null) content += '  ' + m[1].trim() + '\n';

  // 목내용
  const mokRe = /<목내용><!\[CDATA\[([\s\S]*?)\]\]>/gi;
  while ((m = mokRe.exec(xml)) !== null) content += '    ' + m[1].trim() + '\n';

  return content.trim() ? { title, content: content.trim() } : null;
}

// ── 판례 검색 파싱 ──

function parsePrecSearch(xml) {
  if (!xml) return [];
  const results = [];
  const blocks = xml.match(/<prec\s[^>]*>[\s\S]*?<\/prec>/gi) || [];
  for (const b of blocks) {
    results.push({
      id: tag(b, '판례일련번호'),
      court: cdata(b, '법원명') || tag(b, '법원명') || '대법원',
      caseNumber: cdata(b, '사건명') || tag(b, '사건명') || '',
      date: tag(b, '선고일자') || '',
      summary: (cdata(b, '판례내용') || tag(b, '판례내용') || '').slice(0, 500)
    });
  }
  return results;
}

// ── 해석례 검색 파싱 ──

function parseInterpSearch(xml) {
  if (!xml) return [];
  const results = [];
  const blocks = xml.match(/<expc\s[^>]*>[\s\S]*?<\/expc>/gi) || [];
  for (const b of blocks) {
    results.push({
      title: cdata(b, '해석례제목') || cdata(b, '사건명') || tag(b, '사건명') || '',
      summary: (cdata(b, '요지') || cdata(b, '해석례내용') || '').slice(0, 400)
    });
  }
  return results;
}

// ══════════════════════════════════════
// 질문 분석 유틸
// ══════════════════════════════════════

function extractLawQuery(question) {
  // 법령명 추출 (약칭 자동 변환)
  const aliases = {
    '교특법': '교통사고처리특례법', '특가법': '특정범죄가중처벌법등에관한법률',
    '자배법': '자동차손해배상보장법', '화관법': '화학물질관리법',
    '산안법': '산업안전보건법', '근기법': '근로기준법',
    '남녀고용법': '남녀고용평등과일ㆍ가정양립지원에관한법률',
    '개인정보법': '개인정보보호법', '정통망법': '정보통신망이용촉진및정보보호등에관한법률',
  };

  // 약칭 먼저 체크
  let lawName = null;
  for (const [alias, full] of Object.entries(aliases)) {
    if (question.includes(alias)) { lawName = full; break; }
  }

  // 전체 법령명 추출 (X법, X법 시행령, X법 시행규칙)
  if (!lawName) {
    const lawMatch = question.match(/([가-힣]+(?:법|령|규칙)(?:\s*시행[령규칙])?)/);
    if (lawMatch) lawName = lawMatch[1];
  }

  // 조문번호 추출: "제74조", "74조", "제148조의2"
  let joNo = null;
  const joMatch = question.match(/제?(\d+)조/);
  if (joMatch) joNo = joMatch[1];

  return { lawName, joNo };
}

function extractKeywords(question) {
  const stopwords = ['은','는','이','가','을','를','의','에','에서','로','으로','도','만','까지','부터',
    '인데','인가요','일까요','인지','건가요','할까요','하면','해도','되나요','합니다','입니다','어떻게','얼마',
    '좀','제가','저는','나는','저','나','요','네','것','때','수','시','해서','하고','해요','하나요',
    '알려주세요','알려줘','뭐예요','무엇','어떤','대해','관련','기준','방법','절차'];
  return question.replace(/[?!.,]/g, '').split(/\s+/)
    .filter(w => w.length > 1 && !stopwords.includes(w)).slice(0, 5).join(' ');
}

function guessArticleNumbers(question) {
  // 키워드로 관련 조문번호 추측 (자주 묻는 조문)
  const keywordMap = {
    '음주': ['44', '93', '148'],
    '면허': ['82', '83', '93'],
    '신호': ['5', '156'],
    '속도': ['17', '156'],
    '사고': ['54', '148'],
    '보험': ['5', '46'],
    '주차': ['32', '33', '34'],
    '벌점': ['93'],
  };
  for (const [kw, jos] of Object.entries(keywordMap)) {
    if (question.includes(kw)) return jos;
  }
  return [];
}

// ── XML 헬퍼 ──

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].trim() : '';
}

function cdata(xml, name) {
  const m = xml.match(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`));
  return m ? m[1].trim() : '';
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
