import { describe, it, expect } from 'vitest'
import {
  violationsOf,
  violatingTargets,
  violationCount,
  buildFixPayload,
  mergeFixed,
  sumUsage,
} from '../src/lib/fixTargets.js'
import { onRequestPost } from '../functions/api/ax/batch-listing.js'

const ROWS = [
  { input_name: '유산균 30포', title: '유산균 30포 프로바이오틱스', ad_check: [] },
  { input_name: '최고급 김', title: '최고급 김 인기 상품', ad_check: [{ word: '최고' }] },
  { input_name: '두유 24팩', title: '두유 24팩', ad_check: [], brand_missing: ['국내산 표기'] },
]

const SENT = [
  { name: '유산균 30포', category: '건기식', features: '19종' },
  { name: '최고급 김', category: '식품', features: '남해안 원초' },
  { name: '두유 24팩', category: '음료', features: '국산 검은콩' },
]

describe('위반 상품 선별', () => {
  it('금칙어와 룰북 누락을 모두 위반으로 본다', () => {
    expect(violationsOf(ROWS[1])).toEqual(['최고'])
    expect(violationsOf(ROWS[2])).toEqual(['국내산 표기'])
    expect(violationsOf(ROWS[0])).toEqual([])
  })

  it('통과한 상품은 재생성 대상에서 제외한다 (비용은 위반 건수만큼만)', () => {
    const targets = violatingTargets(ROWS)
    expect(targets.map((t) => t.index)).toEqual([1, 2])
    expect(violationCount(ROWS)).toBe(2)
  })

  it('위반이 없으면 대상이 비어 재생성 버튼이 뜨지 않는다', () => {
    expect(violatingTargets([{ ad_check: [] }])).toEqual([])
    expect(violatingTargets(null)).toEqual([])
  })
})

describe('재생성 요청 만들기', () => {
  it('원래 입력(카테고리·특징)에 이전 상품명과 검출 표현을 얹어 보낸다', () => {
    const payload = buildFixPayload(violatingTargets(ROWS), SENT)
    expect(payload).toHaveLength(2)
    expect(payload[0]).toEqual({
      name: '최고급 김',
      category: '식품',
      features: '남해안 원초',
      previous: '최고급 김 인기 상품',
      violations: ['최고'],
    })
  })

  it('보낸 상품 정보가 없으면 결과에 남은 상품명으로 대체한다', () => {
    const payload = buildFixPayload(violatingTargets(ROWS), [])
    expect(payload[0].name).toBe('최고급 김')
    expect(payload[0].category).toBe('')
  })
})

describe('재생성 결과 병합', () => {
  it('대상 행만 교체하고 통과한 행은 손대지 않는다', () => {
    const targets = violatingTargets(ROWS)
    const merged = mergeFixed(ROWS, [{ title: '새 김 상품명' }, { title: '새 두유 상품명' }], targets)
    expect(merged[0]).toBe(ROWS[0]) // 통과 행은 원본 그대로
    expect(merged[1].title).toBe('새 김 상품명')
    expect(merged[2].title).toBe('새 두유 상품명')
  })

  it('상품이 뒤바뀌지 않도록 원래 상품명을 유지한다', () => {
    const merged = mergeFixed(ROWS, [{ title: 'x', input_name: '엉뚱한 상품' }], violatingTargets(ROWS))
    expect(merged[1].input_name).toBe('최고급 김')
  })

  it('응답이 비어도 원래 표를 깨뜨리지 않는다', () => {
    expect(mergeFixed(ROWS, [], violatingTargets(ROWS))).toHaveLength(3)
    expect(mergeFixed(ROWS, null, violatingTargets(ROWS))[1]).toEqual(ROWS[1])
  })
})

describe('토큰 사용량 누적', () => {
  it('최초 생성과 재생성 사용량을 합산한다', () => {
    expect(sumUsage({ input_tokens: 10, output_tokens: 5 }, { input_tokens: 3, output_tokens: 2 })).toEqual({
      input_tokens: 13,
      output_tokens: 7,
    })
    expect(sumUsage(null, { input_tokens: 3, output_tokens: 2 })).toEqual({ input_tokens: 3, output_tokens: 2 })
    expect(sumUsage({ input_tokens: 1, output_tokens: 1 }, null)).toEqual({ input_tokens: 1, output_tokens: 1 })
  })
})

describe('서버 재생성 모드', () => {
  async function call(body) {
    const request = new Request('https://test/api/ax/batch-listing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const res = await onRequestPost({ request, env: {}, waitUntil: () => {} })
    return res.json()
  }

  it('검출된 표현을 뺀 결과를 돌려준다 (예시 응답 경로에서도 원칙 동일)', async () => {
    const data = await call({
      products: [
        {
          name: '최고급 유산균 30포',
          category: '건강기능식품',
          features: '19종',
          previous: '최고급 유산균 30포 인기 상품',
          violations: ['최고'],
        },
      ],
    })
    expect(data.results[0].title).not.toContain('최고')
    expect(data.results[0].input_name).toBe('최고급 유산균 30포')
    expect(data.results[0].ad_check).toEqual([])
  })

  it('재생성 정보가 없으면 기존 최초 생성과 동일하게 동작한다', async () => {
    const data = await call({ products: [{ name: '두유 24팩', category: '음료' }] })
    expect(data.results[0].title).toContain('두유')
  })

  it('입력 원문의 위반은 생성물 위반과 분리해 돌려준다 (재생성으로 해결되지 않는 건)', async () => {
    const data = await call({
      products: [{ name: '곱창돌김 16봉', category: '식품', features: '변비 치료에 좋은 김' }],
    })
    const row = data.results[0]
    expect(row.input_check.map((f) => f.word)).toContain('변비 치료')
    // 생성 문구 자체에는 위반이 없으므로 재생성 대상이 아니다
    expect(row.ad_check).toEqual([])
    expect(violatingTargets(data.results)).toEqual([])
  })
})
