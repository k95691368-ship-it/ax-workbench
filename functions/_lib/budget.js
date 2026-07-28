// 일일 비용 상한 — "몇 번 호출했나"가 아니라 "얼마 썼나"로 막는다.
//
// 기존 상한은 하루 300"회"였다. 그런데 채널 콘텐츠 1회(최대 16k 토큰)와 상품등록 1회(4k)는
// 실제 비용이 몇 배 차이라, 회수 기준 상한은 예산을 통제하지 못한다.
// 이미 호출마다 토큰을 기록하고 있으므로, 그 합계로 실제 지출을 계산해 막는 편이 정확하다.

// claude-opus-5 단가 (USD / 토큰)
export const INPUT_PRICE = 5 / 1_000_000
export const OUTPUT_PRICE = 25 / 1_000_000

export const DAILY_BUDGET_USD = 3

export function costOf(inputTokens, outputTokens) {
  return (inputTokens || 0) * INPUT_PRICE + (outputTokens || 0) * OUTPUT_PRICE
}

// 오늘(UTC 기준 24시간) 라이브 호출로 쓴 금액을 집계한다.
// 조회 실패 시에는 서비스가 멈추지 않도록 통과시키되, 회수 기반 상한이 여전히 뒤를 받친다.
export async function checkDailyBudget(env, limitUsd = DAILY_BUDGET_USD) {
  if (!env?.DB) return { ok: true, spent: 0, limit: limitUsd, available: false }
  try {
    const row = await env.DB.prepare(
      `SELECT SUM(COALESCE(input_tokens, 0)) AS input_tokens,
              SUM(COALESCE(output_tokens, 0)) AS output_tokens
       FROM ai_calls
       WHERE created_at >= datetime('now', '-1 day')`
    ).first()
    const spent = costOf(row?.input_tokens, row?.output_tokens)
    return { ok: spent < limitUsd, spent, limit: limitUsd, available: true }
  } catch {
    return { ok: true, spent: 0, limit: limitUsd, available: false }
  }
}

export function budgetNotice(budget) {
  return `오늘의 AI 생성 예산(${budget.limit.toFixed(2)} USD)을 모두 사용해 예시 결과를 표시합니다. 자정 이후 다시 이용할 수 있습니다.`
}
