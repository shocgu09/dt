// 재테크 푸시 알림 — dt-push 워커에 서비스 바인딩(env.PUSH)으로 넘긴다 (회원별 설정·기기 목록은 dt-push 가 안다)
// 실패해도 매매·정산은 그대로 — 알림은 덤이다

const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원';

export async function sendNotes(env, notes) {
  if (!notes || !notes.length || !env.PUSH || !env.INTERNAL_PUSH_KEY) return;
  try {
    await env.PUSH.fetch('https://dt-push/api/internal/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': env.INTERNAL_PUSH_KEY },
      body: JSON.stringify({ messages: notes.slice(0, 60) })
    });
  } catch (e) { console.error('notify failed', e && e.message); }
}

/** 크론이 체결을 마무리했을 때 (화면을 보고 있으면 화면이 직접 체결해 알림을 띄우므로 크론 체결만 보낸다) */
export function fillNote(order, f) {
  const side = order.forced ? '반대매매' : (order.side === 'buy' ? '매수' : '매도');
  const total = order.filled_qty + f.qty;
  const done = f.status === 'filled';
  return {
    uid: order.uid, kind: 'fill', tag: 'fill-' + order.id, url: '/invest/?tab=account',
    title: (done ? '✅ ' : '◐ ') + order.name + ' ' + side + (done ? ' 체결' : ' 일부 체결'),
    body: total.toLocaleString('ko-KR') + '주' + (order.filled_qty === 0 ? ' · ' + won(f.price) : '')
      + (done ? '' : ' (주문 ' + order.qty.toLocaleString('ko-KR') + '주 중 나머지는 취소)')
  };
}

const md = (ymd) => ymd ? Number(ymd.slice(4, 6)) + '/' + Number(ymd.slice(6, 8)) : '';

/** 밤 정산의 알림 — 미수 반대매매 예정 · 담보부족 · 담보부족 반대매매 예정 · 만기 */
export function marginNote(uid, kind, info) {
  const base = { uid, kind: 'margin', url: '/invest/?tab=account' };
  if (kind === 'misu') return { ...base, tag: 'misu', title: '⚠️ 미수 ' + won(info.amount), body: md(info.due) + ' 09:00 시가에 반대매매됩니다. 08:30 전에 매도해 부족분을 채우면 반대매매되지 않습니다' };
  if (kind === 'collateral') return { ...base, tag: 'collateral', title: '⚠️ 담보비율 ' + Math.round((info.ratio || 0) * 100) + '% · 추가담보 필요', body: '부족액 ' + won(info.amount) + ' · 다음 거래일 종가 기준으로도 140% 미만이면 반대매매됩니다' };
  if (kind === 'collateral-due') return { ...base, tag: 'collateral', title: '⚠️ 담보부족 반대매매 예정', body: md(info.due) + ' 09:00 시가에 신용·담보 잔고를 반대매매합니다 (부족액 ' + won(info.amount) + ')' };
  if (kind === 'expiry') return { ...base, tag: 'expiry', title: '⏰ 대출 만기', body: md(info.due) + ' 아침 자동상환하고, 주문가능현금이 모자라면 반대매매됩니다' };
  return null;
}
