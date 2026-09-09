# DT Club 재테크 탭 — 국내주식 기획안

> 작성일: 2026-09-09
> 대상: dt-club 서브앱 (`/invest/`)
> 범위: 1차 국내주식 (KOSPI/KOSDAQ) — 이후 부동산·연금·절세로 확장
> 핵심: 관리자 시황 브리핑 + 종목별 커뮤니티 + 모바일 차트를 **기존 ai-trend/car-trend 패턴 그대로** 구현

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| **기능명** | DT 재테크 (DT Invest) |
| **경로** | `/invest/` (독립 서브앱, 내부 탭으로 자산군 확장) |
| **1차 범위** | 국내주식 — 시황 브리핑 / 종목 검색 / 차트 / 종목별 커뮤니티 |
| **대상** | 열람 = 전체 공개 / 글·댓글 작성 = 실제 회원만 (게스트 불가) |
| **관리자 역할** | 시황 브리핑 작성·고정, 커뮤니티 신고 처리, 관심종목 큐레이션 |

### 핵심 흐름

```
                     /invest/  (재테크 홈)
                          │
   ┌──────────────────────┼──────────────────────┐
   │                      │                      │
   ▼                      ▼                      ▼
📋 시황 브리핑         🔍 종목                🗣️ 커뮤니티
(관리자 작성)          검색·상세               (종목별 게시판)
   │                      │                      │
   ├─ 💬 댓글             ├─ 📈 차트(일/주/월)   ├─ 강세/약세 태그
   ├─ 📌 상단 고정        ├─ 💰 현재가·등락률    ├─ 좋아요·댓글
   └─ 🤖 AI 초안 생성     ├─ ⭐ 관심종목 추가    └─ 🚨 신고
                          └─ 🔗 증권사 앱 열기
```

### 왜 독립 서브앱인가 (메인 탭 아님)

| 방식 | 장점 | 단점 |
|------|------|------|
| 메인 `index.html`에 `page-invest` 추가 | 하단 nav에서 바로 접근 | **app.js가 이미 256KB / 170개 함수** — 더 키우면 유지보수 한계. 하단 nav 5칸도 이미 포화 |
| **독립 서브앱 `/invest/` (채택)** | ai-trend·car-trend·legal과 동일 패턴, 코드 격리, 자산군 확장 시 내부 탭으로 흡수 | 진입점을 홈에 별도로 배치해야 함 |

→ 진입점은 **홈 히어로 버튼 + 편의 기능 카드 + 홈 브리핑 탭 3번째 슬롯**에 배치 (§10 참조)

---

## 2. 데이터 소스 — 가장 중요한 결정

국내주식은 "무료 실시간"이 사실상 없습니다. 재배포 제약 때문입니다. 3단 구조로 갑니다.

| 티어 | 소스 | 지연 | 비용 | 용도 | 도입 시점 |
|------|------|------|------|------|----------|
| **T1** | [KRX Open API](https://openapi.krx.co.kr/) | EOD(장마감 후) | 무료 | 종목 마스터, 일별 시세, 일봉 차트 데이터 | Phase 1 |
| **T2** | [TradingView 무료 위젯](https://www.tradingview.com/widget/) (`KRX:005930`) | 지연 | 무료 | 종목 상세 **실시간형 차트** (iframe) | Phase 1 |
| **T3** | [KIS Developers OpenAPI](https://apiportal.koreainvestment.com/apiservice) (한국투자증권) | 실시간 (REST + WebSocket) | 무료 (계좌 필요) | 현재가·호가·체결 | Phase 3 |
| 보조 | [공공데이터포털 금융위 주식시세정보](https://www.data.go.kr/data/15094808/openapi.do) | **T+1 오후 1시** | 무료 | KRX API 장애 시 백업 | Phase 2 |

### 각 소스 실무 메모

**KRX Open API** — `openapi.krx.co.kr` 가입 → 마이페이지에서 인증키 신청(영업일 1일 승인) → **서비스별로 따로 신청**해야 함. 필요한 서비스: `유가증권 일별매매정보`, `코스닥 일별매매정보`, `유가증권 종목기본정보`, `코스닥 종목기본정보`, `KOSPI 시리즈 일별시세정보`. 2010년부터 데이터 제공.

**TradingView 위젯** — Advanced Chart 위젯을 iframe으로 삽입. 심볼 포맷 `KRX:005930`. 캔들/이동평균/거래량이 기본 제공되고 **모바일 터치 확대·스크롤이 이미 최적화**되어 있음. Phase 1에서 차트 개발 비용을 0으로 만드는 가장 실용적인 선택. 시세 제공 책임도 TradingView에 있음.

**KIS OpenAPI** — 별도 이용료 없음. 실시간 WebSocket 지원. 단, **계좌 개설 필요**(모의투자 계좌로도 발급 가능)하고 `appkey`/`appsecret`으로 발급받은 액세스 토큰은 **개인 사용 전제**. 다수 회원에게 뿌리는 순간 시세 재배포 영역에 들어가므로 §9-3 참조.

**공공데이터포털** — 전 종목 일별 시세를 한 번에 받기 좋지만 **기준일 다음 영업일 오후 1시 이후** 갱신(금요일 데이터는 월요일 제공). 실시간 용도로는 부적합, 백업용.

### 시세 정확도 표기 원칙

화면에 항상 데이터 성격을 명시합니다. 사용자 신뢰 + 법적 안전 양쪽에 필요합니다.

```
┌──────────────────────────────────┐
│ 삼성전자  005930      KOSPI      │
│ 71,200원   ▲ 900 (+1.28%)        │
│ ⓘ 2026.09.08 종가 기준 · KRX     │  ← 항상 노출
└──────────────────────────────────┘
```

---

## 3. Worker 설계 (`dt-stock-worker.js`)

기존 `dt-opinet` / `dt-rss` 워커와 동일 구조. `functions/` 아래 배치.

### 3-1. 엔드포인트

```
GET  /api/symbols?q=삼성          → 종목 검색 (KV 마스터에서 조회)
GET  /api/quote?code=005930       → 최신 일별 시세 1건
GET  /api/ohlc?code=005930&n=120  → 일봉 N개 (자체 차트용, Phase 2)
GET  /api/index                   → 코스피·코스닥·환율 요약
GET  /api/movers?market=KOSPI     → 등락률 상위/하위 10
POST /api/briefing/draft          → 시황 브리핑 AI 초안 (관리자 전용)
GET  /api/health
```

### 3-2. 응답 예시

```json
GET /api/quote?code=005930
{
  "code": "005930",
  "name": "삼성전자",
  "market": "KOSPI",
  "date": "20260908",
  "close": 71200,
  "change": 900,
  "changeRate": 1.28,
  "open": 70500, "high": 71500, "low": 70300,
  "volume": 12043221,
  "marketCap": 425300000000000,
  "source": "KRX",
  "asOf": "2026-09-08T15:30:00+09:00",
  "delayed": true
}
```

### 3-3. 캐시 전략 (KV: `STOCK_CACHE`)

| 키 | 내용 | TTL | 갱신 방식 |
|----|------|-----|----------|
| `symbols:v1` | 전 종목 마스터 (코드·명·시장·업종) | 24h | Cron 매일 06:00 |
| `daily:{YYYYMMDD}` | 그날 전 종목 일별 시세 | 7d | Cron 평일 18:00 |
| `index:latest` | 지수·환율 요약 | 10m | 요청 시 갱신 |
| `movers:{market}:{date}` | 등락률 상위 | 12h | daily에서 파생 |

**전 종목을 하루 1번만 당겨서 KV에 넣는 구조**가 핵심입니다. 종목별로 API를 때리면 KRX 호출 한도에 금방 걸립니다.

### 3-4. Cron 트리거

```toml
# functions/wrangler-stock.toml
name = "dt-stock"
main = "dt-stock-worker.js"
compatibility_date = "2024-12-01"

[[kv_namespaces]]
binding = "STOCK_CACHE"
id = "<wrangler kv namespace create STOCK_CACHE 로 생성>"

[triggers]
crons = ["0 21 * * 1-5", "0 21 * * 0"]   # UTC 21:00 = KST 06:00

# Secrets
# wrangler secret put KRX_API_KEY      --config functions/wrangler-stock.toml
# wrangler secret put OPENAI_API_KEY   --config functions/wrangler-stock.toml
# wrangler secret put ADMIN_SECRET     --config functions/wrangler-stock.toml
```

배포 후 URL: `https://dt-stock.shocguna.workers.dev`

---

## 4. Firestore 데이터 모델

### 4-1. 컬렉션

```
invest_briefings/{briefingId}              # 관리자 시황 브리핑
  date          "2026-09-09"
  title         "9/9 시황 — 반도체 반등, 금리 관망"
  body          (본문, 줄바꿈 보존)
  market        "all" | "kospi" | "kosdaq"
  tickers       ["005930", "000660"]        # 언급 종목 → 칩으로 렌더
  sentiment     "bull" | "bear" | "neutral" # 브리핑 톤 배지
  authorName    "운영진"
  pinned        false
  commentCount  0
  createdAt     timestamp
  updatedAt     timestamp

  └─ comments/{commentId}                   # ★ 브리핑 댓글
       authorUid, authorName, authorPhoto
       body
       parentId      null | "<commentId>"   # 1단계 대댓글
       likes, likedBy[]
       createdAt

stock_boards/{code}/posts/{postId}          # 종목별 커뮤니티
  authorUid, authorName
  title, body
  sentiment     "bull" | "bear" | "neutral"
  likes, likedBy[]
  commentCount
  reportCount                               # 신고 누적
  createdAt

  └─ comments/{commentId}                   # 종목글 댓글 (구조 동일)

stock_watchlist/{uid}                       # 내 관심종목
  codes         ["005930", "035420"]
  updatedAt

stock_reports/{reportId}                    # 신고 접수 (관리자 처리용)
  targetPath    "stock_boards/005930/posts/abc"
  reason, reporterUid, status, createdAt

invest_config/settings                      # 면책 문구·공지·기능 플래그
  disclaimer, notice, featureFlags{}
```

### 4-2. 보안 규칙 (`firestore.rules` 추가분)

기존 헬퍼(`isAuth` / `isRealUser` / `isAdmin`)를 그대로 씁니다.

```javascript
// ── invest_briefings (관리자 시황 브리핑) ──────────────────
// - 누구나 읽기 (비회원도 브리핑은 볼 수 있게)
// - 작성·수정·삭제는 관리자만
// - 댓글은 실제 회원만 작성, 본인/관리자만 삭제
match /invest_briefings/{briefingId} {
  allow read: if true;
  allow create, delete: if isAdmin();
  allow update: if isAdmin()
    || (isRealUser() && request.resource.data.diff(resource.data)
          .affectedKeys().hasOnly(['commentCount']));

  match /comments/{commentId} {
    allow read: if true;
    allow create: if isRealUser()
      && request.resource.data.authorUid == request.auth.uid
      && request.resource.data.body.size() <= 1000;
    allow update: if isRealUser()
      && (resource.data.authorUid == request.auth.uid
          || request.resource.data.diff(resource.data)
               .affectedKeys().hasOnly(['likes', 'likedBy']));
    allow delete: if isAdmin()
      || (isRealUser() && resource.data.authorUid == request.auth.uid);
  }
}

// ── stock_boards (종목별 커뮤니티) ─────────────────────────
match /stock_boards/{code}/posts/{postId} {
  allow read: if true;
  allow create: if isRealUser()
    && request.resource.data.authorUid == request.auth.uid
    && request.resource.data.body.size() <= 3000;
  // ★ 본문 조작 방지: 본인 글이 아니면 좋아요/신고/댓글수 필드만 변경 가능
  allow update: if isAdmin()
    || (isRealUser() && resource.data.authorUid == request.auth.uid)
    || (isRealUser() && request.resource.data.diff(resource.data)
          .affectedKeys().hasOnly(['likes', 'likedBy', 'commentCount', 'reportCount']));
  allow delete: if isAdmin()
    || (isRealUser() && resource.data.authorUid == request.auth.uid);

  match /comments/{commentId} {
    allow read: if true;
    allow create: if isRealUser()
      && request.resource.data.authorUid == request.auth.uid
      && request.resource.data.body.size() <= 1000;
    allow delete: if isAdmin()
      || (isRealUser() && resource.data.authorUid == request.auth.uid);
  }
}

// ── stock_watchlist (내 관심종목) ──────────────────────────
match /stock_watchlist/{uid} {
  allow read: if isOwner(uid) || isAdmin();
  allow write: if isOwner(uid);
}

// ── stock_reports (신고) ───────────────────────────────────
match /stock_reports/{reportId} {
  allow read: if isAdmin();
  allow create: if isRealUser()
    && request.resource.data.reporterUid == request.auth.uid;
  allow update, delete: if isAdmin();
}

// ── invest_config ──────────────────────────────────────────
match /invest_config/{docId} {
  allow read: if true;
  allow write: if isAdmin();
}
```

> `allow update: if isRealUser()` 처럼 **필드 제한 없는 update를 절대 쓰지 않는 것**이 이 설계의 핵심입니다.
> 기존 `anon_posts` 규칙이 이 형태라 아무 회원이나 남의 글 본문을 덮어쓸 수 있는 상태이므로, 이번에 같이 고치는 것을 권합니다. (§11 참조)

### 4-3. 필요한 복합 인덱스

```
invest_briefings          : pinned DESC, createdAt DESC
stock_boards/{code}/posts : createdAt DESC
stock_boards/{code}/posts : likes DESC, createdAt DESC
```

---

## 5. 화면 설계 (모바일 우선)

### 5-1. `/invest/` 홈

```
┌──────────────────────────────────────┐
│ ← 홈      💰 재테크            🌙     │
├──────────────────────────────────────┤
│ [📈 국내주식] [🏠 부동산] [🪙 코인]   │  ← 자산군 탭 (1차는 주식만 활성)
├──────────────────────────────────────┤
│ ┌── 지수 스트립 (가로 스크롤) ──────┐ │
│ │ KOSPI    2,684.12  ▲ 0.82%      │ │
│ │ KOSDAQ     812.44  ▼ 0.31%      │ │
│ │ USD/KRW  1,342.50  ▲ 0.12%      │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌── 📋 오늘의 시황 브리핑 ─────────┐ │
│ │ 📌 고정   2026.09.09             │ │
│ │ 9/9 시황 — 반도체 반등, 금리 관망│ │
│ │                                  │ │
│ │ 미 증시 강세에 반도체가 3거래일  │ │
│ │ 만에 반등했습니다. 다만 외국인은 │ │
│ │ 여전히 순매도 기조를...          │ │
│ │                        더보기 ▾  │ │
│ │ ─────────────────────────────── │ │
│ │ 🏷️ 005930 삼성전자  000660 SK…  │ │  ← 탭하면 종목 상세로
│ │ 💬 댓글 12    👀 340             │ │
│ └──────────────────────────────────┘ │
│   이전 브리핑 보기 (24개) ▾           │
│                                      │
│ ┌── ⭐ 내 관심종목 ────────────────┐ │
│ │ 삼성전자  71,200  ▲1.28%        │ │
│ │ NAVER    182,400  ▼0.44%        │ │
│ │              + 관심종목 추가     │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌── 🔥 오늘의 등락 ────────────────┐ │
│ │ [상승] [하락] [거래량]           │ │
│ │ 1 에코프로   +12.4%             │ │
│ │ 2 한미반도체  +9.8%             │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 🔍 종목 검색                          │
│ ┌──────────────────────────────────┐ │
│ │ 종목명 또는 코드 입력             │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ⚠️ 본 정보는 투자 참고용이며, 투자    │
│    판단과 그 결과는 본인 책임입니다.  │
└──────────────────────────────────────┘
```

### 5-2. 종목 상세 `/invest/?code=005930`

```
┌──────────────────────────────────────┐
│ ← 재테크    삼성전자        ⭐ 관심   │
├──────────────────────────────────────┤
│ 005930 · KOSPI · 반도체               │
│                                      │
│   71,200 원                          │
│   ▲ 900 (+1.28%)                     │
│   ⓘ 2026.09.08 종가 · KRX            │
│                                      │
│ ┌── 차트 ──────────────────────────┐ │
│ │  [일] [주] [월]  [1M][3M][1Y]    │ │
│ │                                  │ │
│ │      ╱╲    ╱╲                    │ │
│ │  ╱╲╱  ╲╱╲╱  ╲╱╲                 │ │
│ │  ▁▂▃▅▂▁▃▅▇▅▃  (거래량)          │ │
│ │                                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌── 기본 정보 ─────────────────────┐ │
│ │ 시가 70,500   고가 71,500        │ │
│ │ 저가 70,300   거래량 1,204만     │ │
│ │ 시총 425.3조  상장주식 59.7억    │ │
│ └──────────────────────────────────┘ │
│                                      │
│ [🔗 네이버금융] [🔗 증권사 앱]        │  ← 실주문·정밀시세는 외부 위임
│                                      │
├──────────────────────────────────────┤
│ 🗣️ 커뮤니티 (48)          ✏️ 글쓰기  │
│ [최신] [인기]                         │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ 🟢 강세  ·  김OO  ·  2시간 전    │ │
│ │ 3분기 실적 컨센서스 상향          │ │
│ │ HBM 물량이 예상보다 빠르게...     │ │
│ │ 👍 24   💬 8            🚨       │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ 🔴 약세  ·  이OO  ·  5시간 전    │ │
│ │ 외국인 순매도 6일째              │ │
│ │ 👍 11   💬 3            🚨       │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 5-3. 브리핑 댓글 UI

```
┌── 💬 댓글 12 ────────────────────────┐
│ ┌──────────────────────────────────┐ │
│ │ 댓글을 입력하세요...              │ │
│ │                          [등록]  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 👤 박OO · 1시간 전                    │
│    반도체 비중 지금 늘려도 될까요?    │
│    👍 3   답글                        │
│                                      │
│    └ 👑 운영진 · 40분 전   [관리자]   │  ← 관리자 답글은 배지 강조
│        분할 매수 관점이면 나쁘지      │
│        않은 구간이라 봅니다. 다만     │
│        FOMC 전까지는...              │
│        👍 8                          │
│                                      │
│ 👤 최OO · 30분 전                     │
│    브리핑 잘 봤습니다 👍              │
│    👍 1   답글                        │
└──────────────────────────────────────┘
```

### 5-4. 관리자 탭

```
┌── ⚙️ 관리 ───────────────────────────┐
│                                      │
│ 📋 시황 브리핑 작성                   │
│ ┌──────────────────────────────────┐ │
│ │ 날짜  [2026-09-09]               │ │
│ │ 제목  [                        ] │ │
│ │ 톤    (○강세 ○중립 ○약세)       │ │
│ │ 종목  [005930 ×] [000660 ×] +   │ │
│ │ ┌──────────────────────────────┐ │ │
│ │ │ 본문...                      │ │ │
│ │ └──────────────────────────────┘ │ │
│ │ [🤖 AI 초안 생성]  [📌 상단고정] │ │
│ │              [📋 브리핑 게시]    │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 🚨 신고 접수 (3)                      │
│ ┌──────────────────────────────────┐ │
│ │ 005930 게시글 · 허위정보          │ │
│ │           [보기] [삭제] [무시]   │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ⭐ 추천 종목 큐레이션                 │
│ 📢 재테크 공지 / 면책 문구 수정        │
└──────────────────────────────────────┘
```

---

## 6. AI 브리핑 초안 생성

기존 `dt-ai` 워커(OpenAI Responses API, `gpt-4.1`)와 `dt-digest` 워커(Firestore 서비스계정 저장)의 조합을 그대로 재사용합니다.

```
관리자가 [🤖 AI 초안 생성] 클릭
        │
        ▼
POST /api/briefing/draft  (X-Admin-Secret 헤더)
        │
        ├─ KV에서 오늘 지수·등락률 상위 데이터 로드
        ├─ dt-rss 워커로 경제 뉴스 헤드라인 수집 (연합인포맥스/한경 RSS 등)
        ├─ OpenAI로 초안 생성
        │
        ▼
{ "title": "...", "body": "...", "tickers": ["005930"], "sentiment": "neutral" }
        │
        ▼
관리자가 폼에서 직접 수정 후 게시  ← ★ 자동 게시 금지, 반드시 사람이 검수
```

### 시스템 프롬프트 초안

```
당신은 한국 주식시장 시황을 정리하는 애널리스트입니다.
제공된 지수 데이터와 뉴스 헤드라인만을 근거로 브리핑 초안을 작성하세요.

규칙:
- 사실과 해석을 명확히 구분한다. 데이터에 없는 수치는 절대 지어내지 않는다.
- "매수하세요", "목표가 OO원" 같은 직접적 투자 권유 표현을 쓰지 않는다.
- 특정 종목을 언급할 때는 "왜 움직였는가"를 설명하되 매매 판단은 독자에게 남긴다.
- 구성: ① 오늘의 시장 한 줄 요약 ② 지수·수급 ③ 주목할 섹터/종목 ④ 내일 체크포인트
- 분량은 400~600자. 이모지는 소제목에만 사용한다.
```

> 자동 게시를 넣지 않는 이유: AI가 생성한 시황이 그대로 나가면 오류가 났을 때 운영자가 책임을 지게 됩니다. `ai_trend_posts`는 정보 큐레이션이라 자동화가 괜찮지만, 투자 정보는 반드시 사람이 최종 확인해야 합니다.

---

## 7. 파일 구조

```
dt/
├── invest/                          # ★ 신규 서브앱
│   ├── index.html                   # 홈 + 종목상세 + 커뮤니티 + 관리 (SPA 1파일)
│   ├── app.js                       # 로직
│   ├── style.css                    # 기존 CSS 변수 체계 상속
│   └── chart.js                     # Phase 2: lightweight-charts 래퍼
│
├── functions/
│   ├── dt-stock-worker.js           # ★ 신규 워커
│   └── wrangler-stock.toml          # ★ 신규 설정
│
├── firestore.rules                  # invest_* / stock_* 규칙 추가
├── index.html                       # 홈 진입점 3곳 추가
├── sitemap.xml                      # /invest/ 추가
└── docs/
    └── feature-plan-invest-stock.md # 이 문서
```

### 프론트엔드 기술 선택

| 항목 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | 없음 (Vanilla JS) | ai-trend/car-trend/legal과 동일. 번들러 불필요 |
| Firebase | compat SDK v10.12.2 (CDN) | 기존 서브앱과 동일 버전 |
| 차트 (P1) | TradingView Advanced Chart 위젯 | 개발 비용 0, 모바일 최적화 완료 |
| 차트 (P2) | [lightweight-charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0, ~45KB) | 자체 데이터로 캔들 렌더, 오프라인 캐시 가능 |
| 스타일 | 기존 CSS 변수 (`--primary` `#7c6fff` 등) | 브랜드 일관성 |

### 재테크 전용 시맨틱 컬러

기존 시맨틱 컬러(운전자 green / 동승자 blue)와 **충돌하지 않도록** 별도 토큰을 둡니다.

```css
:root {
  --stock-up:   #ff4d4d;  /* 상승 — 한국 관행상 빨강 */
  --stock-down: #4d8bff;  /* 하락 — 파랑 */
  --stock-flat: #9898b0;
  --stock-bull: #ff4d4d;  /* 강세 태그 */
  --stock-bear: #4d8bff;  /* 약세 태그 */
}
```

> ⚠️ 기존 `--accent: #ff6b6b`(경고/위험)과 상승 빨강이 시각적으로 겹칩니다. 채도를 다르게 하거나, 상승/하락은 **숫자 색상에만** 쓰고 배경 배지에는 쓰지 않는 규칙을 두세요.

---

## 8. 구현 단계

### Phase 1 — 시황 브리핑 + 댓글 (1~2주) ★ 최우선

가장 큰 가치가 여기 있습니다. 시세는 없어도 브리핑과 댓글만으로 서비스가 성립합니다.

- [ ] `/invest/` 뼈대 (index.html + app.js + style.css), 자산군 탭 UI
- [ ] `invest_briefings` 컬렉션 + 보안 규칙 배포
- [ ] 관리자 브리핑 작성/수정/삭제/고정
- [ ] 브리핑 목록·상세, 더보기 접기/펼치기 (ai-trend 패턴 재사용)
- [ ] **브리핑 댓글 + 1단계 대댓글 + 좋아요**, 관리자 배지
- [ ] 면책 문구 상시 노출
- [ ] 홈 진입점 3곳 추가

### Phase 2 — 시세·차트·종목 상세 (2~3주)

- [ ] KRX Open API 인증키 신청 (**영업일 1일 소요 — 지금 바로 신청**), 서비스 5종 개별 신청
- [ ] `dt-stock-worker` 작성 + KV + Cron 배포
- [ ] 종목 검색 (한글 초성 검색 포함)
- [ ] 종목 상세 화면 + TradingView 위젯 차트
- [ ] 지수 스트립, 등락률 TOP
- [ ] 관심종목 (`stock_watchlist`)
- [ ] 브리핑 본문 종목 코드 → 자동 칩 링크

### Phase 3 — 종목별 커뮤니티 (2주)

- [ ] `stock_boards/{code}/posts` + 댓글
- [ ] 강세/약세 태그, 좋아요, 정렬(최신/인기)
- [ ] 신고 기능 + 관리자 처리 큐
- [ ] 금칙어 필터 (리딩방 유인·종목 추천 광고 차단)

### Phase 4 — 고도화

- [ ] KIS OpenAPI 실시간 시세 (§9-3 검토 완료 후)
- [ ] 가격 알림 푸시 (기존 `dt-push` 워커 + `PUSH_SUBS` KV 재사용)
- [ ] lightweight-charts 자체 차트
- [ ] AI 브리핑 초안 자동 생성 + 스케줄 리마인더
- [ ] 재테크 확장: 부동산(실거래가 API) / 연금 / 절세 계산기

---

## 9. 주의사항 ★ 반드시 읽어주세요

### 9-1. 유사투자자문업 신고

자본시장법 제101조상 유사투자자문업은 **"대가를 받고"** 불특정다수에게 금융투자상품의 가치·투자판단에 관한 조언을 하는 것입니다.

| 상황 | 신고 필요 여부 |
|------|--------------|
| 동아리 회원 대상 **무료** 시황 브리핑 | 신고 대상 아님 |
| 유료 멤버십·구독료를 받고 브리핑 제공 | **유사투자자문업 신고 필요** |
| 1:1로 특정인에게 맞춤 종목 조언 | **투자자문업 인가 필요** (신고로 불가) |
| 실시간 채팅으로 매매 타이밍 제시 (리딩방) | 2024년 개정법상 **유료 운영은 불법** |

**권고**
- 재테크 탭은 **완전 무료**로 유지하고, 유료화 논의가 나오는 순간 이 항목을 다시 검토하세요.
- 댓글에서 회원이 "지금 사야 하나요?"라고 물을 때 **관리자가 1:1로 매수·매도를 지시하는 형태의 답변은 피하세요.** 일반적인 시장 해석 수준으로 답하는 게 안전합니다.
- AdSense 광고가 붙어 있으므로, "브리핑을 대가로 받는 수익"으로 오해되지 않도록 브리핑 페이지 광고 배치를 보수적으로 가져가세요.

### 9-2. 면책 고지 상시 노출

브리핑 하단, 종목 상세 하단, 커뮤니티 상단 3곳에 고정 노출합니다.

```
⚠️ DT 재테크의 모든 정보는 투자 참고용이며, 특정 종목의 매수·매도를
   권유하지 않습니다. 시세는 지연될 수 있으며 오류가 있을 수 있습니다.
   투자 판단과 그에 따른 결과의 책임은 전적으로 투자자 본인에게 있습니다.
   회원이 작성한 게시글은 DT Club의 입장과 무관합니다.
```

### 9-3. 시세 데이터 재배포

KRX 이용약관은 **무단 자동 수집·복제·배포를 금지**하고, 이용계약 종료 후 데이터 사용도 제한합니다. KIS OpenAPI로 받은 실시간 시세를 서버가 받아 다수 회원에게 뿌리는 구조는 개인 사용 전제를 벗어납니다.

**안전한 순서**
1. Phase 1~2는 **정식 발급받은 KRX Open API 키로 EOD 데이터만** 사용 + 출처(KRX) 표기 + "지연" 명시 → 리스크 낮음
2. 실시간 차트는 **TradingView 위젯**으로 위임 → 제공 책임이 TradingView에 있음
3. 정밀 실시간·실주문은 **네이버금융·증권사 앱 딥링크**로 넘김 → 우리가 재배포하지 않음
4. Phase 4에서 KIS 실시간을 직접 붙이려면, 그 전에 한국투자증권 OpenAPI 이용약관의 제3자 제공 조항을 확인하세요.

### 9-4. 커뮤니티 리스크

종목 게시판은 일반 게시판보다 위험합니다. 시세조종성 글, 허위사실 유포, 리딩방 유인 광고가 붙습니다.

- 신고 기능은 **Phase 3에 반드시 함께** 출시 (나중에 붙이지 마세요)
- 금칙어 필터: `리딩방`, `수익인증`, `단톡방`, `무료체험`, 카카오 오픈채팅 링크 패턴
- 게시글 작성은 **실제 회원만** (게스트 차단) — 이미 `isRealUser()`로 커버됨
- `reportCount`가 임계값(예: 3) 넘으면 자동 블라인드 처리

### 9-5. 데이터 비용

전 종목 일별 시세를 매일 Firestore에 쓰면 문서 쓰기가 폭증합니다. **시세는 Firestore가 아니라 Workers KV에만** 저장하세요. Firestore는 브리핑·게시글·댓글처럼 사용자가 만든 데이터만 담습니다.

---

## 10. 메인 홈 진입점

### 10-1. 히어로 버튼 (`index.html` ~146행)

```html
<div class="hero-buttons">
  <a href="spots/" class="btn btn-primary">📍 DT 스팟</a>
  <a href="invest/" class="btn btn-outline">💰 재테크</a>   <!-- 추가 -->
  <a href="ai-trend/" class="btn btn-outline">🤖 AI 트렌드</a>
  <a href="car-trend/" class="btn btn-outline">🚘 자동차 트렌드</a>
  <a href="legal/" class="btn btn-outline">⚖️ 법률 도우미</a>
</div>
```

### 10-2. 홈 브리핑 탭에 3번째 슬롯 추가 (~154행)

```html
<div class="home-briefing-tabs">
  <button class="home-briefing-tab active" data-brief="ai">🤖 AI 트렌드</button>
  <button class="home-briefing-tab" data-brief="car">🚘 자동차 트렌드</button>
  <button class="home-briefing-tab" data-brief="invest">💰 재테크</button>  <!-- 추가 -->
</div>
```

`app.js`의 홈 브리핑 로더가 `ai_trend_posts` / `car_trend_posts`를 읽는 부분에 `invest_briefings`를 추가하면 됩니다. **가장 최근 브리핑 1건 프리뷰**만 보여주고 더보기는 `/invest/`로 보냅니다.

### 10-3. DT 라운지 카드 (~183행)

```html
<a href="invest/" class="home-tool-card home-tool-sm">
  <span class="home-tool-icon">💰</span>
  <span class="home-tool-name">재테크</span>
</a>
```

### 10-4. 하단 nav는 건드리지 않음

현재 5개(홈/회원/차량/이벤트/게시판)가 모바일 하단 nav의 적정 상한입니다. 6개로 늘리면 터치 타겟이 좁아집니다. 재테크는 홈 진입점 3곳으로 충분히 노출됩니다.

---

## 11. 함께 처리하면 좋을 기존 이슈

이번 작업 중 발견한, 재테크 기능과 직접 얽히는 항목들입니다.

| 우선순위 | 위치 | 내용 |
|---------|------|------|
| 🔴 높음 | `firestore.rules:141` | `anon_posts`의 `allow update: if isRealUser()` — 필드 제한이 없어 **아무 회원이나 남의 글 본문을 덮어쓸 수 있음**. 주석의 의도대로 `hasOnly(['likes','likedBy'])`로 제한 필요. 새 `stock_boards` 규칙은 이미 이 문제를 피해서 설계했음 |
| 🔴 높음 | `firestore.rules:157` | `blacklist`의 `allow read: if true` — **강퇴 사유가 담긴 이메일 목록이 비인증 전체 공개**. 가입 시 체크는 Cloud Function이나 워커로 옮기고 read를 `isAdmin()`으로 제한 권장 |
| 🟡 중간 | `firestore.rules:143` | `anon_posts`의 `allow delete: if isAdmin()` — 작성자 본인이 자기 글을 못 지움. 탈퇴 시 데이터 정리도 불가 |
| 🟡 중간 | `app.js` (256KB / 170 함수) | 단일 파일 한계. 재테크는 서브앱으로 분리해 이 문제를 키우지 않는 게 이번 설계의 전제 |
| 🟢 낮음 | `sw.js:4` | STATIC에 `/app.js`를 캐시하지만 HTML은 `app.js?v=10`을 요청 → 캐시 키 불일치. 배포 시 버전 쿼리를 STATIC과 맞추면 첫 로드가 빨라짐 |

---

## 12. 결정이 필요한 사항

| # | 질문 | 기본 제안 |
|---|------|----------|
| 1 | 브리핑을 **비회원에게도** 공개할까요? | 공개 (SEO·유입에 유리, 댓글만 회원 제한) |
| 2 | 종목 커뮤니티를 **실명(회원명)** vs **익명**? | 실명 — 익명은 종목판 특성상 관리 부담이 큼 |
| 3 | Phase 1에 종목 시세를 아예 빼고 브리핑만 낼까요? | 예 — 브리핑 먼저 출시해 반응 확인 후 시세 투자 |
| 4 | 재테크를 앞으로 **유료화**할 계획이 있나요? | 없다면 현 설계 그대로. 있다면 §9-1을 먼저 해결해야 함 |

---

## 13. 참고 링크

- KRX Open API — https://openapi.krx.co.kr/
- KIS Developers (한국투자증권) — https://apiportal.koreainvestment.com/apiservice
- 한국투자증권 공식 예제 저장소 — https://github.com/koreainvestment/open-trading-api
- 공공데이터포털 금융위원회 주식시세정보 — https://www.data.go.kr/data/15094808/openapi.do
- lightweight-charts — https://github.com/tradingview/lightweight-charts
- 금융위 유권해석: 온라인 주식방송의 유사투자자문업 신고 필요 여부 — https://better.fsc.go.kr/fsc_new/replyCase/LawreqDetail.do?stNo=11&muNo=171&muGpNo=75&lawreqIdx=3509
