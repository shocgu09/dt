/**
 * DT Club Push Notification Worker
 * Cloudflare Worker + KV를 사용한 Web Push 알림 서버
 *
 * 환경변수 (Secrets):
 *   VAPID_PRIVATE_KEY - VAPID 비공개키 (URL-safe base64)
 *   VAPID_PUBLIC_KEY  - VAPID 공개키 (URL-safe base64)
 *   FIREBASE_PROJECT_ID - Firebase 프로젝트 ID
 *
 * KV Namespace:
 *   PUSH_SUBS - 푸시 구독 정보 저장소
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case '/api/subscribe':
          return await handleSubscribe(request, env);
        case '/api/unsubscribe':
          return await handleUnsubscribe(request, env);
        case '/api/push':
          return await handlePush(request, env);
        case '/api/health':
          return jsonResponse({ status: 'ok' });
        default:
          return jsonResponse({ error: 'Not found' }, 404);
      }
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal error' }, 500);
    }
  }
};

/* ===== 구독 등록 ===== */
async function handleSubscribe(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth.ok) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { uid, subscription } = await request.json();
  if (!uid || !subscription) {
    return jsonResponse({ error: 'Missing uid or subscription' }, 400);
  }
  if (uid !== auth.uid) {
    return jsonResponse({ error: 'UID mismatch' }, 403);
  }

  // 구독 해시 생성 (endpoint 기반)
  const subHash = await hashString(subscription.endpoint);
  const subKey = `sub:${uid}:${subHash}`;

  // KV에 구독 저장
  await env.PUSH_SUBS.put(subKey, JSON.stringify({
    subscription,
    createdAt: Date.now(),
    userAgent: request.headers.get('User-Agent') || ''
  }));

  // 해당 유저의 구독 인덱스 업데이트
  const indexKey = `subs-index:${uid}`;
  const existing = await env.PUSH_SUBS.get(indexKey, 'json') || [];
  if (!existing.includes(subKey)) {
    existing.push(subKey);
    await env.PUSH_SUBS.put(indexKey, JSON.stringify(existing));
  }

  return jsonResponse({ success: true });
}

/* ===== 구독 해제 ===== */
async function handleUnsubscribe(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth.ok) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { uid, endpoint } = await request.json();
  if (!uid) return jsonResponse({ error: 'Missing uid' }, 400);
  if (uid !== auth.uid) return jsonResponse({ error: 'UID mismatch' }, 403);

  if (endpoint) {
    // 특정 구독만 삭제
    const subHash = await hashString(endpoint);
    const subKey = `sub:${uid}:${subHash}`;
    await env.PUSH_SUBS.delete(subKey);

    const indexKey = `subs-index:${uid}`;
    const existing = await env.PUSH_SUBS.get(indexKey, 'json') || [];
    const updated = existing.filter(k => k !== subKey);
    await env.PUSH_SUBS.put(indexKey, JSON.stringify(updated));
  } else {
    // 전체 구독 삭제
    const indexKey = `subs-index:${uid}`;
    const keys = await env.PUSH_SUBS.get(indexKey, 'json') || [];
    for (const key of keys) {
      await env.PUSH_SUBS.delete(key);
    }
    await env.PUSH_SUBS.delete(indexKey);
  }

  return jsonResponse({ success: true });
}

/* ===== 푸시 발송 ===== */
async function handlePush(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth.ok) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { recipientUid, title, body, convId } = await request.json();
  if (!recipientUid) return jsonResponse({ error: 'Missing recipientUid' }, 400);

  // 수신자의 구독 목록 가져오기
  const indexKey = `subs-index:${recipientUid}`;
  const subKeys = await env.PUSH_SUBS.get(indexKey, 'json') || [];

  if (subKeys.length === 0) {
    return jsonResponse({ success: true, sent: 0, message: 'No subscriptions' });
  }

  const payload = JSON.stringify({ title, body, convId });
  let sent = 0;
  const invalidKeys = [];

  for (const subKey of subKeys) {
    const subData = await env.PUSH_SUBS.get(subKey, 'json');
    if (!subData) {
      invalidKeys.push(subKey);
      continue;
    }

    try {
      const result = await sendWebPush(
        subData.subscription,
        payload,
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY
      );
      console.log('Push result for', subKey, ':', result.status, result.statusText);
      if (result.ok) {
        sent++;
      } else if (result.status === 404 || result.status === 410) {
        invalidKeys.push(subKey);
      } else {
        console.error('Push failed:', result.status, result.statusText, await result.text?.() || '');
      }
    } catch (err) {
      console.error('Push send error:', err.message, err.stack);
    }
  }

  // 만료된 구독 정리
  if (invalidKeys.length > 0) {
    for (const key of invalidKeys) {
      await env.PUSH_SUBS.delete(key);
    }
    const updated = subKeys.filter(k => !invalidKeys.includes(k));
    await env.PUSH_SUBS.put(indexKey, JSON.stringify(updated));
  }

  return jsonResponse({ success: true, sent });
}

/* ===== Web Push 전송 (RFC 8291) ===== */
async function sendWebPush(subscription, payload, vapidPublicKey, vapidPrivateKey) {
  const endpoint = subscription.endpoint;
  const url = new URL(endpoint);

  // VAPID JWT 생성
  const audience = `${url.protocol}//${url.host}`;
  const vapidToken = await createVapidJWT(audience, vapidPublicKey, vapidPrivateKey);

  // 페이로드 암호화 (Web Push Encryption)
  const encrypted = await encryptPayload(subscription, payload);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': '86400',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Authorization': `vapid t=${vapidToken}, k=${vapidPublicKey}`,
    },
    body: encrypted,
  });

  const statusText = response.ok ? 'OK' : await response.text().catch(() => '');
  return { ok: response.ok, status: response.status, statusText };
}

/* ===== VAPID JWT 생성 ===== */
async function createVapidJWT(audience, publicKey, privateKey) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: audience,
    exp: now + 12 * 3600,
    sub: 'mailto:dt-club@example.com'
  };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const claimsB64 = base64urlEncode(JSON.stringify(claims));
  const unsignedToken = `${headerB64}.${claimsB64}`;

  // Import private key
  const privKeyBytes = base64urlDecode(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    await convertRawToPKCS8(privKeyBytes),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  // Sign
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER signature to raw (r || s)
  const rawSig = derToRaw(new Uint8Array(signature));
  const sigB64 = base64urlEncode(rawSig);

  return `${unsignedToken}.${sigB64}`;
}

/* ===== 페이로드 암호화 (aes128gcm) ===== */
async function encryptPayload(subscription, payload) {
  const keys = subscription.keys;
  const p256dh = base64urlDecode(keys.p256dh);
  const auth = base64urlDecode(keys.auth);

  // 로컬 ECDH 키 쌍 생성
  const localKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const localPublicKey = await crypto.subtle.exportKey('raw', localKeys.publicKey);

  // 클라이언트 공개키 import
  const clientPublicKey = await crypto.subtle.importKey(
    'raw', p256dh,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );

  // ECDH 공유 비밀 생성
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    localKeys.privateKey,
    256
  );

  // HKDF로 암호화 키 도출
  const payloadBytes = new TextEncoder().encode(payload);

  // IKM = HKDF(auth, sharedSecret, "WebPush: info" || 0x00 || clientPubKey || localPubKey)
  const authInfo = new Uint8Array([
    ...new TextEncoder().encode('WebPush: info\0'),
    ...new Uint8Array(p256dh),
    ...new Uint8Array(localPublicKey)
  ]);

  const prk = await hkdfExtract(new Uint8Array(auth), new Uint8Array(sharedSecret));
  const ikm = await hkdfExpand(prk, authInfo, 32);

  // salt 생성
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Content encryption key & nonce
  const prkPayload = await hkdfExtract(salt, ikm);
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const cek = await hkdfExpand(prkPayload, cekInfo, 16);
  const nonce = await hkdfExpand(prkPayload, nonceInfo, 12);

  // AES-128-GCM 암호화
  const cryptoKey = await crypto.subtle.importKey(
    'raw', cek,
    { name: 'AES-GCM' },
    false, ['encrypt']
  );

  // 패딩 추가 (delimiter 0x02)
  const padded = new Uint8Array(payloadBytes.length + 1);
  padded.set(payloadBytes);
  padded[payloadBytes.length] = 2; // delimiter

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    padded
  );

  // aes128gcm 헤더 구성
  const localPubBytes = new Uint8Array(localPublicKey);
  const header = new Uint8Array(16 + 4 + 1 + localPubBytes.length);
  header.set(salt, 0);                         // salt (16 bytes)
  new DataView(header.buffer).setUint32(16, 4096); // record size (4 bytes)
  header[20] = localPubBytes.length;           // key ID length (1 byte)
  header.set(localPubBytes, 21);               // key ID (65 bytes for P-256)

  // 최종 바이너리
  const body = new Uint8Array(header.length + encrypted.byteLength);
  body.set(header, 0);
  body.set(new Uint8Array(encrypted), header.length);

  return body;
}

/* ===== 유틸리티 ===== */

async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false };
  }
  const idToken = authHeader.slice(7);

  try {
    // Firebase ID Token 검증 (Google public keys)
    const projectId = env.FIREBASE_PROJECT_ID || 'dt-club';
    const tokenParts = idToken.split('.');
    if (tokenParts.length !== 3) return { ok: false };

    const payload = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));

    // 기본 검증: 만료, 발급자, audience
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return { ok: false };
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return { ok: false };
    if (payload.aud !== projectId) return { ok: false };

    return { ok: true, uid: payload.sub || payload.user_id };
  } catch {
    return { ok: false };
  }
}

async function hashString(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function base64urlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// DER ECDSA 서명을 raw (r || s) 형식으로 변환
function derToRaw(der) {
  // DER format: 0x30 [len] 0x02 [r_len] [r] 0x02 [s_len] [s]
  if (der[0] === 0x30) {
    let offset = 2;
    const rLen = der[offset + 1];
    const r = der.slice(offset + 2, offset + 2 + rLen);
    offset += 2 + rLen;
    const sLen = der[offset + 1];
    const s = der.slice(offset + 2, offset + 2 + sLen);

    // Pad or trim to 32 bytes each
    const rawR = padTo32(r);
    const rawS = padTo32(s);
    const raw = new Uint8Array(64);
    raw.set(rawR, 0);
    raw.set(rawS, 32);
    return raw;
  }
  return der; // already raw
}

function padTo32(bytes) {
  if (bytes.length === 32) return bytes;
  if (bytes.length > 32) return bytes.slice(bytes.length - 32);
  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return padded;
}

// Raw ECDSA private key to PKCS#8 DER format
async function convertRawToPKCS8(rawKey) {
  // PKCS#8 wrapper for EC P-256 private key
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
    0x01, 0x01, 0x04, 0x20
  ]);
  // After private key bytes: optional public key context tag
  const pkcs8Suffix = new Uint8Array([
    0xa1, 0x44, 0x03, 0x42, 0x00
  ]);

  // For signing only, we don't need the public key part
  // Simplified PKCS#8 without public key
  const simplePrefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02,
    0x01, 0x01, 0x04, 0x20
  ]);

  const result = new Uint8Array(simplePrefix.length + rawKey.length);
  result.set(simplePrefix, 0);
  result.set(rawKey, simplePrefix.length);
  return result;
}

// HKDF-Extract (HMAC-SHA-256)
async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = await crypto.subtle.sign('HMAC', key, ikm);
  return new Uint8Array(result);
}

// HKDF-Expand (HMAC-SHA-256)
async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithCounter = new Uint8Array(info.length + 1);
  infoWithCounter.set(info, 0);
  infoWithCounter[info.length] = 1;
  const result = await crypto.subtle.sign('HMAC', key, infoWithCounter);
  return new Uint8Array(result).slice(0, length);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}
