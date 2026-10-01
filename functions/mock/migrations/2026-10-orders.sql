-- 2026-10-01 주문 건수 — 순위표 등에서 체결 건수 대신 '체결된 주문 건수'를 보인다 (나눠 체결된 대량 주문이 수십 건으로 세지지 않게)
-- 적용: 한 문장씩. 배포 전에 1·2, 배포 직후 2 를 한 번 더 (그 사이 옛 코드가 체결한 주문을 다시 센다)
ALTER TABLE accounts ADD COLUMN orders INTEGER NOT NULL DEFAULT 0;
UPDATE accounts SET orders = (SELECT COUNT(DISTINCT order_id) FROM fills f WHERE f.season_id = accounts.season_id AND f.uid = accounts.uid);
