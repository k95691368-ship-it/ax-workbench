// 브랜드 룰북 — 회사의 브랜드명·말투·금지어·필수 문구를 한 번 정의하면
// 모든 생성 기능(상세페이지·상품등록·콘텐츠·대량등록·리뷰응대)이 자동으로 따르게 하는 공용 규칙.
//
// 이 파일은 프론트(설정 화면)와 서버(프롬프트 주입·검증)가 함께 쓴다.
// 서버는 클라이언트가 보낸 값을 신뢰하지 않고 언제나 normalizeBrand로 다시 정제한다.

export const EMPTY_BRAND = {
  name: '',
  tone: '',
  audience: '',
  banned: [],
  required: [],
  notes: '',
}

const MAX_ITEMS = 12
const MAX_ITEM_LEN = 40

const LIMITS = { name: 40, tone: 120, audience: 120, notes: 300 }

function textField(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function listField(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split('\n')
      : []
  const seen = []
  for (const raw of source) {
    const item = textField(raw, MAX_ITEM_LEN)
    if (item && !seen.includes(item)) seen.push(item)
    if (seen.length >= MAX_ITEMS) break
  }
  return seen
}

// 어떤 형태로 들어와도 항상 같은 모양의 룰북 객체로 정규화한다.
export function normalizeBrand(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BRAND }
  return {
    name: textField(raw.name, LIMITS.name),
    tone: textField(raw.tone, LIMITS.tone),
    audience: textField(raw.audience, LIMITS.audience),
    banned: listField(raw.banned),
    required: listField(raw.required),
    notes: textField(raw.notes, LIMITS.notes),
  }
}

// 한 항목이라도 채워져 있어야 "적용 중"으로 본다 (빈 룰북은 프롬프트를 오염시키지 않는다)
export function isBrandActive(brand) {
  if (!brand) return false
  return Boolean(
    brand.name ||
      brand.tone ||
      brand.audience ||
      brand.notes ||
      (brand.banned && brand.banned.length) ||
      (brand.required && brand.required.length)
  )
}

// 룰북을 시스템 프롬프트에 덧붙일 지시문으로 변환한다.
// 법정 표시광고 규칙이 항상 우선한다는 점을 명시해, 브랜드 규정이 규제를 덮어쓰지 못하게 한다.
// required=false로 부르면 "필수 표기 문구를 여기서는 넣지 말라"고 지시한다.
// 한 결과물을 여러 호출로 나눠 만들 때, 그중 한 곳만 required=true여야 한다.
export function brandPrompt(brand, { required = true } = {}) {
  if (!isBrandActive(brand)) return ''
  const b = normalizeBrand(brand)
  const lines = []
  if (b.name) lines.push(`- 브랜드명은 "${b.name}"으로 표기하세요. 임의로 줄이거나 바꾸지 마세요.`)
  if (b.tone) lines.push(`- 말투·톤: ${b.tone}`)
  if (b.audience) lines.push(`- 주 고객층: ${b.audience}. 이 고객이 실제로 쓰는 말로 작성하세요.`)
  if (b.banned.length)
    lines.push(
      `- 다음 표현은 회사 규정상 사용 금지입니다: ${b.banned.join(', ')}. 비슷한 말로 우회하지 말고 다른 방식으로 표현하세요.`
    )
  // 필수 표기 문구는 "결과물 하나에 한 번"이다.
  // 상세페이지처럼 한 결과물을 여러 호출로 나눠 만들 때 모든 호출에 "반드시 포함"이라고 하면
  // 같은 문구가 페이지에 여러 번 박힌다 — 실제로 라이브에서 4번 반복됐다.
  if (b.required.length) {
    const quoted = b.required.map((r) => `"${r}"`).join(', ')
    lines.push(
      required
        ? `- 다음 문구는 결과물에 표기 그대로 반드시 포함하세요: ${quoted}`
        : `- 다음 표기 문구는 결과물의 다른 부분에서 한 번만 넣습니다. 여기서는 쓰지 마세요: ${quoted}`
    )
  }
  if (b.notes) lines.push(`- 추가 지침: ${b.notes}`)
  return `\n\n[브랜드 룰북 — 회사가 정한 규정]\n${lines.join('\n')}\n(단, 위 표시광고 안전 규칙과 충돌하는 경우에는 언제나 표시광고 안전 규칙이 우선합니다.)`
}

// 공백·대소문자 차이는 무시하고 비교한다 ("무료 배송" vs "무료배송")
const squash = (s) => String(s).replace(/\s+/g, '').toLowerCase()

// 필수 문구가 결과물에 실제로 들어갔는지 확인해, 빠진 문구만 돌려준다.
export function missingRequired(texts, brand) {
  if (!isBrandActive(brand)) return []
  const required = normalizeBrand(brand).required
  if (required.length === 0) return []
  const joined = squash((Array.isArray(texts) ? texts : [texts]).filter(Boolean).join('\n'))
  return required.filter((phrase) => !joined.includes(squash(phrase)))
}
