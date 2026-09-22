// 회원 프로필 조회 — 워커 공용
// 서비스 계정 없이 회원 본인의 ID 토큰으로 Firestore users/{uid} 를 읽는다 (규칙상 본인 문서는 읽을 수 있다).
//  - role 이 없으면 강퇴·탈퇴한 계정이므로 시세·모의투자 모두 막는다 (토큰만 살아 있어도 회원이 아니다)
//  - 닉네임을 클라이언트가 보내게 두면 남의 이름으로 순위표에 오를 수 있으므로 서버가 직접 읽는다
// 결과는 워커 인스턴스 메모리에 10분 두어 요청마다 Firestore 를 두드리지 않는다.

const mem = new Map();
const TTL = 600e3;

export async function profileOf(env, uid, token) {
  const hit = mem.get(uid);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v = { role: null, name: null };
  try {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
    );
    if (r.ok) {
      const f = (await r.json()).fields || {};
      v = { role: (f.role && f.role.stringValue) || null, name: (f.name && f.name.stringValue) || null };
    } else if (r.status !== 403 && r.status !== 404) {
      // Firestore 장애·지연 — 회원이 아니라고 단정하지 않는다 (캐시하지 않고 통과)
      return { role: 'unknown', name: null, transient: true };
    }
  } catch (e) {
    return { role: 'unknown', name: null, transient: true };
  }
  mem.set(uid, { at: Date.now(), v });
  if (mem.size > 2000) mem.delete(mem.keys().next().value);
  return v;
}

/** 강퇴 직후 캐시가 남지 않도록 (관리자 경로에서 호출할 수 있게 열어 둔다) */
export function forgetProfile(uid) { mem.delete(uid); }
