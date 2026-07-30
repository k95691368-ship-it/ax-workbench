import { describe, it, expect } from 'vitest'
import { parseProducts, rowsToProducts, productsToText, BATCH_MAX } from '../src/lib/batchParse.js'

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
    const lines = Array.from({ length: BATCH_MAX + 3 }, (_, i) => `상품 ${i + 1}`).join('\n')
    const { products, overflow } = parseProducts(lines)
    expect(products).toHaveLength(BATCH_MAX)
    expect(overflow).toBe(3)
  })
})

describe('rowsToProducts (엑셀·CSV 행렬 → 상품 목록)', () => {
  it('헤더 이름으로 컬럼을 찾는다 (순서가 달라도 된다)', () => {
    const { products, hasHeader } = rowsToProducts([
      ['특징', '상품명', '카테고리'],
      ['100억 CFU', '유산균 30포', '건강기능식품'],
    ])
    expect(hasHeader).toBe(true)
    expect(products[0]).toEqual({
      name: '유산균 30포',
      category: '건강기능식품',
      features: '100억 CFU',
    })
  })

  it('컬럼명 변형(제품명/분류/설명)도 알아본다', () => {
    const { products } = rowsToProducts([
      ['제품명', '분류', '설명'],
      ['도시락김 16봉', '식품', '남해안 원초'],
    ])
    expect(products[0].name).toBe('도시락김 16봉')
    expect(products[0].category).toBe('식품')
  })

  it('헤더가 없으면 1·2·3열을 상품명·카테고리·특징으로 읽는다', () => {
    const { products, hasHeader } = rowsToProducts([['유산균 30포', '건강기능식품', '100억 CFU']])
    expect(hasHeader).toBe(false)
    expect(products).toHaveLength(1)
    expect(products[0].name).toBe('유산균 30포')
  })

  it('상품명이 빈 행은 세어서 알려주고 결과에서 뺀다', () => {
    const { products, skipped } = rowsToProducts([
      ['상품명', '카테고리'],
      ['유산균', '건기식'],
      ['', '카테고리만'],
    ])
    expect(products).toHaveLength(1)
    expect(skipped).toBe(1)
  })

  it('빈 표는 빈 결과를 돌려준다 (예외를 던지지 않는다)', () => {
    expect(rowsToProducts([]).products).toEqual([])
    expect(rowsToProducts(null).products).toEqual([])
  })
})

describe('업로드한 셀이 존재하지 않는 상품을 만들지 않는다', () => {
  // 엑셀 Alt+Enter로 넣은 셀 내부 줄바꿈. 예전에는 이 줄바꿈이 업로드 →
  // productsToText → textarea → parseProducts를 거치며 상품 구분자로 승격돼,
  // 상품 2개 파일에서 '4개 인식됨'과 가짜 상품 2개가 생겼다.
  const rows = [
    ['상품명', '카테고리', '특징'],
    ['도시락김 16봉', '식품', '남해안 원초\n저온 2회 구이\n들기름+참기름'],
    ['유산균 30포', '건강기능식품', '19종 유산균 | 100억 CFU'],
  ]

  it('셀 안 줄바꿈을 공백으로 눕혀 한 상품으로 유지한다', () => {
    const { products } = rowsToProducts(rows)
    expect(products).toHaveLength(2)
    expect(products[0].features).toBe('남해안 원초 저온 2회 구이 들기름+참기름')
  })

  it('셀 안 구분자(|)가 칸을 밀어내지 않는다', () => {
    const { products } = rowsToProducts(rows)
    expect(products[1].features).toBe('19종 유산균 / 100억 CFU')
  })

  it('업로드 안내 개수와 실제 전송 개수가 같다 (왕복해도 늘어나지 않는다)', () => {
    const uploaded = rowsToProducts(rows).products
    const roundTrip = parseProducts(productsToText(uploaded)).products
    expect(roundTrip).toHaveLength(uploaded.length)
    expect(roundTrip).toEqual(uploaded)
  })

  it('구분자를 4개 이상 쓴 줄에서 뒷조각을 버리지 않는다', () => {
    const { products } = parseProducts('유산균 | 건강기능식품 | 19종 유산균 | 100억 CFU')
    expect(products[0].features).toBe('19종 유산균|100억 CFU')
  })
})

describe('productsToText (상품 목록 → 입력창 텍스트)', () => {
  it('뒤쪽 빈 칸은 구분자까지 지운다', () => {
    const text = productsToText([
      { name: '유산균', category: '건기식', features: '100억' },
      { name: '김', category: '', features: '' },
    ])
    expect(text).toBe('유산균 | 건기식 | 100억\n김')
  })

  it('parseProducts로 되돌리면 같은 상품이 나온다 (왕복 일관성)', () => {
    const products = [{ name: '유산균', category: '건기식', features: '100억' }]
    expect(parseProducts(productsToText(products)).products).toEqual(products)
  })
})
