import { useMemo, useRef, useState } from 'react'
import { postJson } from '../lib/api.js'
import { parseCsv, normalizeSales, aggregate, weekdayAverages, decodeCsvBuffer } from '../lib/csv.js'
import { SAMPLE_CSV } from '../lib/sampleSales.js'
import DemoBadge from '../components/DemoBadge.jsx'

const fmt = (n) => Math.round(n).toLocaleString('ko-KR')

function buildReportMd(report, period, channel) {
  return [
    `# 주간 매출 리포트 (${period})`,
    channel !== 'all' ? `> 채널: ${channel}` : '> 채널: 전체',
    '',
    `## ${report.headline || '주간 리포트'}`,
    report.summary || '',
    '',
    '## 인사이트',
    ...(report.insights || []).map((s) => `- ${s}`),
    '',
    '## 이번 주 실행 제안',
    ...(report.actions || []).map((s) => `- ${s}`),
    '',
    '## 리스크',
    ...(report.risks || []).map((s) => `- ${s}`),
  ].join('\n')
}

function DailyBarChart({ byDate, anomalies }) {
  const [hover, setHover] = useState(null)
  const anomalyMap = useMemo(() => new Map(anomalies.map((a) => [a.date, a])), [anomalies])
  const W = 640
  const H = 220
  const pad = { top: 16, right: 8, bottom: 28, left: 56 }
  const max = Math.max(...byDate.map(([, v]) => v))
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom
  const gap = 2
  const barW = Math.max(4, innerW / byDate.length - gap)
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t))

  return (
    <figure className="viz-figure">
      <figcaption>일별 매출 추이</figcaption>
      <div className="viz-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="일별 매출 막대 차트" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => {
            const y = pad.top + innerH - (max ? (t / max) * innerH : 0)
            return (
              <g key={t}>
                <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="#e1e0d9" strokeWidth="1" />
                <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#898781">
                  {t >= 10000 ? `${fmt(t / 10000)}만` : fmt(t)}
                </text>
              </g>
            )
          })}
          {byDate.map(([date, value], i) => {
            const h = max ? (value / max) * innerH : 0
            const x = pad.left + i * (innerW / byDate.length) + gap / 2
            const y = pad.top + innerH - h
            const anomaly = anomalyMap.get(date)
            return (
              <g key={date}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(h, 1)}
                  rx="4"
                  ry="4"
                  fill="#2a78d6"
                  opacity={hover && hover.date !== date ? 0.45 : 1}
                  onMouseEnter={() => setHover({ date, value, x: x + barW / 2, y })}
                />
                {anomaly && (
                  <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="11" fill={anomaly.direction === 'spike' ? '#006300' : '#d03b3b'}>
                    {anomaly.direction === 'spike' ? '▲' : '▼'}
                  </text>
                )}
                {(i === 0 || i === byDate.length - 1 || i % Math.ceil(byDate.length / 6) === 0) && (
                  <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#898781">
                    {date.slice(5)}
                  </text>
                )}
              </g>
            )
          })}
          <line x1={pad.left} x2={W - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="#c3c2b7" strokeWidth="1" />
        </svg>
        {hover && (
          <div className="viz-tooltip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
            <strong>{hover.date}</strong>
            <span>{fmt(hover.value)}원</span>
            {anomalyMap.get(hover.date) && (
              <span className={anomalyMap.get(hover.date).direction === 'spike' ? 'tip-up' : 'tip-down'}>
                {anomalyMap.get(hover.date).direction === 'spike' ? '▲ 급증' : '▼ 급감'}
                {anomalyMap.get(hover.date).ratio != null && ` (일평균의 ${anomalyMap.get(hover.date).ratio}%)`}
              </span>
            )}
          </div>
        )}
      </div>
    </figure>
  )
}

function RankBars({ title, data, total }) {
  const top = data.slice(0, 6)
  const max = top.length ? Math.max(...top.map(([, v]) => v)) : 0
  return (
    <figure className="viz-figure">
      <figcaption>{title}</figcaption>
      <div className="rank-bars">
        {top.map(([label, value]) => (
          <div className="rank-row" key={label} title={`${label}: ${fmt(value)}원`}>
            <span className="rank-label">{label}</span>
            <span className="rank-track">
              <span className="rank-fill" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
            </span>
            <span className="rank-value">
              {fmt(value)}원{total ? <em> ({Math.round((value / total) * 100)}%)</em> : null}
            </span>
          </div>
        ))}
      </div>
    </figure>
  )
}

export default function SalesPage() {
  const [records, setRecords] = useState(null)
  const [channel, setChannel] = useState('all')
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [copiedMd, setCopiedMd] = useState(false)
  const fileRef = useRef(null)
  const channelRef = useRef('all')

  const channels = useMemo(
    () => (records ? [...new Set(records.map((r) => r.channel))].sort() : []),
    [records]
  )
  const filtered = useMemo(
    () => (records && channel !== 'all' ? records.filter((r) => r.channel === channel) : records),
    [records, channel]
  )
  const summary = useMemo(() => (filtered?.length ? aggregate(filtered) : null), [filtered])
  const weekdays = useMemo(() => (summary ? weekdayAverages(summary.byDate) : []), [summary])
  const period = summary
    ? `${summary.byDate[0][0]} ~ ${summary.byDate[summary.byDate.length - 1][0]}`
    : ''

  function loadText(text) {
    setError('')
    setReport(null)
    setChannel('all')
    channelRef.current = 'all'
    try {
      setRecords(normalizeSales(parseCsv(text)))
    } catch (err) {
      setRecords(null)
      setError(err.message)
    }
  }

  function pickChannel(c) {
    setChannel(c)
    channelRef.current = c
    setReport(null)
  }

  async function copyReportMd() {
    await navigator.clipboard.writeText(buildReportMd(report, period, channel))
    setCopiedMd(true)
    setTimeout(() => setCopiedMd(false), 1500)
  }

  function downloadReportMd() {
    const blob = new Blob([buildReportMd(report, period, channel)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `주간리포트_${period.replace(/\s/g, '')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function onFile(e) {
    const file = e.target.files?.[0]
    // 같은 파일을 다시 선택해도 change가 발화하도록 value를 비워둔다
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    // ArrayBuffer로 읽어 UTF-8/CP949(한국 Excel 기본)를 자동 판별해 디코딩
    reader.onload = () => loadText(decodeCsvBuffer(reader.result))
    reader.onerror = () => setError('파일을 읽지 못했습니다. 다시 시도해주세요.')
    reader.readAsArrayBuffer(file)
  }

  function downloadSample() {
    const blob = new Blob(['﻿' + SAMPLE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '샘플_판매데이터.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function makeReport() {
    setLoading(true)
    setError('')
    const scope = channel
    try {
      const data = await postJson('/api/ax/sales-report', { summary })
      // 응답 대기 중 필터가 바뀌었으면 다른 범위의 리포트이므로 버린다
      setReport((prev) => (scope === channelRef.current ? data : prev))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">담당업무 A · 매출분석/판매통계 자동화</span>
        <h1>매출 리포트 자동화</h1>
        <p>
          판매 CSV를 올리면 브라우저에서 즉시 집계·시각화합니다(원본 데이터는 서버로 전송되지
          않습니다). 이어서 AI가 인사이트·실행 제안이 담긴 주간 리포트를 작성합니다.
        </p>
      </header>

      <div className="sales-actions">
        <button type="button" className="btn-primary" onClick={() => loadText(SAMPLE_CSV)}>
          샘플 데이터로 바로 보기
        </button>
        <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
          내 CSV 업로드
        </button>
        <button type="button" className="btn-ghost" onClick={downloadSample}>
          샘플 CSV 내려받기
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
        <span className="sales-hint">필요 컬럼: 날짜, 채널, 상품명, 수량, 매출액</span>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      {summary && (
        <>
          <div className="sales-filterbar">
            <div className="filter-chips" role="group" aria-label="채널 필터">
              <button
                type="button"
                className={channel === 'all' ? 'preset-chip active' : 'preset-chip'}
                onClick={() => pickChannel('all')}
              >
                전체 채널
              </button>
              {channels.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={channel === c ? 'preset-chip active' : 'preset-chip'}
                  onClick={() => pickChannel(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <span className="sales-period">조회 기간: {period}</span>
          </div>

          <div className="stat-row">
            <div className="stat-tile">
              <span className="stat-label">총매출</span>
              <span className="stat-value">{fmt(summary.totalAmount)}원</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">판매 수량</span>
              <span className="stat-value">{fmt(summary.totalQty)}개</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">일평균 매출</span>
              <span className="stat-value">{fmt(summary.dailyAvg)}원</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">이상 감지</span>
              <span className="stat-value">
                {summary.anomalies.length}건
                {summary.anomalies.length > 0 && <em className="stat-note"> ±50% 초과 변동일</em>}
              </span>
            </div>
          </div>

          <DailyBarChart byDate={summary.byDate} anomalies={summary.anomalies} />
          <div className="viz-pair">
            <RankBars title="채널별 매출" data={summary.byChannel} total={summary.totalAmount} />
            <RankBars title="상품별 매출 TOP" data={summary.byProduct} total={summary.totalAmount} />
          </div>
          {weekdays.length > 1 && (
            <RankBars title="요일별 하루 평균 매출 (월~일)" data={weekdays} total={0} />
          )}

          <details className="viz-table">
            <summary>집계 데이터 표로 보기</summary>
            <table>
              <thead>
                <tr><th>날짜</th><th>매출액(원)</th></tr>
              </thead>
              <tbody>
                {summary.byDate.map(([d, v]) => (
                  <tr key={d}><td>{d}</td><td>{fmt(v)}</td></tr>
                ))}
              </tbody>
            </table>
          </details>

          <div className="report-cta">
            <button type="button" className="btn-primary" onClick={makeReport} disabled={loading}>
              {loading ? '리포트 작성 중...' : 'AI 주간 리포트 작성'}
            </button>
          </div>
        </>
      )}

      {report && (
        <article className="report-card">
          <div className="result-toolbar">
            {report.demo && <DemoBadge />}
            <button type="button" className="btn-ghost" onClick={copyReportMd}>
              {copiedMd ? '복사됨 ✓' : '마크다운 복사'}
            </button>
            <button type="button" className="btn-ghost" onClick={downloadReportMd}>
              .md 다운로드
            </button>
          </div>
          <h2>{report.headline}</h2>
          <p className="report-summary">{report.summary}</p>
          <div className="report-grid">
            <section>
              <h3>인사이트</h3>
              <ul className="plain-list">
                {(report.insights || []).map((s) => <li key={s}>{s}</li>)}
              </ul>
            </section>
            <section>
              <h3>이번 주 실행 제안</h3>
              <ul className="plain-list">
                {(report.actions || []).map((s) => <li key={s}>{s}</li>)}
              </ul>
            </section>
            <section>
              <h3>리스크</h3>
              <ul className="plain-list warn-list">
                {(report.risks || []).map((s) => <li key={s}>{s}</li>)}
              </ul>
            </section>
          </div>
        </article>
      )}

      {!summary && !error && (
        <div className="result-empty sales-empty">
          <p>아직 데이터가 없습니다. "샘플 데이터로 바로 보기"를 눌러 흐름을 확인해 보세요.</p>
          <p className="result-empty-sub">샘플에는 프로모션 급증일(7/18)과 품절 급감일(7/21)이 들어 있어 이상 감지 기능을 확인할 수 있습니다.</p>
        </div>
      )}
    </div>
  )
}
