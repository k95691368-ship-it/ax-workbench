import { describe, it, expect } from 'vitest'
import { onRequestPost } from '../functions/api/ax/reviews.js'

// API 키 없이 호출하면 예시 응답 경로를 타므로, 룰북 점검 로직만 독립적으로 검증할 수 있다.
async function callReviews(body) {
  const request = new Request('https://test/api/ax/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await onRequestPost({ request, env: {}, waitUntil: () => {} })
  return res.json()
}

const REVIEWS = [
  '맛도 좋고 배송도 빨라요. 재구매했습니다!',
  '이거 먹고 배가 아파서 병원 다녀왔어요. 어떻게 하나요?',
]

describe('리뷰 응대의 브랜드 룰북 점검', () => {
  it('룰북이 없으면 점검하지 않는다', async () => {
    const data = await callReviews({ reviews: REVIEWS })
    expect(data.brand_applied).toBe(false)
    expect(data.brand_missing).toBeUndefined()
  })

  it('일반 답변에서 빠진 필수 문구를 답변별로 알려준다', async () => {
    const data = await callReviews({
      reviews: REVIEWS,
      brand: { required: ['고객센터 1588-0000'] },
    })
    expect(data.brand_applied).toBe(true)
    expect(data.brand_missing).toEqual(['고객센터 1588-0000'])
    expect(data.results[0].brand_missing).toEqual(['고객센터 1588-0000'])
  })

  it('에스컬레이션(담당자 확인) 답변은 필수 문구 검증에서 제외한다', async () => {
    const data = await callReviews({
      reviews: REVIEWS,
      brand: { required: ['고객센터 1588-0000'] },
    })
    const escalated = data.results.find((r) => r.escalate)
    expect(escalated).toBeTruthy()
    expect(escalated.brand_missing).toBeUndefined()
  })

  it('회사 금지어는 답변에서도 검출된다', async () => {
    const data = await callReviews({
      reviews: REVIEWS,
      brand: { banned: ['감사합니다'] },
    })
    const words = data.results.flatMap((r) => r.ad_check.map((f) => f.word))
    expect(words).toContain('감사합니다')
  })
})
