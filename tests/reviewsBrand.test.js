import { describe, it, expect } from 'vitest'
import { onRequestPost, normalizeReplies, alignReplies, applyEscalationRules } from '../functions/api/ax/reviews.js'

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

describe('리뷰 답변 재작성 모드', () => {
  it('검출된 표현이 든 문장을 덜어낸 답변을 돌려준다', async () => {
    const data = await callReviews({
      reviews: ['배송이 너무 늦어요'],
      fix: [{ previous: '고객님, 배송이 지연되어 불편을 드려 죄송합니다. 주문 내역을 확인해 드리겠습니다.', violations: ['죄송'] }],
      brand: { banned: ['죄송'] },
    })
    expect(data.results[0].reply).not.toContain('죄송')
    expect(data.results[0].ad_check.map((f) => f.word)).not.toContain('죄송')
  })

  it('모든 문장이 걸리면 안전한 기본 문구로 대체한다 (빈 답변을 만들지 않는다)', async () => {
    const data = await callReviews({
      reviews: ['배송이 너무 늦어요'],
      fix: [{ previous: '이전 답변', violations: ['고객님'] }],
      brand: { banned: ['고객님'] },
    })
    expect(data.results[0].reply.length).toBeGreaterThan(10)
  })

  it('재작성 정보가 없으면 기존 동작 그대로다', async () => {
    const data = await callReviews({ reviews: ['배송이 너무 늦어요'] })
    expect(data.results[0].category).toBe('배송')
    expect(data.results[0].reply).toContain('죄송')
  })
})

describe('AI 응답 필드 누락에 대한 안전장치', () => {
  it('판단 값(escalate)이 없으면 담당자 확인으로 기울인다', () => {
    const [row] = normalizeReplies([{ reply: '답변', category: '배송' }])
    expect(row.escalate).toBe(true)
    expect(row.escalate_reason).toContain('안전하게')
  })

  it('AI가 판단했다면 그 값을 그대로 존중한다', () => {
    expect(normalizeReplies([{ reply: 'a', category: '칭찬', escalate: false }])[0].escalate).toBe(false)
    expect(normalizeReplies([{ reply: 'a', category: '품질', escalate: true }])[0].escalate).toBe(true)
  })

  it('알 수 없는 분류는 기타로 떨어뜨린다 (화면이 깨지지 않게)', () => {
    expect(normalizeReplies([{ reply: 'a', category: '이상한분류', escalate: false }])[0].category).toBe('기타')
  })
})

describe('리뷰-답변 정렬 정합성 (가장 위험한 어긋남)', () => {
  const reviews = ['맛있어요 재구매합니다', '먹고 두드러기가 나서 병원 다녀왔어요', '배송이 빨라요']

  it('AI가 중간 답변을 빠뜨려도 답변이 다른 리뷰로 밀리지 않는다', () => {
    // 리뷰 3건인데 AI가 2건만 돌려준 상황
    const out = alignReplies([{ reply: '감사합니다', escalate: false, category: '칭찬' }, null], reviews)
    expect(out).toHaveLength(3)
    expect(out[0].reply).toBe('감사합니다')
    // 2번 리뷰(건강 이상)의 자리에 3번 답변이 밀려오면 안 된다
    expect(out[1].reply).not.toBe('감사합니다')
  })

  it('빠진 자리는 담당자 확인으로 기울여 채운다 (fail-safe)', () => {
    const out = alignReplies([{ reply: '감사합니다', escalate: false, category: '칭찬' }], reviews)
    expect(out[1].escalate).toBe(true)
    expect(out[2].escalate).toBe(true)
    expect(out[1].escalate_reason).toContain('만들지 못')
  })

  it('밀림이 없으면 에스컬레이션 규칙이 올바른 리뷰에 걸린다', () => {
    const aligned = alignReplies(
      [
        { reply: '감사합니다', escalate: false, category: '칭찬' },
        null,
        { reply: '감사합니다', escalate: false, category: '칭찬' },
      ],
      reviews
    )
    const out = applyEscalationRules(aligned, reviews)
    // 건강 이상을 호소한 2번 리뷰가 올라가야 한다 (1번·3번은 칭찬)
    expect(out[1].escalate).toBe(true)
    expect(out[0].escalate).toBe(false)
    expect(out[2].escalate).toBe(false)
  })
})
