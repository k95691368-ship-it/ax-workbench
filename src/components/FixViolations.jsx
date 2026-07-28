import { buildFixFeedback } from '../lib/fixViolations.js'

// 규정 위반이 검출됐을 때, 사람이 문장을 다시 쓰는 대신 AI에게 교정을 맡기는 한 줄 액션.
// summary: { banned, missing, count } — violationSummary/mergeViolations의 결과
export default function FixViolations({ summary, onFix, busy }) {
  if (!summary || summary.count === 0) return null
  const { banned, missing, count } = summary

  return (
    <div className="fixbar">
      <div className="fixbar-text">
        <p className="fixbar-title">발행 전에 고쳐야 할 항목 {count}건</p>
        <p className="fixbar-detail">
          {banned.length > 0 && <>금지 표현: {banned.join(', ')}</>}
          {banned.length > 0 && missing.length > 0 && ' · '}
          {missing.length > 0 && <>필수 문구 누락: {missing.join(', ')}</>}
        </p>
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={() => onFix(buildFixFeedback(summary))}
      >
        {busy ? '수정 중...' : 'AI에게 자동 수정 맡기기'}
      </button>
    </div>
  )
}
