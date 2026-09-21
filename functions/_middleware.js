// 저장소 루트가 통째로 서빙되므로, 사이트에 필요 없는 내부 파일은 여기서 막는다.
// (보안 규칙·작업 지침·설정 파일이 외부에서 그대로 열리던 문제)
// 이 미들웨어가 도는 경로는 /_routes.json 의 include 로 한정한다 — 정적 파일 요청까지
// 전부 Functions 호출로 잡히면 무료 요청 한도를 갉아먹는다.
const BLOCKED = [
  /^\/docs(\/|$)/i,
  /^\/firestore\.rules$/i,
  /^\/firebase\.json$/i,
  /^\/\.impeccable\.md$/i,
  /^\/(CLAUDE|README)\.md$/i,
];

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (BLOCKED.some((re) => re.test(path))) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return context.next();
}
