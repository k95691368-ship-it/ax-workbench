import { describe, it, expect } from 'vitest'
import { scanText, BANNED_RULES } from '../src/lib/compliance.js'

describe('scanText', () => {
  it('질병 예방·치료 표현을 높음 위험도로 잡는다', () => {
    const findings = scanText('변비 치료에 좋은 유산균')
    expect(findings.some((f) => f.word.includes('치료') && f.severity === 'high')).toBe(true)
  })

  it('겹치는 금칙어는 더 긴 표현 하나로만 보고한다', () => {
    const findings = scanText('변비 치료에 좋은')
    const words = findings.map((f) => f.word)
    expect(words).toContain('변비 치료')
    expect(words).not.toContain('치료')
  })

  it('최상급 표현을 주의로 잡는다', () => {
    const findings = scanText('국내 1위 유일한 제품')
    const words = findings.map((f) => f.word)
    expect(words).toContain('1위')
    expect(words).toContain('유일한')
    expect(findings.every((f) => f.severity === 'medium')).toBe(true)
  })

  it('안전한 고시형 문구는 통과시킨다', () => {
    expect(scanText('유산균 증식 및 유해균 억제에 도움을 줄 수 있음')).toHaveLength(0)
  })

  it('같은 단어가 여러 번 나오면 모두 찾고 위치순으로 정렬한다', () => {
    const findings = scanText('치료 효과, 다시 치료')
    const hits = findings.filter((f) => f.word === '치료')
    expect(hits).toHaveLength(2)
    expect(hits[0].index).toBeLessThan(hits[1].index)
  })

  it('빈 입력은 빈 배열을 반환한다', () => {
    expect(scanText('')).toEqual([])
  })

  it('모든 규칙에 근거 사유가 있다', () => {
    for (const rule of BANNED_RULES) {
      expect(rule.reason.length).toBeGreaterThan(5)
      expect(rule.words.length).toBeGreaterThan(0)
    }
  })
})
