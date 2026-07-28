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

    // 폴백이 "왜" 일어났는지 — 사유가 없으면 건수만 쌓이고 무엇을 고칠지는 알 수 없다.
    // reason 컬럼이 아직 없는 DB에서도 지표 전체가 죽지 않도록 따로 감싼다.
    let failureReasons = []
    try {
      const r = await env.DB.prepare(
        `SELECT reason, COUNT(*) AS calls
         FROM ai_calls
         WHERE created_at >= datetime('now', '-7 days') AND reason IS NOT NULL
         GROUP BY reason
         ORDER BY calls DESC
         LIMIT 5`
      ).all()
      failureReasons = (r.results || []).map((row) => ({ reason: row.reason, calls: row.calls }))
    } catch {
      failureReasons = []
    }

    // 사유별 건수만으로는 "어느 기능이" 아픈지 알 수 없다.
    // 기능별 라이브/폴백 비율까지 봐야 다음에 무엇을 고칠지 정해진다.
    let byEndpoint = []
    try {
      const r = await env.DB.prepare(
        `SELECT endpoint,
                COUNT(*) AS calls,
                SUM(CASE WHEN mode = 'live' THEN 1 ELSE 0 END) AS live_calls,
                SUM(CASE WHEN mode = 'fallback' THEN 1 ELSE 0 END) AS fallback_calls,
                AVG(CASE WHEN mode = 'live' THEN latency_ms END) AS avg_ms
         FROM ai_calls
         WHERE created_at >= datetime('now', '-7 days')
         GROUP BY endpoint
         ORDER BY calls DESC`
      ).all()
      byEndpoint = (r.results || []).map((row) => ({
        endpoint: row.endpoint,
        calls: row.calls,
        live_calls: row.live_calls || 0,
        fallback_calls: row.fallback_calls || 0,
        fallback_rate: row.calls ? Math.round(((row.fallback_calls || 0) / row.calls) * 1000) / 10 : 0,
        avg_ms: row.avg_ms ? Math.round(row.avg_ms) : null,
      }))
    } catch {
      byEndpoint = []
    }

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
      failure_reasons: failureReasons,
      by_endpoint: byEndpoint,
    })
  } catch {
    // 테이블 미생성 등 — 지표 없이도 사이트는 정상 동작해야 한다
    return json({ available: false })
  }
}
