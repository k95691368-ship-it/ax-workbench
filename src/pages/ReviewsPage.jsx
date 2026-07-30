import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { postJson } from '../lib/api.js'
import DemoBadge from '../components/DemoBadge.jsx'
import { BrandBadge, UsageNote, ResultNotice } from '../components/ResultMeta.jsx'
import GenProgress from '../components/GenProgress.jsx'
import { pushHistory } from '../lib/history.js'
import { violatingTargets, buildReviewFixPayload, mergeFixed, sumUsage } from '../lib/fixTargets.js'

// 서버(functions/api/ax/reviews.js의 MAX_REVIEWS)와 같은 값이어야 한다 —
// 프론트가 더 많이 보내면 뒤 리뷰가 조용히 잘려 답변 없이 사라진다.
const MAX_REVIEWS = 8

const GEN_STEPS = [
  '리뷰를 유형별로 분류하고 있어요',
  '유형에 맞는 답변 초안을 쓰고 있어요',
  '사람의 판단이 필요한 건을 선별하고 있어요',
]

const SAMPLE = `맛도 좋고 배송도 빨라요. 아이들이랑 잘 먹고 있어서 재구매했습니다!
주문한 지 5일이 지났는데 아직도 배송이 안 와요. 언제 오나요?
이거 먹고 아이가 배가 아프다고 해서 병원 다녀왔어요. 어떻게 해야 하나요?
포장이 찢어져서 왔는데 교환 가능한가요?
유통기한이 어디에 표시되어 있나요? 못 찾겠어요.`

const CATEGORY_COLOR = {
  칭찬: 'cat-praise',
  배송: 'cat-ship',
  품질: 'cat-quality',
  '환불/교환': 'cat-refund',
  사용문의: 'cat-ask',
  기타: 'cat-etc',
}

export default function ReviewsPage() {
  const [text, setText] = useState(SAMPLE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState('')
  const resultRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  // 요청에 실제로 보낸 리뷰 — 입력창을 나중에 고쳐도 재작성 대상이 어긋나지 않게 보관
  const [sent, setSent] = useState([])
  const [fixing, setFixing] = useState(false)
  const [fixedRows, setFixedRows] = useState([])
  const [fixNote, setFixNote] = useState('')

  // 입력 텍스트 → 리뷰 배열. 생성 시점과 복원 시점이 같은 규칙을 쓰도록 한 곳에 둔다.
  const splitReviews = (t) =>
    String(t || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, MAX_REVIEWS)

  // 생성 이력에서 복원
  useEffect(() => {
    const entry = location.state?.restore
    if (!entry?.result) return
    if (typeof entry.input === 'string') {
      setText(entry.input)
      // sent도 함께 채운다. 비워 두면 복원 화면에서 리뷰 원문이 안 나오고,
      // "위반 답변만 다시 쓰기"가 빈 리뷰를 보내 400으로 실패한다.
      setSent(splitReviews(entry.input))
    }
    setResult(entry.result)
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])

  const reviews = useMemo(() => splitReviews(text), [text])

  async function generate(e) {
    e.preventDefault()
    if (reviews.length === 0) {
      setError('리뷰를 1개 이상 입력해주세요. (한 줄에 하나)')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await postJson('/api/ax/reviews', { reviews })
      data.results = Array.isArray(data.results) ? data.results : []
      setResult(data)
      setSent(reviews)
      setFixedRows([])
      setFixNote('')
      pushHistory({
        feature: 'reviews',
        label: `리뷰 ${reviews.length}건 응대`,
        input: text,
        result: data,
      })
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 위반이 검출된 답변만 다시 쓴다 — 통과한 답변은 그대로 둔다
  async function rewriteFlagged() {
    if (!result || fixing) return
    const targets = violatingTargets(result.results)
    if (targets.length === 0) return
    const before = targets.reduce((n, t) => n + t.violations.length, 0)
    setFixing(true)
    setError('')
    try {
      const data = await postJson('/api/ax/reviews', buildReviewFixPayload(targets, sent))
      const merged = mergeFixed(result.results, Array.isArray(data.results) ? data.results : [], targets)
      const after = violatingTargets(merged).reduce((n, t) => n + t.violations.length, 0)
      const next = {
        ...result,
        results: merged,
        // 상단 배지는 행 단위 결과에서 다시 집계한다. 예전에는 최초 생성 당시의 목록을
        // 그대로 들고 있어서, "위반이 모두 해소됐습니다"와 "필수 문구 1건 누락"이
        // 같은 화면에 동시에 떴다. 부분 재작성에도 정확하려면 행에서 다시 세야 한다.
        brand_applied: data.brand_applied ?? result.brand_applied,
        brand_missing: [...new Set(merged.flatMap((r) => r.brand_missing || []))],
        usage: sumUsage(result.usage, data.usage),
        demo: result.demo || data.demo,
        notice: data.notice || result.notice,
      }
      setResult(next)
      setFixedRows(targets.map((t) => t.index))
      setFixNote(
        after === 0
          ? `재작성 완료 — 위반 ${before}건이 모두 해소됐습니다. (${targets.length}건만 다시 작성)`
          : `재작성 완료 — 위반 ${before}건 → ${after}건. 남은 건은 담당자가 확인해주세요.`
      )
      pushHistory({
        feature: 'reviews',
        label: `답변 ${targets.length}건 재작성 (위반 ${before}건 → ${after}건)`,
        input: text,
        result: next,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setFixing(false)
    }
  }

  async function copyReply(i, reply) {
    try {
      await navigator.clipboard.writeText(reply)
      setCopied(`r${i}`)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setError('클립보드 복사에 실패했습니다.')
    }
  }

  const escalated = result ? result.results.filter((r) => r.escalate).length : 0
  // 금칙어·룰북 위반이 남은 답변 수 (재작성 대상)
  const flaggedReplies = result ? violatingTargets(result.results).length : 0

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">담당업무 C · 반복 업무 자동화</span>
        <h1>리뷰 자동 응대</h1>
        <p>
          고객 리뷰를 붙여넣으면 유형을 분류하고 답변 초안을 일괄 작성합니다. 건강 이상 호소처럼
          <strong> 사람의 판단이 필요한 건은 AI가 답하지 않고 담당자에게 올립니다</strong> — 반복은
          대체하고, 판단은 남기는 설계입니다.
        </p>
      </header>

      <div className="tool-layout">
        <form className="tool-form" onSubmit={generate}>
          <label>
            고객 리뷰 — 한 줄에 하나 (최대 8건)
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} />
          </label>
          <div className="batch-meta">
            <span className={reviews.length > 0 ? 'batch-count ok' : 'batch-count'}>{reviews.length}건 인식됨</span>
            <button type="button" className="preset-chip" onClick={() => setText(SAMPLE)}>
              샘플 5건 채우기
            </button>
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '일괄 응대 작성 중... (20~50초)' : `${reviews.length}건 일괄 응대 작성`}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>

        <div className="tool-result" ref={resultRef}>
          {!result && !loading && (
            <div className="result-empty">
              <p>샘플 리뷰 5건이 채워져 있어요 — 그중 하나는 일부러 "건강 이상 호소" 건입니다.</p>
              <p className="result-empty-sub">AI가 그 건만 골라 "담당자 확인 필요"로 올리는지 지켜보세요.</p>
            </div>
          )}
          {loading && <GenProgress steps={GEN_STEPS} />}
          {result && !loading && (
            <>
              <ResultNotice text={result.notice} />
              <ResultNotice text={result.input_warning} />
              <div className="result-toolbar">
                {result.demo && <DemoBadge />}
                <BrandBadge applied={result.brand_applied} missing={result.brand_missing} />
                <UsageNote usage={result.usage} />
                {flaggedReplies > 0 && (
                  <button type="button" className="btn-primary" disabled={fixing} onClick={rewriteFlagged}>
                    {fixing ? '재작성 중... (20~50초)' : `위반 답변 ${flaggedReplies}건만 다시 쓰기`}
                  </button>
                )}
              </div>
              {fixNote && (
                <p className="form-success" role="status">
                  {fixNote}
                </p>
              )}

              <div className="stat-row batch-summary">
                <div className="stat-tile">
                  <span className="stat-label">처리 리뷰</span>
                  <span className="stat-value">{result.results.length}건</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">자동 응대</span>
                  <span className="stat-value">{result.results.length - escalated}건</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">담당자 확인 필요</span>
                  <span className="stat-value">
                    {escalated}건{escalated > 0 && <em className="stat-note"> 판단 필요 건</em>}
                  </span>
                </div>
              </div>

              <div className="review-list">
                {result.results.map((r, i) => (
                  <article className={r.escalate ? 'review-card escalated' : 'review-card'} key={i}>
                    <div className="review-head">
                      <span className={`cat-badge ${CATEGORY_COLOR[r.category] || 'cat-etc'}`}>{r.category}</span>
                      {r.escalate && (
                        <span className="escalate-badge" title={r.escalate_reason || '담당자 판단 필요'}>
                          ⚠ 담당자 확인 필요
                        </span>
                      )}
                      {r.escalation_source === 'rule' && (
                        <span
                          className="rule-badge"
                          title={`AI는 자동 응대로 판단했지만, 안전 규칙이 담당자 확인으로 올렸습니다.${
                            r.escalation_matched ? ` (검출: ${r.escalation_matched.join(', ')})` : ''
                          }`}
                        >
                          규칙 강제
                        </span>
                      )}
                      <button type="button" className="copy-mini" onClick={() => copyReply(i, r.reply)}>
                        {copied === `r${i}` ? '✓' : '답변 복사'}
                      </button>
                    </div>
                    {/* 반드시 sent[i](요청에 실제로 보낸 리뷰)를 쓴다.
                        입력창을 실시간으로 다시 계산한 reviews[i]를 쓰면, 결과를 읽는 중에
                        입력을 고치면 카드가 밀려 건강 이상 호소 답변이 다른 리뷰 밑에 붙는다.
                        담당자가 화면 기준으로 "답변 복사"를 누르면 엉뚱한 고객에게 나간다. */}
                    <p className="review-original">“{sent[i] ?? ''}”</p>
                    <p className="review-reply">{r.reply}</p>
                    {r.escalate && r.escalate_reason && (
                      <p className="escalate-reason">에스컬레이션 사유: {r.escalate_reason}</p>
                    )}
                    {fixedRows.includes(i) && <span className="row-refixed">재작성됨</span>}
                    {r.brand_missing?.length > 0 && (
                      <p className="review-brand-missing">
                        룰북 필수 문구 누락: {r.brand_missing.join(', ')}
                      </p>
                    )}
                    {r.ad_check?.length > 0 && (
                      <p className="review-brand-missing">
                        점검 주의: {r.ad_check.map((f) => `${f.word}(${f.label})`).join(', ')}
                      </p>
                    )}
                    {r.promise_check?.length > 0 && (
                      <p
                        className="review-promise-check"
                        title={r.promise_check.map((p) => `${p.claim} — ${p.reason}`).join('\n')}
                      >
                        확약 표현 확인 필요:{' '}
                        {r.promise_check.map((p) => `${p.claim}(${p.label})`).join(', ')} — 보상
                        범위·처리 기한은 회사 정책이라 담당자 확인 후 내보내세요.
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
