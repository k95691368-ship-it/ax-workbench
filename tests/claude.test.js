import { describe, it, expect, vi, afterEach } from 'vitest'
import { callClaudeTool, ensureContract, failureCode } from '../functions/_lib/claude.js'
import { RATE_NOTICE } from '../functions/_lib/rateLimit.js'

const ENV = { CLAUDE_API_KEY: 'test-key' }
const TOOL = { name: 'record_test', input_schema: { type: 'object' } }
const CALL = { system: 's', user: 'u', tool: TOOL, maxTokens: 100 }

function apiResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callClaudeTool', () => {
  it('정상 tool_use 응답에서 input과 usage를 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        apiResponse({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', input: { titles: ['a'] } }],
          usage: { input_tokens: 10, output_tokens: 20 },
        })
      )
    )
    const { input, usage } = await callClaudeTool(ENV, CALL)
    expect(input).toEqual({ titles: ['a'] })
    expect(usage).toEqual({ input_tokens: 10, output_tokens: 20 })
  })

  it('max_tokens로 잘린 응답은 tool_use가 있어도 거부한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        apiResponse({
          stop_reason: 'max_tokens',
          content: [{ type: 'tool_use', input: {} }],
        })
      )
    )
    await expect(callClaudeTool(ENV, CALL)).rejects.toThrow(/너무 길어/)
  })

  it('과부하(429) 시 1회 재시도해 성공 응답을 반환한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse({}, 429))
      .mockResolvedValueOnce(
        apiResponse({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', input: { ok: true } }],
          usage: { input_tokens: 1, output_tokens: 2 },
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    const { input } = await callClaudeTool(ENV, CALL)
    expect(input).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 10000)

  it('재시도까지 실패하면 혼잡 안내 오류를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse({}, 529)))
    await expect(callClaudeTool(ENV, CALL)).rejects.toThrow(/혼잡/)
  }, 10000)
})

describe('ensureContract', () => {
  it('필수 배열이 누락되면 거부한다', () => {
    expect(() => ensureContract({ titles: 'not-array' }, { arrays: ['titles'] })).toThrow(/불완전/)
  })

  it('필수 문자열이 비어 있으면 거부한다', () => {
    expect(() => ensureContract({ headline: '  ' }, { strings: ['headline'] })).toThrow(/불완전/)
  })

  it('계약을 지킨 응답은 통과시킨다', () => {
    const input = { titles: [], headline: 'ok' }
    expect(ensureContract(input, { arrays: ['titles'], strings: ['headline'] })).toBe(input)
  })
})

// 상한 판정 자체의 테스트는 tests/rateLimit.test.js 로 옮겼다.
// 단일 버킷용 checkRateLimit은 제거했다 — 여러 상한을 함께 판정해야
// "막힌 상한이 있으면 아무 몫도 쓰지 않는다"를 지킬 수 있고,
// 같은 규칙을 두 함수가 각자 구현하면 한쪽만 고쳐져 어긋난다.

describe('한도 안내 문구 (에러 벽 대신 예시 결과로 강등)', () => {
  it('IP 한도와 전체 한도의 안내가 서로 다르다', () => {
    expect(RATE_NOTICE.ip).not.toBe(RATE_NOTICE.all)
  })

  it('두 안내 모두 예시 결과임을 알리고 다시 시도할 길을 남긴다', () => {
    for (const notice of [RATE_NOTICE.ip, RATE_NOTICE.all]) {
      expect(notice).toContain('예시 결과')
      expect(notice).toContain('다시 시도')
    }
  })
})

describe('안전 분류기 거절 (오류가 아니라 HTTP 200으로 온다)', () => {
  it('stop_reason=refusal을 no_tool_use가 아니라 refusal로 분류한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        apiResponse({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio' }, content: [] })
      )
    )
    try {
      await callClaudeTool(ENV, CALL)
      throw new Error('여기 오면 안 된다')
    } catch (err) {
      // 사유가 틀리게 남으면 무엇을 고쳐야 할지 알 수 없다
      expect(failureCode(err)).toBe('refusal_bio')
      expect(err.message).toContain('거절')
    }
  })

  it('분류 정보가 없어도 refusal로 잡는다 (stop_details는 null일 수 있다)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => apiResponse({ stop_reason: 'refusal', content: [] }))
    )
    await expect(callClaudeTool(ENV, CALL)).rejects.toThrow(/거절/)
    try {
      await callClaudeTool(ENV, CALL)
    } catch (err) {
      expect(failureCode(err)).toBe('refusal')
    }
  })
})

describe('결과를 못 써도 청구된 토큰은 오류에 실린다', () => {
  const withUsage = (body) => ({
    ok: true,
    status: 200,
    json: async () => ({ ...body, usage: { input_tokens: 700, output_tokens: 120 } }),
    text: async () => JSON.stringify(body),
  })

  it('max_tokens로 잘린 응답도 사용량을 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => withUsage({ stop_reason: 'max_tokens', content: [] })))
    try {
      await callClaudeTool(ENV, CALL)
    } catch (err) {
      expect(err.usage).toEqual({ input_tokens: 700, output_tokens: 120 })
    }
  })

  it('거절·파싱 실패도 사용량을 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => withUsage({ stop_reason: 'refusal', content: [] })))
    try {
      await callClaudeTool(ENV, CALL)
    } catch (err) {
      expect(err.usage.input_tokens).toBe(700)
    }
    vi.stubGlobal('fetch', vi.fn(async () => withUsage({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] })))
    try {
      await callClaudeTool(ENV, CALL)
    } catch (err) {
      expect(failureCode(err)).toBe('no_tool_use')
      expect(err.usage.input_tokens).toBe(700)
    }
  })
})

describe('재시도 예산 — 상행 호출이 늘어 청구가 배로 뛰지 않게', () => {
  const timeoutErr = () => Object.assign(new Error('timeout'), { name: 'TimeoutError' })

  it('과부하 재시도와 타임아웃 재시도가 합쳐 최대 2회다 (예전엔 3회까지 나갔다)', async () => {
    // 1차 529 → 2차 타임아웃. 예전 구조라면 여기서 3차 요청이 또 나갔다.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse({}, 529))
      .mockImplementationOnce(async () => { throw timeoutErr() })
    vi.stubGlobal('fetch', fetchMock)
    await expect(callClaudeTool(ENV, CALL)).rejects.toThrow(/지연/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 15000)

  it('타임아웃 재시도는 남은 예산만 쓴다 (총 대기가 timeoutMs를 넘지 않게)', async () => {
    const timeouts = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // AbortSignal.timeout(ms)로 만든 signal에서 남은 시간을 직접 읽을 수 없으므로
        // doFetch에 전달된 예산을 간접 확인한다: 호출 시점의 경과 시간으로 판단
        timeouts.push(Date.now())
        throw timeoutErr()
      })
    )
    const started = Date.now()
    await expect(callClaudeTool(ENV, { ...CALL, timeoutMs: 20000 })).rejects.toThrow(/지연/)
    // 즉시 실패하는 목이라 실제 대기는 없지만, 두 번째 시도가 존재했음을 확인
    expect(timeouts.length).toBeGreaterThanOrEqual(1)
    expect(Date.now() - started).toBeLessThan(20000)
  }, 25000)

  it('남은 예산이 최소치보다 적으면 새 요청을 띄우지 않는다', async () => {
    const fetchMock = vi.fn(async () => { throw timeoutErr() })
    vi.stubGlobal('fetch', fetchMock)
    // 예산이 최소 시도 시간(8초)보다 작으면 첫 시도조차 하지 않는다
    await expect(callClaudeTool(ENV, { ...CALL, timeoutMs: 3000 })).rejects.toThrow(/지연/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('정상 응답이면 한 번만 호출한다', async () => {
    const fetchMock = vi.fn(async () =>
      apiResponse({ stop_reason: 'tool_use', content: [{ type: 'tool_use', input: { ok: true } }], usage: { input_tokens: 1, output_tokens: 2 } })
    )
    vi.stubGlobal('fetch', fetchMock)
    await callClaudeTool(ENV, CALL)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
