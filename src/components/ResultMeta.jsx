// AI 생성 결과에 붙는 공통 메타 표시: 표시광고 자동 점검 배지, 토큰 사용량·추정 비용, 안내문

// claude-opus-4-8 단가 (USD / 토큰)
const INPUT_PRICE = 5 / 1_000_000
const OUTPUT_PRICE = 25 / 1_000_000

export function AdCheckBadge({ findings }) {
  if (!Array.isArray(findings)) return null
  if (findings.length === 0) {
    return <span className="adcheck ok">✓ 표시광고 자동 점검 통과</span>
  }
  return (
    <span
      className="adcheck warn"
      title={findings.map((f) => `"${f.word}" — ${f.label}: ${f.reason}`).join('\n')}
    >
      ⚠ 표시광고 점검 주의 {findings.length}건 · {findings.map((f) => f.word).join(', ')}
    </span>
  )
}

export function UsageNote({ usage }) {
  if (!usage || usage.input_tokens == null) return null
  const cost = usage.input_tokens * INPUT_PRICE + usage.output_tokens * OUTPUT_PRICE
  return (
    <span className="usage-note" title="이번 생성 1회의 실측 토큰 사용량과 추정 비용입니다.">
      claude-opus-4-8 · 입력 {usage.input_tokens.toLocaleString('ko-KR')} · 출력{' '}
      {usage.output_tokens.toLocaleString('ko-KR')} 토큰 · 약 ${cost.toFixed(3)}
    </span>
  )
}

export function ResultNotice({ text }) {
  if (!text) return null
  return <p className="result-notice">{text}</p>
}
