// DT 모의투자 — 재테크 닉네임
// 순위표·명예의 전당·커뮤니티 글·댓글에는 실명 대신 닉네임을 보여 준다.
//  - 저장: D1 nicknames (uid 당 1개, nick_key 로 중복 금지 — 띄어쓰기·대소문자 무시)
//  - 아직 안 정한 회원은 처음 이름이 필요할 때 자동 닉네임('용감한 황소 27')을 만들어 둔다
//  - 실명은 지금처럼 accounts·shares·share_comments·final_rankings 의 nickname 칸에 남긴다 (관리자 확인·감사 기록용)
//  - 회원이 직접 바꾼 뒤에는 30일이 지나야 다시 바꿀 수 있다 (자동 닉네임에서 처음 바꾸는 건 바로 된다)

export const NICK_CHANGE_MS = 30 * 86400e3;

const ADJ = [
  '용감한', '침착한', '빠른', '느긋한', '대담한', '신중한', '행복한', '씩씩한', '재빠른', '든든한',
  '영리한', '다정한', '꼼꼼한', '당당한', '부지런한', '조용한', '유쾌한', '날쌘', '성실한', '묵직한',
  '반짝이는', '차분한', '호기심많은', '느린', '센스있는', '냉철한', '끈기있는', '명랑한', '우직한', '재치있는'
];
const ANIMAL = [
  '황소', '곰', '여우', '호랑이', '독수리', '거북이', '고래', '펭귄', '수달', '다람쥐',
  '부엉이', '치타', '돌고래', '판다', '늑대', '사슴', '햄스터', '코끼리', '올빼미', '너구리',
  '표범', '고슴도치', '해달', '미어캣', '알파카', '참새', '두루미', '족제비', '라쿤', '물개'
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const genAuto = () => `${pick(ADJ)} ${pick(ANIMAL)} ${10 + Math.floor(Math.random() * 90)}`;

export const nickKey = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

// 운영 주체·회원 신분을 사칭할 수 있는 말 (닉네임 어디에 들어가도 막는다)
const BANNED = ['운영', '관리자', '관리인', '어드민', 'admin', '디티', 'dtclub', '공식', '스태프', 'staff',
  '시스템', 'system', '탈퇴', '익명', '모더', 'moder'];

/** 형식 검사 — 통과하면 다듬은 닉네임, 아니면 HttpError 용 메시지를 던진다 */
export function checkNick(raw) {
  const nick = String(raw == null ? '' : raw).trim();
  if (!/^[가-힣A-Za-z0-9]{2,10}$/.test(nick)) {
    throw new Error('닉네임은 띄어쓰기 없이 한글·영문·숫자 2~10자로 정해 주세요');
  }
  const k = nickKey(nick);
  if (k.includes('dt') || BANNED.some((w) => k.includes(w))) throw new Error('쓸 수 없는 단어가 들어 있습니다');
  return nick;
}

/* 인스턴스 메모리 캐시 — 순위표는 보는 사람마다 10초에 한 번 부른다. 바꾼 회원은 바로 지운다 */
const cache = new Map();         // uid -> { at, v: { nick, auto, changedAt } }
const TTL = 60e3;
const fresh = (uid) => { const h = cache.get(uid); return h && Date.now() - h.at < TTL ? h.v : null; };
const put = (uid, v) => { cache.set(uid, { at: Date.now(), v }); if (cache.size > 3000) cache.delete(cache.keys().next().value); };

async function createAuto(db, uid) {
  // 자동 닉네임끼리 겹치면(9만 가지 중) 다른 조합으로 다시 — INSERT OR IGNORE 는 uid·nick_key 어느 쪽이 겹쳐도 조용히 넘어간다
  for (let i = 0; i < 8; i++) {
    const nick = genAuto();
    await db.prepare(`INSERT OR IGNORE INTO nicknames (uid, nick, nick_key, auto, changed_at) VALUES (?,?,?,1,NULL)`)
      .bind(uid, nick, nickKey(nick)).run();
    const r = await db.prepare(`SELECT nick, auto, changed_at FROM nicknames WHERE uid=?`).bind(uid).first();
    if (r) return { nick: r.nick, auto: !!r.auto, changedAt: r.changed_at };
  }
  return { nick: '회원', auto: true, changedAt: null };
}

/** uid 목록 → Map(uid → 닉네임). 없는 회원은 자동 닉네임을 만들어 채운다 */
export async function nicksFor(db, uids) {
  const out = new Map();
  const todo = [];
  for (const u of new Set(uids.filter(Boolean))) {
    const v = fresh(u);
    if (v) out.set(u, v.nick); else todo.push(u);
  }
  for (let i = 0; i < todo.length; i += 90) {
    const part = todo.slice(i, i + 90);
    const rows = (await db.prepare(
      `SELECT uid, nick, auto, changed_at FROM nicknames WHERE uid IN (${part.map(() => '?').join(',')})`
    ).bind(...part).all()).results || [];
    for (const r of rows) { const v = { nick: r.nick, auto: !!r.auto, changedAt: r.changed_at }; put(r.uid, v); out.set(r.uid, v.nick); }
  }
  for (const u of todo) {
    if (out.has(u)) continue;
    const v = await createAuto(db, u);
    put(u, v); out.set(u, v.nick);
  }
  return out;
}

/** 내 닉네임 (없으면 자동으로 만든다) */
export async function myNick(db, uid) {
  const v = fresh(uid);
  if (v) return v;
  const r = await db.prepare(`SELECT nick, auto, changed_at FROM nicknames WHERE uid=?`).bind(uid).first();
  const got = r ? { nick: r.nick, auto: !!r.auto, changedAt: r.changed_at } : await createAuto(db, uid);
  put(uid, got);
  return got;
}

/**
 * 닉네임 바꾸기. 실패하면 { error, status, code } 를 돌려준다 (라우터가 HttpError 로 바꾼다).
 * 다른 회원의 실명(모의투자·커뮤니티에 남은 이름)과 같은 닉네임도 막는다 — 남인 척하는 것을 막으려고.
 */
export async function setNick(db, uid, raw, now = Date.now()) {
  let nick;
  try { nick = checkNick(raw); } catch (e) { return { error: e.message, status: 400, code: 'invalid' }; }
  const cur = await myNick(db, uid);
  if (nickKey(nick) === nickKey(cur.nick) && nick === cur.nick) return { nick: cur.nick, auto: cur.auto, changedAt: cur.changedAt };
  if (cur.changedAt && now - cur.changedAt < NICK_CHANGE_MS) {
    const next = new Date(cur.changedAt + NICK_CHANGE_MS + 9 * 3600e3);
    return { error: `닉네임은 30일에 한 번 바꿀 수 있습니다 (${next.getUTCMonth() + 1}/${next.getUTCDate()}부터 가능)`, status: 429, code: 'cooldown' };
  }
  const k = nickKey(nick);
  const taken = await db.prepare(`SELECT uid FROM nicknames WHERE nick_key=? AND uid<>?`).bind(k, uid).first();
  if (taken) return { error: '이미 다른 회원이 쓰는 닉네임입니다', status: 409, code: 'taken' };
  const real = await db.prepare(
    `SELECT 1 FROM (SELECT uid, nickname FROM accounts UNION ALL SELECT uid, nickname FROM shares UNION ALL SELECT uid, nickname FROM share_comments)
     WHERE uid<>? AND REPLACE(LOWER(nickname), ' ', '')=? LIMIT 1`
  ).bind(uid, k).first();
  if (real) return { error: '다른 회원의 이름과 같은 닉네임은 쓸 수 없습니다', status: 409, code: 'real_name' };
  try {
    await db.batch([
      db.prepare(`UPDATE nicknames SET nick=?, nick_key=?, auto=0, changed_at=? WHERE uid=?`).bind(nick, k, now, uid),
      db.prepare(`INSERT INTO audit_log (at, actor, action, detail) VALUES (?,?,?,?)`)
        .bind(now, uid, 'nick.change', JSON.stringify({ from: cur.nick, to: nick }))
    ]);
  } catch (e) {
    // 같은 순간 다른 회원이 같은 닉네임을 잡았다 (UNIQUE 위반)
    if (/UNIQUE/i.test(String(e && e.message))) return { error: '이미 다른 회원이 쓰는 닉네임입니다', status: 409, code: 'taken' };
    throw e;
  }
  const v = { nick, auto: false, changedAt: now };
  put(uid, v);
  return v;
}

/** 화면용 — 언제 다시 바꿀 수 있는지 */
export function nickView(v, now = Date.now()) {
  const nextAt = v.changedAt ? v.changedAt + NICK_CHANGE_MS : null;
  return { nick: v.nick, auto: v.auto, canChange: !nextAt || now >= nextAt, nextChangeAt: nextAt && now < nextAt ? nextAt : null };
}
