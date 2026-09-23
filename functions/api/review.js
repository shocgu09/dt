// 계좌 AI 평가 — Cloudflare Pages Function
//
// dt-stock 워커가 서버끼리 부른다. 화면에서 직접 부르지 못하게 공유 비밀로 막는다.
//   - 지표(metrics)는 dt-stock 이 D1 로 계산한 값이다. 화면이 보내게 두면 숫자를 위조할 수 있다.
//   - 유료 API 라 하루 횟수 제한도 dt-stock 쪽에서 센다. 여기가 열려 있으면 그 제한이 무의미해진다.
// 여기서는 문장만 만든다 — 숫자 계산은 시키지 않는다.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Review-Secret',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

const SYSTEM = [
  '당신은 트레이딩 코치입니다. 모의투자 계좌의 매매 지표를 받아 짧은 평가를 씁니다.',
  '',
  '톤 — 냉정한 코치:',
  '- 잘한 것은 짧게 인정하고, 고칠 것은 돌려 말하지 않고 그대로 짚습니다.',
  '- 응원·격려·위로 금지. 과장 금지. 존댓말은 유지합니다.',
  '- 이모지는 아래 형식에 적힌 섹션 머리 것만 씁니다. 문장 안에는 넣지 마세요.',
  '- 듣기 좋은 말로 채우지 말고, 할 말이 없으면 데이터가 부족하다고 쓰세요.',
  '',
  '규칙:',
  '- 숫자를 새로 계산하지 마세요. 주어진 지표에 없는 수치는 절대 쓰지 마세요.',
  '- 지표가 null 이면 판단할 데이터가 부족하다고 쓰고, 지어내지 마세요.',
  '- replayOk 가 false 이면 승률·보유기간은 신뢰할 수 없으니 언급하지 마세요.',
  '- 가장 중요한 것은 alpha(시장 대비 초과수익)와 holdDays(이익/손실 보유기간 차이)입니다.',
  '  수익이 나도 alpha 가 마이너스면 시장을 못 이긴 것이라고 분명히 말하세요.',
  '  이익을 빨리 팔고 손실을 오래 들고 있으면 처분효과라고 이름 붙여 지적하세요.',
  '- 보유 종목에 대한 매매 의견을 제시해도 됩니다. 근거는 지표에서 찾아 말하세요.',
  '- 모의투자 계좌입니다. 실제 손익이 아닙니다.',
  '',
  '형식 (마크다운 기호 없이 순수 텍스트, 전체 400자 이내).',
  '아래 머리글을 이모지까지 그대로 쓰고, 다른 이모지는 쓰지 마세요:',
  '',
  '📊 총평',
  '한 문장',
  '',
  '✅ 잘한 점',
  '- 두 줄 이내',
  '',
  '⚠️ 고칠 점',
  '- 두 줄 이내',
  '',
  '🎯 다음 점검',
  '- 한 줄'
].join('\n');

export async function onRequestPost(context) {
  const env = context.env;
  const key = env.OPENAI_API_KEY_REFINE || env.OPENAI_API_KEY;
  if (!key) return json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, 500);
  if (!env.REVIEW_SECRET) return json({ error: 'REVIEW_SECRET이 설정되지 않았습니다.' }, 500);

  if (context.request.headers.get('X-Review-Secret') !== env.REVIEW_SECRET) {
    return json({ error: '인증 실패' }, 401);
  }

  let metrics;
  try {
    const body = await context.request.json();
    metrics = body && body.metrics;
  } catch (e) { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (!metrics || typeof metrics !== 'object') return json({ error: '지표가 없습니다.' }, 400);

  // 모델은 환경변수로 바꿀 수 있게 둔다 (되돌릴 때 코드 배포가 필요 없도록)
  const model = env.REVIEW_MODEL || 'gpt-5.4-nano';
  const reasoning = /^gpt-5/.test(model);

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        // 추론 모델은 'developer' 역할을 쓴다 (예전 모델의 'system' 자리)
        input: [
          { role: reasoning ? 'developer' : 'system', content: [{ type: 'input_text', text: SYSTEM }] },
          { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(metrics) }] }
        ],
        text: { format: { type: 'text' }, verbosity: 'medium' },
        ...(reasoning ? { reasoning: { effort: 'medium' } } : {}),
        // 추론 모델은 생각하는 토큰도 이 한도에서 깎는다.
        // 700 으로 두면 생각만 하다 끝나 본문이 비어 돌아온다 — 넉넉히 준다.
        max_output_tokens: reasoning ? 3000 : 700
      })
    });
  } catch (e) {
    return json({ error: 'AI 서버에 연결하지 못했습니다.' }, 502);
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.warn('openai review failed', model, res.status, detail);
    // 401 이면 키 문제다 — 부른 쪽이 구분할 수 있게 상태를 넘긴다
    return json({ error: 'AI 응답 실패', upstream: res.status, detail }, 502);
  }

  const data = await res.json();
  // 추론 모델의 output 에는 reasoning 항목도 섞인다 — 실제 답변(message)만 골라낸다
  const text = String(
    data.output_text
    || (data.output || [])
        .filter((o) => o.type === 'message')
        .flatMap((o) => (o.content || []).map((c) => c.text || ''))
        .join('')
    || ''
  ).trim();

  if (!text && data.status === 'incomplete') {
    console.warn('openai review incomplete', model, JSON.stringify(data.incomplete_details || {}));
    return json({ error: 'AI 응답이 잘렸습니다. 잠시 후 다시 시도해 주세요' }, 502);
  }
  if (!text) return json({ error: 'AI 응답이 비었습니다.' }, 502);

  return json({ text });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
