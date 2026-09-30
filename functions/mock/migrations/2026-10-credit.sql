-- 2026-10 결제(T+2)·미수·신용융자·증권담보대출 (functions/mock/credit.js)
-- 기존 행은 건드리지 않는다 — 새 칸은 전부 기본값이 있고, 기본값일 때 예전과 똑같이 동작한다.
-- 적용: 한 문장씩 (wrangler d1 execute --command 에 ALTER 두 개를 넣으면 실패한다)
--   npx wrangler d1 execute dt-mock --remote --config functions/wrangler-stock.toml --command "<문장>"

-- 시즌별 사용 여부: off(없음) | admin(운영진만 — 운영 환경 시험용) | on(전 회원)
ALTER TABLE seasons ADD COLUMN credit_mode TEXT NOT NULL DEFAULT 'off';

-- 예수금(D+2) = cash − cash_short. 모자란 만큼을 cash_short 에 쌓는다 (cash >= 0 CHECK 는 체결 경합 안전장치라 그대로)
ALTER TABLE accounts ADD COLUMN cash_short INTEGER NOT NULL DEFAULT 0 CHECK (cash_short >= 0);
-- 계좌 증거금률: cash(100%) | spectrum(종목 증거금률 — 미수 가능)
ALTER TABLE accounts ADD COLUMN margin_mode TEXT NOT NULL DEFAULT 'cash';
-- 미수동결 마지막 날 (YYYYMMDD) — 그날까지 증거금 100%
ALTER TABLE accounts ADD COLUMN frozen_until TEXT;
-- 미수가 처음 생긴 결제일 / 연체이자를 마지막으로 매긴 날
ALTER TABLE accounts ADD COLUMN misu_since TEXT;
ALTER TABLE accounts ADD COLUMN misu_accrued_ymd TEXT;
-- 낸 이자·연체료 합계 (표시용 — 실현손익에는 넣지 않는다)
ALTER TABLE accounts ADD COLUMN interest_paid INTEGER NOT NULL DEFAULT 0;

-- 주문: credit = buy(신용매수) | NULL, lot_id = 상환할 신용·담보 잔고, margin_rate = 접수 때 적용한 증거금률·보증금률,
--       forced = misu | collateral | expiry (반대매매 — 회원이 취소·정정할 수 없다)
ALTER TABLE orders ADD COLUMN credit TEXT;
ALTER TABLE orders ADD COLUMN lot_id TEXT;
ALTER TABLE orders ADD COLUMN margin_rate REAL;
ALTER TABLE orders ADD COLUMN forced TEXT;

-- 체결: 결제일, 결제 때 예수금 증감, 증거금 계산용 값, 신용·담보 잔고, 융자·상환 원금, 상환 이자
ALTER TABLE fills ADD COLUMN settle_ymd TEXT;
ALTER TABLE fills ADD COLUMN cash_delta INTEGER;
ALTER TABLE fills ADD COLUMN margin INTEGER;
ALTER TABLE fills ADD COLUMN lot_id TEXT;
ALTER TABLE fills ADD COLUMN loan INTEGER;
ALTER TABLE fills ADD COLUMN interest INTEGER;
ALTER TABLE fills ADD COLUMN forced TEXT;

CREATE INDEX IF NOT EXISTS idx_fills_settle ON fills (season_id, uid, settle_ymd);

-- 신용·담보대출 잔고. 같은 날 같은 종목 신용매수는 한 줄로 합친다 (실전 잔고도 대출일별로 묶인다)
CREATE TABLE IF NOT EXISTS lots (
  id            TEXT PRIMARY KEY,
  season_id     TEXT NOT NULL,
  uid           TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('credit','loan')),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  qty           INTEGER NOT NULL CHECK (qty >= 0),
  cost          INTEGER NOT NULL CHECK (cost >= 0),        -- 이 잔고 주식의 매입금액 (평단 = cost / qty)
  principal     INTEGER NOT NULL CHECK (principal >= 0),   -- 남은 융자금·대출금
  rate          REAL,                                      -- 담보대출 고정 이율 (신용은 기간 구간표)
  start_ymd     TEXT NOT NULL,                             -- 이자 기산일 (신용: 매수 결제일, 담보대출: 대출일)
  due_ymd       TEXT NOT NULL,                             -- 만기일
  interest_paid INTEGER NOT NULL DEFAULT 0,                -- 이미 낸 이자 (소급법 차감용)
  paid_through  TEXT,                                      -- 정기징수(매월 첫 영업일)로 이자를 낸 마지막 날
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lots_key ON lots (season_id, uid, kind, code, start_ymd);
CREATE INDEX IF NOT EXISTS idx_lots_code ON lots (season_id, code);

-- 담보로 잡으면 주식이 현금 보유(positions)에서 담보 잔고(lots)로 옮겨 간다 — AI 평가의 실현손익 재생이 이걸 읽는다
CREATE TABLE IF NOT EXISTS lot_moves (
  id        TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  uid       TEXT NOT NULL,
  lot_id    TEXT NOT NULL,
  code      TEXT NOT NULL,
  dir       TEXT NOT NULL CHECK (dir IN ('in','out','set')), -- in: 현금 보유 → 잔고, out: 잔고 → 현금 보유(현금상환), set: 권리 변동으로 잔고 수량·매입금액을 이 값으로
  qty       INTEGER NOT NULL,
  cost      INTEGER NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lot_moves_user ON lot_moves (season_id, uid, at);

-- 체결이 아닌 예수금 변동 — 담보대출 입금·현금상환·이자·연체료
CREATE TABLE IF NOT EXISTS cash_events (
  id        TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  uid       TEXT NOT NULL,
  kind      TEXT NOT NULL,        -- loan_in | repay | interest | overdue_fee
  amount    INTEGER NOT NULL,     -- 예수금 증감 (+ 입금 / − 출금)
  lot_id    TEXT,
  detail    TEXT,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_events_user ON cash_events (season_id, uid, at);

-- 미수·담보부족·만기 — 회원에게 알리고 반대매매 일정을 잡는다
CREATE TABLE IF NOT EXISTS margin_calls (
  id         TEXT PRIMARY KEY,
  season_id  TEXT NOT NULL,
  uid        TEXT NOT NULL,
  kind       TEXT NOT NULL,       -- misu | collateral | expiry
  ymd        TEXT NOT NULL,       -- 발생일 (미수: 결제일, 담보부족: 판정일, 만기: 만기일)
  amount     INTEGER NOT NULL,    -- 미수금 · 담보부족액 · 만기 원금
  ratio      REAL,                -- 담보비율 (담보부족)
  due_ymd    TEXT,                -- 반대매매 예정일
  status     TEXT NOT NULL,       -- open(추가담보 기한) | due(반대매매 예정) | ordered(반대매매 주문) | covered(매도로 충당) | resolved
  detail     TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (season_id, uid, kind, ymd)
);
CREATE INDEX IF NOT EXISTS idx_margin_calls_open ON margin_calls (season_id, status);
