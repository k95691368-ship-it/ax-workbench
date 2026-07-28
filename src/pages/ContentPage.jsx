import { useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { postJson } from '../lib/api.js'
import { PRODUCT_PRESETS, CHANNELS } from '../lib/presets.js'
import DemoBadge from '../components/DemoBadge.jsx'
import ChannelPreview from '../components/ChannelPreview.jsx'
import { AdCheckBadge, BrandBadge, UsageNote, ResultNotice } from '../components/ResultMeta.jsx'
import GenProgress from '../components/GenProgress.jsx'
import FixViolations from '../components/FixViolations.jsx'
import { mergeViolations } from '../lib/fixViolations.js'

const GEN_STEPS = [
  '제품 정보를 분석하고 있어요',
  '채널별 문법을 적용하고 있어요',
  '채널별 콘텐츠를 쓰고 있어요',
  '표시광고 기준으로 검수하고 있어요',
]

const QUICK_FEEDBACK = [
  '첫 줄 후킹을 더 강하게',
  '이모지를 줄여줘',
  '더 짧고 임팩트 있게',
  '신뢰감 있는 존댓말 톤으로 통일',
]

export default function ContentPage() {
  const location = useLocation()
  const [product, setProduct] = useState(() => location.state?.product || PRODUCT_PRESETS[0])
  const [selected, setSelected] = useState(['instagram', 'cardnews', 'youtube'])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [versions, setVersions] = useState([])
  const [activeVer, setActiveVer] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [revising, setRevising] = useState(false)
  const [activeTab, setActiveTab] = useState('')
  const [copied, setCopied] = useState('')
  const resultRef = useRef(null)

  const result = versions[activeVer] || null

  const set = (key) => (e) => setProduct((p) => ({ ...p, [key]: e.target.value }))

  function toggleChannel(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  async function generate(e) {
    e.preventDefault()
    if (selected.length === 0) {
      setError('채널을 1개 이상 선택해주세요.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await postJson('/api/ax/content', { product, channels: selected })
      data.results = Array.isArray(data.results) ? data.results : []
      setVersions([data])
      setActiveVer(0)
      setFeedback('')
      setActiveTab(data.results[0]?.channel || '')
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 현재 버전의 모든 채널 콘텐츠에 피드백을 일관 반영한 새 버전을 만든다
  async function revise(text) {
    const fb = (text || '').trim()
    if (!fb || !result || revising) return
    setRevising(true)
    setError('')
    try {
      const channels = result.results.map((r) => r.channel)
      const data = await postJson('/api/ax/content', {
        product,
        channels,
        revision: {
          feedback: fb,
          previous: result.results.map((r) => ({
            channel: r.channel,
            title: r.title,
            body: r.body,
            hashtags: r.hashtags,
          })),
        },
      })
      data.results = Array.isArray(data.results) ? data.results : []
      setVersions((prev) => {
        const next = [...prev, { ...data, feedbackApplied: fb }].slice(-6)
        setActiveVer(next.length - 1)
        return next
      })
      setFeedback('')
    } catch (err) {
      setError(err.message)
    } finally {
      setRevising(false)
    }
  }

  async function copy(item) {
    const text = `${item.title}\n\n${item.body}${item.hashtags?.length ? `\n\n${item.hashtags.map((h) => `#${h}`).join(' ')}` : ''}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(item.channel)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setError('클립보드 복사에 실패했습니다. 본문을 드래그해서 복사해주세요.')
    }
  }

  const channelLabel = (id) => CHANNELS.find((c) => c.id === id)?.label || id
  const active = result?.results?.find((r) => r.channel === activeTab) || result?.results?.[0]

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">담당업무 B · 채널별 콘텐츠 생성</span>
        <h1>채널 콘텐츠 팩토리</h1>
        <p>
          제품 정보 하나로 인스타·카드뉴스·블로그·스레드·유튜브 쇼츠·틱톡 콘텐츠를 각 채널의
          문법에 맞춰 동시에 생성합니다. 마케터는 검수와 발행에만 집중합니다.
        </p>
      </header>

      <div className="tool-layout">
        <form className="tool-form" onSubmit={generate}>
          <div className="preset-row" role="group" aria-label="예시 제품 불러오기">
            {PRODUCT_PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                className={product.name === p.name ? 'preset-chip active' : 'preset-chip'}
                onClick={() => setProduct(p)}
              >
                {p.name.split(' ').slice(0, 2).join(' ')}
              </button>
            ))}
          </div>

          <label>
            제품명 *
            <input value={product.name} onChange={set('name')} required maxLength={100} />
          </label>
          <label>
            핵심 특징
            <textarea value={product.features} onChange={set('features')} rows={3} maxLength={500} />
          </label>
          <label>
            타깃 고객
            <input value={product.target} onChange={set('target')} maxLength={200} />
          </label>

          <fieldset className="channel-fieldset">
            <legend>생성할 채널 선택</legend>
            <div className="channel-grid">
              {CHANNELS.map((ch) => (
                <label key={ch.id} className={selected.includes(ch.id) ? 'channel-check active' : 'channel-check'}>
                  <input
                    type="checkbox"
                    checked={selected.includes(ch.id)}
                    onChange={() => toggleChannel(ch.id)}
                  />
                  {ch.label}
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '생성 중... (10~30초)' : `${selected.length}개 채널 콘텐츠 생성`}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>

        <div className="tool-result" ref={resultRef}>
          {!result && !loading && (
            <div className="result-empty">
              <p>제품을 고르고 채널을 선택한 뒤 생성 버튼을 누르세요.</p>
              <p className="result-empty-sub">같은 제품이라도 채널마다 말투·구조·길이가 달라지는 것이 포인트입니다.</p>
            </div>
          )}
          {loading && <GenProgress steps={GEN_STEPS} />}
          {result && !loading && (
            <>
              <ResultNotice text={result.notice} />
              <FixViolations
                summary={mergeViolations([...(result.results || []), { brand_missing: result.brand_missing }])}
                onFix={revise}
                busy={revising}
              />
              <div className="result-toolbar">
                {result.demo && <DemoBadge />}
                <BrandBadge applied={result.brand_applied} missing={result.brand_missing} />
                <UsageNote usage={result.usage} />
                {versions.length > 1 && (
                  <div className="ver-row" role="group" aria-label="생성 버전 선택">
                    {versions.map((v, i) => (
                      <button
                        type="button"
                        key={i}
                        className={i === activeVer ? 'ver-chip active' : 'ver-chip'}
                        title={v.feedbackApplied ? `피드백: ${v.feedbackApplied}` : '최초 생성'}
                        onClick={() => setActiveVer(i)}
                      >
                        버전 {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="tab-row" role="tablist">
                {result.results.map((r) => (
                  <button
                    key={r.channel}
                    role="tab"
                    aria-selected={activeTab === r.channel}
                    className={activeTab === r.channel ? 'tab active' : 'tab'}
                    onClick={() => setActiveTab(r.channel)}
                  >
                    {channelLabel(r.channel)}
                  </button>
                ))}
              </div>
              {active && (
                <article className="content-card">
                  <div className="content-card-head">
                    <h3>{active.title}</h3>
                    <div className="content-card-tools">
                      <AdCheckBadge findings={active.ad_check} />
                      <span className="char-count">{String(active.body || '').length.toLocaleString('ko-KR')}자</span>
                      <button type="button" className="btn-ghost" onClick={() => copy(active)}>
                        {copied === active.channel ? '복사됨 ✓' : '본문 복사'}
                      </button>
                    </div>
                  </div>
                  <ChannelPreview item={active} />
                  {active.channel !== 'instagram' && active.hashtags?.length > 0 && (
                    <div className="chip-row content-tags">
                      {active.hashtags.map((h) => (
                        <span className="chip" key={h}>#{h}</span>
                      ))}
                    </div>
                  )}
                </article>
              )}

              <div className="fb-box">
                <h3>AI 피드백으로 다듬기</h3>
                <p className="fb-sub">피드백 하나가 생성된 모든 채널 콘텐츠에 일관되게 반영됩니다.</p>
                <div className="fb-chips">
                  {QUICK_FEEDBACK.map((q) => (
                    <button type="button" key={q} className="preset-chip" disabled={revising} onClick={() => revise(q)}>
                      {q}
                    </button>
                  ))}
                </div>
                <div className="fb-input-row">
                  <input
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    maxLength={300}
                    placeholder="예: 유튜브는 더 길게, 나머지는 그대로"
                    aria-label="피드백 입력"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        revise(feedback)
                      }
                    }}
                  />
                  <button type="button" className="btn-primary" disabled={revising || !feedback.trim()} onClick={() => revise(feedback)}>
                    {revising ? '반영 중... (10~30초)' : '피드백 반영'}
                  </button>
                </div>
                {revising && <p className="fb-status" aria-live="polite">모든 채널에 피드백을 일관 반영하고 있어요...</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
