import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { postJson } from '../lib/api.js'
import { PRODUCT_PRESETS } from '../lib/presets.js'
import { DP_THEMES, getTheme, orbStyle, makeCustomTheme, fileToResizedDataUrl } from '../lib/themes.js'
import DemoBadge from '../components/DemoBadge.jsx'
import { AdCheckBadge, UsageNote, ResultNotice } from '../components/ResultMeta.jsx'
import GenProgress from '../components/GenProgress.jsx'

const EMPTY = { name: '', category: '', features: '', target: '', tone: '' }

const QUICK_FEEDBACK = [
  '톤을 더 고급스럽게 바꿔줘',
  '더 캐주얼하고 친근하게',
  '문장을 절반 길이로 짧게',
  '인증·보장균수 같은 신뢰 요소를 더 강조해줘',
]

const LOADING_STEPS = [
  '제품 정보를 분석하고 있어요',
  '섹션 구조를 설계하고 있어요',
  '섹션별 카피를 쓰고 있어요',
  '표시광고 기준으로 검수하고 있어요',
]

function buildHtml(result, product, theme) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const t = theme || getTheme('green')
  const orbs = (t.orbs || [])
    .map((o) => {
      const pos = [
        o.top != null ? `top:${o.top}px;` : '',
        o.bottom != null ? `bottom:${o.bottom}px;` : '',
        o.left != null ? `left:${o.left}px;` : '',
        o.right != null ? `right:${o.right}px;` : '',
      ].join('')
      return `<i style="position:absolute;${pos}width:${o.size}px;height:${o.size}px;border-radius:50%;background:${o.bg};${o.blur ? `filter:blur(${o.blur}px);` : ''}"></i>`
    })
    .join('')
  const cardStyle = t.card
    ? `background:${t.card.bg};border-radius:${t.card.radius}px;${t.card.border ? `border:${t.card.border};` : ''}${t.card.shadow ? `box-shadow:${t.card.shadow};` : ''}${t.card.blur ? `-webkit-backdrop-filter:blur(${t.card.blur}px);backdrop-filter:blur(${t.card.blur}px);` : ''}margin:16px auto;max-width:720px;padding:32px 24px;`
    : 'padding:48px 24px;max-width:720px;margin:0 auto;border-bottom:1px solid rgba(128,128,128,.18);'
  const headingStyle = t.headingClip
    ? `font-size:24px;background:${t.headingClip};-webkit-background-clip:text;background-clip:text;color:transparent;`
    : `font-size:24px;color:${t.heading};`
  const sections = (result.sections || [])
    .map(
      (s) => `
  <section style="${cardStyle}">
    <h2 style="${headingStyle}">${esc(s.title)}</h2>
    <p style="font-size:16px;line-height:1.8;color:${t.text};">${esc(s.body)}</p>
    ${(s.bullets || []).length ? `<ul style="color:${t.text};">${s.bullets.map((b) => `<li style="line-height:1.9;">${esc(b)}</li>`).join('')}</ul>` : ''}
    <p style="font-size:12px;color:${t.briefText};background:${t.briefBg};padding:8px 12px;border-radius:6px;">[이미지 지시] ${esc(s.image_brief)}</p>
  </section>`
    )
    .join('')
  const faq = (result.faq || [])
    .map(
      (f) =>
        `<dt style="font-weight:700;margin-top:16px;color:${t.faqQ};">Q. ${esc(f.q)}</dt><dd style="margin:4px 0 0;color:${t.faqA};line-height:1.7;">A. ${esc(f.a)}</dd>`
    )
    .join('')
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(product.name)} 상세페이지 초안</title></head>
<body style="margin:0;font-family:Pretendard,'Malgun Gothic',sans-serif;background:${t.bodyBg};">
  <header style="position:relative;overflow:hidden;background:${t.heroBg};color:${t.heroText};text-align:center;padding:72px 24px;">
    ${orbs}
    <div style="position:relative;z-index:1;">
      <h1 style="font-size:30px;margin:0 0 12px;">${esc(result.headline)}</h1>
      <p style="font-size:17px;opacity:.85;margin:0;">${esc(result.subheadline)}</p>
    </div>
  </header>
  ${sections}
  <section style="${cardStyle}">
    <h2 style="${headingStyle.replace('font-size:24px', 'font-size:22px')}">자주 묻는 질문</h2>
    <dl>${faq}</dl>
  </section>
  <footer style="background:${t.footerBg};padding:24px;text-align:center;font-size:12px;color:${t.footerText};">
    본 문서는 AI가 생성한 초안입니다 · 디자인 테마: ${esc(t.label)} · 디자이너 메모: ${esc(result.designer_notes)}
  </footer>
</body></html>`
}

function buildBrief(result, product, theme) {
  const lines = [
    `[상세페이지 디자인 브리프] ${product.name}`,
    '',
    `헤드라인: ${result.headline}`,
    `서브: ${result.subheadline}`,
    `디자인 테마: ${theme.label} (포인트 ${theme.accent} / 배경 ${theme.surface})`,
    `톤앤매너: ${result.designer_notes}`,
    '',
    '섹션 구성:',
    ...(result.sections || []).map((s, i) => `${i + 1}. ${s.title}\n   - 이미지: ${s.image_brief}`),
  ]
  return lines.join('\n')
}

export default function DetailPage() {
  const [form, setForm] = useState(PRODUCT_PRESETS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [versions, setVersions] = useState([])
  const [activeVer, setActiveVer] = useState(0)
  const [themeId, setThemeId] = useState('green')
  const [feedback, setFeedback] = useState('')
  const [revising, setRevising] = useState(false)
  const [viewport, setViewport] = useState('mobile')
  const [copied, setCopied] = useState('')
  const [customImage, setCustomImage] = useState(null)
  const resultRef = useRef(null)
  const imgInputRef = useRef(null)
  const navigate = useNavigate()

  const result = versions[activeVer] || null
  const theme = themeId === 'custom' && customImage ? makeCustomTheme(customImage) : getTheme(themeId)

  // 테마 카드(글래스 등)·그라데이션 제목을 미리보기에 그대로 적용하기 위한 인라인 스타일
  const cardInline = theme.card
    ? {
        background: theme.card.bg,
        borderRadius: theme.card.radius,
        border: theme.card.border,
        boxShadow: theme.card.shadow,
        backdropFilter: theme.card.blur ? `blur(${theme.card.blur}px)` : undefined,
        WebkitBackdropFilter: theme.card.blur ? `blur(${theme.card.blur}px)` : undefined,
        margin: '14px',
        borderBottom: 'none',
      }
    : undefined
  const headingInline = theme.headingClip
    ? { backgroundImage: theme.headingClip, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
    : undefined

  async function onPickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 사용할 수 있습니다.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('이미지가 너무 큽니다(8MB 이하). 작은 파일로 시도해주세요.')
      return
    }
    try {
      const dataUrl = await fileToResizedDataUrl(file)
      setCustomImage(dataUrl)
      setThemeId('custom')
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function generate(e) {
    e?.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await postJson('/api/ax/detail-page', form)
      setVersions([data])
      setActiveVer(0)
      setFeedback('')
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 현재 보고 있는 버전에 사용자 피드백을 반영한 새 버전을 만든다
  async function revise(text) {
    const fb = (text || '').trim()
    if (!fb || !result || revising) return
    setRevising(true)
    setError('')
    try {
      const data = await postJson('/api/ax/detail-page', {
        ...form,
        revision: {
          feedback: fb,
          previous: {
            headline: result.headline,
            subheadline: result.subheadline,
            sections: result.sections,
            faq: result.faq,
            designer_notes: result.designer_notes,
          },
        },
      })
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

  async function copyText(key, text) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setError('클립보드 복사에 실패했습니다. 내용을 드래그해서 복사해주세요.')
    }
  }

  function download() {
    const safeName = (form.name || '제품').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    const blob = new Blob([buildHtml(result, form, theme)], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `상세페이지_초안_${safeName}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">담당업무 B · 필수 자격요건 대응</span>
        <h1>AI 상품 상세페이지 생성기</h1>
        <p>
          제품 정보를 입력하면 상세페이지의 섹션 구조·카피·이미지 지시서를 생성합니다. 결과물은
          HTML과 디자인 브리프로 내려받아 디자이너에게 그대로 인계할 수 있습니다.
        </p>
      </header>

      <div className="tool-layout">
        <form className="tool-form" onSubmit={generate}>
          <div className="preset-row" role="group" aria-label="예시 제품 불러오기">
            {PRODUCT_PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                className={form.name === p.name ? 'preset-chip active' : 'preset-chip'}
                onClick={() => setForm(p)}
              >
                {p.name.split(' ').slice(0, 2).join(' ')}
              </button>
            ))}
            <button type="button" className="preset-chip" onClick={() => setForm(EMPTY)}>
              직접 입력
            </button>
          </div>

          <label>
            제품명 *
            <input value={form.name} onChange={set('name')} required maxLength={100} placeholder="예: 데일리 장편한 유산균 30포" />
          </label>
          <label>
            카테고리
            <input value={form.category} onChange={set('category')} maxLength={100} placeholder="예: 건강기능식품 > 프로바이오틱스" />
          </label>
          <label>
            핵심 특징 (성분·규격·인증 등)
            <textarea value={form.features} onChange={set('features')} rows={3} maxLength={500} placeholder="예: 19종 혼합 유산균, 보장균수 100억 CFU..." />
          </label>
          <label>
            타깃 고객
            <input value={form.target} onChange={set('target')} maxLength={200} placeholder="예: 출근길에 챙길 유산균을 찾는 2040 직장인" />
          </label>
          <label>
            톤앤매너
            <input value={form.tone} onChange={set('tone')} maxLength={100} placeholder="예: 신뢰감 있고 담백한 설명형" />
          </label>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '생성 중...' : '상세페이지 생성'}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>

        <div className="tool-result" ref={resultRef}>
          {!result && !loading && (
            <div className="result-empty">
              <p>왼쪽 예시 제품이 이미 채워져 있어요. 생성 버튼만 누르면 됩니다.</p>
              <p className="result-empty-sub">생성 → 모바일 미리보기 → HTML·브리프 다운로드 → 디자이너 인계 흐름을 시연합니다.</p>
            </div>
          )}
          {loading && <GenProgress steps={LOADING_STEPS} />}
          {result && !loading && (
            <>
              <ResultNotice text={result.notice} />
              <div className="result-toolbar">
                {result.demo && <DemoBadge />}
                <AdCheckBadge findings={result.ad_check} />
                <UsageNote usage={result.usage} />
                <div className="viewport-toggle" role="group" aria-label="미리보기 크기">
                  <button
                    type="button"
                    className={viewport === 'mobile' ? 'toggle-btn active' : 'toggle-btn'}
                    onClick={() => setViewport('mobile')}
                  >
                    모바일
                  </button>
                  <button
                    type="button"
                    className={viewport === 'pc' ? 'toggle-btn active' : 'toggle-btn'}
                    onClick={() => setViewport('pc')}
                  >
                    PC
                  </button>
                </div>
                <button type="button" className="btn-ghost" onClick={generate}>
                  다시 생성
                </button>
                <button type="button" className="btn-ghost" onClick={() => copyText('brief', buildBrief(result, form, theme))}>
                  {copied === 'brief' ? '복사됨 ✓' : '디자인 브리프 복사'}
                </button>
                <button type="button" className="btn-ghost" onClick={download}>
                  HTML 다운로드
                </button>
              </div>

              <div className="dp-controls">
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
                <div className="theme-row" role="group" aria-label="디자인 테마 선택">
                  <span className="theme-row-label">디자인 테마</span>
                  {DP_THEMES.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      className={t.id === themeId ? 'theme-chip active' : 'theme-chip'}
                      title={t.desc}
                      onClick={() => setThemeId(t.id)}
                    >
                      <span className="theme-dot" style={{ background: t.heroBg }} aria-hidden="true" />
                      {t.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={themeId === 'custom' ? 'theme-chip active' : 'theme-chip'}
                    title="내 이미지를 배경으로 사용 (서버 업로드 없음 — 브라우저에서만 처리)"
                    onClick={() => imgInputRef.current?.click()}
                  >
                    <span
                      className="theme-dot"
                      style={
                        customImage
                          ? { backgroundImage: `url(${customImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                          : { background: '#94a3b8' }
                      }
                      aria-hidden="true"
                    />
                    📷 내 이미지
                  </button>
                  <input ref={imgInputRef} type="file" accept="image/*" hidden onChange={onPickImage} />
                </div>
              </div>

              <div className={viewport === 'mobile' ? 'dp-frame mobile' : 'dp-frame'}>
                {viewport === 'mobile' && <div className="dp-frame-notch" aria-hidden="true" />}
                <article
                  className="dp-preview"
                  style={{
                    '--dp-surface': theme.bodyBg,
                    '--dp-heading': theme.heading,
                    '--dp-text': theme.text,
                    '--dp-brief-bg': theme.briefBg,
                    '--dp-brief-text': theme.briefText,
                    '--dp-faq-q': theme.faqQ,
                    '--dp-faq-a': theme.faqA,
                  }}
                  aria-label="상세페이지 미리보기"
                >
                  <header className="dp-hero" style={{ background: theme.heroBg, color: theme.heroText }}>
                    {(theme.orbs || []).map((o, i) => (
                      <i className="dp-orb" key={i} style={orbStyle(o)} aria-hidden="true" />
                    ))}
                    <h2>{result.headline}</h2>
                    <p>{result.subheadline}</p>
                  </header>
                  {(result.sections || []).map((s, i) => (
                    <section className="dp-section" style={cardInline} key={i}>
                      <div className="dp-section-head">
                        <h3 style={headingInline}>{s.title}</h3>
                        <button
                          type="button"
                          className="copy-mini"
                          onClick={() => copyText(`sec${i}`, `${s.title}\n${s.body}${(s.bullets || []).length ? '\n- ' + s.bullets.join('\n- ') : ''}`)}
                        >
                          {copied === `sec${i}` ? '✓' : '복사'}
                        </button>
                      </div>
                      <p>{s.body}</p>
                      {(s.bullets || []).length > 0 && (
                        <ul>
                          {s.bullets.map((b, j) => (
                            <li key={j}>{b}</li>
                          ))}
                        </ul>
                      )}
                      <p className="dp-image-brief">🎨 이미지 지시: {s.image_brief}</p>
                    </section>
                  ))}
                  {(result.faq || []).length > 0 && (
                    <section className="dp-section" style={cardInline}>
                      <h3 style={headingInline}>자주 묻는 질문</h3>
                      {result.faq.map((f, i) => (
                        <div className="dp-faq" key={i}>
                          <p className="dp-faq-q">Q. {f.q}</p>
                          <p className="dp-faq-a">A. {f.a}</p>
                        </div>
                      ))}
                    </section>
                  )}
                </article>
              </div>

              <div className="fb-box">
                <h3>AI 피드백으로 다듬기</h3>
                <p className="fb-sub">
                  바꾸고 싶은 점을 말하면 이 결과를 기억한 채로 개선판(새 버전)을 만듭니다.
                </p>
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
                    placeholder="예: 헤드라인을 더 짧게, 선물용 느낌으로 바꿔줘"
                    aria-label="피드백 입력"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        revise(feedback)
                      }
                    }}
                  />
                  <button type="button" className="btn-primary" disabled={revising || !feedback.trim()} onClick={() => revise(feedback)}>
                    {revising ? '반영 중... (10~20초)' : '피드백 반영'}
                  </button>
                </div>
                {revising && <p className="fb-status" aria-live="polite">이전 결과를 기억한 채로 피드백을 반영하고 있어요...</p>}
              </div>

              <aside className="dp-meta">
                <h3>디자이너 인계 메모</h3>
                <p>{result.designer_notes}</p>
                <h3>검색 키워드</h3>
                <div className="chip-row">
                  {(result.keywords || []).map((k) => (
                    <span className="chip" key={k}>{k}</span>
                  ))}
                </div>
              </aside>

              <div className="next-steps">
                <span className="next-steps-label">이 제품 정보 그대로 이어서:</span>
                <button type="button" className="btn-ghost" onClick={() => navigate('/content', { state: { product: form } })}>
                  채널 콘텐츠 만들기 →
                </button>
                <button type="button" className="btn-ghost" onClick={() => navigate('/listing', { state: { product: form } })}>
                  상품등록 최적화 →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
