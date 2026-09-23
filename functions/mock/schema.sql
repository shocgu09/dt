-- DT 모의투자 장부 (Cloudflare D1)
-- 이 DB 에는 dt-stock 워커만 접근한다. 브라우저가 잔고를 직접 쓸 경로가 없다.
-- 금액은 전부 정수(원). CHECK 제약은 동시 체결로 잔고·수량이 음수가 되는 것을 DB 차원에서 막는다
-- (제약 위반이면 batch 전체가 롤백된다).
--
-- 적용: npx wrangler d1 execute dt-mock --remote --file functions/mock/schema.sql --config functions/wrangler-stock.toml

CREATE TABLE IF NOT EXISTS seasons (
  id          TEXT PRIMARY KEY,            -- '2026PRE', '2027Q1'
  name        TEXT NOT NULL,
  start_date  TEXT NOT NULL,               -- YYYY-MM-DD (KST)
  end_date    TEXT NOT NULL,
  seed        INTEGER NOT NULL,
  fee_rate    REAL NOT NULL,               -- 0.00015 = 0.015%
  tax_rate    REAL NOT NULL,               -- 0.002 = 0.20% (매도, ETF·ETN 면제)
  volume_fill INTEGER NOT NULL DEFAULT 1,  -- 1: 실제 거래량 범위 안에서만 체결
  fill_mode   TEXT NOT NULL DEFAULT 'realtime',   -- realtime | close
  notice      TEXT,                                 -- 운영진 전달사항 (참가 안내 창에 보여 준다)
  status      TEXT NOT NULL DEFAULT 'upcoming'    -- upcoming | active | settling | closed
);

CREATE TABLE IF NOT EXISTS accounts (
  season_id    TEXT NOT NULL,
  uid          TEXT NOT NULL,
  nickname     TEXT NOT NULL,
  cash         INTEGER NOT NULL CHECK (cash >= 0),
  fills        INTEGER NOT NULL DEFAULT 0,
  realized_pnl INTEGER NOT NULL DEFAULT 0,
  joined_at    INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',    -- active | hidden
  PRIMARY KEY (season_id, uid)
);

CREATE TABLE IF NOT EXISTS positions (
  season_id TEXT NOT NULL,
  uid       TEXT NOT NULL,
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  qty       INTEGER NOT NULL CHECK (qty >= 0),
  cost      INTEGER NOT NULL CHECK (cost >= 0),   -- 보유분 매입금액 합(이동평균). 평단 = cost / qty
  PRIMARY KEY (season_id, uid, code)
);

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL,
  season_id       TEXT NOT NULL,
  uid             TEXT NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('buy','sell')),
  type            TEXT NOT NULL CHECK (type IN ('market','limit')),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  limit_price     INTEGER,
  filled_qty      INTEGER NOT NULL DEFAULT 0,
  reserved        INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),   -- 매수 주문이 묶어 둔 현금(증거금)
  vol_at_accept   INTEGER NOT NULL DEFAULT 0,     -- 접수 시점 KRX 누적거래량 — 이후 늘어야 "실제 체결이 있었다"
  pre_open        INTEGER NOT NULL DEFAULT 0,     -- 09:00 전 접수 → 시가에 체결
  session         TEXT NOT NULL DEFAULT 'regular',-- regular(정규장) | pre(NXT 프리마켓) | after(NXT·KRX 애프터마켓)
  nxt_vol_at_accept INTEGER NOT NULL DEFAULT 0,   -- 접수 시점 NXT 누적거래량 (시간외 주문의 체결 판정용)
  marketable      INTEGER NOT NULL DEFAULT 0,     -- 접수 시점에 즉시 체결 가능한 지정가였는지
  tax_free        INTEGER NOT NULL DEFAULT 0,     -- ETF·ETN
  trade_date      TEXT NOT NULL,                  -- 접수한 거래일 (YYYYMMDD, KST) — 당일 장 마감에 만료
  status          TEXT NOT NULL DEFAULT 'open',   -- open | partial | filled | cancelled | expired | rejected
  reason          TEXT,
  accepted_at     INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CHECK (filled_qty >= 0 AND filled_qty <= qty),
  UNIQUE (uid, client_order_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_open ON orders (status, season_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (season_id, uid, accepted_at);

CREATE TABLE IF NOT EXISTS fills (
  id        TEXT PRIMARY KEY,
  order_id  TEXT NOT NULL,
  season_id TEXT NOT NULL,
  uid       TEXT NOT NULL,
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  side      TEXT NOT NULL,
  qty       INTEGER NOT NULL,
  price     INTEGER NOT NULL,
  fee       INTEGER NOT NULL,
  tax       INTEGER NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fills_user ON fills (season_id, uid, at);

-- 15:30 종가 단일가 체결가. 네이버 일봉·현재가는 16시 이후 애프터마켓을 따라 움직여 정산 기준으로 못 쓴다.
CREATE TABLE IF NOT EXISTS closes (
  code  TEXT NOT NULL,
  date  TEXT NOT NULL,                     -- YYYYMMDD
  close INTEGER NOT NULL,
  PRIMARY KEY (code, date)
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  season_id TEXT NOT NULL,
  uid       TEXT NOT NULL,
  date      TEXT NOT NULL,
  equity    INTEGER NOT NULL,
  cash      INTEGER NOT NULL,
  rank      INTEGER,
  PRIMARY KEY (season_id, uid, date)
);

CREATE TABLE IF NOT EXISTS final_rankings (
  season_id TEXT NOT NULL,
  rank      INTEGER NOT NULL,
  uid       TEXT NOT NULL,
  nickname  TEXT NOT NULL,
  equity    INTEGER NOT NULL,
  fills     INTEGER NOT NULL,
  PRIMARY KEY (season_id, uid)
);

CREATE TABLE IF NOT EXISTS blocked_codes (
  code   TEXT PRIMARY KEY,
  reason TEXT,
  by_uid TEXT,
  at     INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     INTEGER NOT NULL,
  actor  TEXT,
  action TEXT NOT NULL,
  detail TEXT
);

-- ── 자랑하기 스냅샷 ────────────────────────────────────────────
-- 종목 커뮤니티에 붙이는 "내 수익률" 카드.
-- 숫자를 글(Firestore)에 저장하면 개발자도구로 고칠 수 있으므로, 워커가 장부에서 직접 읽어
-- 여기에 박아 두고 글에는 id 만 남긴다. 클라이언트를 거치지 않아 위조할 수 없다.
-- 자랑한 순간으로 고정한다 — 나중에 주가가 변해도 그때 그 숫자를 보여 준다.
CREATE TABLE IF NOT EXISTS brags (
  id         TEXT PRIMARY KEY,
  season_id  TEXT NOT NULL,
  uid        TEXT NOT NULL,
  nickname   TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  qty        INTEGER NOT NULL,
  avg_price  INTEGER NOT NULL,          -- cost / qty (반올림)
  price      INTEGER NOT NULL,          -- 자랑한 순간의 현재가
  pnl        INTEGER NOT NULL,          -- 평가손익(원) — 손실이면 음수
  pnl_rate   REAL NOT NULL,             -- 수익률(%)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brags_uid ON brags(uid, created_at DESC);

-- ── AI 계좌 평가 ──────────────────────────────────────────────
-- 지표는 워커가 D1 에서 직접 계산하고(metrics), AI 는 그걸 문장으로만 푼다(body).
-- 숫자를 AI 에게 계산시키면 틀리고, 같은 계좌를 두 번 평가할 때 값이 달라진다.
-- ymd 는 하루 횟수 제한용(KST 기준).
CREATE TABLE IF NOT EXISTS reviews (
  id         TEXT PRIMARY KEY,
  season_id  TEXT NOT NULL,
  uid        TEXT NOT NULL,
  ymd        TEXT NOT NULL,            -- YYYYMMDD (KST)
  metrics    TEXT NOT NULL,            -- 계산된 지표 JSON — 화면 숫자는 이걸 쓴다
  body       TEXT NOT NULL,            -- AI 가 쓴 평가문
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_quota ON reviews(uid, ymd);
