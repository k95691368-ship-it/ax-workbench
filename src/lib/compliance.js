// 건강기능식품·식품 표시광고 사전점검 규칙 (1차 규칙 기반 스캔)
// 근거: 식품표시광고법 제8조 — 질병 예방·치료 효능 표방, 의약품 오인,
// 거짓·과장, 최상급 표현 등 부당한 표시·광고 금지.
// 이 목록은 데모용 요약이며, 실제 심의 기준 전체를 대체하지 않는다.

import { inDisclaimerClause } from './negation.js'

export const BANNED_RULES = [
  {
    id: 'disease',
    severity: 'high',
    label: '질병 예방·치료 표현',
    reason: '건강기능식품은 질병의 예방·치료 효능을 표방할 수 없습니다(식품표시광고법 제8조).',
    words: ['치료', '치유', '완치', '예방', '항암', '암세포', '당뇨 개선', '혈압을 낮춰', '아토피', '변비 치료', '면역력 치료', '질병'],
  },
  {
    id: 'medicine',
    severity: 'high',
    label: '의약품 오인 표현',
    reason: '의약품으로 오인할 수 있는 표현은 금지됩니다.',
    words: ['약효', '처방', '복용량', '부작용 없는 약', '천연 항생제', '항생제', '진통', '소염'],
  },
  {
    id: 'superlative',
    severity: 'medium',
    label: '최상급·단정 표현',
    reason: '객관적 근거 없는 최상급·단정 표현은 거짓·과장 광고로 판단될 수 있습니다.',
    words: ['최고', '최상', '1위', '유일한', '100% 효과', '즉시 효과', '무조건', '완벽한 효과'],
  },
  {
    id: 'body-change',
    severity: 'medium',
    label: '신체 변화 단정 표현',
    reason: '체험 전후 비교, 신체 변화를 단정하는 표현은 부당광고로 판단될 수 있습니다.',
    words: ['살이 빠', '체지방이 사라', '디톡스', '독소 배출', '숙변', '키가 큰다', '피부가 하얘'],
  },
]

// 브랜드 룰북에서 회사가 직접 지정한 금지어. 법정 규칙과 같은 방식으로 함께 스캔한다.
export const BRAND_RULE = {
  id: 'brand',
  severity: 'medium',
  label: '브랜드 금지어',
  reason: '브랜드 룰북에서 쓰지 않기로 정한 표현입니다.',
}

// 금칙어를 포함하지만 오히려 써야 하거나 문제가 없는 표현들.
// 특히 첫 항목은 건강기능식품에 **법으로 표기가 요구되는 문구**다 —
// 이걸 위반으로 잡으면 담당자가 필수 문구를 지우는, 정반대 사고가 난다.
export const ALLOWED_PHRASES = [
  '질병의 예방 및 치료를 위한 의약품이 아닙니다',
  '질병의 예방·치료를 위한 의약품이 아닙니다',
  '의약품이 아닙니다',
  '치료를 대신할 수 없습니다',
  '치료 목적으로 사용하지 마',
  '예방접종',
  '질병관리청',
  '질병관리본부',
]

// 띄어쓰기·가운뎃점·특수문자를 끼워 넣는 우회 표기("치 료", "치·료")를 무력화하기 위해
// 비교용 문자열에서 이런 문자를 제거한다. 동시에 정규화 위치 → 원문 위치 매핑을 만들어,
// 검출 결과를 원문 기준 위치로 되돌릴 수 있게 한다(하이라이트가 원문 위에 그려지므로).
const SKIP_CHARS = new Set([
  '·', // 가운뎃점 ·
  '・', // 일본어 가운뎃점 ・
  '.', ',', '-', '_', '~', '*', "'", '"', '`', '^', '|', '/', '\\',
  '(', ')', '[', ']', '{', '}',
  '​', '‌', '‍', '﻿', // 눈에 보이지 않는 문자로 글자를 쪼개는 우회
])

const isSkip = (ch) => SKIP_CHARS.has(ch) || /\s/.test(ch)

function normalizeWithMap(text) {
  let norm = ''
  const map = []
  for (let i = 0; i < text.length; i++) {
    if (isSkip(text[i])) continue
    norm += text[i]
    map.push(i)
  }
  return { norm, map }
}

const squash = (s) =>
  [...String(s)].filter((ch) => !isSkip(ch)).join('')

// 텍스트에서 금칙어 후보를 스캔해 위치와 함께 반환한다.
// 겹치는 매치("변비 치료" 안의 "치료" 등)는 더 긴 표현 하나로만 보고한다.
// brandBanned를 넘기면 회사 규정 금지어까지 같은 기준으로 함께 검출한다.
export function scanText(text, brandBanned = []) {
  const findings = []
  if (!text) return findings
  const extra = [...new Set((brandBanned || []).filter((w) => typeof w === 'string' && w.trim()))]
  const rules = extra.length ? [...BANNED_RULES, { ...BRAND_RULE, words: extra }] : BANNED_RULES

  const { norm, map } = normalizeWithMap(text)

  // 허용 표현이 차지하는 구간(정규화 기준)은 검출에서 제외한다
  const allowedRanges = []
  for (const phrase of ALLOWED_PHRASES) {
    const needle = squash(phrase)
    let at = norm.indexOf(needle)
    while (at !== -1) {
      allowedRanges.push([at, at + needle.length])
      at = norm.indexOf(needle, at + 1)
    }
  }
  const inAllowed = (start, end) => allowedRanges.some(([s, e]) => start >= s && end <= e)

  for (const rule of rules) {
    for (const word of rule.words) {
      const needle = squash(word)
      if (!needle) continue
      let at = norm.indexOf(needle)
      while (at !== -1) {
        const end = at + needle.length
        const from = map[at]
        const to = map[end - 1] + 1
        // "치료 효과는 안내드릴 수 없습니다"처럼 **규정을 지키려고 쓴 거절 문장**은 위반이 아니다.
        // 이걸 위반으로 세면 담당자가 오히려 규정을 어기는 방향으로 문장을 고치게 된다.
        if (!inAllowed(at, end) && !inDisclaimerClause(text, from)) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            label: rule.label,
            reason: rule.reason,
            word,
            // 원문에 실제로 쓰인 형태 (우회 표기를 그대로 보여주기 위해)
            matchedText: text.slice(from, to),
            index: from,
            length: to - from,
            excerpt: text.slice(Math.max(0, from - 15), to + 15),
          })
        }
        at = norm.indexOf(needle, at + 1)
      }
    }
  }

  findings.sort((a, b) => a.index - b.index || b.length - a.length)
  const deduped = []
  let lastEnd = -1
  for (const f of findings) {
    if (f.index < lastEnd) continue
    deduped.push(f)
    lastEnd = f.index + f.length
  }
  return deduped
}
