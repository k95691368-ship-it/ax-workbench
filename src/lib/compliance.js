// 건강기능식품·식품 표시광고 사전점검 규칙 (1차 규칙 기반 스캔)
// 근거: 식품표시광고법 제8조 — 질병 예방·치료 효능 표방, 의약품 오인,
// 거짓·과장, 최상급 표현 등 부당한 표시·광고 금지.
// 이 목록은 데모용 요약이며, 실제 심의 기준 전체를 대체하지 않는다.

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

// 텍스트에서 금칙어 후보를 스캔해 위치와 함께 반환한다.
export function scanText(text) {
  const findings = []
  if (!text) return findings
  for (const rule of BANNED_RULES) {
    for (const word of rule.words) {
      let idx = text.indexOf(word)
      while (idx !== -1) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          label: rule.label,
          reason: rule.reason,
          word,
          index: idx,
          excerpt: text.slice(Math.max(0, idx - 15), idx + word.length + 15),
        })
        idx = text.indexOf(word, idx + word.length)
      }
    }
  }
  return findings.sort((a, b) => a.index - b.index)
}
