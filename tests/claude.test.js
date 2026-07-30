import { describe, it, expect, vi, afterEach } from 'vitest'
import { callClaudeTool, ensureContract, failureCode } from '../functions/_lib/claude.js'
import { checkRateLimit, RATE_NOTICE } from '../functions/_lib/rateLimit.js'

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

describe('checkRateLimit', () => {
  // 조건부 INSERT 한 문장으로 처리하므로, 삽입이 일어났는지(meta.changes)로 허용 여부를 판단한다
  function mockDb(changes, { throws = false } = {}) {
    const stmt = {
      bind: () => stmt,
      run: async () => {
        if (throws) throw new Error('D1 down')
        return { meta: { changes } }
      },
    }
    return { prepare: () => stmt }
  }

  it('빈자리가 있으면 기록하고 허용한다', async () => {
    expect(await checkRateLimit({ DB: mockDb(1) }, 'b', 5, 60)).toBe(true)
  })

  it('한도에 도달하면 삽입이 일어나지 않아 차단된다', async () => {
    expect(await checkRateLimit({ DB: mockDb(0) }, 'b', 5, 60)).toBe(false)
  })

  it('DB 오류 시 기본은 서비스 연속성을 위해 통과시킨다 (사용자 편의 상한)', async () => {
    expect(await checkRateLimit({ DB: mockDb(0, { throws: true }) }, 'b', 5, 60)).toBe(true)
  })

  it('비용을 지키는 상한은 DB 오류 시 막는 쪽으로 기운다 (fail-closed)', async () => {
    expect(
      await checkRateLimit({ DB: mockDb(0, { throws: true }) }, 'b', 5, 60, { failOpen: false })
    ).toBe(false)
  })

  it('DB 바인딩이 없으면 제한 없이 통과한다', async () => {
    expect(await checkRateLimit({}, 'b', 5, 60)).toBe(true)
  })
})

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
