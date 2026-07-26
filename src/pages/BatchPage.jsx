import { useMemo, useRef, useState } from 'react'
import { postJson } from '../lib/api.js'
import { parseProducts, BATCH_MAX } from '../lib/batchParse.js'
import DemoBadge from '../components/DemoBadge.jsx'
import { UsageNote, ResultNotice } from '../components/ResultMeta.jsx'
import GenProgress from '../components/GenProgress.jsx'

const GEN_STEPS = [
  '상품 목록을 해석하고 있어요',
  '상품별 검색 키워드를 조합하고 있어요',
  '상품명을 일괄 최적화하고 있어요',
  '표시광고 금칙어를 점검하고 있어요',
]

const SAMPLE = `데일리 장편한 유산균 30포 | 건강기능식품 > 프로바이오틱스 | 19종 혼합 유산균, 보장균수 100억 CFU, 아연 함유
바삭 곱창돌김 도시락김 16봉 | 식품 > 김/해조류 | 남해안 원초, 저온 2회 구이, 들기름+참기름
멀티비타 올인원 츄어블 60정 | 건강기능식품 > 비타민 | 비타민 12종, 하루 1정, 오렌지맛
고소한 아침 검은콩 두유 24팩 | 식품 > 음료 | 국산 검은콩, 무설탕, 190ml 팩
탱탱 저분자 콜라겐 젤리 30포 | 건강기능식품 > 콜라겐 | 저분자 피쉬콜라겐 3000mg, 복숭아맛`

const csvEsc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`

export default function BatchPage() {
  const [text, setText] = useState(SAMPLE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState('')
  const resultRef = useRef(null)

  const parsed = useMemo(() => parseProducts(text), [text])

  async function generate(e) {
    e.preventDefault()
    if (parsed.products.length === 0) {
      setError('상품을 1개 이상 입력해주세요. (한 줄에 하나)')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await postJson('/api/ax/batch-listing', { products: parsed.products })
      data.results = Array.isArray(data.results) ? data.results : []
      setResult(data)
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function copyTitle(i, title) {
    try {
      await navigator.clipboard.writeText(title)
      setCopied(`t${i}`)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setError('클립보드 복사에 실패했습니다.')
    }
  }

  function downloadCsv() {
    const header = ['원래 상품명', '최적화 상품명', '대안 상품명', '검색 키워드', '등록 태그', '표시광고 점검']
    const rows = result.results.map((r) => [
      r.input_name,
      r.title,
      r.alt_title,
      (r.keywords || []).join(' '),
      (r.tags || []).join(' '),
      r.ad_check?.length ? `주의 ${r.ad_check.length}건: ${r.ad_check.map((f) => f.word).join(', ')}` : '통과',
    ])
    const csv = '﻿' + [header, ...rows].map((row) => row.map(csvEsc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '대량등록_결과.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const flagged = result ? result.results.filter((r) => r.ad_check?.length).length : 0

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">담당업무 A · 연 1,000개 상품 대응</span>
        <h1>대량 등록 도우미</h1>
        <p>
          신상품 목록을 붙여넣으면 AI 호출 한 번으로 전 상품의 최적화 상품명·키워드·태그를 일괄
          생성하고, 표시광고 금칙어를 자동 점검합니다. 사람은 플래그가 붙은 상품만 확인하면 됩니다.
        </p>
      </header>

      <div className="tool-layout">
        <form className="tool-form" onSubmit={generate}>
          <label>
            상품 목록 — 한 줄에 하나, <code>상품명 | 카테고리 | 특징</code> (카테고리·특징 생략 가능)
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              placeholder={'예)\n데일리 장편한 유산균 30포 | 건강기능식품 | 19종 유산균'}
            />
          </label>
          <div className="batch-meta">
            <span className={parsed.products.length > 0 ? 'batch-count ok' : 'batch-count'}>
              {parsed.products.length}개 인식됨 (데모는 한 번에 최대 {BATCH_MAX}개)
            </span>
            {parsed.overflow > 0 && (
              <span className="batch-overflow">초과 {parsed.overflow}개는 이번 처리에서 제외됩니다</span>
            )}
            <button type="button" className="preset-chip" onClick={() => setText(SAMPLE)}>
              샘플 5개 채우기
            </button>
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '일괄 처리 중... (15~30초)' : `${parsed.products.length}개 상품 일괄 최적화`}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>

        <div className="tool-result" ref={resultRef}>
          {!result && !loading && (
            <div className="result-empty">
              <p>샘플 5개가 채워져 있어요. 일괄 최적화 버튼만 누르면 됩니다.</p>
              <p className="result-empty-sub">
                "하나씩 1,000번"이 아니라 "목록째 한 번에" — 반복 업무를 대체하는 AX의 핵심 데모입니다.
              </p>
            </div>
          )}
          {loading && <GenProgress steps={GEN_STEPS} />}
          {result && !loading && (
            <>
              <ResultNotice text={result.notice} />
              <div className="result-toolbar">
                {result.demo && <DemoBadge />}
                <UsageNote usage={result.usage} />
                <button type="button" className="btn-ghost" onClick={downloadCsv}>
                  등록용 CSV 다운로드
                </button>
              </div>

              <div className="stat-row batch-summary">
                <div className="stat-tile">
                  <span className="stat-label">처리 상품</span>
                  <span className="stat-value">{result.results.length}개</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">자동 통과</span>
                  <span className="stat-value">{result.results.length - flagged}개</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">사람 확인 필요</span>
                  <span className="stat-value">{flagged}개{flagged > 0 && <em className="stat-note"> 금칙어 검출</em>}</span>
                </div>
              </div>

              <div className="req-table-wrap">
                <table className="req-table batch-table">
                  <thead>
                    <tr>
                      <th>입력 상품명</th>
                      <th>최적화 상품명</th>
                      <th>키워드 · 태그</th>
                      <th>점검</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((r, i) => (
                      <tr key={i} className={r.ad_check?.length ? 'batch-row-flagged' : ''}>
                        <td className="batch-input-name">{r.input_name}</td>
                        <td>
                          <div className="batch-title-cell">
                            <strong>{r.title}</strong>
                            <button type="button" className="copy-mini" onClick={() => copyTitle(i, r.title)}>
                              {copied === `t${i}` ? '✓' : '복사'}
                            </button>
                          </div>
                          <span className="batch-alt">대안: {r.alt_title}</span>
                        </td>
                        <td>
                          <div className="chip-row batch-chips">
                            {(r.keywords || []).map((k) => (
                              <span className="chip" key={`k${k}`}>{k}</span>
                            ))}
                            {(r.tags || []).map((t) => (
                              <span className="chip chip-soft" key={`t${t}`}>{t}</span>
                            ))}
                          </div>
                        </td>
                        <td>
                          {r.ad_check?.length ? (
                            <span
                              className="sev sev-high"
                              title={r.ad_check.map((f) => `${f.word} — ${f.label}`).join('\n')}
                            >
                              ⚠ {r.ad_check.length}건
                            </span>
                          ) : (
                            <span className="sev sev-ok">✓ 통과</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
