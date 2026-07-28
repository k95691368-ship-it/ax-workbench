// AI 호출 기록 — 응답을 막지 않도록 waitUntil로 비동기 기록하고, 실패해도 무시한다.
// 개인정보(IP·입력 내용)는 저장하지 않는다.
export function logCall(context, { endpoint, mode, startedAt, usage, findingsCount, reason }) {
  const env = context.env
  if (!env?.DB) return
  const values = [
    endpoint,
    mode,
    startedAt ? Date.now() - startedAt : null,
    usage?.input_tokens ?? null,
    usage?.output_tokens ?? null,
    findingsCount ?? null,
  ]

  // reason 컬럼이 아직 없는 DB(마이그레이션 전)에서도 기록이 끊기지 않도록,
  // 실패하면 기존 형태로 한 번 더 시도한다.
  const withReason = env.DB.prepare(
    'INSERT INTO ai_calls (endpoint, mode, latency_ms, input_tokens, output_tokens, findings_count, reason) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(...values, reason ?? null)
    .run()
    .catch(() =>
      env.DB.prepare(
        'INSERT INTO ai_calls (endpoint, mode, latency_ms, input_tokens, output_tokens, findings_count) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(...values)
        .run()
        .catch(() => {})
    )

  try {
    context.waitUntil(withReason)
  } catch {
    // waitUntil 미지원 환경(로컬 등)에서는 결과를 기다리지 않고 흘려보낸다
  }
}
