import { describe, it, expect } from 'vitest'
import { scanText, ALLOWED_PHRASES } from '../src/lib/compliance.js'
import { checkClaims } from '../src/lib/factCheck.js'
import { normalizeDetail, normalizeChannelContents, normalizeListing } from '../functions/_lib/shape.js'
import { checkDailyBudget, costOf } from '../functions/_lib/budget.js'

describe('금칙어 매칭 — 우회 표기 차단', () => {
  it('띄어쓰기·가운뎃점으로 쪼갠 금칙어도 잡는다', () => {
    expect(scanText('이 제품은 치 료 효과가 있습니다')[0].word).toBe('치료')
    expect(scanText('치·료 효과')[0].word).toBe('치료')
    expect(scanText('최 고 품질')[0].word).toBe('최고')
  })

  it('원문에 쓰인 형태를 그대로 함께 돌려준다 (사람이 어디를 고칠지 알 수 있게)', () => {
    expect(scanText('치 료 효과')[0].matchedText).toBe('치 료')
  })

  it('원문 기준 위치·길이를 정확히 돌려준다 (하이라이트가 어긋나지 않게)', () => {
    const [f] = scanText('가나다 최고 라마')
    expect('가나다 최고 라마'.slice(f.index, f.index + f.length)).toBe('최고')
  })
})

describe('금칙어 매칭 — 오검출 예외', () => {
  it('법으로 표기가 요구되는 문구를 위반으로 잡지 않는다', () => {
    expect(scanText('질병의 예방 및 치료를 위한 의약품이 아닙니다')).toEqual([])
  })

  it('허용 목록의 표현들은 모두 통과한다', () => {
    for (const phrase of ALLOWED_PHRASES) {
      expect(scanText(phrase), phrase).toEqual([])
    }
  })

  it('허용 문구 밖의 위반은 여전히 잡는다', () => {
    const found = scanText('질병의 예방 및 치료를 위한 의약품이 아닙니다. 하지만 국내 1위 완치 효과!')
    expect(found.map((f) => f.word)).toContain('1위')
    expect(found.map((f) => f.word)).toContain('완치')
  })
})

describe('사실 근거 검증', () => {
  const source = ['곱창돌김 16봉', '식품 > 김', '남해안 원초, 저온 2회 구이']

  it('입력에 있는 수치는 문제 삼지 않는다', () => {
    expect(checkClaims(['남해안 원초 곱창돌김 16봉'], source)).toEqual([])
  })

  it('입력에 없는 수치를 지어내면 잡는다', () => {
    const found = checkClaims(['국내산 김 100g 대용량 16봉'], source)
    expect(found.map((f) => f.claim)).toContain('100g')
  })

  it('띄어쓰기·쉼표 차이는 같은 값으로 본다', () => {
    expect(checkClaims(['보장균수 100 억 CFU'], ['보장균수 100억 CFU'])).toEqual([])
    expect(checkClaims(['1,000mg 함유'], ['1000mg 함유'])).toEqual([])
  })

  it('근거 없는 인증·수상 표현을 잡는다', () => {
    const found = checkClaims(['HACCP 인증 받은 김'], source)
    expect(found.some((f) => f.claim === '인증')).toBe(true)
    expect(found.some((f) => f.claim === 'HACCP')).toBe(true)
  })

  it('입력에 근거가 있으면 통과시킨다', () => {
    expect(checkClaims(['HACCP 인증 원료'], ['HACCP 인증 시설에서 생산'])).toEqual([])
  })

  it('단위 없는 맨숫자는 무시한다 (문장 번호·순서 오탐 방지)', () => {
    expect(checkClaims(['1. 첫 번째 이유'], source)).toEqual([])
  })
})

describe('응답 계약 — 중첩 항목 정규화', () => {
  it('망가진 섹션은 버리고 성한 것만 남긴다', () => {
    const out = normalizeDetail({
      headline: 'H',
      subheadline: 'S',
      sections: [
        { title: '정상', body: '본문' },
        { title: '본문 없음' },
        null,
      ],
      faq: [{ q: 'Q', a: 'A' }, { q: '답 없음' }],
      keywords: ['a', 1, 'b'],
      designer_notes: 'N',
    })
    expect(out.sections).toHaveLength(1)
    expect(out.faq).toHaveLength(1)
    expect(out.keywords).toEqual(['a', 'b'])
  })

  it('쓸 수 있는 섹션이 하나도 없으면 계약 위반으로 처리한다', () => {
    expect(() => normalizeDetail({ sections: [{ title: '본문 없음' }] })).toThrow()
  })

  it('요청하지 않은 채널이 섞여 오면 버린다', () => {
    const out = normalizeChannelContents(
      [
        { channel: 'instagram', title: 'T', body: 'B' },
        { channel: 'tiktok', title: 'T', body: 'B' },
      ],
      ['instagram']
    )
    expect(out).toHaveLength(1)
    expect(out[0].channel).toBe('instagram')
  })

  it('상품명이 하나도 없으면 계약 위반으로 처리한다', () => {
    expect(() => normalizeListing({ titles: [] })).toThrow()
  })
})

describe('일일 예산 상한 (회수가 아닌 실제 지출)', () => {
  const dbWith = (input, output) => ({
    prepare: () => ({ first: async () => ({ input_tokens: input, output_tokens: output }) }),
  })

  it('토큰 사용량으로 비용을 계산한다', () => {
    expect(costOf(1_000_000, 0)).toBeCloseTo(5)
    expect(costOf(0, 1_000_000)).toBeCloseTo(25)
  })

  it('예산 안이면 통과시킨다', async () => {
    const r = await checkDailyBudget({ DB: dbWith(10_000, 5_000) }, 3)
    expect(r.ok).toBe(true)
  })

  it('예산을 넘으면 막는다', async () => {
    const r = await checkDailyBudget({ DB: dbWith(0, 200_000) }, 3)
    expect(r.ok).toBe(false)
    expect(r.spent).toBeCloseTo(5)
  })

  it('집계에 실패해도 서비스는 계속된다 (회수 상한이 뒤를 받친다)', async () => {
    const broken = { prepare: () => ({ first: async () => { throw new Error('down') } }) }
    const r = await checkDailyBudget({ DB: broken }, 3)
    expect(r.ok).toBe(true)
    expect(r.available).toBe(false)
  })
})
