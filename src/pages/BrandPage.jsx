import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadBrand, saveBrand, clearBrand, linesToList, listToLines } from '../lib/brand.js'
import { brandPrompt, isBrandActive, normalizeBrand } from '../lib/brandRules.js'

const APPLIES_TO = [
  { to: '/onboard', label: '신상품 원클릭 온보딩' },
  { to: '/detail-page', label: 'AI 상세페이지 생성기' },
  { to: '/content', label: '채널 콘텐츠 팩토리' },
  { to: '/listing', label: '상품등록 최적화' },
  { to: '/batch', label: '대량 등록 도우미' },
  { to: '/reviews', label: '리뷰 자동 응대' },
]

const TONE_PRESETS = [
  '정중한 합니다체. 과장 없이 담백하게',
  '친근한 반말 없이, 대화하듯 편안한 해요체',
  '전문가 톤. 근거와 수치를 앞세워 설명',
  '유쾌한 톤. 이모지 1~2개까지 허용',
]

const SAMPLE = {
  name: '온담',
  tone: '정중한 합니다체. 과장 없이 담백하게, 감탄사·느낌표 남발 금지',
  audience: '30~50대 여성. 가족 건강을 챙기는 주 구매자',
  banned: ['초특가', '역대급', '완판임박', '지금 안 사면 손해', '가성비 갑'],
  required: ['식약처 인증 원료 사용', '구매 후 7일 이내 교환·환불 가능'],
  notes: '경쟁사명을 직접 언급하지 말 것. 원산지는 항상 병기할 것.',
}

export default function BrandPage() {
  const [form, setForm] = useState(() => {
    const b = loadBrand()
    return { ...b, banned: listToLines(b.banned), required: listToLines(b.required) }
  })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const brand = useMemo(
    () => normalizeBrand({ ...form, banned: linesToList(form.banned), required: linesToList(form.required) }),
    [form]
  )
  const active = isBrandActive(brand)
  const preview = brandPrompt(brand)

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2500)
    return () => clearTimeout(t)
  }, [saved])

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setSaved(false)
  }

  function onSave(e) {
    e.preventDefault()
    saveBrand(brand)
    setSaved(true)
  }

  function onReset() {
    clearBrand()
    setForm({ name: '', tone: '', audience: '', banned: '', required: '', notes: '' })
    setSaved(false)
  }

  // 룰북을 파일로 주고받기 — 담당자가 정한 기준을 팀에 그대로 배포할 수 있게 한다
  function exportBrand() {
    const blob = new Blob([JSON.stringify(brand, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `브랜드룰북${brand.name ? `_${brand.name}` : ''}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importBrand(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      const parsed = normalizeBrand(JSON.parse(await file.text()))
      if (!isBrandActive(parsed)) {
        setError('룰북 내용이 비어 있는 파일입니다.')
        return
      }
      setForm({
        ...parsed,
        banned: listToLines(parsed.banned),
        required: listToLines(parsed.required),
      })
      setSaved(false)
    } catch {
      setError('룰북 파일을 읽지 못했습니다. 이 화면에서 내보낸 .json 파일인지 확인해주세요.')
    }
  }

  function fillSample() {
    setForm({
      ...SAMPLE,
      banned: SAMPLE.banned.join('\n'),
      required: SAMPLE.required.join('\n'),
    })
    setSaved(false)
  }

  return (
    <div className="tool-page">
      <header className="tool-header">
        <span className="tool-tag">전 기능 공통 · 회사 규정 자동 준수</span>
        <h1>브랜드 룰북</h1>
        <p>
          회사의 말투·금지어·필수 문구를 <strong>여기 한 번만</strong> 정의하면, 이후 모든 AI 생성
          기능이 자동으로 그 규정을 따릅니다. 담당자가 결과물을 매번 손보는 대신, 규칙을 한 곳에서
          관리하는 방식입니다.
        </p>
      </header>

      <div className="tool-layout">
        <form className="tool-form" onSubmit={onSave}>
          <label>
            브랜드명
            <input value={form.name} onChange={set('name')} placeholder="예) 온담" maxLength={40} />
          </label>

          <label>
            말투 · 톤
            <input
              value={form.tone}
              onChange={set('tone')}
              placeholder="예) 정중한 합니다체. 과장 없이 담백하게"
              maxLength={120}
            />
          </label>
          <div className="chip-row preset-row">
            {TONE_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                className="preset-chip"
                onClick={() => {
                  setForm((f) => ({ ...f, tone: t }))
                  setSaved(false)
                }}
              >
                {t.split('.')[0]}
              </button>
            ))}
          </div>

          <label>
            주 고객층
            <input
              value={form.audience}
              onChange={set('audience')}
              placeholder="예) 30~50대 여성, 가족 건강을 챙기는 주 구매자"
              maxLength={120}
            />
          </label>

          <label>
            쓰지 않을 표현 — 한 줄에 하나 (최대 12개)
            <textarea
              value={form.banned}
              onChange={set('banned')}
              rows={5}
              placeholder={'초특가\n역대급\n완판임박'}
            />
          </label>
          <p className="field-hint">
            AI 생성 단계에서 회피하고, 생성 후 결과물도 이 단어들로 다시 한번 기계 점검합니다.
          </p>

          <label>
            반드시 넣을 문구 — 한 줄에 하나 (최대 12개)
            <textarea
              value={form.required}
              onChange={set('required')}
              rows={4}
              placeholder={'식약처 인증 원료 사용\n구매 후 7일 이내 교환·환불 가능'}
            />
          </label>
          <p className="field-hint">
            생성 결과에 실제로 들어갔는지 확인해, 빠졌으면 결과 화면에 경고로 알려 드립니다. CS 답변에도
            함께 적용되며, 담당자 확인이 필요한 에스컬레이션 답변은 검증에서 제외합니다.
          </p>

          <label>
            추가 지침
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={3}
              placeholder="예) 경쟁사명을 직접 언급하지 말 것. 원산지는 항상 병기할 것."
              maxLength={300}
            />
          </label>

          <div className="brand-actions">
            <button type="submit" className="btn-primary">
              룰북 저장
            </button>
            <button type="button" className="btn-ghost" onClick={fillSample}>
              예시 룰북 채우기
            </button>
            <button type="button" className="btn-ghost" onClick={exportBrand}>
              파일로 내보내기
            </button>
            <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
              파일에서 불러오기
            </button>
            <button type="button" className="btn-ghost" onClick={onReset}>
              전체 삭제
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importBrand} />
          </div>
          <p className="field-hint">
            내보낸 룰북 파일을 팀원에게 전달하면, 같은 기준을 그대로 불러와 쓸 수 있습니다.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="form-success" role="status">
              ✓ 저장했습니다. 지금부터 모든 생성 기능에 적용됩니다.
            </p>
          )}
        </form>

        <div className="tool-result">
          <div className="brand-status">
            <span className={active ? 'brandbadge on' : 'brandbadge off'}>
              {active ? '🏷 룰북 적용 중' : '룰북 미설정 — 기본 규정만 적용'}
            </span>
            <p className="brand-status-note">
              룰북은 이 브라우저에만 저장됩니다(서버에 회사 규정을 보관하지 않습니다). 생성 요청을
              보낼 때만 함께 전달됩니다.
            </p>
          </div>

          <section className="brand-block">
            <h2>적용되는 기능</h2>
            <ul className="brand-applies">
              {APPLIES_TO.map((f) => (
                <li key={f.to}>
                  <Link to={f.to}>{f.label}</Link>
                </li>
              ))}
            </ul>
            <p className="field-hint">
              기능 화면은 룰북의 존재를 몰라도 됩니다. 요청을 보내는 통로 한 곳에서 룰북이 자동으로
              실리기 때문에, 기능을 새로 추가해도 규정 준수는 그대로 따라옵니다.
            </p>
          </section>

          <section className="brand-block">
            <h2>AI에게 실제로 전달되는 지시문</h2>
            <p className="field-hint">
              룰북이 어떻게 프롬프트로 번역되는지 그대로 보여 드립니다. 결과가 마음에 들지 않을 때
              어느 문장을 고쳐야 하는지 바로 알 수 있습니다.
            </p>
            <pre className="brand-preview">
              {preview.trim() || '(아직 비어 있습니다. 왼쪽에서 한 항목이라도 채워 보세요.)'}
            </pre>
          </section>

          <section className="brand-block">
            <h2>이 기능이 필요한 이유</h2>
            <p className="brand-why">
              AI를 도입할 때 실제로 발목을 잡는 건 품질이 아니라 <strong>일관성</strong>입니다.
              담당자마다 다른 말투로 쓰고, 쓰면 안 되는 표현이 매번 다시 등장하면 결국 사람이 전부
              검수하게 되어 자동화의 이득이 사라집니다. 규칙을 조직 자산으로 한 번 정의해 두면,
              누가 어느 기능을 쓰든 같은 기준의 결과물이 나옵니다.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
