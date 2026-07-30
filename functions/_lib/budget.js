// 일일 비용 상한 — "몇 번 호출했나"가 아니라 "얼마 썼나"로 막는다.
//
// 기존 상한은 하루 300"회"였다. 그런데 채널 콘텐츠 1회(최대 16k 토큰)와 상품등록 1회(4k)는
// 실제 비용이 몇 배 차이라, 회수 기준 상한은 예산을 통제하지 못한다.
// 이미 호출마다 토큰을 기록하고 있으므로, 그 합계로 실제 지출을 계산해 막는 편이 정확하다.

// claude-opus-5 단가 (USD / 토큰)
export const INPUT_PRICE = 5 / 1_000_000
export const OUTPUT_PRICE = 25 / 1_000_000

export const DAILY_BUDGET_USD = 3

// 호출 1회의 대략적인 비용 — 실측에서 얻은 값이다.
// 상세페이지 1회 = 6호출에 입력 14.7k·출력 4.1k 토큰 ≈ $0.176 → 호출당 약 $0.03.
export const RESERVE_PER_CALL_USD = 0.03

export function costOf(inputTokens, outputTokens) {
  return (inputTokens || 0) * INPUT_PRICE + (outputTokens || 0) * OUTPUT_PRICE
}

// 최근 24시간 라이브 호출로 쓴 금액을 집계한다.
//
// calls: 이번 요청이 만들 AI 호출 수. 상한을 "이미 쓴 금액"만으로 판단하면,
// 한 요청이 6호출을 하는 지금 구조에서는 그 요청분만큼 상한을 넘겨 버린다
// (실제로 $3 상한에서 $3.33까지 지출됐다). 그래서 이번 요청의 예상 비용을 미리 빼고 본다.
//
// 조회 실패 시에는 서비스가 멈추지 않도록 통과시킨다 — 레이트리밋이 뒤를 받친다.
export async function checkDailyBudget(env, limitUsd = DAILY_BUDGET_USD, { calls = 1 } = {}) {
  const reserve = Math.max(1, calls) * RESERVE_PER_CALL_USD
  if (!env?.DB) return { ok: true, spent: 0, limit: limitUsd, available: false }
  try {
    const row = await env.DB.prepare(
      `SELECT SUM(COALESCE(input_tokens, 0)) AS input_tokens,
              SUM(COALESCE(output_tokens, 0)) AS output_tokens
       FROM ai_calls
       WHERE created_at >= datetime('now', '-1 day')`
    ).first()
    const spent = costOf(row?.input_tokens, row?.output_tokens)
    return { ok: spent + reserve <= limitUsd, spent, limit: limitUsd, reserve, available: true }
  } catch {
    return { ok: true, spent: 0, limit: limitUsd, available: false }
  }
}

// 집계 창은 자정 기준이 아니라 "최근 24시간" 롤링이다.
// 예전 문구는 "자정 이후 다시 이용할 수 있습니다"라고 안내했는데, 실제로는 오래된 사용분이
// 시간이 지나며 차례로 빠지면서 조금씩 회복된다. 사실과 다른 안내는 하지 않는다.
export function budgetNotice(budget) {
  return `최근 24시간 AI 생성 예산(${budget.limit.toFixed(2)} USD)을 모두 사용해 예시 결과를 표시합니다. 사용량이 시간이 지나며 차례로 빠지므로 잠시 후 다시 이용할 수 있습니다.`
}
