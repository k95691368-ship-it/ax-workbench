// AI 생성 결과에 붙는 공통 메타 표시: 표시광고 자동 점검 배지, 브랜드 룰북 적용 여부,
// 토큰 사용량·추정 비용, 안내문
import { Link } from 'react-router-dom'

// claude-opus-5 단가 (USD / 토큰)
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
      claude-opus-5 · 입력 {usage.input_tokens.toLocaleString('ko-KR')} · 출력{' '}
      {usage.output_tokens.toLocaleString('ko-KR')} 토큰 · 약 ${cost.toFixed(3)}
    </span>
  )
}

// 병렬 생성으로 실제로 얼마나 시간을 벌었는지 보여준다.
//
// 연출이 아니라 서버가 호출마다 잰 실측이다. 개별 호출 시간의 합은 예전 구조
// (한 번에 다 만들기)였다면 걸렸을 시간이고, total은 실제 걸린 시간이다.
export function ParallelNote({ timing }) {
  if (!timing?.total_ms || !timing?.serial_ms) return null
  const speedup = timing.serial_ms / timing.total_ms
  if (speedup < 1.2) return null
  const sec = (ms) => (ms / 1000).toFixed(1)
  return (
    <span
      className="usage-note"
      title={`${timing.calls}개 호출을 동시에 실행했습니다. 개별 소요시간 합계 ${sec(timing.serial_ms)}초 → 실제 ${sec(timing.total_ms)}초.`}
    >
      병렬 생성 {timing.calls}회 · {sec(timing.serial_ms)}초 작업을 {sec(timing.total_ms)}초에 (
      {speedup.toFixed(1)}배)
    </span>
  )
}

// 브랜드 룰북이 이번 생성에 실제로 적용됐는지, 필수 문구가 빠지진 않았는지 보여준다.
export function BrandBadge({ applied, missing }) {
  if (applied == null) return null
  if (!applied) {
    return (
      <Link to="/brand" className="brandbadge off">
        브랜드 룰북 미설정 — 회사 톤·금지어 적용하기
      </Link>
    )
  }
  if (Array.isArray(missing) && missing.length > 0) {
    return (
      <span className="brandbadge warn" title="룰북의 필수 문구가 결과에 포함되지 않았습니다.">
        ⚠ 브랜드 룰북 적용 · 필수 문구 {missing.length}건 누락: {missing.join(', ')}
      </span>
    )
  }
  return <span className="brandbadge on">🏷 브랜드 룰북 적용됨</span>
}

// 사실 근거 점검 — "위반"이 아니라 "사람이 확인해야 할 것"이다.
// 기계가 확신할 수 없는 영역이므로 자동 수정 대상에 넣지 않고 표시만 한다.
export function FactCheckBadge({ findings }) {
  if (!Array.isArray(findings) || findings.length === 0) return null
  return (
    <span
      className="adcheck fact"
      title={findings.map((f) => `${f.claim} — ${f.reason}`).join('\n')}
    >
      🔎 근거 확인 필요 {findings.length}건 · {findings.map((f) => f.claim).join(', ')}
    </span>
  )
}

export function ResultNotice({ text }) {
  if (!text) return null
  return <p className="result-notice">{text}</p>
}
