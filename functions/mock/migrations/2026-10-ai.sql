-- 2026-10 AI 리그 (functions/mock/ai.js) — 기존 행은 건드리지 않는다
-- 적용: 한 문장씩 (wrangler d1 execute --command 에 문장 두 개를 넣으면 실패한다)
--   npx wrangler d1 execute dt-mock --remote --config functions/wrangler-stock.toml --command "<문장>"
-- AI 계좌는 accounts 에 uid 'ai:<봇 id>', status 'ai' 로 들어간다 (회원 순위·통계는 status='active' 만 센다)

-- 시즌별 AI 리그: off | admin(관리자에게만 보임 — 시험) | on(전체 공개)
ALTER TABLE seasons ADD COLUMN ai_mode TEXT NOT NULL DEFAULT 'off';

-- 판단 기록 — AI 한 명 · 한 라운드에 한 줄. detail 은 JSON (행동별 결과·보유 판단·관심 종목·손절)
CREATE TABLE IF NOT EXISTS ai_journal (
  id         TEXT PRIMARY KEY,
  season_id  TEXT NOT NULL,
  uid        TEXT NOT NULL,
  ymd        TEXT NOT NULL,
  hm         INTEGER NOT NULL,
  round_id   TEXT NOT NULL,
  status     TEXT NOT NULL,      -- ok | dry(판단만) | fail
  view       TEXT,
  detail     TEXT,
  tokens_in  INTEGER,
  tokens_out INTEGER,
  neurons    INTEGER,
  ms         INTEGER,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_journal ON ai_journal (season_id, at);
CREATE INDEX IF NOT EXISTS idx_ai_journal_uid ON ai_journal (season_id, uid, at);

-- 보유 종목마다 AI 가 세운 계획 — 다음 판단 카드에 다시 보여 주고, 손절은 코드가 집행한다
CREATE TABLE IF NOT EXISTS ai_theses (
  season_id  TEXT NOT NULL,
  uid        TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT,
  thesis     TEXT,
  stop       INTEGER NOT NULL,
  target     INTEGER,
  hold_days  INTEGER,
  opened_ymd TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season_id, uid, code)
);

-- 그날 순자산 (15:45) — AI 수익 곡선. 회원 스냅샷(daily_snapshots)과 따로 둔다
CREATE TABLE IF NOT EXISTS ai_daily (
  season_id TEXT NOT NULL,
  uid       TEXT NOT NULL,
  ymd       TEXT NOT NULL,
  equity    INTEGER NOT NULL,
  PRIMARY KEY (season_id, uid, ymd)
);
