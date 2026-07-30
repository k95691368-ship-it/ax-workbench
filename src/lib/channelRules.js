// 오픈마켓 등록 규정 엔진.
//
// 왜 이걸 만드는가:
// AI가 만든 상품명은 "검색에 좋은 상품명"이지 "등록이 통과되는 상품명"이 아니다.
// 실무에서 상품등록이 막히는 첫 지점은 카피 품질이 아니라 채널 규정이다 —
// 글자수 초과, 특수문자, 같은 단어 반복(검색 어뷰징으로 간주), 상품명에 넣을 수 없는
// 홍보 문구(무료배송·최저가·1위). 반려되면 담당자가 채널마다 손으로 고쳐 다시 올린다.
// 생성과 등록 사이의 이 구간을 코드로 끝내는 것이 이 파일의 목적이다.
//
// 설계 원칙:
// 1) 규정은 **데이터**다. 채널 정책은 시기마다 바뀌므로 코드가 아니라 아래 표에 모아 두고
//    운영자가 고칠 수 있게 한다. 기본값은 널리 알려진 공개 기준을 보수적으로 옮긴 것이며,
//    실제 운영 시에는 채널 공지 기준으로 맞추는 것을 전제로 한다.
// 2) 판정은 "왜"까지 돌려준다. 무엇이 걸렸는지만 알려주면 담당자는 또 손으로 고쳐야 한다.
// 3) 자동 교정은 **무엇을 왜 고쳤는지** 함께 돌려준다. 조용히 바꾸면 신뢰할 수 없다.

// 상품명에 쓸 수 있는 문자 (한글·영문·숫자·공백 + 규격 표기에 필요한 최소 기호)
const ALLOWED_CHAR = /[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9\s\-+/().,%&]/

// 상품명에 넣을 수 없는 홍보·거래조건 문구.
// 채널 공통으로 제한되는 축이라 기본값에 모아 두고, 채널별로 덧붙인다.
const COMMON_PROMO = [
  '최저가',
  '최고',
  '1위',
  '무료배송',
  '무료 배송',
  '당일발송',
  '당일 발송',
  '무료',
  '특가',
  '초특가',
  '할인',
  '세일',
  '이벤트',
  '사은품',
  '쿠폰',
  '증정',
  '품절임박',
  '한정판매',
  '정품',
  '베스트',
  '인기',
  '추천',
]

// 연락처·주소를 상품명에 넣는 것(채널 외 거래 유도)은 어느 채널에서도 막힌다
const CONTACT_PATTERNS = [
  { re: /https?:\/\/|www\.|\.com|\.co\.kr/i, label: 'URL' },
  { re: /\d{2,4}-\d{3,4}-\d{4}/, label: '전화번호' },
  { re: /[\w.]+@[\w.]+/, label: '이메일' },
  { re: /카톡|카카오톡|오픈채팅/, label: '외부 메신저 유도' },
]

// 연락처를 지우고 나면 홀로 남는 유도 문구 (교정 결과가 "국내 문의"처럼 어색해지지 않게)
const CONTACT_LEADS = ['문의', '상담', '연락']

// 채널 규정 기본값 — 운영자가 수정하는 자리다.
export const CHANNEL_RULES = [
  {
    id: 'smartstore',
    label: '네이버 스마트스토어',
    maxLen: 100,
    recommendLen: 50,
    maxRepeat: 1, // 같은 단어를 두 번 쓰면 검색 노출에 불이익
    promo: COMMON_PROMO,
    note: '상품명 100자 이내, 검색 노출은 50자 이내 권장. 중복 단어·특수문자·홍보 문구 제한.',
  },
  {
    id: 'coupang',
    label: '쿠팡',
    maxLen: 100,
    recommendLen: 60,
    maxRepeat: 1,
    promo: [...COMMON_PROMO, '로켓배송', '로켓와우'],
    note: '노출 상품명 100자 이내. 배송·프로모션 문구는 상품명이 아니라 옵션·배송 설정에서 다룬다.',
  },
  {
    id: 'eleven',
    label: '11번가',
    maxLen: 100,
    recommendLen: 60,
    maxRepeat: 2,
    promo: COMMON_PROMO,
    note: '상품명 100자 이내. 홍보성 문구·특수문자 제한.',
  },
  {
    id: 'esm',
    label: 'G마켓 · 옥션',
    maxLen: 50,
    recommendLen: 40,
    maxRepeat: 1,
    promo: COMMON_PROMO,
    note: '상품명 길이 제약이 가장 짧다 — 여기서 통과하면 대개 다른 채널도 통과한다.',
  },
]

export function getChannelRule(id) {
  return CHANNEL_RULES.find((c) => c.id === id) || CHANNEL_RULES[0]
}

// 의미 있는 단어만 센다 (조사·한 글자 토큰은 반복으로 보지 않는다)
function words(title) {
  return String(title || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase())
    .filter((w) => w.length >= 2)
}

function repeatedWords(title, maxRepeat) {
  const seen = new Map()
  for (const w of words(title)) seen.set(w, (seen.get(w) || 0) + 1)
  return [...seen.entries()].filter(([, n]) => n > maxRepeat).map(([w, n]) => ({ word: w, count: n }))
}

function badChars(title) {
  const found = []
  for (const ch of String(title || '')) {
    if (!ALLOWED_CHAR.test(ch) && !found.includes(ch)) found.push(ch)
  }
  return found
}

function promoHits(title, promo) {
  const text = String(title || '')
  // 긴 문구를 먼저 맞춰 '무료배송'이 '무료'로 두 번 잡히지 않게 한다
  const sorted = [...promo].sort((a, b) => b.length - a.length)
  const hits = []
  let masked = text
  for (const p of sorted) {
    if (masked.includes(p)) {
      hits.push(p)
      masked = masked.split(p).join(' '.repeat(p.length))
    }
  }
  return hits
}

// 상품명 하나를 한 채널 규정으로 판정한다.
// 반환: { channel, label, length, findings: [{code, severity, message}], score, ok }
export function checkTitle(title, channelId) {
  const rule = getChannelRule(channelId)
  const text = String(title || '')
  const findings = []

  if (text.trim() === '') {
    findings.push({ code: 'empty', severity: 'high', message: '상품명이 비어 있습니다.' })
  }

  if (text.length > rule.maxLen) {
    findings.push({
      code: 'max_len',
      severity: 'high',
      message: `${rule.label} 상품명 한도 ${rule.maxLen}자를 ${text.length - rule.maxLen}자 초과했습니다 (현재 ${text.length}자). 등록 단계에서 잘리거나 반려됩니다.`,
    })
  } else if (rule.recommendLen && text.length > rule.recommendLen) {
    findings.push({
      code: 'recommend_len',
      severity: 'warn',
      message: `권장 ${rule.recommendLen}자를 넘었습니다 (현재 ${text.length}자). 검색 결과에서 뒷부분이 잘려 보일 수 있습니다.`,
    })
  }

  const chars = badChars(text)
  if (chars.length > 0) {
    findings.push({
      code: 'char',
      severity: 'high',
      message: `상품명에 쓸 수 없는 문자: ${chars.join(' ')} — 특수문자·이모지는 등록이 거부되거나 검색에서 제외됩니다.`,
    })
  }

  const repeats = repeatedWords(text, rule.maxRepeat)
  if (repeats.length > 0) {
    findings.push({
      code: 'repeat',
      severity: 'warn',
      message: `같은 단어 반복: ${repeats.map((r) => `${r.word}(${r.count}회)`).join(', ')} — 검색 어뷰징으로 간주되어 노출이 내려갑니다.`,
    })
  }

  const promos = promoHits(text, rule.promo)
  if (promos.length > 0) {
    findings.push({
      code: 'promo',
      severity: 'high',
      message: `상품명에 넣을 수 없는 홍보·거래조건 문구: ${promos.join(', ')} — 배송·할인은 상품명이 아니라 채널 설정에서 다룹니다.`,
    })
  }

  for (const c of CONTACT_PATTERNS) {
    if (c.re.test(text)) {
      findings.push({
        code: 'contact',
        severity: 'high',
        message: `${c.label}가 상품명에 있습니다 — 채널 외 거래 유도로 판단되어 제재 대상입니다.`,
      })
    }
  }

  if (/\s{2,}/.test(text) || text !== text.trim()) {
    findings.push({ code: 'space', severity: 'warn', message: '불필요한 공백이 있습니다.' })
  }

  const penalty = findings.reduce((sum, f) => sum + (f.severity === 'high' ? 25 : 8), 0)
  return {
    channel: rule.id,
    label: rule.label,
    length: text.length,
    findings,
    score: Math.max(0, 100 - penalty),
    ok: findings.every((f) => f.severity !== 'high'),
  }
}

// 상품명 하나를 모든 채널로 판정 (어느 채널에서 막히는지 한눈에)
export function checkTitleAllChannels(title) {
  return CHANNEL_RULES.map((c) => checkTitle(title, c.id))
}

// 자동 교정. 무엇을 왜 고쳤는지 changes에 담아 돌려준다 (조용히 바꾸지 않는다).
export function autoFixTitle(title, channelId) {
  const rule = getChannelRule(channelId)
  const changes = []
  let text = String(title || '')

  // 1) 쓸 수 없는 문자 제거
  const chars = badChars(text)
  if (chars.length > 0) {
    text = [...text].filter((ch) => ALLOWED_CHAR.test(ch)).join('')
    changes.push({ code: 'char', detail: `특수문자 제거: ${chars.join(' ')}` })
  }

  // 2) 홍보·거래조건 문구 제거
  const promos = promoHits(text, rule.promo)
  for (const p of promos) text = text.split(p).join(' ')
  if (promos.length > 0) changes.push({ code: 'promo', detail: `홍보 문구 제거: ${promos.join(', ')}` })

  // 3) 연락처·외부 유도 제거 — 이걸 남기면 교정했다고 하면서 제재 사유가 그대로 남는다.
  //    부분 치환이 아니라 **어절 단위로** 지운다 (www.example.co.kr에서 앞뒤만 지우면
  //    'example'이 남아 무슨 말인지 알 수 없는 상품명이 된다).
  const contacts = []
  const survivors = []
  for (const token of text.split(/\s+/)) {
    const hit = CONTACT_PATTERNS.find((c) => c.re.test(token))
    if (hit) {
      if (!contacts.includes(hit.label)) contacts.push(hit.label)
      continue
    }
    survivors.push(token)
  }
  text = survivors.join(' ')
  // 연락처를 지우면 앞에 붙어 있던 유도 문구가 홀로 남는다
  if (contacts.length > 0) {
    for (const w of CONTACT_LEADS) text = text.split(w).join(' ')
    changes.push({ code: 'contact', detail: `연락처·외부 유도 제거: ${contacts.join(', ')}` })
  }

  // 4) 공백 정리 (뒤 단계의 토큰 계산이 정확해지도록 먼저 한다)
  const beforeSpace = text
  text = text.replace(/\s+/g, ' ').trim()
  if (text !== beforeSpace) changes.push({ code: 'space', detail: '중복 공백 정리' })

  // 5) 중복 단어 제거 — 뒤에 나온 것을 지운다 (앞쪽이 대개 브랜드·제품명이다)
  const seen = new Map()
  const kept = []
  const dropped = []
  for (const token of text.split(' ').filter(Boolean)) {
    const key = token.replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase()
    if (key.length >= 2) {
      const n = (seen.get(key) || 0) + 1
      seen.set(key, n)
      if (n > rule.maxRepeat) {
        dropped.push(token)
        continue
      }
    }
    kept.push(token)
  }
  text = kept.join(' ')
  if (dropped.length > 0) changes.push({ code: 'repeat', detail: `중복 단어 제거: ${dropped.join(', ')}` })

  // 6) 길이 초과 — 뒤쪽 부가 키워드부터 덜어낸다.
  //    상품명은 앞쪽이 브랜드·제품명, 뒤쪽이 검색용 부가 키워드인 관행을 따른다.
  //    앞 3어절은 제품 식별에 필요하므로 남긴다.
  const MIN_TOKENS = 3
  if (text.length > rule.maxLen) {
    const tokens = text.split(' ')
    const removed = []
    while (text.length > rule.maxLen && tokens.length > MIN_TOKENS) {
      removed.push(tokens.pop())
      text = tokens.join(' ')
    }
    if (removed.length > 0)
      changes.push({
        code: 'max_len',
        detail: `${rule.maxLen}자 한도에 맞춰 뒤쪽 키워드 제거: ${removed.reverse().join(', ')}`,
      })
    // 앞 3어절만으로도 넘치면 어절 경계에서 자른다
    if (text.length > rule.maxLen) {
      text = text.slice(0, rule.maxLen).replace(/\s+\S*$/, '')
      changes.push({ code: 'truncate', detail: `제품명 자체가 한도를 넘어 ${rule.maxLen}자에서 잘랐습니다 — 사람 확인이 필요합니다.` })
    }
  }

  return { title: text, changes, check: checkTitle(text, rule.id) }
}

// 후보 여러 개 중 이 채널에 가장 잘 맞는 것 (점수 → 짧은 것 순)
export function bestTitle(titles, channelId) {
  const scored = (titles || [])
    .filter((t) => String(t || '').trim())
    .map((t) => ({ title: t, ...checkTitle(t, channelId) }))
    .sort((a, b) => b.score - a.score || a.length - b.length)
  return scored[0] || null
}

// 채널별 요약 — "몇 개 채널에서 그대로 등록 가능한가"
export function channelSummary(titles) {
  const per = CHANNEL_RULES.map((c) => {
    const best = bestTitle(titles, c.id)
    return { channel: c.id, label: c.label, ok: Boolean(best?.ok), best }
  })
  return { per, okCount: per.filter((p) => p.ok).length, total: per.length }
}
