import { describe, it, expect } from 'vitest'
import { checkTexts } from '../functions/_lib/adcheck.js'

describe('checkTexts (서버측 표시광고 사후검증)', () => {
  it('여러 텍스트 조각에서 금칙어를 요약 형태로 찾는다', () => {
    const findings = checkTexts(['변비 치료에 좋아요', '국내 1위 유산균'])
    const words = findings.map((f) => f.word)
    expect(words).toContain('변비 치료')
    expect(words).toContain('1위')
    expect(findings.every((f) => f.reason && f.label && f.severity)).toBe(true)
  })

  it('같은 단어가 여러 조각에 나와도 1건으로 요약한다', () => {
    const findings = checkTexts(['즉시 효과 보장', '이것도 즉시 효과'])
    expect(findings.filter((f) => f.word === '즉시 효과')).toHaveLength(1)
  })

  it('안전한 고시형 문구는 빈 배열을 반환한다', () => {
    expect(checkTexts(['유산균 증식 및 유해균 억제에 도움을 줄 수 있음', null, ''])).toEqual([])
  })
})
