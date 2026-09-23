// KRX 휴장일 — D1 단일 출처
//
// 운영진이 관리 화면에서 직접 넣고 뺀다. 코드에는 어떤 날짜도 두지 않는다.
//
// 자동 탐지(시세가 CLOSE 면 휴장, 공휴일 API 대조)는 쓰지 않는다.
//   - 오판하면 멀쩡한 거래일에 주문이 통째로 막힌다
//   - 공휴일 목록은 KRX 휴장일과 다르다 (설·추석 연휴 전날, 대체공휴일, 12/31 연말 휴장)
// 틀린 날짜가 조용히 들어오느니 운영진이 확인해서 넣는 편이 낫다.

let cache = null, cacheAt = 0;
const TTL = 600e3;          // 10분 — 운영진이 고치면 그 안에 반영된다

export async function holidaySet(db) {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  try {
    const rows = (await db.prepare(`SELECT ymd FROM holidays`).all()).results || [];
    cache = new Set(rows.map((r) => r.ymd));
    cacheAt = Date.now();
  } catch (e) {
    if (!cache) cache = new Set();        // D1 이 흔들려도 주말 판정은 살아 있다
  }
  return cache;
}

export function forgetHolidays() { cache = null; cacheAt = 0; }

/** 앞으로의 휴장일 */
export async function listHolidays(db, fromYmd, limit = 80) {
  return (await db.prepare(
    `SELECT ymd, name FROM holidays WHERE ymd >= ? ORDER BY ymd LIMIT ?`
  ).bind(fromYmd, limit).all()).results || [];
}

export async function addHolidays(db, items, now) {
  const rows = (items || [])
    .filter((x) => /^\d{8}$/.test(x.ymd))
    .slice(0, 60);
  if (!rows.length) return 0;
  await db.batch(rows.map((x) => db.prepare(
    `INSERT INTO holidays (ymd, name, added_at) VALUES (?,?,?)
     ON CONFLICT (ymd) DO UPDATE SET name = excluded.name`
  ).bind(x.ymd, String(x.name || '').slice(0, 40) || null, now)));
  forgetHolidays();
  return rows.length;
}

export async function removeHoliday(db, ymd) {
  await db.prepare(`DELETE FROM holidays WHERE ymd=?`).bind(ymd).run();
  forgetHolidays();
}
