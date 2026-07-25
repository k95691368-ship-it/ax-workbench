import { useState } from 'react'
import { postJson } from '../lib/api.js'
import { PRODUCT_PRESETS, CHANNELS } from '../lib/presets.js'
import DemoBadge from '../components/DemoBadge.jsx'
import ChannelPreview from '../components/ChannelPreview.jsx'

export default function ContentPage() {
  const [product, setProduct] = useState(PRODUCT_PRESETS[0])
  const [selected, setSelected] = useState(['instagram', 'cardnews', 'youtube'])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [activeTab, setActiveTab] = useState('')
  const [copied, setCopied] = useState('')

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
      setResult(data)
      setActiveTab(data.results[0]?.channel || '')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
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
  const active = result?.results?.find((r) => r.channel === activeTab)

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

        <div className="tool-result">
          {!result && !loading && (
            <div className="result-empty">
              <p>제품을 고르고 채널을 선택한 뒤 생성 버튼을 누르세요.</p>
              <p className="result-empty-sub">같은 제품이라도 채널마다 말투·구조·길이가 달라지는 것이 포인트입니다.</p>
            </div>
          )}
          {loading && <div className="result-empty"><p>채널별 문법에 맞춰 콘텐츠를 쓰는 중...</p></div>}
          {result && !loading && (
            <>
              <div className="result-toolbar">{result.demo && <DemoBadge />}</div>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
