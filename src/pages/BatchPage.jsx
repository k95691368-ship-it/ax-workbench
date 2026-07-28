import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { postJson } from '../lib/api.js'
import { parseProducts, rowsToProducts, productsToText, BATCH_MAX } from '../lib/batchParse.js'
import { readTabularFile, TABULAR_ACCEPT } from '../lib/tabular.js'
import { pushHistory } from '../lib/history.js'
import { violatingTargets, buildFixPayload, mergeFixed, sumUsage } from '../lib/batchFix.js'
import DemoBadge from '../components/DemoBadge.jsx'
import { BrandBadge, UsageNote, ResultNotice } from '../components/ResultMeta.jsx'
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

// 업로드 형식을 알려주기 위한 견본 (엑셀에서 그대로 열린다)
const TEMPLATE_CSV = `상품명,카테고리,특징
데일리 장편한 유산균 30포,건강기능식품 > 프로바이오틱스,19종 혼합 유산균 보장균수 100억 CFU
바삭 곱창돌김 도시락김 16봉,식품 > 김/해조류,남해안 원초 저온 2회 구이`

export default function BatchPage() {
  const [text, setText] = useState(SAMPLE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState('')
  const [fileNote, setFileNote] = useState('')
  // 요청에 실제로 보낸 상품 목록 — 입력창을 나중에 고쳐도 재생성 대상이 어긋나지 않게 보관한다
  const [sent, setSent] = useState([])
  const [fixing, setFixing] = useState(false)
  const [fixedRows, setFixedRows] = useState([])
  const [fixNote, setFixNote] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const resultRef = useRef(null)
  const fileRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()

  // 생성 이력에서 복원
  useEffect(() => {
    const entry = location.state?.restore
    if (!entry?.result) return
    if (typeof entry.input === 'string') setText(entry.input)
    setResult(entry.result)
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])

  const parsed = useMemo(() => parseProducts(text), [text])

  // 엑셀(.xlsx)·CSV를 그대로 올리면 입력창을 자동으로 채운다 — 실무자가 손으로 옮겨 적지 않도록
  async function handleFile(file) {
    if (!file) return
    setError('')
    setFileNote('')
    try {
      const rows = await readTabularFile(file)
      const { products, skipped, hasHeader } = rowsToProducts(rows)
      if (products.length === 0) {
        setError('상품명을 찾지 못했습니다. 첫 줄을 "상품명, 카테고리, 특징" 헤더로 두거나, 첫 번째 열에 상품명을 넣어주세요.')
        return
      }
      setText(productsToText(products))
      setFileNote(
        `${file.name} — 상품 ${products.length}개 인식` +
          (hasHeader ? ' (헤더 인식됨)' : ' (첫 열을 상품명으로 읽음)') +
          (skipped > 0 ? ` · 상품명이 빈 ${skipped}행 제외` : '')
      )
    } catch (err) {
      setError(err.message || '파일을 읽지 못했습니다.')
    }
  }

  function onFileInput(e) {
    const file = e.target.files?.[0]
    // 같은 파일을 다시 골라도 change가 발화하도록 값을 비운다
    e.target.value = ''
    handleFile(file)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  function downloadTemplate() {
    const blob = new Blob(['﻿' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '상품목록_양식.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

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
      setSent(parsed.products)
      setFixedRows([])
      setFixNote('')
      pushHistory({
        feature: 'batch',
        label: `${parsed.products.length}개 상품 (${parsed.products[0]?.name || ''} 외)`,
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

  // 위반이 검출된 상품만 골라 다시 생성한다 — 통과한 상품은 그대로 두므로 비용도 그만큼만 든다
  async function regenerateFlagged() {
    if (!result || fixing) return
    const targets = violatingTargets(result.results)
    if (targets.length === 0) return
    const before = targets.reduce((n, t) => n + t.violations.length, 0)
    setFixing(true)
    setError('')
    try {
      const data = await postJson('/api/ax/batch-listing', {
        products: buildFixPayload(targets, sent),
      })
      const fixedResults = Array.isArray(data.results) ? data.results : []
      const merged = mergeFixed(result.results, fixedResults, targets)
      const after = violatingTargets(merged).reduce((n, t) => n + t.violations.length, 0)
      const next = {
        ...result,
        results: merged,
        usage: sumUsage(result.usage, data.usage),
        demo: result.demo || data.demo,
        notice: data.notice || result.notice,
      }
      setResult(next)
      setFixedRows(targets.map((t) => t.index))
      setFixNote(
        after === 0
          ? `재생성 완료 — 위반 ${before}건이 모두 해소됐습니다. (${targets.length}개 상품만 다시 생성)`
          : `재생성 완료 — 위반 ${before}건 → ${after}건. 남은 건은 한 번 더 재생성하거나 사람이 확인하세요.`
      )
      pushHistory({
        feature: 'batch',
        label: `${targets.length}개 상품 재생성 (위반 ${before}건 → ${after}건)`,
        input: text,
        result: next,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setFixing(false)
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
    const header = ['원래 상품명', '최적화 상품명', '대안 상품명', '검색 키워드', '등록 태그', '생성 문구 점검', '입력 원문 점검']
    const rows = result.results.map((r) => [
      r.input_name,
      r.title,
      r.alt_title,
      (r.keywords || []).join(' '),
      (r.tags || []).join(' '),
      r.ad_check?.length ? `주의 ${r.ad_check.length}건: ${r.ad_check.map((f) => f.word).join(', ')}` : '통과',
      r.input_check?.length
        ? `원문 수정 필요 ${r.input_check.length}건: ${r.input_check.map((f) => f.word).join(', ')}`
        : '통과',
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

  // 재생성으로 해결되는 위반(생성물)과, 사람이 원문을 고쳐야 하는 위반(입력)을 구분한다
  const flagged = result ? result.results.filter((r) => r.ad_check?.length).length : 0
  const inputFlagged = result ? result.results.filter((r) => r.input_check?.length).length : 0

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">담당업무 A · 연 1,000개 상품 대응</span>
        <h1>대량 등록 도우미</h1>
        <p>
          쓰던 엑셀·CSV 파일을 올리거나 목록을 붙여넣으면, AI 호출 한 번으로 전 상품의 최적화
          상품명·키워드·태그를 일괄 생성하고 표시광고 금칙어를 자동 점검합니다. 사람은 플래그가 붙은
          상품만 확인하면 됩니다.
        </p>
      </header>

      <div className="tool-layout">
        <form className="tool-form" onSubmit={generate}>
          <div
            className={dragOver ? 'dropzone over' : 'dropzone'}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <p className="dropzone-main">엑셀(.xlsx) · CSV 파일을 여기에 끌어다 놓으세요</p>
            <p className="dropzone-sub">
              쓰던 상품 목록 파일을 그대로 올리면 아래 입력창이 자동으로 채워집니다. 파일은 브라우저
              안에서만 읽고 서버로 보내지 않습니다.
            </p>
            <div className="brand-actions" style={{ justifyContent: 'center', marginTop: 10 }}>
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                파일 선택
              </button>
              <button type="button" className="btn-ghost" onClick={downloadTemplate}>
                양식 CSV 내려받기
              </button>
            </div>
            <input ref={fileRef} type="file" accept={TABULAR_ACCEPT} hidden onChange={onFileInput} />
            {fileNote && <p className="dropzone-file">✓ {fileNote}</p>}
          </div>

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
              {parsed.products.length}개 인식됨 (포트폴리오 버전은 한 번에 최대 {BATCH_MAX}개)
            </span>
            {parsed.overflow > 0 && (
              <span className="batch-overflow">초과 {parsed.overflow}개는 이번 처리에서 제외됩니다</span>
            )}
            <button type="button" className="preset-chip" onClick={() => setText(SAMPLE)}>
              샘플 5개 채우기
            </button>
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '일괄 처리 중... (20~50초)' : `${parsed.products.length}개 상품 일괄 최적화`}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>

        <div className="tool-result" ref={resultRef}>
          {!result && !loading && (
            <div className="result-empty">
              <p>샘플 5개가 채워져 있어요. 일괄 최적화 버튼만 누르면 됩니다.</p>
              <p className="result-empty-sub">
                "하나씩 1,000번"이 아니라 "목록째 한 번에" — 반복 업무를 대체하는 AX의 핵심 기능입니다.
              </p>
            </div>
          )}
          {loading && <GenProgress steps={GEN_STEPS} />}
          {result && !loading && (
            <>
              <ResultNotice text={result.notice} />
              <div className="result-toolbar">
                {result.demo && <DemoBadge />}
                <BrandBadge applied={result.brand_applied} />
                <UsageNote usage={result.usage} />
                <button type="button" className="btn-ghost" onClick={downloadCsv}>
                  등록용 CSV 다운로드
                </button>
                {flagged > 0 && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={fixing}
                    onClick={regenerateFlagged}
                  >
                    {fixing ? '재생성 중... (20~50초)' : `위반 상품 ${flagged}개만 다시 생성`}
                  </button>
                )}
              </div>

              {fixNote && (
                <p className="form-success" role="status">
                  {fixNote}
                </p>
              )}

              {inputFlagged > 0 && (
                <p className="result-notice">
                  입력한 상품 특징에 점검 대상 표현이 있는 상품이 {inputFlagged}개 있습니다. 이 건은 다시
                  생성해도 사라지지 않으니, 원문(특징 설명)을 직접 고쳐주세요.
                </p>
              )}

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
                  <span className="stat-label">재생성으로 해결</span>
                  <span className="stat-value">
                    {flagged}개{flagged > 0 && <em className="stat-note"> 생성 문구 위반</em>}
                  </span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">원문 수정 필요</span>
                  <span className="stat-value">
                    {inputFlagged}개{inputFlagged > 0 && <em className="stat-note"> 입력한 특징에 포함</em>}
                  </span>
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
                        <td className="batch-input-name">
                          {r.input_name}
                          {fixedRows.includes(i) && <span className="row-refixed">재생성됨</span>}
                        </td>
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
