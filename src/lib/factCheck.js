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

// 고객 응대 답변이 회사를 대신해 "확약"하는 표현들.
//
// 상품 문구의 지어낸 수치보다 실무 리스크가 큰 자리다 — 리뷰 답변은 공개 게시글이라,
// AI가 임의로 "전액 환불해 드리겠습니다"라고 쓰면 그 순간 대외 약속이 된다.
// 보상 범위·처리 기한은 회사 정책이지 AI가 정할 수 있는 값이 아니다.
const PROMISE_PATTERNS = [
  { re: /전액\s*환불|100\s*%\s*환불|무조건\s*환불|즉시\s*환불/, label: '환불 확약', kind: '보상 범위' },
  { re: /전액\s*보상|보상해\s*드리겠|배상해\s*드리겠|보상\s*처리해\s*드리겠/, label: '보상 확약', kind: '보상 범위' },
  { re: /무상\s*(교환|재발송|재배송)|무료로\s*(교환|재발송|보내)/, label: '무상 처리 확약', kind: '보상 범위' },
  { re: /\d+\s*(일|시간|영업일)\s*(내|이내|안에)/, label: '처리 기한 확약', kind: '처리 기한' },
  { re: /반드시\s*(해결|처리|보상)|틀림없이|보장(해\s*드리|드리)/, label: '결과 보장', kind: '결과 보장' },
  { re: /책임지고|전적으로\s*저희\s*(과실|잘못)|저희\s*잘못입니다/, label: '과실 인정', kind: '책임 인정' },
]

// replies: AI가 쓴 답변들. 반환값은 "확인 필요" 목록이며 위반이 아니다 — 판단은 사람이 한다.
export function checkPromises(replies) {
  const list = (Array.isArray(replies) ? replies : [replies]).filter(Boolean)
  const found = new Map()

  for (const reply of list) {
    const text = String(reply)
    for (const p of PROMISE_PATTERNS) {
      const m = p.re.exec(text)
      if (!m || found.has(p.label)) continue
      found.set(p.label, {
        type: 'promise',
        claim: m[0].trim(),
        label: p.label,
        reason: `${p.kind}은(는) 회사 정책 사항입니다. 담당자 확인 없이 답변에 확약하면 그대로 대외 약속이 됩니다.`,
      })
    }
  }

  return [...found.values()]
}
