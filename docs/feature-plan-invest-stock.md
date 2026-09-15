# DT Club 재테크 탭 — 국내주식 기획안 (v2 · 실시간 시세/호가 반영)

> 작성일: 2026-09-09 · 개정: 2026-09-14
> 대상: dt-club 서브앱 (`/invest/`)
> 범위: 1차 국내주식 (KOSPI/KOSDAQ/NXT) — 이후 부동산·연금·절세로 확장
> **v2 변경점**: 폐쇄형 회원 전용 전제 확정 / 실시간 체결가·호가 필수 기능으로 승격 /
> Cloudflare Worker `fetch()`로는 KIS 접속이 불가능하다는 사실 확인 → **Durable Object + TCP 소켓** 구조로 전면 재설계

---

## 0. v2에서 달라진 것 (먼저 읽어주세요)

실시간을 넣기로 하면서 **기술 검증 중 치명적인 제약 하나**를 발견했습니다.

> **Cloudflare Workers의 `fetch()`는 프로덕션에서 비표준 포트를 무시합니다.**
> `fetch("https://openapi.koreainvestment.com:9443")` → 실제로는 **443으로 연결**됩니다.

그런데 실측 결과 KIS는 표준 포트를 열어두지 않았습니다.

```
$ curl -m 10 https://openapi.koreainvestment.com:9443/...   → HTTP 500 (도달 O, 인증 누락)
$ curl -m 10 https://openapi.koreainvestment.com/...        → timeout (443 미개방)
$ nc -z ops.koreainvestment.com 21000                       → OPEN
$ nc -z ops.koreainvestment.com 443                         → closed
```

**결론: 기존 워커 8종이 쓰는 `fetch()` 프록시 패턴으로는 KIS에 아예 접속할 수 없습니다.**
`dt-opinet`, `dt-rss`처럼 만들면 배포 후 100% 실패합니다. 로컬 `wrangler dev`에서는 비표준 포트가 동작하므로 **로컬에서 잘 되다가 배포하면 죽는** 가장 골치 아픈 형태로 나타납니다.

해결책은 §3에 정리했습니다. 요약하면 Cloudflare의 **TCP Sockets API(`connect()`)** 를 쓰는 것이고, 이건 임의 포트 + TLS를 지원하며 Durable Object 안에서 동작합니다.

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| **기능명** | DT 재테크 (DT Invest) |
| **경로** | `/invest/` (독립 서브앱, 내부 탭으로 자산군 확장) |
| **1차 범위** | 국내주식 — 실시간 시세·호가 / 실시간 차트 / 시황 브리핑 / 종목별 커뮤니티 |
| **접근 권한** | **전 페이지 실제 회원 전용** (게스트·비회원 차단) — 폐쇄형 동호회 전제 |
| **관리자 역할** | 시황 브리핑 작성·고정·댓글, 커뮤니티 관리, 상시 구독 종목 큐레이션 |

### 핵심 흐름

```
                     /invest/  (재테크 홈 · 회원 전용)
                          │
   ┌──────────────────────┼──────────────────────┐
   ▼                      ▼                      ▼
📋 시황 브리핑         📈 종목 상세           🗣️ 커뮤니티
(관리자 작성)          ├─ 실시간 현재가         (종목별 게시판)
   │                   ├─ 실시간 호가 10단계    │
   ├─ 💬 댓글          ├─ 실시간 캔들 차트      ├─ 강세/약세
   ├─ 📌 상단 고정      ├─ 체결 틱 리스트       ├─ 좋아요·댓글
   └─ 🤖 AI 초안       └─ ⭐ 관심종목          └─ 🚨 신고
```

---

## 2. 데이터 소스 — KIS OpenAPI 단일화

재배포 제약을 고려하지 않기로 하셨으므로 **한국투자증권 KIS Developers 하나로 통일**합니다. KRX Open API·공공데이터포털을 병행할 이유가 사라졌습니다(둘 다 EOD라 실시간 요구를 못 맞춥니다).

### 2-1. 사전 준비

| 단계 | 내용 | 소요 |
|------|------|------|
| 1 | 한국투자증권 **실전 계좌** 개설 (비대면) | 1일 |
| 2 | [KIS Developers](https://apiportal.koreainvestment.com/) 가입 → 앱 등록 → `appkey` / `appsecret` 발급 | 즉시 |
| 3 | HTS ID 등록 (웹소켓 인증에 필요) | 즉시 |
| 4 | 종목 마스터 파일(`kospi_code.mst`, `kosdaq_code.mst`) 다운로드 → KV 적재 | 즉시 |

> **모의투자 계좌로는 안 됩니다.** 모의는 REST 호출이 **초당 2건**으로 묶여 있어 여러 회원이 동시에 쓰면 즉시 한도 초과합니다. 실전 계좌는 초당 20건입니다. 실전 계좌를 쓰되 **잔고 0원으로 두고 시세 조회 용도로만** 쓰면 됩니다. 주문 API는 아예 구현하지 않습니다.

### 2-2. 사용할 API

**실시간 (WebSocket · `ws://ops.koreainvestment.com:21000`)**

| TR ID | 내용 | 비고 |
|-------|------|------|
| `H0UNCNT0` | 국내주식 실시간체결가 **(통합)** | ★ KRX+NXT 통합 — 이걸 쓰세요 |
| `H0UNASP0` | 국내주식 실시간호가 **(통합)** | ★ 10단계 호가·잔량 |
| `H0STCNT0` / `H0STASP0` | KRX 전용 체결가/호가 | 통합이 안 될 때 폴백 |

> 2025년 대체거래소 **넥스트레이드(NXT)** 출범 이후 KRX 전용 TR만 쓰면 NXT 체결이 누락됩니다. 반드시 `H0UN*` 통합 TR을 쓰세요.

**조회 (REST · `https://openapi.koreainvestment.com:9443`)**

| TR ID | 엔드포인트 | 용도 |
|-------|-----------|------|
| — | `POST /oauth2/tokenP` | 액세스 토큰 (유효 24h, **1분에 1회만 발급**) |
| — | `POST /oauth2/Approval` | 웹소켓 접속키(`approval_key`) |
| `FHKST01010100` | `/uapi/domestic-stock/v1/quotations/inquire-price` | 현재가 스냅샷 (최초 진입용) |
| `FHKST01010200` | `/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn` | 호가 스냅샷 + 예상체결 |
| `FHKST03010100` | `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` | 일/주/월봉 (차트 과거 구간) |
| `FHKST03010200` | `/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice` | 당일 분봉 |

### 2-3. ★ 반드시 지켜야 하는 한도

| 제약 | 값 | 설계에 미치는 영향 |
|------|-----|------------------|
| **웹소켓 세션당 구독 건수** | **41건** | 체결가 1 + 호가 1 = 종목당 2건 → **동시 20종목이 상한** |
| **`approval_key`당 세션** | **1개** | 회원마다 직접 연결 불가 → **서버가 1개 물고 팬아웃 필수** |
| REST 호출 | 초당 20건 (실전) / 2건 (모의) | 차트 조회는 배치 + 캐시 |
| 액세스 토큰 | 24시간 유효, 1분 1회 발급 | 서버에 반드시 캐시 (매 요청 발급 시 즉시 차단) |
| `fetch()` 비표준 포트 | **프로덕션에서 무시됨** | **`connect()` 필수** (§3) |

**20종목 상한이 이 설계의 중심축입니다.** 동호회 회원이 30명이어도 같은 순간에 서로 다른 20개 넘는 종목을 보는 일은 드뭅니다. §3-4의 동적 구독 + LRU로 해결합니다. 부족해지면 **계좌를 하나 더 만들어 세션을 늘리면 41 × N**으로 확장됩니다.

---

## 3. 아키텍처 — Durable Object 릴레이

### 3-1. 전체 구조

```
  회원 브라우저 A          회원 브라우저 B          회원 브라우저 C
  (005930 보는 중)        (005930 보는 중)        (000660 보는 중)
        │                       │                       │
        └───────── wss:// (표준 443) ────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────────┐
        │  Worker  dt-stock                          │
        │   GET /ws          → DO 업그레이드          │
        │   GET /api/ohlc    → DO 경유 REST + 캐시    │
        │   GET /api/symbols → KV 종목 마스터         │
        └───────────────────┬───────────────────────┘
                            ▼
        ┌───────────────────────────────────────────┐
        │  Durable Object  "MarketHub"  (단일 인스턴스)│
        │                                            │
        │  clients : ws → Set<종목코드>               │
        │  subs    : 종목코드 → refCount              │
        │  last    : 종목코드 → 마지막 틱 (즉시 렌더용) │
        │  token   : 액세스 토큰 캐시 (24h)           │
        │                                            │
        │  ├─ connect(ops...:21000)      ws 평문      │
        │  │    RFC6455 클라이언트 직접 구현           │
        │  └─ connect(openapi...:9443, TLS) REST      │
        └───────────────────┬───────────────────────┘
                            ▼
                   KIS OpenAPI (한국투자증권)
```

핵심은 **`approval_key` 1개 = 세션 1개**라는 제약입니다. 회원 브라우저가 각자 KIS에 붙을 수 없으므로, 서버가 단 하나의 연결을 물고 회원들에게 뿌려주는 구조가 **선택이 아니라 필수**입니다. Durable Object는 정확히 이 용도(단일 인스턴스 + 상태 유지 + WebSocket 팬아웃)에 맞는 프리미티브입니다.

### 3-2. 왜 Durable Object인가 — 대안 비교

| 방식 | 가능? | 평가 |
|------|------|------|
| Worker `fetch()` 프록시 (기존 패턴) | ❌ | **비표준 포트가 프로덕션에서 무시됨.** 로컬만 동작하고 배포하면 죽음 |
| **Worker + Durable Object + `connect()`** | ✅ | **채택.** 기존 Cloudflare 스택 유지, 추가 호스팅 0원. WebSocket 프레이밍을 직접 구현해야 하는 게 유일한 비용 |
| 별도 Node.js 릴레이 (Fly.io / Oracle Free 등) | ✅ | `ws` 패키지가 프로토콜을 다 처리해 코드가 절반. 대신 **관리할 서버가 하나 늘고** 기존 스택에서 이탈 |
| 브라우저가 KIS에 직접 연결 | ❌ | `approval_key` 1세션 제약 + 키가 클라이언트에 노출 |

> **폴백 계획**: `connect()` 기반 WebSocket 클라이언트 구현이 예상보다 막히면 (§8 Phase 2에서 판단), Node.js 릴레이로 갈아타세요. 프론트엔드와 Firestore 설계는 **완전히 동일**하게 유지되므로 바꿔도 버리는 코드가 없습니다. 릴레이만 교체하면 됩니다.

### 3-3. `connect()` 사용법

```js
import { connect } from 'cloudflare:sockets';

// ① REST (TLS, 포트 9443) — HTTP/1.1을 직접 작성
const sock = connect(
  { hostname: 'openapi.koreainvestment.com', port: 9443 },
  { secureTransport: 'on' }
);
const w = sock.writable.getWriter();
await w.write(new TextEncoder().encode(
  `GET ${path}?${qs} HTTP/1.1\r\n` +
  `Host: openapi.koreainvestment.com\r\n` +
  `authorization: Bearer ${token}\r\n` +
  `appkey: ${env.KIS_APP_KEY}\r\n` +
  `appsecret: ${env.KIS_APP_SECRET}\r\n` +
  `tr_id: ${trId}\r\n` +
  `Connection: close\r\n\r\n`
));
// sock.readable 에서 헤더/바디 파싱

// ② WebSocket (평문, 포트 21000) — RFC6455 핸드셰이크 직접 작성
const ws = connect({ hostname: 'ops.koreainvestment.com', port: 21000 });
// GET /tryitout/H0UNCNT0 HTTP/1.1 + Upgrade: websocket + Sec-WebSocket-Key
// → 101 확인 후 프레임 파싱 루프
```

**구현 난이도 메모**: KIS 실시간 시세 프레임은 `0|H0UNCNT0|001|005930^093000^71200^2^...` 형태의 **평문 파이프 구분 텍스트**입니다. AES 복호화가 필요한 건 체결통보(`H0STCNI0`)뿐인데 우리는 주문을 안 하므로 **암호화 처리가 아예 필요 없습니다.** 따라서 직접 구현할 것은 RFC6455 클라이언트 프레이밍(마스킹, opcode, PING/PONG)뿐이고, 텍스트 프레임만 다루면 되므로 200줄 안쪽입니다.

### 3-4. 구독 예산 관리 (41건 한도 대응)

```
회원이 종목 상세 진입
   │
   ▼
DO에 { type:"sub", code:"005930" } 전송
   │
   ├─ 이미 구독 중? → refCount++ , 마지막 틱 즉시 전송(빈 화면 방지)
   │
   └─ 신규?
        ├─ 현재 구독 종목 < 20 → H0UNCNT0 + H0UNASP0 등록
        │
        └─ 20개 꽉 참
             ├─ refCount==0 인 종목 중 가장 오래된 것 해제(LRU) → 등록
             └─ 전부 사용 중 → REST 폴링 폴백 (3초 간격, "지연" 배지 표시)

회원이 화면 이탈 → refCount--
refCount==0 이 30초 지속 → 구독 해제 (즉시 해제하면 재진입 시 낭비)
```

**상시 구독 슬롯**: 관리자가 지정한 대표 종목 5개(예: 삼성전자, SK하이닉스 등)는 `refCount`와 무관하게 항상 구독을 유지해 홈 화면 시세 스트립이 언제나 살아 있게 합니다. → 상시 5 + 동적 15종목.

### 3-5. 장 운영시간 게이팅

```js
// KST 08:30~16:00 평일에만 KIS 연결 유지
// 그 외 시간에는 소켓을 닫고 마지막 종가 스냅샷만 서빙
```

두 가지 이유입니다. ① 장외 시간에 소켓을 물고 있어 봐야 데이터가 없습니다. ② Durable Object는 **TCP 소켓이 열려 있으면 메모리에 상주하며 duration 과금**이 발생합니다 (§9-3).

### 3-6. 브라우저 ↔ DO 프로토콜

```jsonc
// 클라이언트 → 서버
{ "type": "sub",   "codes": ["005930", "000660"] }
{ "type": "unsub", "codes": ["000660"] }
{ "type": "ping" }

// 서버 → 클라이언트
{ "t":"tick", "code":"005930", "price":71200, "chg":900, "chgRate":1.28,
  "vol":12043221, "time":"093012", "sign":"2" }

{ "t":"book", "code":"005930", "ts":"093012",
  "ask":[[71600,12430],[71500,8120], ... ],   // [호가, 잔량] 10단계
  "bid":[[71100,2340],[71000,6780], ... ],
  "askTotal":31540, "bidTotal":45220 }

{ "t":"state", "code":"005930", "mode":"realtime" | "delayed" }  // 폴백 알림
{ "t":"error", "msg":"..." }
```

### 3-7. Wrangler 설정

```toml
# functions/wrangler-stock.toml
name = "dt-stock"
main = "dt-stock-worker.js"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]

[[durable_objects.bindings]]
name = "MARKET_HUB"
class_name = "MarketHub"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["MarketHub"]   # 무료 플랜은 SQLite 백엔드만 지원

[[kv_namespaces]]
binding = "STOCK_KV"                  # 종목 마스터, 일봉 캐시
id = "<wrangler kv namespace create STOCK_KV>"

[triggers]
crons = ["30 21 * * 0"]               # UTC 21:30 = KST 06:30, 종목 마스터 갱신

# Secrets
# wrangler secret put KIS_APP_KEY    --config functions/wrangler-stock.toml
# wrangler secret put KIS_APP_SECRET --config functions/wrangler-stock.toml
# wrangler secret put KIS_HTS_ID     --config functions/wrangler-stock.toml
# wrangler secret put ADMIN_SECRET   --config functions/wrangler-stock.toml
```

배포 후 URL: `https://dt-stock.shocguna.workers.dev`

### 3-8. 회원 인증 게이트

폐쇄형이므로 **WebSocket 연결 시점에 회원 검증**을 합니다. 시세 릴레이가 무인증으로 열려 있으면 링크만 알면 누구나 붙을 수 있습니다.

```
브라우저: firebase.auth().currentUser.getIdToken()
   → wss://dt-stock.../ws?token=<idToken>
DO: Firebase 공개키로 ID 토큰 검증
    - 서명·만료·audience(dt-club) 확인
    - sign_in_provider != 'anonymous' 확인
    - 실패 시 1008 코드로 close
```

기존 `dt-push` 워커가 Firebase 서비스계정 토큰을 다루는 코드가 있으니 검증 로직은 거기서 가져다 쓰면 됩니다.

---

## 4. Firestore 데이터 모델

**시세는 Firestore에 절대 쓰지 않습니다.** 틱 데이터를 Firestore에 넣으면 문서 쓰기가 폭증해 요금이 감당이 안 됩니다. 시세는 DO 메모리 + KV, Firestore는 사람이 만든 데이터만.

### 4-1. 컬렉션

```
invest_briefings/{briefingId}              # 관리자 시황 브리핑
  date, title, body
  market        "all" | "kospi" | "kosdaq"
  tickers       ["005930", "000660"]        # 언급 종목 → 실시간 칩으로 렌더
  sentiment     "bull" | "bear" | "neutral"
  authorName, pinned, commentCount
  createdAt, updatedAt
  └─ comments/{commentId}
       authorUid, authorName, authorPhoto, body
       parentId, likes, likedBy[], createdAt

stock_boards/{code}/posts/{postId}          # 종목별 커뮤니티
  authorUid, authorName, title, body
  sentiment, likes, likedBy[], commentCount, reportCount, createdAt
  priceAtPost                               # 작성 시점 주가 (나중에 "그때 얼마였나" 표시)
  └─ comments/{commentId}

stock_watchlist/{uid}                       # 내 관심종목
  codes[], updatedAt

stock_reports/{reportId}                    # 신고
  targetPath, reason, reporterUid, status, createdAt

invest_config/settings                      # 면책·공지·상시구독 종목
  disclaimer, notice
  alwaysOn     ["005930","000660","035420","005380","373220"]
  featureFlags{}
```

### 4-2. 보안 규칙 추가분

v1과 달리 **`allow read: if true`를 전부 `isRealUser()`로 잠갔습니다.** 폐쇄형 전제이고, 비회원에게 시세 화면을 열어줄 이유가 없습니다.

```javascript
// ── invest_briefings (관리자 시황 브리핑) ──────────────────
match /invest_briefings/{briefingId} {
  allow read: if isRealUser();
  allow create, delete: if isAdmin();
  allow update: if isAdmin()
    || (isRealUser() && request.resource.data.diff(resource.data)
          .affectedKeys().hasOnly(['commentCount']));

  match /comments/{commentId} {
    allow read: if isRealUser();
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
  allow read: if isRealUser();
  allow create: if isRealUser()
    && request.resource.data.authorUid == request.auth.uid
    && request.resource.data.body.size() <= 3000;
  // ★ 본문 조작 방지 — 남의 글은 카운터 필드만 변경 가능
  allow update: if isAdmin()
    || (isRealUser() && resource.data.authorUid == request.auth.uid)
    || (isRealUser() && request.resource.data.diff(resource.data)
          .affectedKeys().hasOnly(['likes','likedBy','commentCount','reportCount']));
  allow delete: if isAdmin()
    || (isRealUser() && resource.data.authorUid == request.auth.uid);

  match /comments/{commentId} {
    allow read: if isRealUser();
    allow create: if isRealUser()
      && request.resource.data.authorUid == request.auth.uid
      && request.resource.data.body.size() <= 1000;
    allow delete: if isAdmin()
      || (isRealUser() && resource.data.authorUid == request.auth.uid);
  }
}

// ── stock_watchlist ────────────────────────────────────────
match /stock_watchlist/{uid} {
  allow read: if isOwner(uid) || isAdmin();
  allow write: if isOwner(uid);
}

// ── stock_reports ──────────────────────────────────────────
match /stock_reports/{reportId} {
  allow read: if isAdmin();
  allow create: if isRealUser()
    && request.resource.data.reporterUid == request.auth.uid;
  allow update, delete: if isAdmin();
}

// ── invest_config ──────────────────────────────────────────
match /invest_config/{docId} {
  allow read: if isRealUser();
  allow write: if isAdmin();
}
```

> `allow update: if isRealUser()` 처럼 **필드 제한 없는 update를 절대 쓰지 않는 것**이 이 설계의 원칙입니다. 기존 `anon_posts` 규칙이 그 형태라 아무 회원이나 남의 글 본문을 덮어쓸 수 있는 상태이므로 이번에 같이 고치길 권합니다 (§11).

### 4-3. 복합 인덱스

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
│ ← 홈      💰 재테크       ● 실시간   │  ← 연결 상태 인디케이터
├──────────────────────────────────────┤
│ [📈 국내주식] [🏠 부동산] [🪙 코인]   │
├──────────────────────────────────────┤
│ ┌── 지수 / 상시 종목 (가로 스크롤) ─┐ │
│ │ KOSPI 2,684.12 ▲0.82%           │ │  ← 값이 바뀌면 0.3s 플래시
│ │ 삼성전자 71,200 ▲1.28%          │ │
│ │ SK하이닉스 198,500 ▼0.44%       │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌── 📋 오늘의 시황 브리핑 ─────────┐ │
│ │ 📌 고정   2026.09.14             │ │
│ │ 9/14 시황 — 반도체 반등, 금리 관망│ │
│ │ 미 증시 강세에 반도체가 3거래일   │ │
│ │ 만에 반등했습니다. 다만...        │ │
│ │                        더보기 ▾  │ │
│ │ ─────────────────────────────── │ │
│ │ 🏷️ 삼성전자 71,200 ▲1.28%       │ │  ← 언급 종목이 실시간으로 뜀
│ │    SK하이닉스 198,500 ▼0.44%    │ │
│ │ 💬 댓글 12                       │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌── ⭐ 내 관심종목 ────────────────┐ │
│ │ 삼성전자   71,200  ▲1.28%       │ │  ← 전부 실시간
│ │ NAVER     182,400  ▼0.44%       │ │
│ │              + 관심종목 추가     │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 🔍 종목 검색 (초성 검색 지원)         │
│                                      │
│ ⚠️ 투자 참고용 · 판단과 책임은 본인   │
└──────────────────────────────────────┘
```

### 5-2. 종목 상세 — 실시간 차트 + 호가

```
┌──────────────────────────────────────┐
│ ← 재테크   삼성전자      ● ⭐ 관심   │
├──────────────────────────────────────┤
│ 005930 · KOSPI · 반도체               │
│   71,200                             │
│   ▲ 900 (+1.28%)      09:30:12 기준  │
│                                      │
│ [차트] [호가] [체결]                  │  ← 세그먼트 탭
├──────────────────────────────────────┤
│ ┌── 차트 ──────────────────────────┐ │
│ │ [1분][5분][일][주][월]           │ │
│ │                          ┃       │ │
│ │              ┃    ┃  ┃ ┃ ┃       │ │
│ │        ┃  ┃  ┃ ┃ ┃  ┃ ┃         │ │  ← 마지막 봉이 틱마다 갱신
│ │   ┃ ┃  ┃ ┃                       │ │
│ │ ▁▂▃▅▂▁▃▅▇▅▃  거래량              │ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ ┌── 호가 10단계 ───────── ● 실시간 ─┐│
│ │  매도잔량    호가     매수잔량    ││
│ │    12,430   71,600               ││
│ │     8,120   71,500               ││
│ │     5,900   71,400               ││
│ │     3,210   71,300               ││
│ │     1,880   71,200 ◀ 현재가       ││
│ │ ─────────────────────────────── ││
│ │             71,100      2,340    ││
│ │             71,000      6,780    ││
│ │             70,900      4,110    ││
│ │             70,800      3,020    ││
│ │             70,700      1,650    ││
│ │ ─────────────────────────────── ││
│ │  총 31,540          총 45,220    ││
│ │  ▓▓▓▓▓▓░░░░░░░░  41% : 59%      ││  ← 매도/매수 잔량 비율 바
│ └──────────────────────────────────┘│
│                                      │
│ [🔗 증권사 앱에서 주문]               │  ← 주문은 외부 위임 (구현 안 함)
├──────────────────────────────────────┤
│ 🗣️ 커뮤니티 (48)          ✏️ 글쓰기  │
│ [최신] [인기]                         │
│ ┌──────────────────────────────────┐ │
│ │ 🟢 강세 · 김OO · 2시간 전         │ │
│ │ 3분기 실적 컨센서스 상향          │ │
│ │ 작성 시점 70,300 → 현재 +1.28%   │ │  ← priceAtPost 활용
│ │ 👍 24  💬 8              🚨      │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 5-3. 실시간 UI 원칙

| 항목 | 규칙 |
|------|------|
| 가격 변동 | 상승 빨강 / 하락 파랑 텍스트 + **0.3초 배경 플래시** |
| 갱신 빈도 | 틱은 초당 수십 개 → **`requestAnimationFrame`으로 묶어 렌더** (DOM 직접 갱신 금지) |
| 연결 상태 | 헤더 점 — 🟢 실시간 / 🟡 지연(폴백) / ⚪ 장 마감 / 🔴 끊김 |
| 끊김 복구 | 지수 백오프 재연결(1s→2s→4s→최대 30s), 복구 시 스냅샷 재수신 |
| 배터리 | `visibilitychange`로 백그라운드 시 구독 해제 — 모바일 PWA에서 중요 |
| 장 마감 | 종가 고정 표시 + "장 마감" 배지, 소켓 연결 시도 안 함 |

### 5-4. 관리자 탭

```
┌── ⚙️ 관리 ───────────────────────────┐
│ 📋 시황 브리핑 작성                   │
│   날짜 / 제목 / 톤(강세·중립·약세)    │
│   종목 태그 [005930 ×] [000660 ×] +  │
│   본문 ┌──────────────────────────┐  │
│        └──────────────────────────┘  │
│   [🤖 AI 초안]  [📌 고정]  [게시]    │
│                                      │
│ ⭐ 상시 구독 종목 (5/5)               │
│   삼성전자 × / SK하이닉스 × / ...     │
│   ⓘ 41건 중 10건 사용 중              │
│                                      │
│ 📡 릴레이 상태                        │
│   연결 ● / 구독 14종목(28건) / 회원 7 │
│   토큰 만료 2026-09-15 06:12         │
│   [강제 재연결]                       │
│                                      │
│ 🚨 신고 접수 (3)   📢 공지/면책 수정  │
└──────────────────────────────────────┘
```

---

## 6. 차트 구현

실시간 틱 스트림을 직접 받으므로 **TradingView 위젯(iframe)을 쓸 이유가 없어졌습니다.** 자체 렌더링이 낫습니다.

**[lightweight-charts](https://github.com/tradingview/lightweight-charts)** (Apache-2.0, ~45KB) 채택

```js
// 과거 구간: KIS REST 로 채움
//   일/주/월봉 → FHKST03010100 (최대 100건)
//   분봉      → FHKST03010200 (당일 30건씩 페이징)
const series = chart.addCandlestickSeries();
series.setData(await fetchOhlc(code, 'D'));

// 실시간: 틱이 올 때마다 마지막 봉만 갱신
socket.on('tick', t => {
  const bar = currentBar(t.time);          // 분 경계 넘으면 새 봉 생성
  bar.high  = Math.max(bar.high, t.price);
  bar.low   = Math.min(bar.low,  t.price);
  bar.close = t.price;
  series.update(bar);                       // O(1) 갱신
});
```

- 일봉 데이터는 **KV에 캐시**(장 마감 후 1회 갱신) → REST 호출 절약
- 분봉은 종목 상세 진입 시 1회 조회 후 틱으로 이어붙임
- 모바일 터치 확대/스크롤은 라이브러리가 기본 제공

---

## 7. 파일 구조

```
dt/
├── invest/                          # ★ 신규 서브앱
│   ├── index.html                   # 홈 + 종목상세 + 커뮤니티 + 관리
│   ├── app.js                       # UI 로직 + Firestore
│   ├── realtime.js                  # ★ WS 클라이언트, 재연결, rAF 렌더 큐
│   ├── chart.js                     # lightweight-charts 래퍼
│   ├── orderbook.js                 # 호가창 렌더
│   └── style.css                    # 기존 CSS 변수 상속
│
├── functions/
│   ├── dt-stock-worker.js           # ★ Worker 엔트리 + MarketHub DO
│   ├── kis-ws-client.js             # ★ RFC6455 클라이언트 (connect 기반)
│   ├── kis-rest.js                  # ★ HTTP/1.1 over TLS 소켓
│   └── wrangler-stock.toml
│
├── firestore.rules                  # invest_* / stock_* 규칙 추가
├── index.html                       # 홈 진입점 3곳 추가
└── docs/
    └── feature-plan-invest-stock.md # 이 문서
```

### 재테크 전용 시맨틱 컬러

```css
:root {
  --stock-up:    #f0616d;  /* 상승 — 기존 --accent(#ff6b6b)와 채도 구분 */
  --stock-down:  #4d8bff;  /* 하락 */
  --stock-flat:  #9898b0;
  --stock-flash-up:   rgba(240, 97, 109, .22);  /* 틱 플래시 */
  --stock-flash-down: rgba(77, 139, 255, .22);
  --book-ask-bar: rgba(77, 139, 255, .18);      /* 호가 잔량 바 */
  --book-bid-bar: rgba(240, 97, 109, .18);
}
```

---

## 8. 구현 단계

### Phase 0 — 계좌·키 준비 (지금 바로) ★ 선행 조건

- [ ] 한국투자증권 **실전 계좌** 비대면 개설
- [ ] KIS Developers 가입 → 앱 등록 → `appkey`/`appsecret` 발급
- [ ] HTS ID 등록
- [ ] 로컬 Python 예제로 `H0UNCNT0` 수신 확인 — **여기서 먼저 검증하고 넘어가세요**

> Phase 0 없이 Phase 2를 시작하면 안 됩니다. 계좌 개설에 영업일이 걸립니다.

### Phase 1 — 시황 브리핑 + 댓글 ✅ 완료 (2026-09-15)

시세 없이도 서비스가 성립합니다. 여기부터 낸 이유는 Phase 0 대기 시간을 버리지 않기 위해서입니다.

- [x] `/invest/` 뼈대, 자산군 탭, 회원 전용 게이트
- [x] `invest_briefings` + 보안 규칙 배포 (`firebase deploy --only firestore:rules` 완료)
- [x] 관리자 브리핑 작성/수정/삭제/고정
- [x] **브리핑 댓글 + 1단계 대댓글 + 좋아요**, 관리자 배지
- [x] 면책 문구, 홈 진입점 (히어로 / 브리핑 탭 / 라운지 카드)
- [x] 시세 탭 자리표시 (실시간 오픈 전까지 예정 기능 안내)
- [x] 관리자 설정: 상시 구독 종목 5개, 재테크 공지

**구현 메모**
- 브리핑 목록은 `orderBy('createdAt','desc')` 단일 정렬만 쓰고 **고정(pinned) 우선순위는 클라이언트에서 정렬**합니다 → 복합 인덱스 불필요
- 브리핑 삭제 시 `comments` 서브컬렉션을 배치로 먼저 지웁니다 (Firestore는 서브컬렉션을 자동 삭제하지 않음)
- 홈 프리뷰는 회원 전용이라 `dt-digest` 워커를 거치지 않고 Firestore에서 직접 읽습니다. 게스트에게는 잠금 안내만 표시

### Phase 2 — 실시간 릴레이 ★ 최대 난관 (2~3주)

- [ ] `kis-rest.js` — TLS 소켓 위 HTTP/1.1, 토큰 발급·캐시
- [ ] `kis-ws-client.js` — RFC6455 핸드셰이크 + 프레임 파싱 + PING/PONG
- [ ] `MarketHub` DO — 클라이언트 관리, 구독 예산(41건), LRU, 팬아웃
- [ ] Firebase ID 토큰 검증 게이트
- [ ] 장 운영시간 게이팅, 재연결 백오프
- [ ] 관리자 릴레이 상태 패널
- [ ] **중간 점검**: 이 단계에서 2주 넘게 막히면 Node.js 릴레이로 전환 (§3-2)

### Phase 3 — 실시간 화면 (2주)

- [ ] `realtime.js` — WS 클라이언트, rAF 렌더 큐, 가시성 기반 구독 해제
- [ ] 종목 검색(초성), 종목 상세
- [ ] `chart.js` — lightweight-charts + 틱 갱신
- [ ] `orderbook.js` — 호가 10단계 + 잔량 비율 바
- [ ] 관심종목, 홈 시세 스트립, 브리핑 종목 칩 실시간화

### Phase 4 — 커뮤니티 (2주)

- [ ] `stock_boards/{code}/posts` + 댓글 + `priceAtPost`
- [ ] 강세/약세 태그, 좋아요, 정렬
- [ ] 신고 + 관리자 처리 큐 + 금칙어 필터 (**Phase 4에 반드시 같이**)

### Phase 5 — 고도화

- [ ] 가격 알림 푸시 (기존 `dt-push` + `PUSH_SUBS` KV 재사용)
- [ ] AI 브리핑 초안 자동 생성
- [ ] 세션 증설 (계좌 추가 → 41 × N)
- [ ] 재테크 확장: 부동산 / 연금 / 절세 계산기

---

## 9. 주의사항

### 9-1. 유사투자자문업 — 지금 구조는 해당 없음

자본시장법 제101조의 유사투자자문업은 **"대가를 받고"** 불특정다수에게 조언하는 것입니다. 폐쇄형 무료 동호회에서 운영진이 시황을 정리해 공유하는 건 신고 대상이 아닙니다.

다만 아래 선을 넘으면 달라집니다.

| 상황 | 판단 |
|------|------|
| 무료 동호회 시황 브리핑 (현 계획) | 신고 대상 아님 |
| 유료 멤버십·구독료 도입 | **유사투자자문업 신고 필요** |
| 1:1 맞춤 종목 조언 | **투자자문업 인가 필요** (신고로 불가) |
| 대가 받고 실시간 매매 타이밍 제시 | 2024년 개정법상 **불법 리딩방** |

→ **재테크 탭을 유료화하지 않는 한 현 설계 그대로 가면 됩니다.** 댓글에서 "지금 사야 하나요?"에 운영진이 1:1 매수 지시를 하는 형태만 피하세요.

### 9-2. KIS 계정 운영 — 실질적 리스크는 여기

재배포는 신경 안 쓰기로 하셨지만, **기술적·운영적으로 반드시 알고 계셔야 하는 것**이 있습니다.

- **동호회 전체가 관리자님 개인 계좌 키 하나로 시세를 봅니다.** 키가 유출되면 그 계좌가 노출됩니다.
  → `appkey`/`appsecret`은 **반드시 Wrangler Secret으로만** 저장. 프론트엔드·Firestore·git에 절대 두지 마세요.
  → 해당 계좌는 **잔고 0원**으로 유지하고, 주문 API는 코드에 아예 넣지 마세요. 구현이 없으면 사고도 없습니다.
- **트래픽 급증 시 계정이 묶일 수 있습니다.** 초당 20건 / 41건 구독을 넘기면 `EGW00201` 등으로 차단됩니다. §3-4의 예산 관리가 없으면 회원 10명만 몰려도 터집니다.
- **토큰은 1분에 1회만 발급됩니다.** DO 재시작마다 발급하면 즉시 막힙니다. 반드시 캐시하세요.

### 9-3. 비용 — 무료 플랜으로 가능하지만 조건이 있음

Durable Objects는 **Workers 무료 플랜에서 사용 가능**합니다(SQLite 백엔드 한정).

| 항목 | 무료 한도 | 예상 사용량 |
|------|----------|------------|
| DO 요청 | 100,000 / 일 | 회원 30명 × 재연결 → 수천 건. 여유 |
| **DO Duration** | **13,000 GB-s / 일** | 장중 6.5시간 상주 = 23,400s × 0.125GB ≈ **2,925 GB-s** |
| KV 읽기 | 100,000 / 일 | 종목 마스터·일봉 캐시. 여유 |

→ **장 운영시간에만 연결하면 여유롭게 무료 한도 안입니다.**
→ 반대로 **24시간 소켓을 열어두면 하루 10,800 GB-s**로 한도에 근접합니다. §3-5 게이팅이 비용 대책이기도 합니다.

> DO 문서상 "TCP 소켓이 열려 있으면 연결당 최대 15분까지 DO를 메모리에 상주시키고 duration 과금이 발생"합니다. 소켓을 계속 물고 있는 우리 구조에서는 사실상 장중 내내 상주한다고 계산하는 게 맞습니다.

### 9-4. 시세 정확도 표기

재배포 제약과 별개로, **화면에 데이터 성격을 표시하는 건 사용자 신뢰 문제**입니다.

```
🟢 실시간        KIS 실시간 체결가 수신 중
🟡 지연 (3초)    41건 한도 초과 → REST 폴링 폴백
⚪ 장 마감       09.14 종가 기준
🔴 연결 끊김     재연결 시도 중...
```

그리고 면책 문구를 브리핑 하단·종목 상세 하단·커뮤니티 상단에 고정합니다.

```
⚠️ DT 재테크의 시세는 참고용이며 지연·오류가 있을 수 있습니다. 실제 매매는
   증권사 앱의 시세를 확인하세요. 투자 판단과 결과의 책임은 본인에게 있습니다.
   회원이 작성한 게시글은 DT Club의 입장과 무관합니다.
```

### 9-5. 커뮤니티 리스크

종목 게시판은 일반 게시판보다 위험합니다. 폐쇄형이라 외부 스팸은 적지만, 회원 간 분쟁 소지는 오히려 큽니다.

- 신고 기능은 **Phase 4에 반드시 함께** 출시
- 금칙어: `리딩방`, `수익인증`, `단톡방`, `무료체험`, 오픈채팅 링크 패턴
- `reportCount` 임계값(3) 초과 시 자동 블라인드
- `priceAtPost`를 남겨 "그때 이 가격에 이렇게 말했다"가 기록으로 남게 → 근거 없는 선동 억제 효과

---

## 10. 메인 홈 진입점

```html
<!-- ① 히어로 버튼 (index.html ~146행) -->
<a href="invest/" class="btn btn-outline">💰 재테크</a>

<!-- ② 홈 브리핑 탭 3번째 슬롯 (~154행) -->
<button class="home-briefing-tab" data-brief="invest">💰 재테크</button>

<!-- ③ DT 라운지 카드 (~183행) -->
<a href="invest/" class="home-tool-card home-tool-sm">
  <span class="home-tool-icon">💰</span>
  <span class="home-tool-name">재테크</span>
</a>
```

`app.js`의 홈 브리핑 로더에 `invest_briefings`를 추가합니다. **홈에서는 WebSocket을 열지 않고** 브리핑 텍스트 프리뷰만 보여주세요 — 홈 진입만으로 릴레이 연결이 생기면 구독 예산이 낭비됩니다.

**하단 nav는 5개 유지.** 6개로 늘리면 터치 타겟이 좁아집니다.

---

## 11. 함께 처리하면 좋을 기존 이슈

| 우선순위 | 위치 | 내용 |
|---------|------|------|
| ✅ 처리됨 | `firestore.rules` | `anon_posts`의 `allow update: if isRealUser()` → **작성자 본인 / 관리자 / `['likes','likedBy','commentCount']` 화이트리스트**로 강화 완료. 실제 호출부(작성자 수정·좋아요·댓글수)를 모두 확인해 기존 동작은 그대로 유지됨 |
| 🔴 높음 | `firestore.rules` | `blacklist`의 `allow read: if true` — **강퇴 사유가 담긴 이메일 목록이 비인증 전체 공개**. ⚠️ **지금 바로 조이면 회원가입이 깨집니다** — `app.js`가 가입 도중(비인증 상태) 이 컬렉션을 조회하기 때문. 이메일 중복 체크를 Worker/Cloud Function으로 옮긴 뒤 read를 `isAdmin()`으로 제한해야 함 (별도 작업) |
| 🟡 중간 | `firestore.rules:143` | `anon_posts` 삭제가 관리자만 — 작성자 본인이 자기 글을 못 지움 |
| 🟡 중간 | `app.js` (256KB / 170 함수) | 단일 파일 한계. 재테크를 서브앱으로 분리하는 게 이번 설계의 전제 |
| 🟢 낮음 | `sw.js:4` | STATIC이 `/app.js`를 캐시하는데 HTML은 `app.js?v=10`을 요청 → 캐시 키 불일치 |

---

## 12. 결정이 필요한 사항

| # | 질문 | 제안 |
|---|------|------|
| 1 | Phase 2에서 `connect()` 구현이 막히면 **Node.js 릴레이**로 전환해도 될까요? (Fly.io 무료 티어 등) | 전환 가능하도록 설계해둠. 2주 룰 적용 |
| 2 | 상시 구독 종목 5개를 무엇으로 할까요? | 삼성전자·SK하이닉스·NAVER·현대차·KODEX 레버리지 등 — 관리자 화면에서 언제든 교체 |
| 3 | 종목 커뮤니티를 **실명(회원명)** vs **익명**? | 실명 — 폐쇄형이고 `priceAtPost` 기록이 남으므로 실명이 건전성에 유리 |
| 4 | 분봉 차트를 1분/5분 중 어디까지 지원할까요? | 1·5·일·주·월 5종. 틱 차트는 배터리 소모가 커서 제외 |

---

## 13. 참고 링크

- KIS Developers 포털 — https://apiportal.koreainvestment.com/
- 한국투자증권 공식 예제 저장소 — https://github.com/koreainvestment/open-trading-api
- 웹소켓 세션당 41건 제한 / 다중 계좌 대응 — https://hky035.github.io/web/refact-kis-websocket/
- REST 초당 20건 제한 대응 사례 — https://tgparkk.github.io/robotrader/2025/10/09/robotrader-1-70stocks-problem.html
- Cloudflare TCP Sockets (`connect()`) — https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- Cloudflare `fetch()` 비표준 포트 미지원 이슈 — https://github.com/cloudflare/cloudflare-docs/issues/4299
- Durable Objects 요금·무료 한도 — https://developers.cloudflare.com/durable-objects/platform/pricing/
- lightweight-charts — https://github.com/tradingview/lightweight-charts
- 금융위 유권해석: 온라인 주식방송의 유사투자자문업 신고 필요 여부 — https://better.fsc.go.kr/fsc_new/replyCase/LawreqDetail.do?stNo=11&muNo=171&muGpNo=75&lawreqIdx=3509
