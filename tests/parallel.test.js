import { describe, it, expect, vi, afterEach } from 'vitest'
import { runAll, sumUsage } from '../functions/_lib/parallel.js'
import { generateChannels } from '../functions/api/ax/content.js'

describe('공용 병렬 실행기', () => {
  it('모든 작업을 동시에 띄운다', async () => {
    let inFlight = 0
    let peak = 0
    const task = () => async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight -= 1
      return { input: {}, usage: { input_tokens: 1, output_tokens: 2 } }
    }
    const { timing } = await runAll([task(), task(), task()])
    expect(peak).toBe(3)
    expect(timing.calls).toBe(3)
    expect(timing.serial_ms).toBeGreaterThan(timing.total_ms)
  })

  it('일부가 실패해도 전체가 무너지지 않는다', async () => {
    const { settled } = await runAll([
      async () => ({ input: { ok: true } }),
      async () => { throw new Error('down') },
    ])
    expect(settled[0].status).toBe('fulfilled')
    expect(settled[1].status).toBe('rejected')
  })

  it('결과를 버렸더라도 성공한 호출의 토큰은 모두 센다 (비용이 실제보다 작아 보이면 안 된다)', () => {
    const settled = [
      { status: 'fulfilled', value: { usage: { input_tokens: 10, output_tokens: 5 } } },
      { status: 'fulfilled', value: { usage: { input_tokens: 20, output_tokens: 7 } } },
      { status: 'rejected', reason: new Error('down') },
    ]
    expect(sumUsage(settled)).toEqual({ input_tokens: 30, output_tokens: 12 })
  })
})

const ENV = { CLAUDE_API_KEY: 'test-key' }

function apiResponse(input, usage = { input_tokens: 100, output_tokens: 50 }) {
  const body = { stop_reason: 'tool_use', content: [{ type: 'tool_use', input }], usage }
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

const CHANNELS = ['instagram', 'blog', 'youtube']
const CALL = { system: 's', product: { name: '김' }, channels: CHANNELS }

// 어떤 채널의 호출인지는 프롬프트에 적힌 "지금 만들 채널"로 가른다
function channelOf(init) {
  const content = JSON.parse(init.body).messages[0].content
  return CHANNELS.find((c) => content.includes(`[지금 만들 채널]\n- ${c}:`))
}

afterEach(() => vi.unstubAllGlobals())

describe('채널 콘텐츠 — 채널별 동시 생성', () => {
  it('채널 수만큼 호출을 동시에 띄우고 채널을 정확히 붙여 돌려준다', async () => {
    let peak = 0
    let inFlight = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const ch = channelOf(init)
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 15))
        inFlight -= 1
        return apiResponse({ title: `${ch} 제목`, body: `${ch} 본문`, hashtags: ['t'] })
      })
    )
    const { results, timing, failed } = await generateChannels(ENV, CALL)
    expect(peak).toBe(3)
    expect(timing.calls).toBe(3)
    expect(failed).toEqual([])
    expect(results.map((r) => r.channel)).toEqual(CHANNELS)
    expect(results.find((r) => r.channel === 'blog').title).toBe('blog 제목')
  })

  it('한 채널이 실패해도 나머지 채널은 살린다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const ch = channelOf(init)
        if (ch === 'blog') throw new Error('down')
        return apiResponse({ title: `${ch} 제목`, body: `${ch} 본문` })
      })
    )
    const { results, failed } = await generateChannels(ENV, CALL)
    expect(failed).toEqual(['blog'])
    expect(results.map((r) => r.channel)).toEqual(['instagram', 'youtube'])
  })

  it('모든 채널이 실패하면 예외를 던져 기존 폴백 경로로 넘긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await expect(generateChannels(ENV, CALL)).rejects.toThrow(/사용할 수 있는 채널 콘텐츠가 없/)
  })

  it('재생성에서는 그 채널의 이전 원고만 준다 (다른 채널 톤이 섞이지 않게)', async () => {
    const prompts = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        prompts.push(JSON.parse(init.body).messages[0].content)
        const ch = channelOf(init)
        return apiResponse({ title: `${ch} 제목`, body: `${ch} 본문` })
      })
    )
    await generateChannels(ENV, {
      ...CALL,
      previous: {
        results: [
          { channel: 'instagram', title: '인스타 이전', body: '인스타 본문' },
          { channel: 'blog', title: '블로그 이전', body: '블로그 본문' },
        ],
      },
      feedback: '더 친근하게',
    })
    const blogPrompt = prompts.find((p) => p.includes('- blog:'))
    expect(blogPrompt).toContain('블로그 이전')
    expect(blogPrompt).not.toContain('인스타 이전')
  })
})
