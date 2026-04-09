# DT Club 교통법률 AI 에이전트 기획안

> 작성일: 2026-04-09
> 대상: dt-club 서브앱 (`/legal/`)
> 핵심: korean-law MCP가 사용하는 법제처 Open API를 Cloudflare Worker에서 직접 호출 → AI가 종합 답변

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| **기능명** | DT 법률 도우미 (DT Legal AI) |
| **경로** | `/legal/` (독립 서브앱) |
| **컨셉** | 교통/운전 전문 AI 에이전트 — 질문하면 **실제 법령·판례를 근거로** 변호사처럼 답변 |
| **대상** | 전체 접근 가능 (회원은 상담 이력 저장) |

### 핵심 포인트

```
사용자: "음주 0.05%인데 면허 취소인가요?"
    │
    ▼
DT 법률 도우미 (AI 에이전트)
    │
    ├─ 법제처 API로 도로교통법 제93조 원문 검색
    ├─ 판례 API로 관련 대법원 판례 검색
    ├─ AI가 법령+판례를 종합하여 쉽게 설명
    │
    ▼
"0.05%는 면허 정지(100일) 대상입니다."
 + 📖 근거 법령 원문 (접기/펼치기)
 + ⚖️ 관련 판례 요약
 + 💡 이의신청 방법 등 실용 팁
```

---

## 2. 구현 아키텍처

### korean-law MCP 활용 방식

korean-law MCP(`chrisryugj/korean-law-mcp`)는 내부적으로 **법제처 Open API**를 호출합니다. DT 홈페이지에서는 **같은 법제처 API를 Cloudflare Worker에서 직접 호출**하는 방식입니다.

```
                    korean-law MCP (참고 구조)
                    ┌───────────────────────┐
                    │ 14개 도구             │
                    │ ├─ search_ai_law      │
                    │ ├─ search_law         │
                    │ ├─ get_law_text       │── 법제처 Open API
                    │ ├─ search_precedents  │
                    │ ├─ chain_full_research│
                    │ └─ ...               │
                    └───────────────────────┘
                              ↕ (같은 API)
┌──────────┐    ┌──────────────────┐    ┌─────────────────┐
│ /legal/  │───▶│ dt-legal-worker  │───▶│ 법제처 Open API  │
│ 프론트엔드│◀───│ (Cloudflare)     │    │ (무료 공공데이터) │
│          │    │                  │───▶│ OpenAI GPT-4.1   │
└──────────┘    └──────────────────┘    └─────────────────┘
```

### 왜 Worker에서 직접 호출하나?

| 방식 | 장점 | 단점 |
|------|------|------|
| **MCP 서버 경유** | MCP 체인 기능 활용 | 별도 서버 필요, 비용 발생 |
| **Worker 직접 호출 (채택)** | 무료, 빠름, 기존 Worker 패턴 동일 | API 호출 로직 직접 구현 |
| **Claude API + MCP** | 가장 강력 | Anthropic API 비용, 복잡도 높음 |

→ MCP가 내부적으로 하는 것(법제처 API 호출 → 결과 정리)을 Worker에서 동일하게 구현

---

## 3. 법제처 Open API 매핑

korean-law MCP 도구 → 법제처 API 엔드포인트 매핑:

| MCP 도구 | 법제처 API | URL | 용도 |
|---------|-----------|-----|------|
| `search_ai_law` | AI 의미검색 | `www.law.go.kr/DRF/lawSearch.do` + `type=AI` | 자연어로 관련 조문 검색 **(핵심)** |
| `search_law` | 법령 검색 | `www.law.go.kr/DRF/lawSearch.do` | 법령명으로 검색 |
| `get_law_text` | 법령 조문 | `www.law.go.kr/DRF/lawService.do` | 조문 원문 조회 |
| `get_article_detail` | 조문 상세 | `www.law.go.kr/DRF/lawService.do` + 조항 | 특정 조문 |
| `search_precedents` | 판례 검색 | `www.law.go.kr/DRF/precSearch.do` | 판례 목록 |
| `get_precedent_text` | 판례 전문 | `www.law.go.kr/DRF/precService.do` | 판례 원문 |
| `search_interpretations` | 해석례 | `www.law.go.kr/DRF/explSearch.do` | 법령 해석례 |
| `search_admin_appeals` | 행정심판 | `www.law.go.kr/DRF/admRulSearch.do` | 행정심판례 |
| `get_three_tier` | 3단 비교 | 법률+시행령+시행규칙 조회 | 위임 구조 |

### 법제처 API 인증키 (OC)

- 법제처 Open API 키: [www.law.go.kr](https://www.law.go.kr) 에서 무료 발급
- Worker 환경변수: `LAW_API_KEY` (= OC 파라미터)
- 호출 제한: 일 1,000회 (무료)

---

## 4. Worker 설계 (`dt-legal-worker.js`)

### 4-1. API 엔드포인트

```
POST /api/legal
Content-Type: application/json

Request:
{
  "question": "음주 0.05%인데 면허 취소인가요?",
  "history": [                    // 이전 대화 (최근 5턴)
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}

Response:
{
  "answer": "혈중알코올농도 0.05%는 면허 정지 대상입니다...",
  "summary": [
    "0.03~0.08%: 면허 정지 (100일)",
    "0.08% 이상: 면허 취소",
    "형사처벌: 1년 이하 징역 또는 500만원 이하 벌금"
  ],
  "laws": [
    {
      "name": "도로교통법",
      "article": "제93조 제1항",
      "title": "운전면허의 취소·정지",
      "text": "시·도경찰청장은..."
    }
  ],
  "precedents": [
    {
      "court": "대법원",
      "caseNumber": "2022도12345",
      "date": "2023-03-15",
      "summary": "음주측정 거부 시 면허취소 적법성..."
    }
  ],
  "tips": [
    "임시운전면허증 신청 가능",
    "처분 통지 후 90일 이내 행정심판 청구 가능"
  ]
}
```

### 4-2. Worker 내부 처리 흐름

```javascript
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsResponse();

    const { question, history } = await request.json();

    // ── Step 1: 법제처 API 병렬 호출 ──
    const [aiLawResult, precResult, explResult] = await Promise.all([
      // AI 의미검색 — 자연어로 관련 조문 찾기
      lawAPI(env, '/lawSearch.do', {
        query: question, type: 'AI', display: 5
      }),
      // 판례 검색
      lawAPI(env, '/precSearch.do', {
        query: extractKeywords(question), display: 3
      }),
      // 해석례 검색
      lawAPI(env, '/explSearch.do', {
        query: extractKeywords(question), display: 3
      }),
    ]);

    // ── Step 2: 상세 조문 조회 (상위 결과만) ──
    const topLaws = parseSearchResult(aiLawResult).slice(0, 3);
    const lawDetails = await Promise.all(
      topLaws.map(l => lawAPI(env, '/lawService.do', {
        MST: l.mst, joNo: l.articleNo
      }))
    );

    // ── Step 3: AI 종합 답변 생성 ──
    const context = buildContext(lawDetails, precResult, explResult);
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0.3,      // 법률 → 정확성 우선
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: LEGAL_SYSTEM_PROMPT },
          ...history.slice(-10),
          { role: 'user', content: `[법령 컨텍스트]\n${context}\n\n[질문]\n${question}` }
        ]
      })
    });

    const result = await aiResponse.json();
    return new Response(JSON.stringify(
      JSON.parse(result.choices[0].message.content)
    ), { headers: corsHeaders });
  }
};

// 법제처 API 호출 헬퍼
async function lawAPI(env, path, params) {
  params.OC = env.LAW_API_KEY;
  params.type = params.type || 'XML';
  const url = `https://www.law.go.kr/DRF${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { cf: { cacheTtl: 3600 } }); // 1시간 캐시
  return res.text();
}
```

### 4-3. 시스템 프롬프트

```
당신은 DT Club의 교통·운전 전문 법률 AI 도우미입니다.

역할:
- 운전/교통 관련 법률 질문에 정확하고 쉽게 답변합니다
- 반드시 [법령 컨텍스트]에 제공된 법령·판례를 근거로 답변합니다
- 법률 용어는 일반인이 이해할 수 있게 풀어서 설명합니다
- 운전자에게 실용적인 조언(팁)을 함께 제공합니다

답변 원칙:
1. 근거 없는 추측 금지 — 법 조문이 없으면 "확인 필요"로 안내
2. [법령 컨텍스트] 데이터가 최우선 — AI 자체 지식보다 제공된 법령 우선
3. 면책 조항 불필요 — 프론트에서 자동 표시됨
4. 한국어로 쉽게 — 법조문 인용 시 핵심만 발췌

전문 분야:
- 도로교통법 (음주, 신호위반, 속도, 면허)
- 교통사고처리특례법 (12대 중과실, 과실비율)
- 자동차관리법 (등록, 매매, 하자)
- 자동차손해배상보장법 (보험, 손해배상)
- 특정범죄가중처벌법 (도주차량, 위험운전)

JSON으로 답변: { "answer": "...", "summary": [...], "tips": [...] }
```

### 4-4. Wrangler 설정

```toml
# wrangler-legal.toml
name = "dt-legal"
main = "dt-legal-worker.js"
compatibility_date = "2024-09-23"

[vars]
# 법제처 API 키는 secrets로 관리
# wrangler secret put LAW_API_KEY
# wrangler secret put OPENAI_API_KEY
```

---

## 5. 프론트엔드 화면 설계

### 5-1. 메인 화면

```
┌─────────────────────────────────────┐
│ ⚖️ DT 법률 도우미            [← 홈] │
│ 교통·운전 AI 법률 상담              │
│  ─────────────────────────────────  │
│                                     │
│  🔥 자주 묻는 질문                   │
│  ┌──────────┐ ┌──────────┐         │
│  │ 🍺 음주운전│ │ 🚦 신호위반│         │
│  │ 처벌 기준 │ │ 범칙금    │         │
│  └──────────┘ └──────────┘         │
│  ┌──────────┐ ┌──────────┐         │
│  │ 📋 면허정지│ │ 💥 교통사고│         │
│  │ /취소 기준│ │ 과실 비율 │         │
│  └──────────┘ └──────────┘         │
│  ┌──────────┐ ┌──────────┐         │
│  │ 💰 과태료 │ │ 📄 중고차 │         │
│  │ 불복 방법 │ │ 계약 분쟁 │         │
│  └──────────┘ └──────────┘         │
│  ┌──────────┐ ┌──────────┐         │
│  │ 🛡️ 보험  │ │ 🅿️ 주차   │         │
│  │ 분쟁 해결 │ │ 관련 법규 │         │
│  └──────────┘ └──────────┘         │
│                                     │
│  ─────────────────────────────────  │
│  [무엇이 궁금하신가요?       ] [전송] │
│  ─────────────────────────────────  │
│  ⚠️ 본 상담은 참고용이며 법적 효력이   │
│  없습니다. 정확한 법률 상담은 변호사와. │
└─────────────────────────────────────┘
```

### 5-2. 대화 진행 화면

```
┌─────────────────────────────────────┐
│ ⚖️ DT 법률 도우미          [새 상담] │
│  ─────────────────────────────────  │
│                                     │
│  ┌─ 나 ─────────────────────────┐  │
│  │ 음주 측정 0.05%인데           │  │
│  │ 면허 취소인가요 정지인가요?    │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌─ ⚖️ AI 법률 도우미 ──────────┐  │
│  │                               │  │
│  │ 혈중알코올농도 0.05%는         │  │
│  │ **면허 정지** 대상입니다.      │  │
│  │                               │  │
│  │ ┌ 📋 핵심 요약 ────────────┐ │  │
│  │ │ • 0.03~0.08%: 면허 정지  │ │  │
│  │ │   (100일)                │ │  │
│  │ │ • 0.08% 이상: 면허 취소  │ │  │
│  │ │ • 형사: 1년↓징역/500만↓벌금│ │  │
│  │ └─────────────────────────┘ │  │
│  │                               │  │
│  │ ┌ 📖 근거 법령 ────────────┐ │  │
│  │ │ ▶ 도로교통법 제93조 제1항 │ │  │  ← 클릭→원문 펼침
│  │ │ ▶ 도로교통법 제148조의2   │ │  │
│  │ └─────────────────────────┘ │  │
│  │                               │  │
│  │ ┌ ⚖️ 관련 판례 ────────────┐ │  │
│  │ │ 대법원 2022도12345        │ │  │
│  │ │ "음주측정 거부 시..."     │ │  │
│  │ │ [▼ 판례 요약 더 보기]     │ │  │
│  │ └─────────────────────────┘ │  │
│  │                               │  │
│  │ ┌ 💡 실용 팁 ──────────────┐ │  │
│  │ │ • 임시운전면허 신청 가능  │ │  │
│  │ │ • 90일 이내 행정심판 가능 │ │  │
│  │ └─────────────────────────┘ │  │
│  └──────────────────────────────┘  │
│                                     │
│  ─────────────────────────────────  │
│  [추가 질문...                ] [전송]│
│  ⚠️ 참고용 정보입니다.               │
└─────────────────────────────────────┘
```

### 5-3. 법령 원문 접기/펼치기 상세

```
▶ 도로교통법 제93조 제1항 (운전면허의 취소·정지)
   ↓ 클릭하면 펼침
▼ 도로교통법 제93조 제1항 (운전면허의 취소·정지)
┌──────────────────────────────────────┐
│ ① 시·도경찰청장은 운전면허(연습운전   │
│ 면허를 포함한다)를 받은 사람이 다음 각 │
│ 호의 어느 하나에 해당하면 행정안전부령  │
│ 으로 정하는 기준에 따라 운전면허를       │
│ 취소하거나 1년 이내의 범위에서 운전면허 │
│ 의 효력을 정지시킬 수 있다...           │
│                                       │
│ 1. 제44조제1항 또는 제2항을 위반하여    │
│    술에 취한 상태에서 자동차등을 운전한  │
│    경우                                │
│ 2. (이하 생략)                          │
└──────────────────────────────────────┘
```

---

## 6. 프리셋 질문 데이터

```javascript
const LEGAL_PRESETS = [
  { id: 'drunk',     icon: '🍺', title: '음주운전 처벌 기준',
    query: '음주운전 혈중알코올농도별 처벌 기준과 면허 정지/취소 기준' },
  { id: 'signal',    icon: '🚦', title: '신호위반 범칙금',
    query: '신호위반 시 범칙금과 벌점은 얼마인가요' },
  { id: 'license',   icon: '📋', title: '면허 정지/취소 기준',
    query: '운전면허 정지와 취소 기준, 벌점 누적 기준' },
  { id: 'accident',  icon: '💥', title: '교통사고 과실 비율',
    query: '교통사고 과실 비율 판정 기준과 12대 중과실' },
  { id: 'fine',      icon: '💰', title: '과태료 불복 방법',
    query: '교통 과태료 이의신청 및 불복 절차' },
  { id: 'usedcar',   icon: '📄', title: '중고차 계약 분쟁',
    query: '중고차 매매 하자 발견 시 환불 방법과 관련 법률' },
  { id: 'insurance', icon: '🛡️', title: '보험 분쟁 해결',
    query: '자동차 보험 사고 처리 시 보험사 분쟁 해결 방법' },
  { id: 'parking',   icon: '🅿️', title: '주차 관련 법규',
    query: '불법주정차 과태료 기준과 견인 관련 법률' },
];
```

---

## 7. 데이터 모델

### Firestore: `legal_chats` (회원 전용 상담 이력)

```javascript
{
  id: auto,
  userId: string,              // Firebase UID
  title: string,               // 첫 질문 자동 요약
  messages: [
    {
      role: 'user' | 'assistant',
      content: string,
      laws: [{ name, article, title, text }],       // assistant만
      precedents: [{ court, caseNumber, summary }],  // assistant만
      tips: [string],
      timestamp: number
    }
  ],
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Firestore 보안 규칙

```
match /legal_chats/{chatId} {
  allow create: if isRealUser();
  allow read, update, delete: if isAuth()
    && resource.data.userId == request.auth.uid;
}
```

---

## 8. 파일 구조

```
dt/
├── legal/                      # 서브앱
│   ├── index.html              # HTML 셸
│   ├── app.js                  # 프론트엔드 로직
│   │   ├── LEGAL_PRESETS       # 프리셋 질문
│   │   ├── renderChat()        # 채팅 UI
│   │   ├── sendQuestion()      # API 호출
│   │   ├── renderAnswer()      # 답변 렌더링 (법령카드, 판례카드)
│   │   ├── toggleLawText()     # 법령 원문 접기/펼치기
│   │   └── saveChatHistory()   # 상담 이력 저장
│   └── style.css               # 스타일
│
├── functions/
│   ├── dt-legal-worker.js      # Cloudflare Worker
│   │   ├── lawAPI()            # 법제처 API 호출 헬퍼
│   │   ├── extractKeywords()   # 질문에서 키워드 추출
│   │   ├── buildContext()      # 법령+판례 컨텍스트 구성
│   │   └── LEGAL_SYSTEM_PROMPT # AI 시스템 프롬프트
│   └── wrangler-legal.toml     # Worker 설정
```

---

## 9. 사용 시나리오

### 시나리오 1: 음주운전 처벌 문의

```
사용자: "어제 음주 측정에 걸렸는데 0.05%였어요"

Worker 처리:
  ①법제처 AI검색("음주운전 0.05% 처벌")
    → 도로교통법 제44조, 제93조, 제148조의2 발견
  ② 판례 검색("음주운전 면허정지")
    → 대법원 2022도12345 등 3건
  ③ 조문 상세 조회 (제93조 원문)
  ④ GPT-4.1-mini가 종합 → JSON 응답

답변:
  "0.05%는 면허 정지(100일) 대상입니다.
   형사처벌: 1년↓징역 또는 500만↓벌금..."
  + 📖 도로교통법 제93조 원문
  + ⚖️ 대법원 판례 요약
  + 💡 임시면허 신청, 행정심판 안내
```

### 시나리오 2: 교통사고 과실 비율

```
사용자: "직진 중인데 좌회전 차량이랑 부딪혔어요"

Worker 처리:
  ① AI검색("직진 좌회전 교통사고 과실비율")
  ② 판례 검색("직진 좌회전 과실")
  ③ 교통사고처리특례법 조문 조회
  ④ GPT 종합

답변:
  "직진 vs 좌회전 → 일반적으로 직진 10~20% : 좌회전 80~90%..."
  + 교특법 근거
  + 유사 판례
  + 보험 처리 팁
```

### 시나리오 3: 과태료 이의신청

```
사용자: "CCTV 단속 과태료가 날아왔는데 이의신청 하고 싶어요"

Worker 처리:
  ① AI검색("교통 과태료 이의신청 절차")
  ② 판례 검색("과태료 이의신청")
  ③ 행정심판례 검색("교통 과태료")

답변:
  "과태료 이의신청은 통지서 수령 후 60일 이내..."
  + 질서위반행위규제법 근거
  + 이의신청서 작성 요령 팁
```

---

## 10. 비용 추정

| 항목 | 비용 | 비고 |
|------|------|------|
| 법제처 Open API | **무료** | 일 1,000회 |
| OpenAI GPT-4.1-mini | 질문당 ~$0.003 | input $0.40/M, output $1.60/M |
| Cloudflare Worker | **무료** | 일 10만 요청 |
| Firestore | **무료** | 일 2만 reads/writes |
| **월 총 예상** | **$5~15** | 하루 50~100건 가정 |

---

## 11. 법제처 API 키 발급 방법

```
1. https://www.law.go.kr 접속
2. 회원가입 → 로그인
3. [Open API] → [인증키 발급]
4. 용도: "교통법률 정보 서비스"
5. 발급된 OC 키를 Worker에 설정:
   wrangler secret put LAW_API_KEY
```

---

## 12. 구현 단계

```
Phase 1: Worker 백엔드 (2~3일)
  ├─ dt-legal-worker.js 기본 구조
  ├─ 법제처 API 호출 함수 (search, get_text)
  ├─ OpenAI GPT 통합 + 시스템 프롬프트
  ├─ JSON 응답 구조화
  └─ 캐싱 (동일 질문 1시간)

Phase 2: 프론트엔드 UI (2일)
  ├─ /legal/ 서브앱 (index.html, app.js, style.css)
  ├─ 프리셋 질문 카드 그리드
  ├─ 채팅 인터페이스 (입력, 버블, 로딩)
  ├─ 답변 렌더링 (요약, 법령 접기, 판례 카드)
  └─ 모바일 반응형

Phase 3: 상담 이력 + 연동 (1일)
  ├─ Firestore legal_chats 저장/불러오기
  ├─ dt 메인 홈에 링크 추가
  └─ 면책 고지 UI 고정

Phase 4: 고도화 (선택)
  ├─ 후속 질문 추천 ("이것도 궁금하신가요?")
  ├─ 법령 가이드 탭 (카테고리별 상시 정보)
  ├─ 상담 내역 공유/내보내기
  └─ 법령 개정 알림 (push)
```

---

## 13. 주의사항

| 항목 | 대응 |
|------|------|
| **변호사법** | 유료 상담 X, 무료 정보 제공 + "참고용" 명시 |
| **면책 조항** | 모든 화면 하단 고정: "법적 효력 없음, 변호사 상담 권장" |
| **정확성** | 법제처 실데이터 기반 → AI 환각 최소화 |
| **개인정보** | 상담 내용 본인만 열람, 30일 자동 삭제 옵션 |
| **법령 최신성** | 법제처 API = 최신 법령 보장, 캐시 TTL 24시간 이내 |
| **API 한도** | 일 1,000회 → 인기 질문 캐싱으로 대응 |

---

## 14. dt 메인에서의 진입점

### 홈 히어로에 링크 추가

```html
<div class="hero-buttons">
  <a href="spots/" class="btn btn-primary">📍 DT 스팟</a>
  <a href="ai-trend/" class="btn btn-outline">🤖 AI 트렌드</a>
  <a href="car-trend/" class="btn btn-outline">🚘 자동차 트렌드</a>
  <a href="legal/" class="btn btn-outline">⚖️ 법률 도우미</a>  <!-- 추가 -->
</div>
```

### 드라이브 가이드(`/guide/`)와의 시너지

- 가이드의 "경고등 설명" → 법률 도우미로 "이 경고등 무시하면 법적 문제?" 연결
- 가이드의 "초보 운전 팁" → 법률 도우미로 "초보 운전자 면허 관련 법규" 연결
