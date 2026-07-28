// 검출로 끝내지 않고 교정까지 — 규정 위반을 AI에게 되돌려줄 수정 요청 문장으로 바꾼다.
// 표시광고 금칙어(ad_check)와 브랜드 룰북 필수 문구 누락(brand_missing)을 한 번에 다룬다.

export function violationSummary(result) {
  const banned = [...new Set((result?.ad_check || []).map((f) => f.word).filter(Boolean))]
  const missing = [...new Set((result?.brand_missing || []).filter(Boolean))]
  return { banned, missing, count: banned.length + missing.length }
}

// 여러 결과(채널 콘텐츠처럼 항목이 여러 개인 경우)를 하나로 합친다
export function mergeViolations(results) {
  const banned = new Set()
  const missing = new Set()
  for (const r of results || []) {
    const s = violationSummary(r)
    s.banned.forEach((w) => banned.add(w))
    s.missing.forEach((w) => missing.add(w))
  }
  return { banned: [...banned], missing: [...missing], count: banned.size + missing.size }
}

export function buildFixFeedback(summary) {
  const { banned, missing } = summary
  const parts = []
  if (banned.length)
    parts.push(
      `다음 표현이 규정 위반으로 검출됐습니다: ${banned.join(', ')}. 모두 제거하고, 같은 의미를 규정에 맞는 다른 방식으로 다시 쓰세요. 비슷한 말로 우회하지 마세요.`
    )
  if (missing.length)
    parts.push(
      `다음 필수 문구가 빠졌습니다: ${missing.map((m) => `"${m}"`).join(', ')}. 표기를 바꾸지 말고 자연스러운 위치에 그대로 넣으세요.`
    )
  parts.push('지적된 부분 외의 내용과 구조는 최대한 그대로 유지하세요.')
  return parts.join(' ')
}
