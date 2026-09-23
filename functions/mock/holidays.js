// KRX 휴장일 — D1 단일 출처
//
// 예전에는 engine.js 와 invest/market.js 에 같은 목록을 복붙해 두고 손으로 고쳤다.
// 두 곳이 어긋나기 쉬웠고 2027년까지밖에 없었으며, 임시공휴일은 넣을 방법이 없었다.
//
// 이제 세 갈래로 채운다.
//   seed   — 옮겨 온 기존 목록
//   auto   — 크론이 찾아낸 것 (아래 두 가지)
//   manual — 운영진이 미리 넣은 앞날의 휴장일
//
// 자동 판정 두 가지:
//   1) 지난 날: 코스피 일봉이 없는 평일은 휴장일이다 (거래가 없었으므로 봉도 없다)
//   2) 오늘  : 평일인데 네이버 marketStatus 가 CLOSE 면 휴장일이다
//      → 갑자기 지정된 임시공휴일도 그날 안에 반영된다
import { naver } from '../providers/naver.js';

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

/** 목록 (관리 화면용) — 오늘 이후를 먼저, 그다음 최근 지난 것 */
export async function listHolidays(db, limit = 60) {
  const rows = (await db.prepare(
    `SELECT ymd, name, source FROM holidays ORDER BY ymd DESC LIMIT ?`
  ).bind(limit).all()).results || [];
  return rows;
}

export async function addHoliday(db, ymd, name, now) {
  await db.prepare(
    `INSERT INTO holidays (ymd, name, source, added_at) VALUES (?,?,'manual',?)
     ON CONFLICT (ymd) DO UPDATE SET name = excluded.name, source = 'manual'`
  ).bind(ymd, name || null, now).run();
  forgetHolidays();
}

export async function removeHoliday(db, ymd) {
  await db.prepare(`DELETE FROM holidays WHERE ymd=?`).bind(ymd).run();
  forgetHolidays();
}

/**
 * 지난 휴장일 채우기 — 코스피 일봉이 없는 평일을 찾는다.
 * 하루 한 번이면 충분하다. 외부 호출 1건.
 */
export async function syncPastHolidays(db, now, days = 120) {
  const p = (n) => String(n).padStart(2, '0');
  const k = new Date(now + 9 * 3600e3);
  const end = `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}`;
  const fromD = new Date(k.getTime() - days * 86400e3);
  const from = `${fromD.getUTCFullYear()}${p(fromD.getUTCMonth() + 1)}${p(fromD.getUTCDate())}`;

  let have;
  try {
    const closes = await naver.indexDailyDates('KOSPI', from, end);
    if (!closes.length) return 0;
    have = new Set(closes);
  } catch (e) { return 0; }

  // 받아온 봉의 첫 날부터 어제까지만 본다 — 오늘은 아직 봉이 없을 수 있다
  const first = [...have].sort()[0];
  const found = [];
  for (let d = new Date(Date.UTC(+first.slice(0, 4), +first.slice(4, 6) - 1, +first.slice(6, 8)));
       ; d.setUTCDate(d.getUTCDate() + 1)) {
    const ymd = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
    if (ymd >= end) break;                        // 오늘은 제외
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (!have.has(ymd)) found.push(ymd);
  }
  if (!found.length) return 0;

  await db.batch(found.map((ymd) => db.prepare(
    `INSERT OR IGNORE INTO holidays (ymd, name, source, added_at) VALUES (?, NULL, 'auto', ?)`
  ).bind(ymd, now)));
  forgetHolidays();
  return found.length;
}

/**
 * 오늘이 휴장일인지 시장 상태로 확인한다 (임시공휴일 당일 반영).
 * 장이 도는 시간대에만 의미가 있다 — 장 시작 전에는 CLOSE 가 정상이다.
 */
export async function syncTodayHoliday(db, t, now) {
  if (t.dow === 0 || t.dow === 6) return false;
  if (t.hm < 10 * 60 || t.hm > 15 * 60) return false;   // 10:00~15:00 사이에만 판정
  const set = await holidaySet(db);
  if (set.has(t.ymd)) return false;
  let q;
  try { q = await naver.getQuote('005930'); } catch (e) { return false; }
  if (!q || q.marketStatus !== 'CLOSE') return false;
  await db.prepare(
    `INSERT OR IGNORE INTO holidays (ymd, name, source, added_at) VALUES (?, '임시휴장(자동 감지)', 'auto', ?)`
  ).bind(t.ymd, now).run();
  forgetHolidays();
  return true;
}
