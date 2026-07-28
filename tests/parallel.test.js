import { describe, it, expect, vi, afterEach } from 'vitest'
import { runAll, sumUsage } from '../functions/_lib/parallel.js'
import { generateChannels, chunkChannels, CHANNEL_CHUNK } from '../functions/api/ax/content.js'

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

const CHANNELS = ['instagram', 'blog', 'youtube', 'cardnews', 'threads', 'tiktok']
const CALL = { system: 's', product: { name: '김' }, channels: CHANNELS }

// 이 호출이 어떤 채널들을 맡았는지는 프롬프트에 적힌 스펙으로 가른다
function channelsOf(init) {
  const content = JSON.parse(init.body).messages[0].content
  const spec = content.split('[지금 만들 채널과 스펙]')[1].split('[다른 채널')[0]
  return CHANNELS.filter((c) => spec.includes(`- ${c}:`))
}

afterEach(() => vi.unstubAllGlobals())

describe('채널 콘텐츠 — 묶음 단위 동시 생성', () => {
  it('채널을 묶음 크기로 나누고 어느 채널도 빠뜨리지 않는다', () => {
    const groups = chunkChannels(CHANNELS)
    expect(groups.flat()).toEqual(CHANNELS)
    expect(groups).toHaveLength(Math.ceil(CHANNELS.length / CHANNEL_CHUNK))
    expect(groups.every((g) => g.length <= CHANNEL_CHUNK)).toBe(true)
    expect(chunkChannels(['instagram'])).toEqual([['instagram']])
  })

  it('묶음만큼 호출을 동시에 띄우고 모든 채널을 돌려준다', async () => {
    let peak = 0
    let inFlight = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const chs = channelsOf(init)
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 15))
        inFlight -= 1
        return apiResponse({ results: chs.map((c) => ({ channel: c, title: `${c} 제목`, body: `${c} 본문` })) })
      })
    )
    const { results, timing, failed } = await generateChannels(ENV, CALL)
    expect(timing.calls).toBe(chunkChannels(CHANNELS).length)
    expect(peak).toBe(chunkChannels(CHANNELS).length)
    expect(failed).toEqual([])
    expect(results.map((r) => r.channel).sort()).toEqual([...CHANNELS].sort())
  })

  it('한 묶음이 실패해도 나머지 채널은 살린다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const chs = channelsOf(init)
        if (chs.includes('cardnews')) throw new Error('down')
        return apiResponse({ results: chs.map((c) => ({ channel: c, title: `${c} 제목`, body: `${c} 본문` })) })
      })
    )
    const { results, failed } = await generateChannels(ENV, CALL)
    // 실패한 묶음에 속한 채널만 빠지고, 나머지는 그대로 나간다
    const downGroup = chunkChannels(CHANNELS).find((g) => g.includes('cardnews'))
    expect(failed.sort()).toEqual([...downGroup].sort())
    expect(results.map((r) => r.channel)).toEqual(CHANNELS.filter((c) => !downGroup.includes(c)))
  })

  it('응답에서 특정 채널이 빠지면 그 채널만 알려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        // AI가 tiktok만 빠뜨린 상황 (묶음 크기와 무관하게 성립한다)
        const chs = channelsOf(init).filter((c) => c !== 'tiktok')
        return apiResponse({ results: chs.map((c) => ({ channel: c, title: `${c} 제목`, body: `${c} 본문` })) })
      })
    )
    const { results, failed } = await generateChannels(ENV, CALL)
    expect(failed).toEqual(['tiktok'])
    expect(results.map((r) => r.channel)).toEqual(CHANNELS.filter((c) => c !== 'tiktok'))
  })

  it('요청하지 않은 채널이 섞여 오면 버린다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const chs = channelsOf(init)
        return apiResponse({
          results: [
            ...chs.map((c) => ({ channel: c, title: `${c} 제목`, body: `${c} 본문` })),
            { channel: 'facebook', title: '안 시켰는데', body: '본문' },
          ],
        })
      })
    )
    const { results } = await generateChannels(ENV, CALL)
    expect(results.some((r) => r.channel === 'facebook')).toBe(false)
  })

  it('모든 묶음이 실패하면 예외를 던져 기존 폴백 경로로 넘긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await expect(generateChannels(ENV, CALL)).rejects.toThrow(/사용할 수 있는 채널 콘텐츠가 없/)
  })

  it('재생성에서는 그 묶음의 이전 원고만 준다 (다른 채널 톤이 섞이지 않게)', async () => {
    const prompts = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        prompts.push(JSON.parse(init.body).messages[0].content)
        const chs = channelsOf(init)
        return apiResponse({ results: chs.map((c) => ({ channel: c, title: `${c} 제목`, body: `${c} 본문` })) })
      })
    )
    await generateChannels(ENV, {
      ...CALL,
      previous: {
        results: [
          { channel: 'instagram', title: '인스타 이전', body: '본문' },
          { channel: 'tiktok', title: '틱톡 이전', body: '본문' },
        ],
      },
      feedback: '더 친근하게',
    })
    const first = prompts.find((p) => p.includes('- instagram:'))
    expect(first).toContain('인스타 이전')
    // 같은 묶음이 아닌 채널의 이전 원고는 섞이지 않는다
    const sameGroup = chunkChannels(CHANNELS).find((g) => g.includes('instagram'))
    if (!sameGroup.includes('tiktok')) expect(first).not.toContain('틱톡 이전')
  })
})
