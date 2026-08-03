// Turnstile 서버 검증 — 요청이 진짜 브라우저에서 왔는지 Cloudflare에 확인한다.
//
// 설계 원칙: 검증 실패를 하드 차단(403)하지 않는다. 포트폴리오 사이트에서는 처음 열어 보는 사람이
// 빈 에러 화면을 보는 것이 봇 유입보다 훨씬 큰 손해다. 대신 호출부가 "예시 결과 + 사유"로
// 우아하게 강등하도록 실패 사유(codes)를 함께 돌려준다. 봇은 AI 비용을 유발하지 못하고,
// 사람은 언제나 동작하는 화면을 본다.
//
// 반환: { ok: boolean, codes: string }
//   codes 예) missing-token(토큰 미전송) · invalid-input-secret(시크릿 불일치)
//             timeout-or-duplicate(토큰 재사용·만료) · invalid-input-response(토큰 손상)
export async function verifyTurnstile(env, request) {
  const secret = env.TURNSTILE_SECRET
  if (!secret) return { ok: true, codes: 'not-configured' }

  const token = request.headers.get('x-turnstile-token')
  if (!token) return { ok: false, codes: 'missing-token' }

  try {
    const params = new URLSearchParams({ secret, response: token })
    const ip = request.headers.get('CF-Connecting-IP')
    if (ip) params.set('remoteip', ip)
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      body: params,
    })
    const data = await res.json()
    if (data.success === true) return { ok: true, codes: 'ok' }
    return { ok: false, codes: (data['error-codes'] || ['unknown']).join(',') }
  } catch {
    // 검증 서비스 장애가 데모 전체를 막지 않도록 통과시킨다
    return { ok: true, codes: 'verify-unreachable' }
  }
}
