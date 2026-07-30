import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { postJson } from '../lib/api.js'
import { PRODUCT_PRESETS, CHANNELS } from '../lib/presets.js'
import { getTheme } from '../lib/themes.js'
import { buildHtml, buildBrief, downloadFile, safeFileName } from '../lib/detailHtml.js'
import DemoBadge from '../components/DemoBadge.jsx'
import { BrandBadge, UsageNote, ResultNotice } from '../components/ResultMeta.jsx'
import { pushHistory } from '../lib/history.js'

const EMPTY = { name: '', category: '', features: '', target: '', tone: '' }

// 신상품 1개 온보딩에 필요한 세 갈래 작업 — 서로 독립적이라 동시에 돌린다
const LANES = [
  { id: 'detail', label: '상세페이지', desc: '섹션 구조 · 카피 · 이미지 지시서' },
  { id: 'listing', label: '상품등록 정보', desc: '검색최적화 상품명 · 키워드 · 태그' },
  { id: 'content', label: '채널 콘텐츠', desc: '인스타 · 카드뉴스 · 유튜브 쇼츠' },
]

const INIT_TASKS = { detail: { status: 'idle' }, listing: { status: 'idle' }, content: { status: 'idle' } }
const CHANNELS_USED = ['instagram', 'cardnews', 'youtube']

const csvEsc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`

export default function OnboardPage() {
  const [form, setForm] = useState(PRODUCT_PRESETS[0])
  const [tasks, setTasks] = useState(INIT_TASKS)
  // 이 결과를 만든 입력의 스냅샷. 결과는 실행 시점에 고정되는데 다운로드가 최신 form을
  // 읽으면 "새 입력 + 옛 결과"가 섞인 산출물이 나온다 — 등록용 CSV의 '제품명' 열과
  // '최적화 상품명'이 서로 다른 상품이 되는, 그대로 오픈마켓에 올리면 사고가 되는 조합이다.
  // 생성 중 편집만의 문제가 아니라 완료 후 프리셋 칩을 눌러도 같은 일이 생긴다.
  const [ranForm, setRanForm] = useState(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const resultRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()

  // 생성 이력에서 복원 — 세 레인의 결과를 완료 상태로 되살린다
  useEffect(() => {
    const entry = location.state?.restore
    const r = entry?.result
    if (!r) return
    if (entry.input) setForm(entry.input)
    setRanForm(entry.input || null)
    // 결과가 없는 레인은 'idle'이 아니라 '그때 생성되지 않았음'이다.
    // idle로 되살리면 (a) 사실과 다르고, (b) 결과 영역 게이트가 닫혀 함께 저장된
    // 나머지 두 레인의 결과·다운로드에 접근할 방법이 사라진다.
    const lane = (data) =>
      data ? { status: 'done', data } : { status: 'error', error: '이 실행에서는 생성되지 않았습니다' }
    setTasks({ detail: lane(r.detail), listing: lane(r.listing), content: lane(r.content) })
    setDone(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const detail = tasks.detail.data
  const listing = tasks.listing.data
  const content = tasks.content.data

  async function runAll(e) {
    e?.preventDefault()
    if (running) return
    // 이 실행에 실제로 보낸 입력을 고정한다 — 결과 표시와 다운로드는 모두 이 값을 쓴다
    const sent = { ...form }
    setRanForm(sent)
    setRunning(true)
    setDone(false)
    setTasks({
      detail: { status: 'running' },
      listing: { status: 'running' },
      content: { status: 'running' },
    })

    // 각 작업이 끝나는 대로 해당 레인만 갱신 — 하나가 느려도 나머지는 먼저 보인다
    const start = (id, promise) =>
      promise
        .then((data) => {
          setTasks((t) => ({ ...t, [id]: { status: 'done', data } }))
          return data
        })
        .catch((err) => {
          setTasks((t) => ({ ...t, [id]: { status: 'error', error: err.message } }))
          return null
        })

    const jobs = [
      start('detail', postJson('/api/ax/detail-page', sent)),
      start(
        'listing',
        postJson('/api/ax/listing', { name: sent.name, category: sent.category, features: sent.features })
      ),
      start('content', postJson('/api/ax/content', { product: sent, channels: CHANNELS_USED })),
    ]

    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    const [d, l, c] = await Promise.all(jobs)
    setRunning(false)
    setDone(true)

    // 세 결과를 한 묶음으로 이력에 남긴다 (되돌리면 세 레인이 함께 복원된다)
    if (d || l || c) {
      const usage = [d?.usage, l?.usage, c?.usage].filter(Boolean).reduce(
        (acc, u) => ({
          input_tokens: acc.input_tokens + (u.input_tokens || 0),
          output_tokens: acc.output_tokens + (u.output_tokens || 0),
        }),
        { input_tokens: 0, output_tokens: 0 }
      )
      pushHistory({
        feature: 'onboard',
        label: sent.name,
        input: sent,
        result: {
          detail: d || null,
          listing: l || null,
          content: c || null,
          demo: Boolean(d?.demo || l?.demo || c?.demo),
          usage,
        },
      })
    }
  }

  // 세 결과의 금칙어 검출을 한데 모은다 (사람이 확인할 항목)
  const flags = []
  if (detail?.ad_check?.length) flags.push(...detail.ad_check.map((f) => ({ ...f, from: '상세페이지' })))
  if (listing?.ad_check?.length) flags.push(...listing.ad_check.map((f) => ({ ...f, from: '상품등록' })))
  for (const r of content?.results || []) {
    if (r.ad_check?.length) flags.push(...r.ad_check.map((f) => ({ ...f, from: `콘텐츠(${r.channel})` })))
  }

  const totalUsage = [detail?.usage, listing?.usage, content?.usage].filter(Boolean).reduce(
    (acc, u) => ({
      input_tokens: acc.input_tokens + (u.input_tokens || 0),
      output_tokens: acc.output_tokens + (u.output_tokens || 0),
    }),
    { input_tokens: 0, output_tokens: 0 }
  )
  const hasUsage = totalUsage.input_tokens > 0 || totalUsage.output_tokens > 0
  const isDemo = Boolean(detail?.demo || listing?.demo || content?.demo)

  const outputCount =
    (detail ? (detail.sections?.length || 0) + (detail.faq?.length || 0) + 2 : 0) +
    (listing ? (listing.titles?.length || 0) + (listing.tags?.length || 0) : 0) +
    (content?.results?.length || 0)

  // 다운로드·미리보기가 쓰는 입력 = 결과를 만든 그 입력 (최신 입력창이 아니다)
  const outForm = ranForm || form

  function downloadHtml() {
    downloadFile(
      `상세페이지_${safeFileName(outForm.name)}.html`,
      buildHtml(detail, outForm, getTheme('green')),
      'text/html;charset=utf-8'
    )
  }

  function downloadCsv() {
    const header = ['제품명', '최적화 상품명', '검색 키워드', '등록 태그', '추천 카테고리']
    const rows = (listing.titles || []).map((t, i) => [
      i === 0 ? outForm.name : '',
      t,
      i === 0 ? (listing.search_keywords || []).join(' ') : '',
      i === 0 ? (listing.tags || []).join(' ') : '',
      i === 0 ? (listing.category_paths || [])[0] || '' : '',
    ])
    const csv = '﻿' + [header, ...rows].map((r) => r.map(csvEsc).join(',')).join('\n')
    downloadFile(`상품등록_${safeFileName(outForm.name)}.csv`, csv, 'text/csv;charset=utf-8')
  }

  function downloadPackage() {
    const channelLabel = (id) => CHANNELS.find((c) => c.id === id)?.label || id
    const lines = [
      `# 신상품 온보딩 패키지 — ${outForm.name}`,
      '',
      `- 카테고리: ${outForm.category || '-'}`,
      `- 핵심 특징: ${outForm.features || '-'}`,
      `- 타깃: ${outForm.target || '-'}`,
      '',
      '---',
      '',
      '## 1. 상세페이지',
    ]
    if (detail) {
      lines.push(
        '',
        `**헤드라인**: ${detail.headline}`,
        `**서브카피**: ${detail.subheadline}`,
        '',
        ...(detail.sections || []).flatMap((s) => [
          `### ${s.title}`,
          s.body,
          ...(s.bullets || []).map((b) => `- ${b}`),
          `> 이미지 지시: ${s.image_brief}`,
          '',
        ]),
        '### 자주 묻는 질문',
        ...(detail.faq || []).flatMap((f) => [`**Q. ${f.q}**`, `A. ${f.a}`, '']),
        '### 디자이너 인계',
        buildBrief(detail, outForm, getTheme('green')),
        ''
      )
    } else {
      lines.push('', '(생성 실패)', '')
    }

    lines.push('---', '', '## 2. 상품등록 정보')
    if (listing) {
      lines.push(
        '',
        '**상품명 후보**',
        ...(listing.titles || []).map((t, i) => `${i + 1}. ${t} (${t.length}자)`),
        '',
        `**검색 키워드**: ${(listing.search_keywords || []).join(', ')}`,
        `**등록 태그**: ${(listing.tags || []).join(', ')}`,
        `**추천 카테고리**: ${(listing.category_paths || []).join(' / ')}`,
        '',
        '**표시광고 유의사항**',
        ...(listing.compliance_notes || []).map((n) => `- ${n}`),
        ''
      )
    } else {
      lines.push('', '(생성 실패)', '')
    }

    lines.push('---', '', '## 3. 채널 콘텐츠')
    for (const r of content?.results || []) {
      lines.push(
        '',
        `### ${channelLabel(r.channel)}`,
        `**${r.title}**`,
        '',
        r.body,
        ...(r.hashtags?.length ? ['', r.hashtags.map((h) => `#${h}`).join(' ')] : []),
        ''
      )
    }

    lines.push(
      '---',
      '',
      '## 4. 표시광고 자동 점검',
      '',
      flags.length === 0
        ? '전 산출물에서 금칙어가 검출되지 않았습니다. (규칙 기반 점검 — 최종 판단은 심의 기준을 따르세요)'
        : `사람 확인이 필요한 표현 ${flags.length}건:`,
      ...flags.map((f) => `- [${f.from}] "${f.word}" — ${f.label}: ${f.reason}`),
      '',
      '---',
      '',
      `생성: Claude Opus 5${hasUsage ? ` · 입력 ${totalUsage.input_tokens.toLocaleString('ko-KR')} · 출력 ${totalUsage.output_tokens.toLocaleString('ko-KR')} 토큰` : ''}`,
      '본 문서는 AI가 생성한 초안입니다. 발행 전 담당자 검수가 필요합니다.'
    )
    downloadFile(`온보딩패키지_${safeFileName(outForm.name)}.md`, lines.join('\n'), 'text/markdown;charset=utf-8')
  }

  const anyResult = detail || listing || content
  // 결과 영역은 세 레인 전체를 보고 열어야 한다. 예전에는 detail 한 레인만 보았기 때문에
  // 상세페이지가 실패한 이력을 복원하면 (detail이 idle) 함께 저장된 상품등록·콘텐츠 결과와
  // 다운로드 버튼이 통째로 렌더되지 않고 초기 안내만 떴다.
  const started = Object.values(tasks).some((t) => t.status !== 'idle')
  // 결과를 만든 입력과 지금 입력창이 어긋났는지 — 다운로드 전에 알려준다
  const formChanged = Boolean(
    ranForm && anyResult && ['name', 'category', 'features', 'target'].some((k) => (ranForm[k] || '') !== (form[k] || ''))
  )

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">담당업무 A·B 통합 · 신상품 온보딩 파이프라인</span>
        <h1>신상품 원클릭 온보딩</h1>
        <p>
          제품 정보를 <strong>한 번만</strong> 입력하면 상세페이지·상품등록 정보·채널 콘텐츠를 동시에
          생성하고, 표시광고 점검까지 마친 <strong>작업 패키지</strong>로 묶어 드립니다. 도구를 옮겨
          다니며 같은 정보를 다시 입력하는 일 자체를 없앤 기능입니다.
        </p>
      </header>

      <div className="tool-layout">
        <form className="tool-form" onSubmit={runAll}>
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
            <input value={form.name} onChange={set('name')} required maxLength={100} />
          </label>
          <label>
            카테고리
            <input value={form.category} onChange={set('category')} maxLength={100} />
          </label>
          <label>
            핵심 특징 (성분·규격·인증 등)
            <textarea value={form.features} onChange={set('features')} rows={3} maxLength={500} />
          </label>
          <label>
            타깃 고객
            <input value={form.target} onChange={set('target')} maxLength={200} />
          </label>
          <label>
            톤앤매너
            <input value={form.tone} onChange={set('tone')} maxLength={100} />
          </label>

          <button type="submit" className="btn-primary" disabled={running}>
            {running ? '온보딩 진행 중... (30~70초)' : '온보딩 패키지 생성'}
          </button>
          <p className="onboard-cost-note">
            한 번 실행에 AI 호출 3회가 동시에 발생합니다 (상세페이지 · 상품등록 · 콘텐츠).
          </p>
        </form>

        <div className="tool-result" ref={resultRef}>
          {!started && (
            <div className="result-empty">
              <p>예시 제품이 채워져 있어요. 버튼 한 번이면 세 갈래 작업이 동시에 돌아갑니다.</p>
              <p className="result-empty-sub">
                기존에는 상세페이지 → 상품등록 → 콘텐츠를 각각 열어 같은 정보를 세 번 입력해야 했습니다.
              </p>
            </div>
          )}

          {started && (
            <>
              <div className="lane-board">
                {LANES.map((lane) => {
                  const t = tasks[lane.id]
                  return (
                    <div className={`lane lane-${t.status}`} key={lane.id}>
                      <div className="lane-head">
                        <span className="lane-icon" aria-hidden="true">
                          {t.status === 'running' ? '◐' : t.status === 'done' ? '✓' : t.status === 'error' ? '!' : '○'}
                        </span>
                        <strong>{lane.label}</strong>
                      </div>
                      <p className="lane-desc">{lane.desc}</p>
                      <p className="lane-status">
                        {t.status === 'running' && '생성 중...'}
                        {t.status === 'done' && '완료'}
                        {t.status === 'error' && `실패 — ${t.error}`}
                      </p>
                    </div>
                  )
                })}
              </div>

              {done && anyResult && (
                <>
                  <ResultNotice text={detail?.notice || listing?.notice || content?.notice} />
                  {formChanged && (
                    <ResultNotice
                      text={`이 결과는 "${outForm.name}" 입력으로 만들어졌습니다. 그 뒤 입력창을 고쳤기 때문에, 다운로드 파일에는 지금 입력창이 아니라 위 입력이 담깁니다.`}
                    />
                  )}
                  <div className="result-toolbar">
                    {isDemo && <DemoBadge />}
                    <BrandBadge
                      applied={detail?.brand_applied ?? listing?.brand_applied ?? content?.brand_applied}
                      missing={[
                        ...(detail?.brand_missing || []),
                        ...(content?.brand_missing || []),
                      ].filter((v, i, a) => a.indexOf(v) === i)}
                    />
                    {hasUsage && <UsageNote usage={totalUsage} />}
                  </div>

                  <div className="stat-row batch-summary">
                    <div className="stat-tile">
                      <span className="stat-label">생성된 산출물</span>
                      <span className="stat-value">{outputCount}개</span>
                    </div>
                    <div className="stat-tile">
                      <span className="stat-label">완료된 작업</span>
                      <span className="stat-value">
                        {Object.values(tasks).filter((t) => t.status === 'done').length} / 3
                      </span>
                    </div>
                    <div className="stat-tile">
                      <span className="stat-label">사람 확인 필요</span>
                      <span className="stat-value">
                        {flags.length}건{flags.length > 0 && <em className="stat-note"> 금칙어 검출</em>}
                      </span>
                    </div>
                  </div>

                  <div className="result-toolbar onboard-downloads">
                    <button type="button" className="btn-primary" onClick={downloadPackage}>
                      작업 패키지 전체 다운로드 (.md)
                    </button>
                    {detail && (
                      <button type="button" className="btn-ghost" onClick={downloadHtml}>
                        상세페이지 HTML
                      </button>
                    )}
                    {listing && (
                      <button type="button" className="btn-ghost" onClick={downloadCsv}>
                        등록용 CSV
                      </button>
                    )}
                  </div>

                  {flags.length > 0 && (
                    <div className="onboard-flags">
                      <h3>표시광고 확인 필요 {flags.length}건</h3>
                      <ul className="plain-list warn-list">
                        {flags.map((f, i) => (
                          <li key={i}>
                            <strong>[{f.from}]</strong> "{f.word}" — {f.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="onboard-preview">
                    {detail && (
                      <section className="onboard-card">
                        <h3>상세페이지</h3>
                        <p className="onboard-headline">{detail.headline}</p>
                        <p className="onboard-sub">{detail.subheadline}</p>
                        <p className="onboard-meta">섹션 {detail.sections?.length || 0}개 · FAQ {detail.faq?.length || 0}개</p>
                      </section>
                    )}
                    {listing && (
                      <section className="onboard-card">
                        <h3>상품등록 정보</h3>
                        <p className="onboard-headline">{(listing.titles || [])[0]}</p>
                        <div className="chip-row">
                          {(listing.search_keywords || []).slice(0, 6).map((k) => (
                            <span className="chip" key={k}>{k}</span>
                          ))}
                        </div>
                      </section>
                    )}
                    {content?.results?.length > 0 && (
                      <section className="onboard-card">
                        <h3>채널 콘텐츠 {content.results.length}종</h3>
                        {content.results.map((r) => (
                          <p className="onboard-channel" key={r.channel}>
                            <strong>{CHANNELS.find((c) => c.id === r.channel)?.label || r.channel}</strong> {r.title}
                          </p>
                        ))}
                      </section>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
