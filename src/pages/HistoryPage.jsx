import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FEATURES,
  listHistory,
  removeHistory,
  clearHistory,
  subscribeHistory,
  formatWhen,
} from '../lib/history.js'

const PRICE = { input: 5 / 1_000_000, output: 25 / 1_000_000 }

export default function HistoryPage() {
  const [entries, setEntries] = useState(() => listHistory())
  const [filter, setFilter] = useState('all')
  const navigate = useNavigate()

  useEffect(() => subscribeHistory(() => setEntries(listHistory())), [])

  const shown = filter === 'all' ? entries : entries.filter((e) => e.feature === filter)
  const used = [...new Set(entries.map((e) => e.feature))]

  const totals = entries.reduce(
    (acc, e) => {
      acc.count += 1
      acc.violations += e.violations || 0
      if (e.usage) {
        acc.cost += (e.usage.input_tokens || 0) * PRICE.input + (e.usage.output_tokens || 0) * PRICE.output
      }
      return acc
    },
    { count: 0, violations: 0, cost: 0 }
  )

  function restore(entry) {
    const path = FEATURES[entry.feature]?.path
    if (!path) return
    navigate(path, { state: { restore: entry } })
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '생성이력.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">전 기능 공통 · 운영 기록</span>
        <h1>생성 이력</h1>
        <p>
          최근에 만든 결과를 최대 20건까지 보관합니다. <strong>[그때 결과 불러오기]</strong>를 누르면
          입력과 결과가 그대로 복원되어, 다시 만들지 않고도 이전 버전으로 되돌아갈 수 있습니다.
          이력은 이 브라우저에만 저장됩니다.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="result-empty">
          <p>아직 이력이 없습니다.</p>
          <p className="result-empty-sub">
            기능에서 결과를 한 번 만들면 여기에 자동으로 쌓입니다. <Link to="/onboard">원클릭 온보딩</Link>부터
            시작해 보세요.
          </p>
        </div>
      ) : (
        <>
          <div className="stat-row batch-summary">
            <div className="stat-tile">
              <span className="stat-label">보관된 생성</span>
              <span className="stat-value">{totals.count}건</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">검출된 규정 위반</span>
              <span className="stat-value">{totals.violations}건</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">누적 추정 비용</span>
              <span className="stat-value">${totals.cost.toFixed(3)}</span>
            </div>
          </div>

          <div className="sales-actions">
            <div className="filter-chips" role="group" aria-label="기능 필터">
              <button
                type="button"
                className={filter === 'all' ? 'preset-chip active' : 'preset-chip'}
                onClick={() => setFilter('all')}
              >
                전체
              </button>
              {used.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={filter === f ? 'preset-chip active' : 'preset-chip'}
                  onClick={() => setFilter(f)}
                >
                  {FEATURES[f]?.label || f}
                </button>
              ))}
            </div>
            <button type="button" className="btn-ghost" onClick={exportAll}>
              이력 내보내기 (.json)
            </button>
            <button type="button" className="btn-ghost" onClick={clearHistory}>
              전체 비우기
            </button>
          </div>

          <div className="req-table-wrap">
            <table className="req-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>기능</th>
                  <th>대상</th>
                  <th>점검</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td className="hist-when">{formatWhen(e.ts)}</td>
                    <td>
                      <span className="chip">{FEATURES[e.feature]?.label || e.feature}</span>
                      {e.demo && <span className="hist-demo"> 예시</span>}
                    </td>
                    <td className="hist-label">{e.label || '(제목 없음)'}</td>
                    <td>
                      {e.violations > 0 ? (
                        <span className="sev sev-high">⚠ {e.violations}건</span>
                      ) : (
                        <span className="sev sev-ok">✓ 통과</span>
                      )}
                    </td>
                    <td>
                      <div className="hist-actions">
                        <button type="button" className="copy-mini" onClick={() => restore(e)}>
                          그때 결과 불러오기
                        </button>
                        <button type="button" className="copy-mini" onClick={() => removeHistory(e.id)}>
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
