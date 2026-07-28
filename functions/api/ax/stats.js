import { json } from '../../_lib/http.js'

// 최근 7일 AI 호출 지표 요약 (About 페이지 '실측 운영 지표'용)
export async function onRequestGet(context) {
  const { env } = context
  if (!env.DB) return json({ available: false })

  try {
    const { results } = await env.DB.prepare(
      `SELECT mode,
              COUNT(*) AS calls,
              AVG(latency_ms) AS avg_ms,
              SUM(COALESCE(input_tokens, 0)) AS input_tokens,
              SUM(COALESCE(output_tokens, 0)) AS output_tokens,
              SUM(COALESCE(findings_count, 0)) AS findings
       FROM ai_calls
       WHERE created_at >= datetime('now', '-7 days')
       GROUP BY mode`
    ).all()

    const byMode = Object.fromEntries(results.map((r) => [r.mode, r]))
    const total = results.reduce((s, r) => s + r.calls, 0)
    const live = byMode.live || null

    return json({
      available: true,
      days: 7,
      total,
      live_calls: live?.calls || 0,
      live_avg_ms: live?.avg_ms ? Math.round(live.avg_ms) : null,
      input_tokens: live?.input_tokens || 0,
      output_tokens: live?.output_tokens || 0,
      findings: live?.findings || 0,
      fallback_calls: byMode.fallback?.calls || 0,
      unverified_calls: byMode.unverified?.calls || 0,
    })
  } catch {
    // 테이블 미생성 등 — 지표 없이도 사이트는 정상 동작해야 한다
    return json({ available: false })
  }
}
