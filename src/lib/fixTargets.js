// "규정 위반이 검출된 항목만" 골라 다시 만들기 위한 공통 로직.
// 대량 등록(상품)과 리뷰 응대(답변)가 같은 원칙을 공유한다 —
// 통과한 항목은 건드리지 않으므로 사람의 확인 부담도, 토큰 비용도 위반 건수만큼만 든다.

// 결과 한 건에 남은 위반 표현 목록 (금칙어 + 룰북 필수 문구 누락)
export function violationsOf(row) {
  return [
    ...(row?.ad_check || []).map((f) => f.word).filter(Boolean),
    ...(row?.brand_missing || []).filter(Boolean),
  ]
}

// 다시 생성해야 할 행들의 위치와 사유
export function violatingTargets(results) {
  return (results || [])
    .map((row, index) => ({ index, row, violations: violationsOf(row) }))
    .filter((t) => t.violations.length > 0)
}

export function violationCount(results) {
  return violatingTargets(results).reduce((sum, t) => sum + t.violations.length, 0)
}

// 재생성 요청 본문 — 원래 입력에 "이전 결과"와 "검출된 표현"을 얹어 보낸다.
// sent: 최초 요청에 실제로 보낸 상품 배열(입력창을 나중에 고쳐도 어긋나지 않도록 보관해 둔 것)
export function buildFixPayload(targets, sent) {
  return targets.map(({ index, row, violations }) => {
    const source = sent?.[index] || { name: row?.input_name || '' }
    return {
      name: source.name,
      category: source.category || '',
      features: source.features || '',
      previous: row?.title || '',
      violations,
    }
  })
}

// 재생성 결과를 원래 표의 해당 행에만 덮어쓴다 (통과한 행은 그대로 유지)
export function mergeFixed(results, fixedResults, targets) {
  const next = [...(results || [])]
  ;(fixedResults || []).forEach((row, i) => {
    const at = targets[i]?.index
    if (at == null || !row) return
    const prev = next[at]
    next[at] = {
      ...row,
      // 상품이 뒤바뀌는 사고를 막기 위해 원래 상품명을 유지한다
      input_name: prev?.input_name || row.input_name,
      // input_check는 "입력 원문에 이미 있던 표현"이라 재생성으로 해결되지 않는다.
      // 그런데 행을 통째로 교체하면 새 응답에 그 값이 없을 때 경고가 조용히 사라진다 —
      // 입력창에는 금칙어가 그대로 남아 있는데 화면은 "원문 수정 필요 0개"로 바뀐다.
      // 해결되지 않은 문제를 해결된 것처럼 보이게 하는 것이 가장 나쁜 실패다.
      input_check: row.input_check?.length ? row.input_check : prev?.input_check,
    }
  })
  return next
}

// 리뷰 응대 재작성 요청 — 원래 리뷰 본문과 함께 이전 답변·검출 표현을 보낸다
export function buildReviewFixPayload(targets, sentReviews) {
  return {
    reviews: targets.map(({ index }) => sentReviews?.[index] || ''),
    fix: targets.map(({ row, violations }) => ({ previous: row?.reply || '', violations })),
  }
}

export function sumUsage(a, b) {
  if (!a) return b || null
  if (!b) return a
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
  }
}
