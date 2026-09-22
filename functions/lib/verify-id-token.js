// Firebase ID 토큰 검증 — 워커 공용 모듈
// securetoken 공개키를 JWK로 받아 RS256 서명을 직접 검증한다.
// (x509 PEM은 WebCrypto가 직접 import하지 못하므로 JWK 엔드포인트를 쓴다)
//
// payload 만 base64 로 풀어 exp/iss/aud 를 보는 방식은 검증이 아니다 —
// 누구나 {sub:"남의 uid"} 로 토큰을 만들어 낼 수 있다. 반드시 이 모듈을 거친다.

const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let _jwks = { at: 0, byKid: null };

async function jwkFor(kid) {
  // 구글이 서명 키를 교체하면 캐시에 없는 kid 가 온다 — 그때는 1시간을 기다리지 않고 다시 받는다.
  // (엉터리 kid 로 재요청을 유발하지 못하도록 재조회는 1분에 한 번으로 제한)
  const stale = !_jwks.byKid || Date.now() - _jwks.at > 3600e3;
  const rotated = _jwks.byKid && !_jwks.byKid[kid] && Date.now() - _jwks.at > 60e3;
  if (stale || rotated) {
    try {
      const r = await fetch(JWK_URL, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('jwk fetch failed');
      const d = await r.json();
      const byKid = {};
      for (const k of d.keys || []) byKid[k.kid] = k;
      _jwks = { at: Date.now(), byKid };
    } catch (e) {
      // 구글 일시 장애 — 이미 받아 둔 키가 있으면 그대로 쓰고 1분 뒤 다시 받는다 (전 회원 401 방지)
      if (!_jwks.byKid) throw e;
      _jwks.at = Date.now() - 3600e3 + 60e3;
    }
  }
  return _jwks.byKid[kid] || null;
}

function b64urlToBytes(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * @param token      Bearer 뒤의 ID 토큰 문자열
 * @param projectId  Firebase 프로젝트 ID
 * @param opts.allowAnonymous  게스트(익명 로그인) 허용 여부 — 기본 false
 * @returns 검증된 payload | null
 */
export async function verifyIdToken(token, projectId, opts) {
  const allowAnonymous = !!(opts && opts.allowAnonymous);
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header  = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { return null; }

  // 1) 클레임 검증
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || !header.kid) return null;
  if (!payload.exp || payload.exp <= now) return null;
  if (payload.iat && payload.iat > now + 300) return null;      // 시계 오차 5분 허용
  if (payload.aud !== projectId) return null;
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (!payload.sub) return null;
  if (!allowAnonymous && payload.firebase && payload.firebase.sign_in_provider === 'anonymous') return null;

  // 2) 서명 검증
  let ok = false;
  try {
    const jwk = await jwkFor(header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch { return null; }
  return ok ? payload : null;
}

/** Authorization: Bearer … 헤더에서 토큰만 꺼낸다. 쿼리스트링으로는 받지 않는다 (접속 로그에 남는다) */
export function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}
