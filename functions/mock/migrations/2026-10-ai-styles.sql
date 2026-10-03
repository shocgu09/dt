-- 2026-10-03 AI 리그 투자 성향 (functions/mock/ai.js STYLES) — 관리 탭에서 AI 마다 고른다
-- 시즌과 상관없이 유지된다. 행이 없으면 '기본'(성향 없음)
--   npx wrangler d1 execute dt-mock --remote --config functions/wrangler-stock.toml --command "<문장>"
CREATE TABLE IF NOT EXISTS ai_styles (
  bot_id      TEXT PRIMARY KEY,   -- ai.js BOTS[].id
  style       TEXT NOT NULL,      -- value | flow | momentum | contrarian
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);
