import { describe, it, expect } from 'vitest'
import { parseProducts, BATCH_MAX } from '../src/lib/batchParse.js'

describe('parseProducts (대량 등록 입력 파서)', () => {
  it('한 줄에 하나씩, 구분자 |로 상품명/카테고리/특징을 나눈다', () => {
    const { products } = parseProducts('유산균 30포 | 건강기능식품 | 100억 CFU\n도시락김 16봉')
    expect(products).toHaveLength(2)
    expect(products[0]).toEqual({ name: '유산균 30포', category: '건강기능식품', features: '100억 CFU' })
    expect(products[1]).toEqual({ name: '도시락김 16봉', category: '', features: '' })
  })

  it('빈 줄과 상품명 없는 줄은 건너뛴다', () => {
    const { products } = parseProducts('\n\n | 카테고리만 있음\n정상 상품\n  ')
    expect(products).toHaveLength(1)
    expect(products[0].name).toBe('정상 상품')
  })

  it(`최대 ${BATCH_MAX}개까지만 처리하고 초과분을 알려준다`, () => {
    const lines = Array.from({ length: 8 }, (_, i) => `상품 ${i + 1}`).join('\n')
    const { products, overflow } = parseProducts(lines)
    expect(products).toHaveLength(BATCH_MAX)
    expect(overflow).toBe(3)
  })
})
