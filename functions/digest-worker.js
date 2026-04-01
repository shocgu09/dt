// AI 데일리 다이제스트 Firestore 저장 Worker
// 환경변수(Secrets): DIGEST_SECRET, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Digest-Secret',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
    const url = new URL(request.url);

    // POST /api/digest — 다이제스트 저장
    if (url.pathname === '/api/digest' && request.method === 'POST') {
      const secret = request.headers.get('X-Digest-Secret');
      if (!secret || secret !== env.DIGEST_SECRET) {
        return new Response(JSON.stringify({ error: '인증 실패' }), { status: 401, headers: jsonHeaders });
      }
      try {
        const body = await request.json();
        const { date, title, body: content } = body;
        if (!date || !title || !content) {
          return new Response(JSON.stringify({ error: 'date, title, body 필수' }), { status: 400, headers: jsonHeaders });
        }

        const accessToken = await getServiceAccountToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);

        const projectId = 'dt-club';
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/ai_trend_posts`;

        const docData = {
          fields: {
            date: { stringValue: date },
            title: { stringValue: title },
            body: { stringValue: content },
            authorName: { stringValue: 'AI Agent' },
            createdAt: { timestampValue: new Date().toISOString() },
          }
        };

        const fsResp = await fetch(firestoreUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify(docData),
        });

        if (!fsResp.ok) {
          const err = await fsResp.text();
          return new Response(JSON.stringify({ error: 'Firestore 저장 실패', detail: err }), { status: 500, headers: jsonHeaders });
        }
        const result = await fsResp.json();
        return new Response(JSON.stringify({ success: true, docId: result.name?.split('/').pop() }), { headers: jsonHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // GET /api/links — ai_trend_links 목록 조회 (공개)
    if (url.pathname === '/api/links' && request.method === 'GET') {
      const projectId = 'dt-club';
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: 'ai_trend_links' }],
          orderBy: [{ field: { fieldPath: 'order' }, direction: 'ASCENDING' }],
        }
      };
      try {
        const resp = await fetch(queryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queryBody),
        });
        const results = await resp.json();
        const docs = results
          .filter(r => r.document)
          .map(r => {
            const f = r.document.fields;
            return {
              category: f.category?.stringValue || '',
              name: f.name?.stringValue || '',
              url: f.url?.stringValue || '',
              rss: f.rss?.stringValue || '',
              channelId: f.channelId?.stringValue || '',
            };
          });
        const grouped = {
          X: docs.filter(d => d.category === 'X').map(d => ({ name: d.name, url: d.url })),
          뉴스레터: docs.filter(d => d.category === '뉴스레터').map(d => ({ name: d.name, url: d.url, rss: d.rss })),
          유튜브: docs.filter(d => d.category === '유튜브').map(d => ({ name: d.name, url: d.url, channelId: d.channelId })),
        };
        return new Response(JSON.stringify(grouped), {
          headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // GET /api/digest — 최근 다이제스트 조회 (공개)
    if (url.pathname === '/api/digest' && request.method === 'GET') {
      const date = url.searchParams.get('date');
      const projectId = 'dt-club';
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: 'ai_trend_posts' }],
          where: date ? {
            fieldFilter: {
              field: { fieldPath: 'date' },
              op: 'EQUAL',
              value: { stringValue: date },
            }
          } : undefined,
          orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
          limit: date ? 1 : 10,
        }
      };
      try {
        const resp = await fetch(queryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queryBody),
        });
        const results = await resp.json();
        const docs = results
          .filter(r => r.document)
          .map(r => {
            const f = r.document.fields;
            return {
              id: r.document.name.split('/').pop(),
              date: f.date?.stringValue || '',
              title: f.title?.stringValue || '',
              body: f.body?.stringValue || '',
              authorName: f.authorName?.stringValue || '',
              createdAt: f.createdAt?.timestampValue || '',
            };
          });
        return new Response(JSON.stringify({ docs }), {
          headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // POST /api/car-digest — 자동차 다이제스트 저장
    if (url.pathname === '/api/car-digest' && request.method === 'POST') {
      const secret = request.headers.get('X-Digest-Secret');
      if (!secret || secret !== env.DIGEST_SECRET) {
        return new Response(JSON.stringify({ error: '인증 실패' }), { status: 401, headers: jsonHeaders });
      }
      try {
        const body = await request.json();
        const { date, title, body: content } = body;
        if (!date || !title || !content) {
          return new Response(JSON.stringify({ error: 'date, title, body 필수' }), { status: 400, headers: jsonHeaders });
        }
        const accessToken = await getServiceAccountToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
        const projectId = 'dt-club';
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/car_trend_posts`;
        const docData = {
          fields: {
            date: { stringValue: date },
            title: { stringValue: title },
            body: { stringValue: content },
            authorName: { stringValue: 'AI Agent' },
            createdAt: { timestampValue: new Date().toISOString() },
          }
        };
        const fsResp = await fetch(firestoreUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify(docData),
        });
        if (!fsResp.ok) {
          const err = await fsResp.text();
          return new Response(JSON.stringify({ error: 'Firestore 저장 실패', detail: err }), { status: 500, headers: jsonHeaders });
        }
        const result = await fsResp.json();
        return new Response(JSON.stringify({ success: true, docId: result.name?.split('/').pop() }), { headers: jsonHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // GET /api/car-links — car_trend_links 목록 조회 (공개)
    if (url.pathname === '/api/car-links' && request.method === 'GET') {
      const projectId = 'dt-club';
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: 'car_trend_links' }],
          orderBy: [{ field: { fieldPath: 'order' }, direction: 'ASCENDING' }],
        }
      };
      try {
        const resp = await fetch(queryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queryBody),
        });
        const results = await resp.json();
        const docs = results
          .filter(r => r.document)
          .map(r => {
            const f = r.document.fields;
            return {
              category: f.category?.stringValue || '',
              name: f.name?.stringValue || '',
              url: f.url?.stringValue || '',
              rss: f.rss?.stringValue || '',
              channelId: f.channelId?.stringValue || '',
            };
          });
        const grouped = {
          X: docs.filter(d => d.category === 'X').map(d => ({ name: d.name, url: d.url })),
          뉴스: docs.filter(d => d.category === '뉴스').map(d => ({ name: d.name, url: d.url, rss: d.rss })),
          유튜브: docs.filter(d => d.category === '유튜브').map(d => ({ name: d.name, url: d.url, channelId: d.channelId })),
        };
        return new Response(JSON.stringify(grouped), {
          headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // GET /api/car-digest — 최근 자동차 다이제스트 조회 (공개)
    if (url.pathname === '/api/car-digest' && request.method === 'GET') {
      const date = url.searchParams.get('date');
      const projectId = 'dt-club';
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: 'car_trend_posts' }],
          where: date ? {
            fieldFilter: {
              field: { fieldPath: 'date' },
              op: 'EQUAL',
              value: { stringValue: date },
            }
          } : undefined,
          orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
          limit: date ? 1 : 10,
        }
      };
      try {
        const resp = await fetch(queryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queryBody),
        });
        const results = await resp.json();
        const docs = results
          .filter(r => r.document)
          .map(r => {
            const f = r.document.fields;
            return {
              id: r.document.name.split('/').pop(),
              date: f.date?.stringValue || '',
              title: f.title?.stringValue || '',
              body: f.body?.stringValue || '',
              authorName: f.authorName?.stringValue || '',
              createdAt: f.createdAt?.timestampValue || '',
            };
          });
        return new Response(JSON.stringify({ docs }), {
          headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    return new Response(JSON.stringify({ status: 'ok', service: 'dt-digest' }), { headers: jsonHeaders });
  }
};

// Firebase Service Account → Google OAuth2 Access Token
async function getServiceAccountToken(clientEmail, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const b64url = obj => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const headerB64 = b64url(header);
  const payloadB64 = b64url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')   // 리터럴 \n 제거
    .replace(/\n/g, '')    // 실제 줄바꿈 제거
    .replace(/\s/g, '')    // 나머지 공백 제거
    .trim();
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${signingInput}.${sigB64}`;

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.text();
    throw new Error('Service account auth 실패: ' + err);
  }
  const tokenData = await tokenResp.json();
  return tokenData.access_token;
}
