// 사실 근거 검증 — AI가 입력에 없는 수치·인증을 지어냈는지 기계적으로 대조한다.
//
// 규제 카테고리에서 가장 위험한 건 금칙어보다 "그럴듯하게 지어낸 숫자"다.
// 프롬프트에 "지어내지 마라"고 써두는 것만으로는 확인이 되지 않으므로,
// 생성 문구에 등장한 수치·인증 표현이 입력 자료에 실제로 있는지 대조해 표시한다.
//
// 이 결과는 "위반"이 아니라 "근거 확인 필요"다 — 판단은 사람이 한다.
// (그래서 자동 재생성 대상에도 넣지 않는다. 기계가 확신할 수 없는 영역이기 때문이다.)

// 의미 있는 수치만 본다. 단위 없는 맨숫자는 문장 번호·순서일 때가 많아 제외한다.
const UNITS = [
  'mg', 'g', 'kg', 'ml', 'l', 'kcal', 'cfu', '%', '퍼센트',
  '억', '만', '천', '종', '가지', '포', '정', '캡슐', '팩', '봉', '매', '개월', '주', '일', '배', '년',
]

const NUMBER_CLAIM = new RegExp(`(\\d[\\d,.]*)\\s*(${UNITS.join('|')})`, 'gi')

// 입력에 없으면 근거가 없는, 검증 대상 표현들
const CERT_CLAIMS = [
  '인증', '특허', '승인', '허가', 'HACCP', 'GMP', '식약처', '유기농', '무첨가', '무설탕',
  '1위', '수상', '임상', '시험 결과', '검증',
]

const squash = (s) => String(s || '').toLowerCase().replace(/[\s,]/g, '')

// generated: AI가 만든 문구들 / source: 사용자가 준 입력(제품명·카테고리·특징 등)
export function checkClaims(generated, source) {
  const haystack = squash((Array.isArray(source) ? source : [source]).filter(Boolean).join(' '))
  if (!haystack) return []

  const text = (Array.isArray(generated) ? generated : [generated]).filter(Boolean).join('\n')
  const found = new Map()

  for (const m of text.matchAll(NUMBER_CLAIM)) {
    const claim = `${m[1]}${m[2]}`
    if (haystack.includes(squash(claim))) continue
    if (found.has(squash(claim))) continue
    found.set(squash(claim), {
      type: 'number',
      claim: m[0].trim(),
      reason: '입력한 제품 정보에서 이 수치를 찾지 못했습니다. 근거를 확인하거나 문구에서 빼주세요.',
    })
  }

  for (const word of CERT_CLAIMS) {
    if (!text.includes(word)) continue
    if (haystack.includes(squash(word))) continue
    if (found.has(squash(word))) continue
    found.set(squash(word), {
      type: 'claim',
      claim: word,
      reason: '입력한 제품 정보에 없는 인증·검증 표현입니다. 실제 근거 자료가 있는지 확인해주세요.',
    })
  }

  return [...found.values()]
}
