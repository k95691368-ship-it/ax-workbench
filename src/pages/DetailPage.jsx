import { useState } from 'react'
import { postJson } from '../lib/api.js'
import { PRODUCT_PRESETS } from '../lib/presets.js'
import DemoBadge from '../components/DemoBadge.jsx'

const EMPTY = { name: '', category: '', features: '', target: '', tone: '' }

function buildHtml(result, product) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const sections = (result.sections || [])
    .map(
      (s) => `
  <section style="padding:48px 24px;max-width:720px;margin:0 auto;border-bottom:1px solid #eee;">
    <h2 style="font-size:24px;color:#14532d;">${esc(s.title)}</h2>
    <p style="font-size:16px;line-height:1.8;color:#333;">${esc(s.body)}</p>
    ${(s.bullets || []).length ? `<ul>${s.bullets.map((b) => `<li style="line-height:1.9;">${esc(b)}</li>`).join('')}</ul>` : ''}
    <p style="font-size:12px;color:#999;background:#f6f6f6;padding:8px 12px;border-radius:6px;">[이미지 지시] ${esc(s.image_brief)}</p>
  </section>`
    )
    .join('')
  const faq = (result.faq || [])
    .map((f) => `<dt style="font-weight:700;margin-top:16px;">Q. ${esc(f.q)}</dt><dd style="margin:4px 0 0;color:#444;line-height:1.7;">A. ${esc(f.a)}</dd>`)
    .join('')
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(product.name)} 상세페이지 초안</title></head>
<body style="margin:0;font-family:Pretendard,'Malgun Gothic',sans-serif;">
  <header style="background:#14532d;color:#fff;text-align:center;padding:72px 24px;">
    <h1 style="font-size:30px;margin:0 0 12px;">${esc(result.headline)}</h1>
    <p style="font-size:17px;opacity:.85;margin:0;">${esc(result.subheadline)}</p>
  </header>
  ${sections}
  <section style="padding:48px 24px;max-width:720px;margin:0 auto;">
    <h2 style="font-size:22px;">자주 묻는 질문</h2>
    <dl>${faq}</dl>
  </section>
  <footer style="background:#f6f6f6;padding:24px;text-align:center;font-size:12px;color:#888;">
    본 문서는 AI가 생성한 초안입니다 · 디자이너 메모: ${esc(result.designer_notes)}
  </footer>
</body></html>`
}

export default function DetailPage() {
  const [form, setForm] = useState(PRODUCT_PRESETS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function generate(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await postJson('/api/ax/detail-page', form)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function download() {
    const blob = new Blob([buildHtml(result, form)], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `상세페이지_초안_${form.name || '제품'}.html`
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
          HTML로 내려받아 디자이너에게 그대로 인계할 수 있습니다.
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
            {loading ? '생성 중... (10~20초)' : '상세페이지 생성'}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>

        <div className="tool-result">
          {!result && !loading && (
            <div className="result-empty">
              <p>왼쪽에서 예시 제품을 선택하거나 직접 입력한 뒤 생성 버튼을 누르세요.</p>
              <p className="result-empty-sub">생성 → 미리보기 → HTML 다운로드 → 디자이너 인계 흐름을 시연합니다.</p>
            </div>
          )}
          {loading && <div className="result-empty"><p>AI가 상세페이지 구조를 설계하고 있습니다...</p></div>}
          {result && !loading && (
            <>
              <div className="result-toolbar">
                {result.demo && <DemoBadge />}
                <button type="button" className="btn-ghost" onClick={download}>
                  HTML 다운로드 (디자이너 인계용)
                </button>
              </div>

              <article className="dp-preview" aria-label="상세페이지 미리보기">
                <header className="dp-hero">
                  <h2>{result.headline}</h2>
                  <p>{result.subheadline}</p>
                </header>
                {(result.sections || []).map((s, i) => (
                  <section className="dp-section" key={i}>
                    <h3>{s.title}</h3>
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
                  <section className="dp-section">
                    <h3>자주 묻는 질문</h3>
                    {result.faq.map((f, i) => (
                      <div className="dp-faq" key={i}>
                        <p className="dp-faq-q">Q. {f.q}</p>
                        <p className="dp-faq-a">A. {f.a}</p>
                      </div>
                    ))}
                  </section>
                )}
              </article>

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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
