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

/** 앞으로의 휴장일 (현황 표시용) */
export async function listHolidays(db, fromYmd, limit = 60) {
  const rows = (await db.prepare(
    `SELECT ymd, name FROM holidays WHERE ymd >= ? ORDER BY ymd LIMIT ?`
  ).bind(fromYmd, limit).all()).results || [];
  return rows;
}

export async function addHoliday(db, ymd, name, now) {
  await db.prepare(
    `INSERT INTO holidays (ymd, name, added_at) VALUES (?,?,?)
     ON CONFLICT (ymd) DO UPDATE SET name = excluded.name`
  ).bind(ymd, name || null, now).run();
  forgetHolidays();
}

export async function removeHoliday(db, ymd) {
  await db.prepare(`DELETE FROM holidays WHERE ymd=?`).bind(ymd).run();
  forgetHolidays();
}

/**
 * 오늘이 휴장일인지 확인한다 — 코스피 당일 분봉이 하나도 없으면 휴장일이다.
 * marketStatus 보다 이 신호가 세다. 네이버가 잠깐 흔들려 CLOSE 를 줘도 분봉은 남아 있기 때문이다.
 * 실측: 거래일 391개 / 휴장일 0개 (2026-08-17 광복절 대체).
 *
 * 09:35 에 한 번 보고, 그때 네트워크가 튀었을 수 있으니 10:30 에 한 번 더 본다.
 * 매분 부르면 거래일에도 외부 호출이 하루 700건 늘어나는데 얻는 게 없다.
 *
 * 남는 틈: 08:00~09:35 에는 아직 모른다. 그 사이 접수된 주문은 거래량이 늘지 않아 체결되지 않고
 * 장 마감에 만료되므로 장부가 틀어지지는 않는다.
 */
export async function syncTodayHoliday(db, t, now) {
  if (t.dow === 0 || t.dow === 6) return false;
  if (t.hm !== 9 * 60 + 35 && t.hm !== 10 * 60 + 30) return false;
  const set = await holidaySet(db);
  if (set.has(t.ymd)) return false;

  let bars;
  try { bars = await naver.indexMinuteCount('KOSPI', t.ymd); }
  catch (e) { return false; }           // 못 물어봤으면 아무것도 단정하지 않는다
  if (bars == null || bars > 0) return false;

  await db.prepare(
    `INSERT OR IGNORE INTO holidays (ymd, name, added_at) VALUES (?, '휴장 (당일 자동 감지)', ?)`
  ).bind(t.ymd, now).run();
  forgetHolidays();
  return true;
}

/**
 * 방금 받은 시세로 오늘이 휴장일인지 잡는다 — 목록에 아직 없는 날을 그 자리에서 걸러 낸다.
 *
 * 정규장 한복판(09:05~15:15)에 거래정지가 아닌 종목이 CLOSE 면 휴장일로 본다.
 * 프리·애프터마켓 구간은 쓰지 않는다 — NXT 비대상 종목은 정상 거래일에도 CLOSE 라 오판한다.
 * 거래정지 종목도 뺀다 (그 종목만 CLOSE 인 것이지 시장이 닫힌 게 아니다).
 *
 * 크론의 09:35 확인을 기다리지 않고 주문·시세 조회 때 바로 반영된다.
 */
export async function catchHolidayFromQuote(db, quote, t, now) {
  if (t.dow === 0 || t.dow === 6) return false;
  if (t.hm < 9 * 60 + 5 || t.hm > 15 * 60 + 15) return false;
  if (!quote || quote.halted || quote.marketStatus !== 'CLOSE') return false;
  const set = await holidaySet(db);
  if (set.has(t.ymd)) return false;
  await db.prepare(
    `INSERT OR IGNORE INTO holidays (ymd, name, added_at) VALUES (?, '휴장 (시세로 감지)', ?)`
  ).bind(t.ymd, now).run();
  forgetHolidays();
  return true;
}
