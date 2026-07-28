import { describe, it, expect } from 'vitest'
import { violationSummary, mergeViolations, buildFixFeedback } from '../src/lib/fixViolations.js'

describe('violationSummary (결과 하나의 위반 요약)', () => {
  it('금칙어와 누락된 필수 문구를 합쳐 센다', () => {
    const s = violationSummary({
      ad_check: [{ word: '1위' }, { word: '즉시 효과' }],
      brand_missing: ['국내산 원초 사용'],
    })
    expect(s.banned).toEqual(['1위', '즉시 효과'])
    expect(s.missing).toEqual(['국내산 원초 사용'])
    expect(s.count).toBe(3)
  })

  it('위반이 없으면 0건 (수정 안내를 띄우지 않기 위한 기준)', () => {
    expect(violationSummary({ ad_check: [], brand_missing: [] }).count).toBe(0)
    expect(violationSummary(null).count).toBe(0)
    expect(violationSummary({}).count).toBe(0)
  })
})

describe('mergeViolations (채널별 결과를 한 번에 수정하기 위한 병합)', () => {
  it('여러 결과에 걸친 같은 위반은 1건으로 합친다', () => {
    const s = mergeViolations([
      { ad_check: [{ word: '1위' }] },
      { ad_check: [{ word: '1위' }, { word: '디톡스' }] },
      { brand_missing: ['국내산 원초 사용'] },
    ])
    expect(s.banned.sort()).toEqual(['1위', '디톡스'])
    expect(s.count).toBe(3)
  })
})

describe('buildFixFeedback (위반 → AI 수정 지시문)', () => {
  it('검출된 표현과 누락 문구를 모두 지시문에 담는다', () => {
    const text = buildFixFeedback({ banned: ['1위'], missing: ['국내산 원초 사용'], count: 2 })
    expect(text).toContain('1위')
    expect(text).toContain('국내산 원초 사용')
  })

  it('우회 표현 금지와 나머지 유지 원칙을 함께 지시한다', () => {
    const text = buildFixFeedback({ banned: ['최고'], missing: [], count: 1 })
    expect(text).toContain('우회하지 마세요')
    expect(text).toContain('그대로 유지')
  })

  it('누락 문구만 있을 때는 금칙어 문장을 넣지 않는다', () => {
    const text = buildFixFeedback({ banned: [], missing: ['교환·환불 가능'], count: 1 })
    expect(text).not.toContain('규정 위반으로 검출')
    expect(text).toContain('교환·환불 가능')
  })
})
