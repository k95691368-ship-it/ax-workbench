import { describe, it, expect } from 'vitest'
import { normalizeBrand, isBrandActive, brandPrompt, missingRequired } from '../src/lib/brandRules.js'
import { sanitizeBrand } from '../functions/_lib/brand.js'
import { checkTexts } from '../functions/_lib/adcheck.js'

describe('normalizeBrand (룰북 정규화)', () => {
  it('빈 값·잘못된 타입이 와도 항상 같은 모양으로 돌려준다', () => {
    expect(normalizeBrand(null)).toEqual({
      name: '',
      tone: '',
      audience: '',
      banned: [],
      required: [],
      notes: '',
    })
    expect(normalizeBrand('문자열')).toEqual(normalizeBrand(null))
  })

  it('줄바꿈 문자열도 목록으로 받아들이고, 공백·중복을 정리한다', () => {
    const b = normalizeBrand({ banned: ' 초특가 \n초특가\n\n역대급 ' })
    expect(b.banned).toEqual(['초특가', '역대급'])
  })

  it('목록은 12개, 항목 길이는 40자로 제한한다 (프롬프트 오염 방지)', () => {
    const b = normalizeBrand({
      banned: Array.from({ length: 30 }, (_, i) => `금지어${i}`),
      required: ['가'.repeat(80)],
    })
    expect(b.banned).toHaveLength(12)
    expect(b.required[0]).toHaveLength(40)
  })
})

describe('isBrandActive / sanitizeBrand', () => {
  it('한 항목이라도 채워져야 적용 중으로 본다', () => {
    expect(isBrandActive(normalizeBrand({}))).toBe(false)
    expect(isBrandActive(normalizeBrand({ tone: '정중하게' }))).toBe(true)
  })

  it('서버는 빈 룰북을 null로 처리해 프롬프트를 건드리지 않는다', () => {
    expect(sanitizeBrand({ name: '   ' })).toBeNull()
    expect(sanitizeBrand({ name: '다솜' })?.name).toBe('다솜')
  })
})

describe('brandPrompt (룰북 → 프롬프트 지시문)', () => {
  it('빈 룰북이면 아무것도 덧붙이지 않는다', () => {
    expect(brandPrompt(null)).toBe('')
    expect(brandPrompt(normalizeBrand({}))).toBe('')
  })

  it('채워진 항목만 지시문에 넣는다', () => {
    const prompt = brandPrompt({ name: '다솜', banned: ['초특가'] })
    expect(prompt).toContain('다솜')
    expect(prompt).toContain('초특가')
    expect(prompt).not.toContain('주 고객층')
  })

  it('브랜드 규정보다 표시광고 안전 규칙이 우선한다고 명시한다', () => {
    expect(brandPrompt({ tone: '유쾌하게' })).toContain('표시광고 안전 규칙이 우선')
  })
})

describe('missingRequired (필수 문구 실제 포함 여부)', () => {
  const brand = normalizeBrand({ required: ['식약처 인증 원료 사용', '7일 이내 교환 가능'] })

  it('결과물에 들어간 문구는 빠진 것으로 보지 않는다', () => {
    expect(missingRequired(['식약처 인증 원료 사용 제품입니다.'], brand)).toEqual(['7일 이내 교환 가능'])
  })

  it('띄어쓰기가 달라도 포함된 것으로 인정한다', () => {
    expect(missingRequired(['식약처인증 원료사용', '7일이내 교환가능'], brand)).toEqual([])
  })

  it('룰북이 없으면 검사하지 않는다', () => {
    expect(missingRequired(['아무 텍스트'], null)).toEqual([])
  })
})

describe('브랜드 금지어가 표시광고 점검에 함께 걸린다', () => {
  it('회사가 지정한 금지어도 같은 결과 목록에 검출된다', () => {
    const brand = sanitizeBrand({ banned: ['초특가'] })
    const findings = checkTexts(['초특가 이벤트! 지금 1위 상품'], brand)
    const words = findings.map((f) => f.word)
    expect(words).toContain('초특가')
    expect(words).toContain('1위')
    expect(findings.find((f) => f.word === '초특가').label).toBe('브랜드 금지어')
  })

  it('룰북 없이 호출하면 기존 법정 규칙만 적용된다 (기존 호출부 호환)', () => {
    expect(checkTexts(['초특가 이벤트']).map((f) => f.word)).toEqual([])
  })
})
