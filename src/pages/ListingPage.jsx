import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { postJson } from '../lib/api.js'
import { PRODUCT_PRESETS } from '../lib/presets.js'
import { highlightSegments } from '../lib/highlight.js'
import { scanText, BANNED_RULES } from '../lib/compliance.js'
import DemoBadge from '../components/DemoBadge.jsx'
import { AdCheckBadge, BrandBadge, FactCheckBadge, UsageNote, ResultNotice } from '../components/ResultMeta.jsx'
import { pushHistory } from '../lib/history.js'

const SAMPLE_RISKY_COPY =
  '변비 치료에 즉시 효과! 국내 1위 유일한 유산균으로 장 질병 예방과 디톡스, 독소 배출까지 한 번에. 100% 효과 보장!'

// 스캔 결과를 <mark> 하이라이트로 렌더 (구간 계산은 highlightSegments — 테스트로 고정됨)
function HighlightedText({ text, findings }) {
  const segments = highlightSegments(text, findings)
  return (
    <p className="highlight-box" aria-label="금칙어 하이라이트 미리보기">
      {segments.map((s, i) =>
        s.severity ? (
          <mark key={i} className={s.severity === 'high' ? 'mark-high' : 'mark-mid'}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </p>
  )
}

export default function ListingPage() {
  const location = useLocation()
  const [form, setForm] = useState(() => {
    const p = location.state?.product
    return p
      ? { name: p.name || '', category: p.category || '', features: p.features || '' }
      : { name: PRODUCT_PRESETS[0].name, category: PRODUCT_PRESETS[0].category, features: PRODUCT_PRESETS[0].features }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copyText, setCopyText] = useState(SAMPLE_RISKY_COPY)
  const [copiedTitle, setCopiedTitle] = useState('')

  const navigate = useNavigate()

  // 생성 이력에서 복원
  useEffect(() => {
    const entry = location.state?.restore
    if (!entry?.result) return
    if (entry.input) setForm(entry.input)
    setResult(entry.result)
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])

  const findings = useMemo(() => scanText(copyText), [copyText])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function copyTitle(t) {
    await navigator.clipboard.writeText(t)
    setCopiedTitle(t)
    setTimeout(() => setCopiedTitle(''), 1500)
  }

  async function generate(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await postJson('/api/ax/listing', form)
      // live 응답 필드 누락에 대비한 방어 (서버도 검증하지만 이중 안전망)
      for (const key of ['titles', 'search_keywords', 'tags', 'category_paths', 'compliance_notes']) {
        if (!Array.isArray(data[key])) data[key] = []
      }
      setResult(data)
      pushHistory({ feature: 'listing', label: form.name, input: form, result: data })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">담당업무 A · 상품등록/검색어 최적화</span>
        <h1>상품등록 · 검색어 최적화</h1>
        <p>
          검색최적화 상품명과 키워드·태그·카테고리를 생성하고, 건강기능식품 표시광고 금칙어를
          등록 전에 걸러냅니다. 1,000개 상품을 다루는 유통사의 등록 속도를 끌어올리는 도구입니다.
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
                onClick={() => setForm({ name: p.name, category: p.category, features: p.features })}
              >
                {p.name.split(' ').slice(0, 2).join(' ')}
              </button>
            ))}
          </div>
          <label>
            제품명 *
            <input value={form.name} onChange={set('name')} required maxLength={100} />
          </label>
          <label>
            카테고리
            <input value={form.category} onChange={set('category')} maxLength={100} />
          </label>
          <label>
            핵심 특징
            <textarea value={form.features} onChange={set('features')} rows={3} maxLength={500} />
          </label>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '분석 중...' : '상품명·키워드 최적화'}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>

        <div className="tool-result">
          {!result && !loading && (
            <div className="result-empty">
              <p>제품 정보를 입력하고 최적화 버튼을 누르세요.</p>
              <p className="result-empty-sub">상품명 후보 → 검색 키워드 → 태그 → 카테고리 → 표시광고 유의사항 순으로 제안합니다.</p>
            </div>
          )}
          {loading && <div className="result-empty"><p>검색 데이터 관점에서 상품명을 조합하는 중...</p></div>}
          {result && !loading && (
            <div className="listing-result">
              <ResultNotice text={result.notice} />
              <div className="result-toolbar">
                {result.demo && <DemoBadge />}
                <AdCheckBadge findings={result.ad_check} />
                <FactCheckBadge findings={result.fact_check} />
                <BrandBadge applied={result.brand_applied} missing={result.brand_missing} />
                <UsageNote usage={result.usage} />
              </div>
              <section>
                <h3>검색최적화 상품명 후보</h3>
                <ol className="listing-titles">
                  {result.titles.map((t) => {
                    const titleFindings = scanText(t)
                    return (
                      <li key={t}>
                        <div className="listing-title-row">
                          <span className="listing-title-text">{t}</span>
                          <span className={t.length > 50 ? 'char-count over' : 'char-count'}>
                            {t.length}/50자
                          </span>
                          <button type="button" className="copy-mini" onClick={() => copyTitle(t)}>
                            {copiedTitle === t ? '✓' : '복사'}
                          </button>
                        </div>
                        {titleFindings.length > 0 && (
                          <p className="listing-title-warn">
                            ⚠ 금칙어 재점검 필요: {titleFindings.map((f) => f.word).join(', ')}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </section>
              <section>
                <h3>검색 키워드</h3>
                <div className="chip-row">
                  {result.search_keywords.map((k) => (
                    <span className="chip" key={k}>{k}</span>
                  ))}
                </div>
              </section>
              <section>
                <h3>등록 태그</h3>
                <div className="chip-row">
                  {result.tags.map((t) => (
                    <span className="chip chip-soft" key={t}>{t}</span>
                  ))}
                </div>
              </section>
              <section>
                <h3>추천 카테고리</h3>
                <ul className="plain-list">
                  {result.category_paths.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>표시광고 유의사항</h3>
                <ul className="plain-list warn-list">
                  {result.compliance_notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </div>
      </div>

      <section className="scanner">
        <h2>표시광고 금칙어 사전점검 <span className="scanner-live">실시간 · 서버 전송 없음</span></h2>
        <p className="scanner-sub">
          상세페이지·광고 문구를 붙여넣으면 식품표시광고법 제8조 기준 위험 표현을 즉시 표시합니다.
          아래는 일부러 위반 표현을 넣은 예시 문구입니다.
        </p>
        <textarea
          className="scanner-input"
          rows={4}
          value={copyText}
          onChange={(e) => setCopyText(e.target.value)}
          aria-label="점검할 광고 문구"
        />
        {findings.length > 0 && <HighlightedText text={copyText} findings={findings} />}
        <div className="scanner-verdict">
          {findings.length === 0 ? (
            <p className="scan-ok">규칙 기반 점검에서 위험 표현이 발견되지 않았습니다. (최종 판단은 심의 기준을 따르세요)</p>
          ) : (
            <p className="scan-bad">위험 표현 {findings.length}건 발견 — 수정 후 등록하세요.</p>
          )}
        </div>
        {findings.length > 0 && (
          <table className="scan-table">
            <thead>
              <tr>
                <th>위험도</th>
                <th>표현</th>
                <th>분류</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f, i) => (
                <tr key={i}>
                  <td>
                    <span className={f.severity === 'high' ? 'sev sev-high' : 'sev sev-mid'}>
                      {f.severity === 'high' ? '높음' : '주의'}
                    </span>
                  </td>
                  <td className="scan-word">{f.word}</td>
                  <td>{f.label}</td>
                  <td className="scan-reason">{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <details className="scanner-rules">
          <summary>점검 규칙 보기 ({BANNED_RULES.length}개 분류)</summary>
          <ul className="plain-list">
            {BANNED_RULES.map((r) => (
              <li key={r.id}>
                <strong>{r.label}</strong> — {r.reason}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  )
}
