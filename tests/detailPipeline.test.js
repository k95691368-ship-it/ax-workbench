import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateDetail, SECTION_BLUEPRINT } from '../functions/_lib/detailPipeline.js'

const ENV = { CLAUDE_API_KEY: 'test-key' }
const N = SECTION_BLUEPRINT.length

function apiResponse(input, usage = { input_tokens: 100, output_tokens: 50 }) {
  const body = { stop_reason: 'tool_use', content: [{ type: 'tool_use', input }], usage }
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

const FRAME = {
  headline: 'H',
  subheadline: 'S',
  faq: [{ q: 'Q', a: 'A' }],
  keywords: ['k1', 'k2'],
  designer_notes: 'N',
}

const section = (i) => ({ title: `제목${i}`, body: `본문${i}`, bullets: ['b'], image_brief: `img${i}` })

// 어떤 호출이 프레임이고 어떤 게 섹션인지는 요청 본문의 tool 이름으로 가른다
// (모두 동시에 나가므로 호출 순서에 의존할 수 없다).
function mockFetch({ frame = FRAME, sections = {}, fail = [] } = {}) {
  let sectionIndex = 0
  return vi.fn(async (_url, init) => {
    const payload = JSON.parse(init.body)
    if (payload.tools[0].name === 'record_detail_frame') {
      if (fail.includes('frame')) throw new Error('frame down')
      return apiResponse(frame)
    }
    const i = sectionIndex++
    if (fail.includes(i)) throw new Error('section down')
    return apiResponse(sections[i] ?? section(i))
  })
}

const CALL = { system: 'sys', productBlock: '<user_data>제품</user_data>' }

afterEach(() => vi.unstubAllGlobals())

describe('상세페이지 파이프라인 — 전 호출 동시 실행', () => {
  it('고정 구성표만큼 섹션을 만들고 프레임과 합친다', async () => {
    vi.stubGlobal('fetch', mockFetch())
    const { result } = await generateDetail(ENV, CALL)
    expect(result.sections).toHaveLength(N)
    expect(result.headline).toBe('H')
    expect(result.faq).toEqual([{ q: 'Q', a: 'A' }])
    expect(result.sections[0]).toMatchObject({ title: '제목0', body: '본문0', image_brief: 'img0' })
  })

  it('섹션이 개요를 기다리지 않는다 — 모든 호출이 동시에 떠 있다', async () => {
    let inFlight = 0
    let peak = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const payload = JSON.parse(init.body)
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 20))
        inFlight -= 1
        return apiResponse(payload.tools[0].name === 'record_detail_frame' ? FRAME : section(0))
      })
    )
    await generateDetail(ENV, CALL)
    // 프레임 1 + 섹션 N개가 한꺼번에 떠 있어야 한다
    expect(peak).toBe(N + 1)
  })

  it('전체 시간이 개별 시간의 합보다 훨씬 짧다 (병렬로 번 시간을 계측한다)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const payload = JSON.parse(init.body)
        await new Promise((r) => setTimeout(r, 30))
        return apiResponse(payload.tools[0].name === 'record_detail_frame' ? FRAME : section(0))
      })
    )
    const { timing } = await generateDetail(ENV, CALL)
    expect(timing.calls).toBe(N + 1)
    expect(timing.serial_ms).toBeGreaterThan(timing.total_ms * 2)
  })

  it('한 섹션이 실패해도 나머지로 페이지를 완성한다', async () => {
    vi.stubGlobal('fetch', mockFetch({ fail: [1] }))
    const { result, degraded } = await generateDetail(ENV, CALL)
    expect(result.sections).toHaveLength(N - 1)
    expect(degraded).toContain('1개')
  })

  it('남은 섹션이 너무 적으면 예시 결과로 강등한다', async () => {
    vi.stubGlobal('fetch', mockFetch({ fail: [0, 1, 2, 3] }))
    await expect(generateDetail(ENV, CALL)).rejects.toThrow(/섹션 생성에 실패/)
  })

  it('헤드라인을 만들지 못하면 상세페이지로 인정하지 않는다', async () => {
    vi.stubGlobal('fetch', mockFetch({ frame: { subheadline: 'S' } }))
    await expect(generateDetail(ENV, CALL)).rejects.toThrow(/헤드라인/)
  })

  it('본문이나 제목이 빈 섹션은 성공으로 세지 않는다', async () => {
    vi.stubGlobal('fetch', mockFetch({ sections: { 0: { title: '제목', body: '   ' }, 1: { title: '', body: '본문' } } }))
    const { result } = await generateDetail(ENV, CALL)
    expect(result.sections).toHaveLength(N - 2)
  })

  it('토큰 사용량을 모든 호출에 걸쳐 합산한다 (비용 표시가 어긋나지 않게)', async () => {
    vi.stubGlobal('fetch', mockFetch())
    const { usage } = await generateDetail(ENV, CALL)
    expect(usage.input_tokens).toBe(100 * (N + 1))
    expect(usage.output_tokens).toBe(50 * (N + 1))
  })

  it('각 섹션 호출은 다른 섹션이 맡은 범위를 함께 받는다 (내용 겹침 방지)', async () => {
    const prompts = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const payload = JSON.parse(init.body)
        prompts.push(payload.messages[0].content)
        return apiResponse(payload.tools[0].name === 'record_detail_frame' ? FRAME : section(0))
      })
    )
    await generateDetail(ENV, CALL)
    const sectionPrompt = prompts.find((p) => p.includes('지금 쓸 섹션'))
    expect(sectionPrompt).toContain('겹쳐 쓰지 마세요')
    expect(sectionPrompt).toContain(SECTION_BLUEPRINT[1].role)
  })
})
