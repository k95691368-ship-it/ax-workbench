import { describe, it, expect } from 'vitest'
import { scanText, ALLOWED_PHRASES } from '../src/lib/compliance.js'
import { checkClaims, checkPromises } from '../src/lib/factCheck.js'
import { normalizeDetail, normalizeChannelContents, normalizeListing } from '../functions/_lib/shape.js'
import { checkDailyBudget, costOf, budgetNotice, RESERVE_PER_CALL_USD } from '../functions/_lib/budget.js'

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

  it('규정을 지키려고 쓴 거절 문장은 위반으로 잡지 않는다', () => {
    // 실제 라이브에서 나온 문장 — 이걸 위반으로 세면 담당자가 규정을 어기는 방향으로 고치게 된다
    expect(
      scanText('제품의 질병 치료나 예방 효과에 대해서는 안내드릴 수 없는 점 양해 부탁드립니다')
    ).toEqual([])
    expect(scanText('치료 효과는 말씀드릴 수 없습니다')).toEqual([])
  })

  it('거절 절 밖의 위반은 그대로 잡는다 (완화가 구멍이 되지 않게)', () => {
    const found = scanText('치료 효과가 뛰어납니다. 자세한 건 안내드릴 수 없는 점 양해 바랍니다')
    expect(found.map((f) => f.word)).toContain('치료')
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

describe('고객 응대 확약 표현 검증', () => {
  it('보상 범위를 임의로 확약하면 잡는다', () => {
    expect(checkPromises(['불편을 드려 죄송합니다. 전액 환불해 드리겠습니다.'])).toHaveLength(1)
    expect(checkPromises(['무상 교환 도와드리겠습니다'])[0].label).toBe('무상 처리 확약')
  })

  it('처리 기한 확약을 잡는다', () => {
    expect(checkPromises(['3일 내 처리해 드리겠습니다'])[0].label).toBe('처리 기한 확약')
  })

  it('과실 인정·결과 보장을 잡는다', () => {
    expect(checkPromises(['책임지고 해결하겠습니다'])[0].label).toBe('과실 인정')
    expect(checkPromises(['반드시 해결해 드리겠습니다'])[0].label).toBe('결과 보장')
  })

  it('정상적인 안내 답변은 잡지 않는다', () => {
    expect(checkPromises(['고객님, 문의 감사합니다. 확인 후 안내드리겠습니다.'])).toEqual([])
    expect(checkPromises(['환불 절차는 고객센터에서 안내해 드립니다.'])).toEqual([])
    expect(checkPromises(['맛있게 드셨다니 감사합니다.'])).toEqual([])
  })

  it('같은 유형이 여러 번 나와도 한 번만 보고한다', () => {
    expect(checkPromises(['전액 환불해 드립니다', '전액 환불 가능합니다'])).toHaveLength(1)
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

describe('예산 상한 — 요청이 만들 호출 수까지 감안한다', () => {
  const dbWith = (input, output) => ({
    prepare: () => ({ first: async () => ({ input_tokens: input, output_tokens: output }) }),
  })

  it('남은 예산이 이번 요청 예상 비용보다 적으면 미리 막는다', async () => {
    // 이미 $2.90 지출 · 남은 여유 $0.10 → 6호출(약 $0.18)짜리 요청은 통과시키면 상한을 넘긴다
    const env = { DB: dbWith(0, 116_000) }
    expect((await checkDailyBudget(env, 3, { calls: 1 })).ok).toBe(true)
    expect((await checkDailyBudget(env, 3, { calls: 6 })).ok).toBe(false)
  })

  it('예약분을 함께 돌려줘 왜 막혔는지 알 수 있다', async () => {
    const r = await checkDailyBudget({ DB: dbWith(0, 116_000) }, 3, { calls: 6 })
    expect(r.reserve).toBeCloseTo(6 * RESERVE_PER_CALL_USD)
  })

  it('호출 수를 안 넘기면 1회분만 예약한다 (기존 호출부와 호환)', async () => {
    const r = await checkDailyBudget({ DB: dbWith(0, 0) }, 3)
    expect(r.ok).toBe(true)
    expect(r.reserve).toBeCloseTo(RESERVE_PER_CALL_USD)
  })

  it('안내 문구가 자정이 아니라 롤링 창임을 말한다', () => {
    const notice = budgetNotice({ limit: 3 })
    expect(notice).toContain('최근 24시간')
    expect(notice).not.toContain('자정')
  })
})

describe('채널 콘텐츠 정규화 — 중복과 순서', () => {
  const row = (channel, title) => ({ channel, title, body: `${channel} 본문` })

  it('같은 채널이 두 번 오면 하나만 남긴다 (화면에 같은 카드가 두 개 뜨지 않게)', () => {
    const out = normalizeChannelContents(
      [row('instagram', '첫 번째'), row('instagram', '두 번째'), row('blog', 'B')],
      ['instagram', 'blog']
    )
    expect(out).toHaveLength(2)
    expect(out.filter((r) => r.channel === 'instagram')).toHaveLength(1)
    expect(out.find((r) => r.channel === 'instagram').title).toBe('첫 번째')
  })

  it('응답 순서가 아니라 사용자가 요청한 채널 순서로 돌려준다', () => {
    const out = normalizeChannelContents(
      [row('youtube', 'Y'), row('instagram', 'I'), row('blog', 'B')],
      ['instagram', 'blog', 'youtube']
    )
    expect(out.map((r) => r.channel)).toEqual(['instagram', 'blog', 'youtube'])
  })
})

describe('상세페이지 정규화 — 빈 문자열 방어', () => {
  it('제목이나 본문이 빈 문자열인 섹션은 버린다', () => {
    const out = normalizeDetail({
      headline: 'H',
      subheadline: 'S',
      sections: [
        { title: '정상', body: '본문' },
        { title: '', body: '본문' },
        { title: '제목', body: '   ' },
      ],
      faq: [],
      keywords: [],
      designer_notes: 'N',
    })
    expect(out.sections).toHaveLength(1)
  })
})

describe('거절 문구 면제가 문장 전체를 지우지 않는다', () => {
  // 감사에서 재현한 우회 — 마침표를 빼면 사전점검이 통째로 뚫렸다
  it('문장부호 없이 이어 붙인 완충 문구가 앞부분 위반을 지우지 않는다', () => {
    const a = scanText('이 제품은 당뇨를 치료합니다 다만 개인차가 있어 효과를 약속드릴 수 없습니다')
    expect(a.map((f) => f.word)).toContain('치료')

    const b = scanText('아토피와 변비 치료에 탁월하며 자세한 상담은 답변드리기 어렵습니다')
    expect(b.map((f) => f.word)).toContain('아토피')

    const c = scanText('아토피 완치를 도와주는 유일한 항암 유산균이며 개별 효과는 보장하지 않습니다')
    const words = c.map((f) => f.word)
    expect(words).toContain('완치')
    expect(words).toContain('항암')
  })

  it('거절이 그 금칙어에 직접 붙은 경우는 여전히 면제한다', () => {
    expect(scanText('치료 효과는 말씀드릴 수 없습니다')).toEqual([])
    expect(
      scanText('제품의 질병 치료나 예방 효과에 대해서는 안내드릴 수 없는 점 양해 부탁드립니다')
    ).toEqual([])
  })
})

describe('법정 필수 표기는 어미가 달라도 위반이 아니다', () => {
  it('라벨 표기형·문장 연결형도 통과한다 (수정 버튼이 필수 문구를 지우게 두지 않는다)', () => {
    expect(scanText('본 제품은 질병의 예방 및 치료를 위한 의약품이 아님')).toEqual([])
    expect(
      scanText('건강기능식품은 질병의 예방·치료를 위한 의약품이 아니며 균형 잡힌 식생활이 중요합니다')
    ).toEqual([])
  })
})
