# DT Club 재테크 탭 — 국내주식 기획안 (rev.2)

> 작성일: 2026-09-09 / 개정: 2026-09-09 (실시간 시세·호가 필수 요건 반영)
> 대상: dt-club 서브앱 (`/invest/`)
> 범위: 1차 국내주식 (KOSPI/KOSDAQ) — 이후 부동산·연금·절세로 확장
> 전제: **폐쇄형 동호회 회원 전용**, 무료 운영, 실시간 시세·호가 제공

### rev.2 변경 요약

| 항목 | rev.1 | **rev.2** |
|------|-------|-----------|
| 실시간 시세 | Phase 4로 유보 | **Phase 2 필수 기능으로 승격** |
| 호가창 | 없음 | **10단계 실시간 호가창 추가** |
| 주 데이터 소스 | KRX EOD + TradingView 위젯 | **KIS OpenAPI WebSocket** (KRX는 과거 일봉 보조) |
| 백엔드 | 무상태 Worker | **Durable Object 팬아웃 허브** |
| 인프라 비용 | $0 | **Workers Paid $5/월** |
| 접근 제어 | 브리핑 공개 | **실시간 피드는 회원 인증 필수 (기술적 강제)** |

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| **기능명** | DT 재테크 (DT Invest) |
| **경로** | `/invest/` (독립 서브앱, 내부 탭으로 자산군 확장) |
| **1차 범위** | 시황 브리핑 / 실시간 시세·호가 / 실시간 차트 / 종목별 커뮤니티 |
| **열람 권한** | 브리핑·커뮤니티 = 전체 공개 / **실시간 시세·호가 = 실제 회원만** |
| **관리자 역할** | 시황 브리핑 작성·고정, 커뮤니티 신고 처리, 관심종목 큐레이션 |

### 핵심 흐름

```
                     /invest/  (재테크 홈)
                          │
   ┌──────────────────────┼──────────────────────┐
   │                      │                      │
   ▼                      ▼                      ▼
📋 시황 브리핑         📈 종목 상세            🗣️ 커뮤니티
(관리자 작성)          (실시간)                (종목별 게시판)
   │                      │                      │
   ├─ 💬 댓글             ├─ 🔴 실시간 체결가    ├─ 강세/약세 태그
   ├─ 📌 상단 고정        ├─ 📊 10단계 호가창    ├─ 좋아요·댓글
   └─ 🤖 AI 초안 생성     ├─ 📉 실시간 분봉 차트 └─ 🚨 신고
                          └─ ⭐ 관심종목
```

### 왜 독립 서브앱인가 (메인 탭 아님)

| 방식 | 장점 | 단점 |
|------|------|------|
| 메인 `index.html`에 `page-invest` 추가 | 하단 nav에서 바로 접근 | **app.js가 이미 256KB / 170개 함수**. 하단 nav 5칸도 포화. 실시간 WebSocket 상태 관리까지 얹으면 유지보수 불가 |
| **독립 서브앱 `/invest/` (채택)** | ai-trend·car-trend·legal과 동일 패턴, 코드 격리, 자산군 확장 시 내부 탭으로 흡수 | 진입점을 홈에 별도 배치 |

---

## 2. 데이터 소스

| 티어 | 소스 | 지연 | 비용 | 용도 |
|------|------|------|------|------|
| **T1 (주력)** | [KIS Developers OpenAPI](https://apiportal.koreainvestment.com/apiservice) WebSocket | **실시간** | 무료 (계좌 필요) | 체결가, **10단계 호가**, 실시간 분봉 |
| **T1'** | KIS OpenAPI REST | 실시간 | 무료 | 스냅샷, 폴백 폴링, 분봉/일봉 조회 |
| **T2** | [KRX Open API](https://openapi.krx.co.kr/) | EOD | 무료 | 종목 마스터, 과거 일봉(2010~), 장외 시간 표시 |
| **T3** | [공공데이터포털 금융위 주식시세정보](https://www.data.go.kr/data/15094808/openapi.do) | T+1 13시 | 무료 | KRX 장애 시 백업 |

### 2-1. KIS 사전 준비 (착수 전 필수)

1. **한국투자증권 실계좌 개설** — 비대면 개설. 예수금 없어도 시세 조회는 됨
   - ⚠️ 모의투자 계좌는 **REST 호출 제한이 현저히 낮아** 서비스 운영에 부적합. 반드시 실계좌
2. **HTS ID 등록** — WebSocket 연결 시 필요. 미등록이면 `No close frame received` 오류
3. [KIS Developers](https://apiportal.koreainvestment.com/apiservice) 가입 → `APP_KEY` / `APP_SECRET` 발급
4. **접근토큰** — 유효 24시간, **재발급은 1분당 1회**. KV에 캐시하고 6시간 주기 갱신
5. **`approval_key`** — WebSocket 전용 접속키. `APP_KEY`+`APP_SECRET`로 별도 발급

### 2-2. KIS 실시간 제약 ★ 설계를 지배하는 숫자

| 제약 | 값 | 설계 영향 |
|------|-----|----------|
| **세션당 구독 수** | **41건** | 종목당 체결(1) + 호가(1) = 2슬롯 → **실질 20종목** |
| 계좌당 세션 수 | 1개 | 계좌 1개 = 허브 1개. 확장하려면 계좌 추가 |
| 프로토콜 | `ws://ops.koreainvestment.com:21000` (평문) | 브라우저 직결 불가 (HTTPS 혼합콘텐츠 차단) → **서버 브리지 필수** |
| 모의투자 | `ws://ops.koreainvestment.com:31000` | 개발 중 테스트용 |
| REST 유량 | 실계좌 초당 약 20건 | 폴백 폴링은 큐잉 필요 |

> **41건 제한이 이 기능의 전부입니다.** 회원 30명이 각자 다른 종목을 보면 60슬롯이 필요한데 41밖에 없습니다.
> → 아래 §3의 **참조 카운팅 + LRU 동적 구독**이 해법입니다.

### 2-3. 주요 TR ID

| 구분 | TR ID | 용도 |
|------|-------|------|
| WebSocket | `H0STCNT0` | 국내주식 실시간 체결가 |
| WebSocket | `H0STASP0` | 국내주식 실시간 **호가** (10단계) |
| REST | `FHKST01010100` | 주식현재가 시세 (스냅샷) |
| REST | `FHKST01010200` | 주식현재가 호가/예상체결 (폴백) |
| REST | 분봉/기간별시세 | 차트 초기 로드 — 개발자센터 문서에서 최종 확인 |

---

## 3. 실시간 아키텍처 — Durable Object 팬아웃 허브 ★ 핵심

KIS는 계좌당 WebSocket 세션 1개, 구독 41건만 허용합니다. 회원마다 KIS에 붙는 건 불가능합니다.
**서버가 KIS와 세션 1개를 유지하고, 회원들에게 되뿌리는(fan-out) 구조**가 유일한 답입니다.

```
   회원 브라우저 (N명)
        │  wss://dt-stock.shocguna.workers.dev/ws?token=<Firebase ID Token>
        ▼
   ┌─────────────────────────────────────────────────┐
   │ Cloudflare Worker (dt-stock)                    │
   │  · Firebase ID 토큰 검증 (회원만 통과)           │
   │  · REST 엔드포인트 (/api/*)                      │
   └────────────────────┬────────────────────────────┘
                        │ DO 라우팅 (싱글톤 id: "kis-hub")
                        ▼
   ┌─────────────────────────────────────────────────┐
   │ Durable Object: KisHub                          │
   │                                                 │
   │  [인바운드]  회원 WebSocket × N                  │
   │              ctx.acceptWebSocket() — Hibernation │
   │                                                 │
   │  [구독 레지스트리]                                │
   │    code → { refCount, feeds, lastSeen }         │
   │    41슬롯 관리 · LRU 축출                        │
   │                                                 │
   │  [아웃바운드] KIS WebSocket × 1                  │
   │    ws://ops.koreainvestment.com:21000           │
   │                                                 │
   │  [alarm()]  08:20 기동 / 10분 heartbeat          │
   │             / 15:40 정규장 종료 / 18:10 완전 종료 │
   └────────────────────┬────────────────────────────┘
                        │
                        ▼
              한국투자증권 KIS WebSocket
```

### 3-1. 클라이언트 ↔ 허브 프로토콜

```jsonc
// 클라이언트 → 허브
{ "op": "auth",  "token": "<Firebase ID Token>" }          // 연결 직후 1회
{ "op": "sub",   "code": "005930", "feeds": ["trade","book"] }
{ "op": "unsub", "code": "005930" }
{ "op": "ping" }

// 허브 → 클라이언트
{ "t":"trade", "code":"005930", "price":71200, "chg":900, "rate":1.28,
  "vol":12043221, "hi":71500, "lo":70300, "ts":"093015" }

{ "t":"book",  "code":"005930",
  "asks":[[71600,12400],[71500,8120], /* …10단계 */],
  "bids":[[71100,5200],[71000,18300], /* …10단계 */],
  "totAsk":84200, "totBid":91500, "ts":"093015" }

{ "t":"mode",  "code":"005930", "mode":"polling",           // 슬롯 부족 시 강등 통지
  "reason":"slot_full", "interval":2000 }

{ "t":"stat",  "used":34, "limit":41, "upstream":"connected", "viewers":12 }
```

### 3-2. KIS 프레임 포맷

**등록/해제 (허브 → KIS)**
```json
{
  "header": {
    "approval_key": "<approval_key>",
    "custtype": "P",
    "tr_type": "1",              // "1"=등록, "2"=해제
    "content-type": "utf-8"
  },
  "body": { "input": { "tr_id": "H0STASP0", "tr_key": "005930" } }
}
```

**수신 (KIS → 허브)** — 파이프/캐럿 구분 평문
```
0|H0STCNT0|001|005930^093015^71200^2^900^1.28^...
│ │        │   └─ 데이터 (^ 구분)
│ │        └─ 데이터 건수
│ └─ TR ID
└─ 0=비암호화, 1=암호화
```
- `PINGPONG` TR이 JSON으로 오면 **받은 그대로 되돌려** 세션 유지
- 파서는 TR별 필드 인덱스 맵을 상수로 관리 (`H0STCNT0`: 체결가=2, 전일대비=4… / `H0STASP0`: 매도호가1~10, 잔량 등)

### 3-3. 41슬롯 배분 전략

```
총 41슬롯
├─ 상시 구독 (8슬롯)  : 클럽 공용 관심종목 TOP 8 — 체결만
│                        → 홈 화면 스트립이 항상 살아있음
├─ 동적 구독 (32슬롯) : 지금 누군가 보고 있는 종목 — 체결 + 호가 (종목당 2)
│                        → 최대 16종목 동시 열람
└─ 예비 (1슬롯)
```

**참조 카운팅**
```
회원 A가 005930 상세 진입  → refCount[005930]++ → 0→1이면 KIS에 등록
회원 B도 005930 진입       → refCount[005930]++ → 이미 구독 중, 등록 안 함
회원 A 이탈                → refCount[005930]-- 
회원 B 이탈                → refCount[005930]-- → 1→0이면 KIS에서 해제
```

**슬롯 부족 시 (LRU 축출)**
1. `lastSeen`이 가장 오래된 종목부터 호가 피드 먼저 해제 (체결은 유지)
2. 그래도 부족하면 체결까지 해제
3. 축출된 종목을 보던 회원에게 `{"t":"mode","mode":"polling"}` 전송
4. 클라이언트는 **REST 2초 폴링 모드**로 자동 강등 — 화면에 `⏱ 2초 지연` 배지 표시

> 폐쇄 동호회 규모(동시접속 10~30명)에서 서로 다른 종목 16개를 동시에 보는 일은 드뭅니다.
> 실측 후 부족하면 §3-6의 계좌 추가로 확장합니다.

### 3-4. DO 수명 주기 (alarm 기반)

**Cloudflare DO의 아웃바운드 WebSocket은 하이버네이션이 불가**하고, **연결 하나가 DO를 최대 15분까지만 살려둡니다.** 따라서 alarm으로 능동 관리해야 합니다.

| 시각 (KST) | 동작 |
|-----------|------|
| 08:20 | alarm 기동 → 토큰·approval_key 확보 → KIS WS 연결 → 상시 8종목 등록 |
| 08:20~18:10 | **10분 주기 alarm** — upstream 상태 점검, 끊겼으면 재연결 후 전 구독 재등록 |
| 15:40 | 정규장 종료 — 호가 피드 전체 해제 (시간외 단일가는 호가 무의미) |
| 18:10 | KIS WS 종료, DO 유휴화 |
| 장외/휴장 | WS 미연결. 마지막 스냅샷 + KRX EOD 표시, 화면에 `장 마감` 배지 |

```javascript
// 재연결 시 반드시 전체 재등록 — KIS는 세션이 끊기면 구독이 모두 날아감
async alarm() {
  if (!this.isMarketWindow()) { await this.closeUpstream(); return; }
  if (!this.upstreamAlive()) {
    await this.connectUpstream();
    for (const [code, s] of this.registry) await this.kisSubscribe(code, s.feeds);
  }
  this.evictStale();                    // 뷰어 없는 종목 정리
  await this.ctx.storage.setAlarm(Date.now() + 10 * 60 * 1000);
}
```

### 3-5. ⚠️ 착수 전 반드시 검증할 리스크 — 포트 21000

Cloudflare Workers의 `fetch()`는 **비표준 포트를 프로덕션에서 무시하는 것으로 알려져 있습니다.** KIS WebSocket은 `ws://…:21000`이라 여기에 직접 걸립니다.

**Phase 2 착수 첫날, 반나절짜리 스파이크로 순서대로 검증하세요.**

| 순서 | 방법 | 확신도 | 비고 |
|------|------|--------|------|
| **A** | `fetch()` + `Upgrade: websocket` → `ws://ops.koreainvestment.com:21000` | 낮음 | compat_date ≥ 2024-09-02 + `allow_custom_ports` 플래그. 되면 가장 단순 |
| **B** | `import { connect } from "cloudflare:sockets"` — **raw TCP + WebSocket 핸드셰이크 직접 구현** | **높음** | TCP 소켓은 **25번 외 모든 포트 허용**, DO에서 사용 가능. KIS가 평문 ws라 TLS도 불필요. 프레임 파서 약 200줄 |
| **C** | 외부 상시 서버에 Node.js 브리지 (오라클 클라우드 Always Free VM / 집 PC / Fly.io) → 허브로 push | 확실 | Cloudflare 제약 완전 회피. 대신 프로세스 관리·재시작 운영 부담 |

→ **B를 기본 설계로 잡고 진행하는 것을 권합니다.** A가 되면 코드가 줄어드는 보너스 정도로 생각하세요.

### 3-6. 확장 (필요 시)

- **계좌 추가**: KIS 세션은 계좌당 1개이므로, 계좌 2개면 82슬롯. DO를 `kis-hub-0`, `kis-hub-1`로 샤딩하고 종목코드 해시로 분배
- 운영진 명의 계좌 1개로 시작 → 슬롯 부족 실측되면 추가

---

## 4. Worker / DO 설계 (`dt-stock-worker.js`)

### 4-1. 엔드포인트

```
WSS  /ws                            → KisHub DO로 업그레이드 (Firebase 토큰 검증 후)

GET  /api/symbols?q=삼성            → 종목 검색 (KV 마스터, 한글 초성 지원)
GET  /api/quote?code=005930         → 현재가 스냅샷 (KIS REST, 3초 캐시)
GET  /api/orderbook?code=005930     → 호가 스냅샷 (폴백 폴링용, 1초 캐시)
GET  /api/candles?code=005930&tf=1m&n=120  → 분봉/일봉 (차트 초기 로드)
GET  /api/index                     → 코스피·코스닥·환율
GET  /api/movers?market=KOSPI       → 등락률 상위/하위
POST /api/briefing/draft            → 시황 브리핑 AI 초안 (관리자)
GET  /api/health                    → 허브 상태 (슬롯 사용량 포함)
```

### 4-2. 인증 — 폐쇄 동호회를 기술적으로 강제

실시간 피드는 **반드시** 회원 인증을 통과해야 합니다. 이게 "폐쇄형 동호회"라는 전제를 코드로 만드는 부분입니다.

```javascript
// Worker: WS 업그레이드 전 Firebase ID 토큰 검증
async function verifyMember(token) {
  // 1) JWT 서명 검증 — Google 공개키
  //    https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com
  //    (KV에 캐시, Cache-Control max-age 준수)
  // 2) aud === 'dt-club', iss === 'https://securetoken.google.com/dt-club', exp 확인
  // 3) firebase.sign_in_provider !== 'anonymous'   ← 게스트 차단
  // 4) Firestore users/{uid}.role ∈ {member, admin, superadmin}
  return { uid, role };
}
```

- 토큰은 **1시간마다 만료** → 클라이언트가 `onIdTokenChanged`로 갱신하고 `{"op":"auth"}` 재전송
- 허브는 인증 실패 시 즉시 `close(4001)`
- 동일 uid 동시 연결 3개 제한 (탭 남용·계정 공유 방지)

### 4-3. KV 캐시 (`STOCK_CACHE`)

| 키 | 내용 | TTL | 갱신 |
|----|------|-----|------|
| `kis:token` | KIS 접근토큰 | 6h | 만료 전 선제 갱신 (**재발급 1분 1회 제한** 주의) |
| `kis:approval` | WebSocket approval_key | 24h | 토큰과 함께 |
| `google:jwks` | Firebase 검증 공개키 | 응답 헤더 준수 | 자동 |
| `symbols:v1` | 전 종목 마스터 (KRX) | 24h | Cron 06:00 |
| `daily:{YYYYMMDD}` | 일별 시세 (KRX) | 7d | Cron 평일 18:00 |
| `snap:{code}` | 마지막 체결 스냅샷 | 24h | 허브가 실시간 수신 시 갱신 |

### 4-4. wrangler 설정

```toml
# functions/wrangler-stock.toml
name = "dt-stock"
main = "dt-stock-worker.js"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat", "allow_custom_ports"]

[[kv_namespaces]]
binding = "STOCK_CACHE"
id = "<wrangler kv namespace create STOCK_CACHE>"

[[durable_objects.bindings]]
name = "KIS_HUB"
class_name = "KisHub"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["KisHub"]      # 무료 플랜은 SQLite 백엔드만 지원

[triggers]
crons = ["20 23 * * 0-4"]            # UTC 23:20 = KST 08:20 (월~금 기동)

# Secrets
# wrangler secret put KIS_APP_KEY     --config functions/wrangler-stock.toml
# wrangler secret put KIS_APP_SECRET  --config functions/wrangler-stock.toml
# wrangler secret put KRX_API_KEY     --config functions/wrangler-stock.toml
# wrangler secret put OPENAI_API_KEY  --config functions/wrangler-stock.toml
```

---

## 5. 인프라 비용

### Durable Objects 과금 구조
- **Duration**: 128MB 기준. 아웃바운드 WS가 붙어 있는 동안 계속 과금 (하이버네이션 불가)
- **Requests**: 인입 WebSocket 메시지에 **20:1 비율** 적용. 아웃바운드 메시지는 **무료**

### 실사용 추정 (장중 9.8시간 × 월 22영업일)

| 항목 | 계산 | 월 사용량 | 무료 한도 | 유료 포함분 |
|------|------|----------|----------|-----------|
| DO Duration | 0.128GB × 35,400s × 22일 | **≈ 99,700 GB-s** | 13,000 GB-s/**일** (일 4,531 사용 → OK) | 400,000 GB-s/월 |
| DO Requests | 인입 30msg/s ÷ 20 × 35,400s × 22일 | **≈ 1.17M** | 100,000/**일** (일 53,000 → OK) | 1M/월 (+$0.15/M) |
| KV / Workers | 브리핑·검색 등 | 미미 | 넉넉 | 포함 |

**결론: Workers Paid $5/월이면 충분합니다.** 초과분은 월 $0.05 수준.

무료 플랜으로도 산술적으로는 가능하지만, 동시 접속이 늘거나 변동성 큰 날 호가 메시지가 폭증하면 일 한도를 넘겨 **장중에 서비스가 끊깁니다.** 실시간이 필수 기능이라면 $5는 지불하는 게 맞습니다.

**추가 비용 없음**: KIS OpenAPI 무료, KRX Open API 무료, Firebase 현 요금제 유지.

---

## 6. Firestore 데이터 모델

> ⚠️ **시세는 Firestore에 절대 쓰지 마세요.** 실시간 체결을 Firestore에 넣으면 쓰기 비용이 폭발합니다.
> 시세는 KV + DO 메모리에만, Firestore는 사람이 만든 데이터(브리핑·게시글·댓글·관심종목)만 담습니다.

```
invest_briefings/{briefingId}              # 관리자 시황 브리핑
  date, title, body
  market        "all" | "kospi" | "kosdaq"
  tickers       ["005930", "000660"]        # 언급 종목 → 실시간 칩으로 렌더
  sentiment     "bull" | "bear" | "neutral"
  authorName, pinned, commentCount
  createdAt, updatedAt

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
  priceAtPost   71200                       # 작성 시점 주가 (사후 검증용)
  likes, likedBy[], commentCount, reportCount
  createdAt
  └─ comments/{commentId}

stock_watchlist/{uid}                       # 내 관심종목
  codes[], updatedAt

stock_hot/global                            # 클럽 공용 관심종목 TOP 8 (상시 구독 대상)
  codes[]                                   # 관리자 큐레이션 + 조회수 집계
  updatedAt

stock_reports/{reportId}                    # 신고 접수
  targetPath, reason, reporterUid, status, createdAt

invest_config/settings                      # 면책 문구·공지·기능 플래그
```

### 6-1. 보안 규칙 (`firestore.rules` 추가분)

기존 헬퍼(`isAuth` / `isRealUser` / `isAdmin` / `isOwner`)를 그대로 씁니다.

```javascript
// ── invest_briefings (관리자 시황 브리핑) ──────────────────
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
  // ★ 본문 조작 방지: 남의 글은 카운터 필드만 변경 가능
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

match /stock_watchlist/{uid} {
  allow read: if isOwner(uid) || isAdmin();
  allow write: if isOwner(uid);
}

match /stock_hot/{docId} {
  allow read: if true;
  allow write: if isAdmin();
}

match /stock_reports/{reportId} {
  allow read: if isAdmin();
  allow create: if isRealUser()
    && request.resource.data.reporterUid == request.auth.uid;
  allow update, delete: if isAdmin();
}

match /invest_config/{docId} {
  allow read: if true;
  allow write: if isAdmin();
}
```

> `allow update: if isRealUser()` 처럼 **필드 제한 없는 update를 절대 쓰지 않는 것**이 이 설계의 원칙입니다.
> 기존 `anon_posts` 규칙이 이 형태라 아무 회원이나 남의 글 본문을 덮어쓸 수 있는 상태입니다. (§11 참조)

### 6-2. 필요한 복합 인덱스

```
invest_briefings          : pinned DESC, createdAt DESC
stock_boards/{code}/posts : createdAt DESC
stock_boards/{code}/posts : likes DESC, createdAt DESC
```

---

## 7. 화면 설계 (모바일 우선)

### 7-1. `/invest/` 홈

```
┌──────────────────────────────────────┐
│ ← 홈      💰 재테크        🟢 실시간  │  ← 연결 상태 인디케이터
├──────────────────────────────────────┤
│ [📈 국내주식] [🏠 부동산] [🪙 코인]   │
├──────────────────────────────────────┤
│ ┌── 지수 (가로 스크롤) ─────────────┐ │
│ │ KOSPI  2,684.12 ▲0.82%          │ │
│ │ KOSDAQ   812.44 ▼0.31%          │ │
│ │ USD/KRW 1,342.50 ▲0.12%         │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌── 📋 오늘의 시황 브리핑 ─────────┐ │
│ │ 📌 고정   2026.09.09             │ │
│ │ 9/9 시황 — 반도체 반등, 금리 관망│ │
│ │ 미 증시 강세에 반도체가 3거래일…  │ │
│ │                        더보기 ▾  │ │
│ │ ─────────────────────────────── │ │
│ │ 🏷️ 005930 71,200 ▲1.28%         │ │  ← 브리핑 종목칩도 실시간
│ │    000660 182,400 ▼0.44%        │ │
│ │ 💬 댓글 12    👀 340             │ │
│ └──────────────────────────────────┘ │
│   이전 브리핑 보기 (24개) ▾           │
│                                      │
│ ┌── ⭐ 내 관심종목 ────────────────┐ │
│ │ 삼성전자  71,200 ▲1.28%  🟢     │ │  ← 🟢=실시간 / ⏱=폴링
│ │ NAVER    182,400 ▼0.44%  🟢     │ │
│ │              + 관심종목 추가     │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌── 🔥 오늘의 등락 ────────────────┐ │
│ │ [상승] [하락] [거래량]           │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 🔍 종목 검색                          │
│                                      │
│ ⚠️ 투자 참고용 · 판단과 책임은 본인   │
└──────────────────────────────────────┘
```

### 7-2. 종목 상세 — 실시간

```
┌──────────────────────────────────────┐
│ ← 재테크    삼성전자   🟢   ⭐ 관심   │
├──────────────────────────────────────┤
│ 005930 · KOSPI · 반도체               │
│                                      │
│   71,200                             │  ← 체결 시 숫자만 플래시
│   ▲ 900 (+1.28%)   거래량 1,204만    │
│                                      │
│ [시세] [호가] [차트] [커뮤니티]       │  ← 세그먼트 탭
├──────────────────────────────────────┤
│ ── 호가 탭 ───────────────────────── │
│                                      │
│   매도잔량      호가      매수잔량    │
│  ┌────────────────────────────────┐  │
│  │   12,400 ▓▓▓  71,600           │  │
│  │    8,120 ▓▓   71,500           │  │
│  │    6,300 ▓    71,400           │  │
│  │    4,100 ▓    71,300           │  │
│  │    2,800      71,250           │  │
│  │ ═══════ 71,200 ● 현재가 ══════ │  │
│  │              71,150      3,100 │  │
│  │              71,100 ▓    5,200 │  │
│  │              71,000 ▓▓▓ 18,300 │  │
│  │              70,900 ▓    6,400 │  │
│  │              70,800 ▓    4,900 │  │
│  └────────────────────────────────┘  │
│   총매도 84,200  │  총매수 91,500     │
│   [■■■■■■■□□□□□] 매수 52.1%          │
│                                      │
│   ⓘ 실시간 · 09:30:15 갱신           │
├──────────────────────────────────────┤
│ ── 차트 탭 ───────────────────────── │
│  [1분][5분][일][주][월]              │
│      ╱╲    ╱╲                        │
│  ╱╲╱  ╲╱╲╱  ╲╱╲   ← 마지막 봉 실시간 │
│  ▁▂▃▅▂▁▃▅▇▅▃      (거래량)          │
├──────────────────────────────────────┤
│ [🔗 네이버금융]  [🔗 증권사 앱]       │
└──────────────────────────────────────┘
```

**호가창 렌더링 규칙**
- 잔량 막대(`▓`)는 그 화면에 보이는 최대 잔량 기준 정규화
- 매도=`--stock-down` 계열, 매수=`--stock-up` 계열 배경 (한국 관행: 상승 빨강)
- 값이 바뀐 셀만 120ms 플래시 — **전체 리렌더 금지**, 셀 단위 `textContent` 갱신
- 호가 메시지는 초당 수십 건까지 오므로 **requestAnimationFrame으로 코얼레싱** (초당 최대 10회 렌더)

### 7-3. 실시간 상태 배지

| 배지 | 의미 | 조건 |
|------|------|------|
| 🟢 실시간 | WebSocket 구독 중 | 정상 |
| ⏱ 2초 지연 | REST 폴링 모드 | 41슬롯 초과로 강등 |
| 🔴 연결 끊김 | upstream 장애 | 자동 재연결 시도 중 |
| ⚫ 장 마감 | 장외 시간 | 마지막 체결가 + KRX 종가 표시 |
| 🔒 회원 전용 | 비회원/게스트 | 로그인 유도 |

### 7-4. 브리핑 댓글

```
┌── 💬 댓글 12 ────────────────────────┐
│ [ 댓글을 입력하세요...      ] [등록] │
│                                      │
│ 👤 박OO · 1시간 전                    │
│    반도체 비중 지금 늘려도 될까요?    │
│    👍 3   답글                        │
│    └ 👑 운영진 · 40분 전  [관리자]    │
│        분할 매수 관점이면 나쁘지      │
│        않은 구간이라 봅니다…          │
│        👍 8                          │
└──────────────────────────────────────┘
```

### 7-5. 관리자 탭

```
┌── ⚙️ 관리 ───────────────────────────┐
│ 📋 시황 브리핑 작성                   │
│   날짜 / 제목 / 톤(강세·중립·약세)    │
│   종목 태그 [005930 ×] [000660 ×] +  │
│   본문 [                          ]  │
│   [🤖 AI 초안 생성] [📌 고정] [게시]  │
│                                      │
│ 📡 실시간 허브 상태                   │
│   슬롯 34 / 41    접속 12명           │
│   upstream: connected (09:30:15)     │
│   [강제 재연결]                       │
│                                      │
│ ⭐ 공용 관심종목 TOP 8 (상시 구독)     │
│ 🚨 신고 접수 (3)                      │
│ 📢 공지 / 면책 문구 수정               │
└──────────────────────────────────────┘
```

---

## 8. AI 브리핑 초안 생성

기존 `dt-ai` 워커(OpenAI Responses API, `gpt-4.1`)와 `dt-digest` 워커 패턴을 재사용합니다.

```
관리자가 [🤖 AI 초안 생성] 클릭
        │
        ▼  POST /api/briefing/draft
        ├─ KV에서 오늘 지수·등락률 상위 로드
        ├─ dt-rss 워커로 경제 뉴스 헤드라인 수집
        ├─ OpenAI로 초안 생성
        ▼
{ "title":"…", "body":"…", "tickers":["005930"], "sentiment":"neutral" }
        │
        ▼
관리자가 폼에서 수정 후 게시  ← ★ 자동 게시 금지, 반드시 사람이 검수
```

**시스템 프롬프트 초안**
```
당신은 한국 주식시장 시황을 정리하는 애널리스트입니다.
제공된 지수 데이터와 뉴스 헤드라인만을 근거로 브리핑 초안을 작성하세요.

규칙:
- 사실과 해석을 명확히 구분한다. 데이터에 없는 수치는 절대 지어내지 않는다.
- "매수하세요", "목표가 OO원" 같은 직접적 투자 권유 표현을 쓰지 않는다.
- 특정 종목은 "왜 움직였는가"를 설명하되 매매 판단은 독자에게 남긴다.
- 구성: ① 시장 한 줄 요약 ② 지수·수급 ③ 주목할 섹터/종목 ④ 내일 체크포인트
- 400~600자. 이모지는 소제목에만.
```

> 자동 게시를 넣지 않는 이유: AI가 만든 시황이 그대로 나가면 오류 시 운영자가 책임을 집니다.
> `ai_trend_posts`는 정보 큐레이션이라 자동화가 괜찮지만, 투자 정보는 사람이 최종 확인해야 합니다.

---

## 9. 파일 구조

```
dt/
├── invest/                          # ★ 신규 서브앱
│   ├── index.html                   # 홈 + 종목상세 + 커뮤니티 + 관리
│   ├── app.js                       # 라우팅·렌더·Firestore
│   ├── realtime.js                  # ★ WebSocket 클라이언트 (재연결·구독·강등)
│   ├── orderbook.js                 # ★ 호가창 렌더러 (rAF 코얼레싱)
│   ├── chart.js                     # lightweight-charts 래퍼 + 실시간 틱 반영
│   └── style.css                    # 기존 CSS 변수 상속
│
├── functions/
│   ├── dt-stock-worker.js           # ★ Worker 진입점 + 인증
│   ├── kis-hub.js                   # ★ Durable Object (팬아웃 허브)
│   ├── kis-protocol.js              # ★ KIS 프레임 파서/빌더
│   └── wrangler-stock.toml
│
├── firestore.rules                  # invest_* / stock_* 규칙 추가
├── index.html                       # 홈 진입점 3곳 추가
├── sitemap.xml                      # /invest/ 추가
└── docs/feature-plan-invest-stock.md
```

### 기술 선택

| 항목 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | 없음 (Vanilla JS) | 기존 서브앱과 동일. 번들러 불필요 |
| Firebase | compat SDK v10.12.2 (CDN) | 기존 서브앱과 동일 버전 |
| 차트 | [lightweight-charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0, ~45KB) | **자체 실시간 틱을 봉에 반영해야 하므로 위젯 불가.** `update()`로 마지막 봉만 갱신 |
| 호가창 | 자체 구현 | 라이브러리 없음. DOM 21행 고정 + 셀 단위 갱신 |
| 스타일 | 기존 CSS 변수 (`--primary` `#7c6fff` 등) | 브랜드 일관성 |

> rev.1의 TradingView 위젯 안은 폐기합니다. 위젯은 iframe이라 **우리 실시간 데이터를 넣을 수 없고 호가도 없습니다.**

### 재테크 전용 시맨틱 컬러

```css
:root {
  --stock-up:   #ff4d4d;  /* 상승 — 한국 관행상 빨강 */
  --stock-down: #4d8bff;  /* 하락 — 파랑 */
  --stock-flat: #9898b0;
  --book-ask:   rgba(77,139,255,.14);   /* 호가창 매도 배경 */
  --book-bid:   rgba(255,77,77,.14);    /* 호가창 매수 배경 */
  --flash:      rgba(255,255,255,.22);  /* 변경 셀 플래시 */
}
```

> ⚠️ 기존 `--accent: #ff6b6b`(경고/위험)와 상승 빨강이 시각적으로 겹칩니다.
> 상승/하락 색은 **숫자와 호가 배경에만** 쓰고, 경고 배지에는 쓰지 않는 규칙을 두세요.

---

## 10. 구현 단계

### Phase 0 — 사전 준비 (지금 바로, 소요 3~5일 대기)

병렬로 신청해두면 Phase 2 착수가 막히지 않습니다.

- [ ] **한국투자증권 실계좌 개설** (비대면, 1~2일)
- [ ] **HTS ID 등록** — WebSocket 필수
- [ ] KIS Developers 가입 → `APP_KEY` / `APP_SECRET` 발급
- [ ] **KRX Open API 인증키 신청** (영업일 1일) + 서비스 5종 개별 신청
      (유가증권·코스닥 일별매매정보, 유가증권·코스닥 종목기본정보, KOSPI 시리즈 일별시세)
- [ ] **Cloudflare Workers Paid 전환** ($5/월)

### Phase 1 — 시황 브리핑 + 댓글 (1~2주)

시세 없이도 서비스가 성립합니다. 먼저 내고 반응을 봅니다.

- [ ] `/invest/` 뼈대, 자산군 탭 UI
- [ ] `invest_briefings` + 보안 규칙 배포
- [ ] 관리자 브리핑 작성/수정/삭제/고정
- [ ] 브리핑 목록·상세, 접기/펼치기 (ai-trend 패턴 재사용)
- [ ] **브리핑 댓글 + 1단계 대댓글 + 좋아요**, 관리자 배지
- [ ] 면책 문구 상시 노출
- [ ] 홈 진입점 3곳 추가

### Phase 2 — 실시간 허브 (2~3주) ★ 난이도 최상

- [ ] **🔬 스파이크 (반나절): 포트 21000 연결 검증** — §3-5의 A → B 순서로
- [ ] `kis-protocol.js` — 프레임 빌더/파서 + PINGPONG + 필드 인덱스 맵, 단위 테스트
- [ ] `KisHub` DO — 인바운드 WS(Hibernation), 아웃바운드 WS, alarm 수명주기
- [ ] 참조 카운팅 + 41슬롯 LRU 축출 + 폴링 강등
- [ ] Firebase ID 토큰 검증 (JWKS 캐시, 게스트 차단, uid당 3연결 제한)
- [ ] `realtime.js` — 자동 재연결(지수 백오프), 토큰 갱신, 구독 복구
- [ ] 관리자 허브 상태 대시보드

### Phase 3 — 실시간 화면 (2주)

- [ ] 종목 검색 (한글 초성)
- [ ] 종목 상세 + 실시간 체결가
- [ ] **호가창** — 10단계, rAF 코얼레싱, 셀 단위 플래시
- [ ] 실시간 차트 — 분봉 초기 로드 + 틱 반영
- [ ] 관심종목 + 홈 실시간 스트립
- [ ] 브리핑 종목칩 실시간 연동

### Phase 4 — 종목별 커뮤니티 (2주)

- [ ] `stock_boards/{code}/posts` + 댓글
- [ ] 강세/약세 태그, 작성 시점 주가 기록, 좋아요, 정렬
- [ ] **신고 기능 + 관리자 처리 큐** (커뮤니티와 동시 출시, 나중에 붙이지 말 것)
- [ ] 금칙어 필터

### Phase 5 — 고도화

- [ ] 가격 알림 푸시 (기존 `dt-push` 워커 + `PUSH_SUBS` KV 재사용)
- [ ] AI 브리핑 초안 자동 생성 + 스케줄 리마인더
- [ ] 계좌 추가 샤딩 (슬롯 부족 시)
- [ ] 재테크 확장: 부동산(실거래가 API) / 연금 / 절세 계산기

---

## 11. 주의사항

### 11-1. 시세 재배포 — 운영자 판단 반영

폐쇄형 동호회·무료 운영 전제로 **진행하기로 결정**되었습니다. 다만 그 전제를 실제로 유지하는 조건을 코드에 박아둡니다.

- 실시간 피드 엔드포인트는 **Firebase 인증 통과한 실제 회원만** 접근 (§4-2) — 게스트·비회원 차단
- 시세 데이터를 **공개 URL로 노출하지 않음** — REST 스냅샷 API도 동일하게 인증 요구
- 검색엔진 색인 제외: `/invest/` 실시간 경로는 `robots.txt`에 `Disallow`
- **유료화하지 않음** — 회비·구독료를 받는 순간 성격이 달라집니다 (§11-2와도 연결)
- 화면에 출처 표기: `데이터 제공: 한국투자증권 OpenAPI`

> 참고: 폐쇄 그룹이라는 사실이 제공사 약관을 자동으로 면제해주지는 않습니다. 위 조건들은 리스크를 실무상 최소화하는 장치이고, 규모가 커지거나 성격이 바뀌면 다시 검토가 필요합니다.

### 11-2. 유사투자자문업

자본시장법 제101조상 유사투자자문업은 **"대가를 받고"** 불특정다수에게 투자판단·가치에 관한 조언을 하는 것입니다.

| 상황 | 신고 필요 여부 |
|------|--------------|
| 동호회 회원 대상 **무료** 시황 브리핑 | 신고 대상 아님 |
| 회비·구독료를 받고 브리핑 제공 | **유사투자자문업 신고 필요** |
| 1:1 맞춤 종목 조언 | **투자자문업 인가 필요** (신고로 불가) |
| 실시간 채팅으로 매매 타이밍 제시 (리딩방) | 2024년 개정법상 **유료 운영은 불법** |

**권고**
- 재테크 탭은 **완전 무료** 유지. 유료화 논의가 나오면 이 항목부터 재검토
- 댓글에서 "지금 사야 하나요?"에 관리자가 1:1로 매수·매도를 지시하는 답변은 피하고, 시장 해석 수준으로
- AdSense가 붙어 있으므로 브리핑 페이지 광고 배치는 보수적으로

### 11-3. 면책 고지 상시 노출

브리핑 하단, 종목 상세 하단, 커뮤니티 상단 3곳 고정.

```
⚠️ DT 재테크의 모든 정보는 투자 참고용이며, 특정 종목의 매수·매도를
   권유하지 않습니다. 시세는 지연·오류가 있을 수 있으며, 시스템 장애로
   중단될 수 있습니다. 투자 판단과 그 결과의 책임은 전적으로 투자자
   본인에게 있습니다. 회원 게시글은 DT Club의 입장과 무관합니다.
   데이터 제공: 한국투자증권 OpenAPI · 한국거래소(KRX)
```

### 11-4. 커뮤니티 리스크

종목 게시판은 일반 게시판보다 위험합니다. 시세조종성 글, 허위사실, 리딩방 유인 광고가 붙습니다.

- 신고 기능은 **커뮤니티와 동시 출시** (나중에 붙이지 마세요)
- 금칙어: `리딩방`, `수익인증`, `단톡방`, `무료체험`, 카카오 오픈채팅 링크 패턴
- 작성은 실제 회원만 — `isRealUser()`로 커버됨
- `reportCount` ≥ 3이면 자동 블라인드

### 11-5. 실시간 시스템 운영 리스크

| 리스크 | 대응 |
|--------|------|
| KIS 세션 끊김 | alarm 10분 점검 + 지수 백오프 재연결 + **끊기면 구독 전체 재등록** |
| 접근토큰 만료 | 6시간 주기 선제 갱신. **재발급 1분 1회 제한** — 실패 시 즉시 재시도 금지, 60초 대기 |
| 41슬롯 초과 | LRU 축출 → REST 폴링 강등 → 화면에 `⏱ 2초 지연` 표시 |
| 호가 메시지 폭주 | 클라이언트 rAF 코얼레싱(최대 10fps) + 허브에서 종목당 100ms 스로틀 |
| DO 15분 축출 | alarm 10분 주기로 항상 선점 |
| 계정 공유 | uid당 동시 연결 3개 제한 |
| 장애 시 사용자 혼란 | 🔴 배지 + "증권사 앱에서 확인하세요" 안내 + 딥링크 |

### 11-6. 데이터 비용

**시세는 Firestore가 아니라 KV/메모리에만.** Firestore는 브리핑·게시글·댓글·관심종목만 담습니다. 실시간 체결을 Firestore에 쓰면 쓰기 비용이 폭발합니다.

---

## 12. 메인 홈 진입점

### 12-1. 히어로 버튼 (`index.html` ~146행)

```html
<div class="hero-buttons">
  <a href="spots/" class="btn btn-primary">📍 DT 스팟</a>
  <a href="invest/" class="btn btn-outline">💰 재테크</a>   <!-- 추가 -->
  <a href="ai-trend/" class="btn btn-outline">🤖 AI 트렌드</a>
  <a href="car-trend/" class="btn btn-outline">🚘 자동차 트렌드</a>
  <a href="legal/" class="btn btn-outline">⚖️ 법률 도우미</a>
</div>
```

### 12-2. 홈 브리핑 탭 3번째 슬롯 (~154행)

```html
<div class="home-briefing-tabs">
  <button class="home-briefing-tab active" data-brief="ai">🤖 AI 트렌드</button>
  <button class="home-briefing-tab" data-brief="car">🚘 자동차 트렌드</button>
  <button class="home-briefing-tab" data-brief="invest">💰 재테크</button>  <!-- 추가 -->
</div>
```

`app.js`의 홈 브리핑 로더가 `ai_trend_posts` / `car_trend_posts`를 읽는 부분에 `invest_briefings`를 추가합니다. 최신 1건 프리뷰만 보여주고 더보기는 `/invest/`로 보냅니다.
**메인 홈에서는 실시간 WebSocket을 붙이지 않습니다** — 홈 진입만으로 허브 슬롯을 소모하면 낭비입니다.

### 12-3. DT 라운지 카드 (~183행)

```html
<a href="invest/" class="home-tool-card home-tool-sm">
  <span class="home-tool-icon">💰</span>
  <span class="home-tool-name">재테크</span>
</a>
```

### 12-4. 하단 nav는 건드리지 않음

현재 5개(홈/회원/차량/이벤트/게시판)가 모바일 하단 nav의 적정 상한입니다. 6개로 늘리면 터치 타겟이 좁아집니다.

---

## 13. 함께 처리하면 좋을 기존 이슈

| 우선순위 | 위치 | 내용 |
|---------|------|------|
| 🔴 높음 | `firestore.rules:141` | `anon_posts`의 `allow update: if isRealUser()` — 필드 제한이 없어 **아무 회원이나 남의 글 본문을 덮어쓸 수 있음**. 주석 의도대로 `hasOnly(['likes','likedBy'])`로 제한 필요 |
| 🔴 높음 | `firestore.rules:157` | `blacklist`의 `allow read: if true` — **강퇴 사유가 담긴 이메일 목록이 비인증 전체 공개**. read를 `isAdmin()`으로 제한하고 가입 시 체크는 워커로 이관 |
| 🟡 중간 | `firestore.rules:143` | `anon_posts`의 `allow delete: if isAdmin()` — 작성자 본인이 자기 글을 못 지움 |
| 🟡 중간 | `app.js` (256KB / 170 함수) | 단일 파일 한계. 재테크를 서브앱으로 분리하는 이번 설계의 전제 |
| 🟢 낮음 | `sw.js:4` | STATIC은 `/app.js`를 캐시하는데 HTML은 `app.js?v=10`을 요청 → 캐시 키 불일치 |
| 🟢 낮음 | `sw.js` | 서비스워커가 `/invest/`의 WebSocket을 가로채지 않도록 확인 (동일 출처 fetch만 처리하므로 현재는 안전) |

---

## 14. 결정이 필요한 사항

| # | 질문 | 기본 제안 |
|---|------|----------|
| 1 | KIS 계좌를 **누구 명의**로 개설하나요? | 운영진 대표 1명. 앱키는 Cloudflare Secret에만 보관, 저장소 커밋 금지 |
| 2 | 실시간을 **회원 전용**으로 잠글까요? | 예 — §11-1의 전제를 유지하는 핵심 조건 |
| 3 | 브리핑·커뮤니티는 비회원 공개? | 공개 (SEO·유입). 실시간 시세만 회원 전용 |
| 4 | 커뮤니티 **실명(회원명) vs 익명**? | 실명 — 익명은 종목판 특성상 관리 부담이 큼 |
| 5 | Phase 1(브리핑)을 먼저 낼까요, Phase 2(실시간)까지 묶어서 낼까요? | 브리핑 먼저 — 실시간은 리스크가 커서 별도 릴리스가 안전 |

---

## 15. 참고 링크

- KIS Developers (한국투자증권) — https://apiportal.koreainvestment.com/apiservice
- 한국투자증권 공식 예제 저장소 — https://github.com/koreainvestment/open-trading-api
- KIS WebSocket 41건 제한 및 다중 계좌 대응 사례 — https://hky035.github.io/web/refact-kis-websocket/
- KRX Open API — https://openapi.krx.co.kr/
- 공공데이터포털 금융위원회 주식시세정보 — https://www.data.go.kr/data/15094808/openapi.do
- Cloudflare Durable Objects — WebSockets 모범 사례 — https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Durable Objects — 요금 — https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare Workers — TCP Sockets (`connect()`) — https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- lightweight-charts — https://github.com/tradingview/lightweight-charts
- 금융위 유권해석: 온라인 주식방송의 유사투자자문업 신고 필요 여부 — https://better.fsc.go.kr/fsc_new/replyCase/LawreqDetail.do?stNo=11&muNo=171&muGpNo=75&lawreqIdx=3509
