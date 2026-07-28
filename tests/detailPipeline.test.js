import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateDetail } from '../functions/_lib/detailPipeline.js'

const ENV = { CLAUDE_API_KEY: 'test-key' }

function apiResponse(input, usage = { input_tokens: 100, output_tokens: 50 }) {
  const body = { stop_reason: 'tool_use', content: [{ type: 'tool_use', input }], usage }
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

const OUTLINE = {
  headline: 'H',
  subheadline: 'S',
  section_plan: [
    { title: '섹션1', role: '문제 공감', image_brief: 'img1' },
    { title: '섹션2', role: '해결 제시', image_brief: 'img2' },
    { title: '섹션3', role: '신뢰 요소', image_brief: 'img3' },
  ],
  faq: [{ q: 'Q', a: 'A' }],
  keywords: ['k1', 'k2'],
  designer_notes: 'N',
}

// 첫 호출은 개요, 이후 호출은 섹션 본문. sectionResults로 각 섹션 호출의 결과를 지정한다.
function mockFetch(sectionResults) {
  let call = 0
  return vi.fn(async () => {
    const i = call++
    if (i === 0) return apiResponse(OUTLINE)
    const r = sectionResults[i - 1]
    if (r === 'fail') throw new Error('network down')
    return apiResponse(r)
  })
}

const CALL = { system: 'sys', productBlock: '<user_data>제품</user_data>' }

afterEach(() => vi.unstubAllGlobals())

describe('상세페이지 파이프라인 — 개요 → 섹션 병렬', () => {
  it('개요의 섹션 계획만큼 본문을 만들어 합친다', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([{ body: '본문1', bullets: ['a'] }, { body: '본문2' }, { body: '본문3' }])
    )
    const { result } = await generateDetail(ENV, CALL)
    expect(result.sections).toHaveLength(3)
    expect(result.sections[0]).toMatchObject({ title: '섹션1', body: '본문1', image_brief: 'img1' })
    expect(result.headline).toBe('H')
    expect(result.faq).toEqual([{ q: 'Q', a: 'A' }])
  })

  it('섹션을 동시에 요청한다 (합이 아니라 가장 느린 하나가 전체 시간이 되게)', async () => {
    let inFlight = 0
    let peak = 0
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const i = call++
        if (i === 0) return apiResponse(OUTLINE)
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 20))
        inFlight -= 1
        return apiResponse({ body: `본문${i}` })
      })
    )
    await generateDetail(ENV, CALL)
    expect(peak).toBe(3)
  })

  it('한 섹션이 실패해도 나머지로 페이지를 완성한다 (예전엔 전체가 예시로 강등됐다)', async () => {
    vi.stubGlobal('fetch', mockFetch([{ body: '본문1' }, 'fail', { body: '본문3' }]))
    const { result, degraded } = await generateDetail(ENV, CALL)
    expect(result.sections).toHaveLength(2)
    expect(result.sections.map((s) => s.title)).toEqual(['섹션1', '섹션3'])
    expect(degraded).toContain('1개')
  })

  it('남은 섹션이 너무 적으면 예시 결과로 강등한다', async () => {
    vi.stubGlobal('fetch', mockFetch(['fail', 'fail', { body: '본문3' }]))
    await expect(generateDetail(ENV, CALL)).rejects.toThrow(/섹션 생성에 실패/)
  })

  it('본문이 빈 섹션은 성공으로 세지 않는다', async () => {
    vi.stubGlobal('fetch', mockFetch([{ body: '   ' }, { body: '본문2' }, { body: '본문3' }]))
    const { result } = await generateDetail(ENV, CALL)
    expect(result.sections).toHaveLength(2)
  })

  it('토큰 사용량을 모든 호출에 걸쳐 합산한다 (비용 표시가 어긋나지 않게)', async () => {
    vi.stubGlobal('fetch', mockFetch([{ body: 'b1' }, { body: 'b2' }, { body: 'b3' }]))
    const { usage } = await generateDetail(ENV, CALL)
    expect(usage.input_tokens).toBe(400)
    expect(usage.output_tokens).toBe(200)
  })

  it('개요에 섹션 계획이 없으면 계약 위반으로 처리한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse({ ...OUTLINE, section_plan: [] })))
    await expect(generateDetail(ENV, CALL)).rejects.toThrow(/섹션 계획/)
  })
})
