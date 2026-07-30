import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateBatch, chunk, CHUNK_SIZE } from '../functions/api/ax/batch-listing.js'

const ENV = { CLAUDE_API_KEY: 'test-key' }

const product = (i) => ({ name: `상품${i}`, category: '식품 > 김', features: '남해안 원초', violations: [] })
const products = (n) => Array.from({ length: n }, (_, i) => product(i))

function apiResponse(results, usage = { input_tokens: 100, output_tokens: 50 }) {
  const body = { stop_reason: 'tool_use', content: [{ type: 'tool_use', input: { results } }], usage }
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

// 요청 본문에서 이 묶음이 받은 상품들을 읽어 그대로 결과를 만들어 준다
function rowsFor(payload) {
  const content = payload.messages[0].content
  const names = [...content.matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1])
  return names.map((n) => ({ input_name: n, title: `${n} 최적화`, alt_title: 'alt', keywords: ['k'], tags: ['t'] }))
}

afterEach(() => vi.unstubAllGlobals())

describe('대량 등록 — 묶음 병렬 처리', () => {
  it('상품을 묶음 크기로 나눈다', () => {
    expect(chunk(products(12)).map((g) => g.length)).toEqual([5, 5, 2])
    expect(chunk(products(5)).map((g) => g.length)).toEqual([5])
  })

  it('20개를 여러 묶음으로 나눠 동시에 보낸다', async () => {
    let inFlight = 0
    let peak = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 20))
        inFlight -= 1
        return apiResponse(rowsFor(JSON.parse(init.body)))
      })
    )
    const { rows, timing } = await generateBatch(ENV, { system: 's', products: products(20) })
    expect(rows).toHaveLength(20)
    expect(timing.calls).toBe(4)
    expect(peak).toBe(4)
    expect(timing.serial_ms).toBeGreaterThan(timing.total_ms)
  })

  it('입력 순서와 상품명을 그대로 지킨다 (행이 뒤바뀌면 잘못된 상품이 등록된다)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => apiResponse(rowsFor(JSON.parse(init.body)))))
    const { rows } = await generateBatch(ENV, { system: 's', products: products(12) })
    expect(rows.map((r) => r.input_name)).toEqual(products(12).map((p) => p.name))
  })

  it('한 묶음이 실패해도 그 묶음만 예시로 채우고 나머지는 살린다', async () => {
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        if (call++ === 1) throw new Error('down')
        return apiResponse(rowsFor(JSON.parse(init.body)))
      })
    )
    const { rows, failedCount } = await generateBatch(ENV, { system: 's', products: products(15) })
    expect(rows).toHaveLength(15)
    expect(failedCount).toBe(CHUNK_SIZE)
    expect(rows.filter((r) => r.title.includes('최적화'))).toHaveLength(10)
  })

  it('묶음이 상품 일부만 돌려주면 남은 자리를 예시로 채운다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => apiResponse(rowsFor(JSON.parse(init.body)).slice(0, 3)))
    )
    const { rows, failedCount } = await generateBatch(ENV, { system: 's', products: products(5) })
    expect(rows).toHaveLength(5)
    expect(failedCount).toBe(2)
  })

  it('모든 묶음이 실패하면 예외를 던져 기존 폴백 경로로 넘긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await expect(generateBatch(ENV, { system: 's', products: products(10) })).rejects.toThrow(/불완전/)
  })

  it('토큰 사용량을 모든 묶음에 걸쳐 합산한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => apiResponse(rowsFor(JSON.parse(init.body)))))
    const { usage } = await generateBatch(ENV, { system: 's', products: products(20) })
    expect(usage.input_tokens).toBe(400)
    expect(usage.output_tokens).toBe(200)
  })
})

describe('행 정렬 정합성 — 상품과 결과가 뒤바뀌지 않아야 한다', () => {
  it('AI가 중간 상품을 빠뜨려도 남은 결과가 밀려 붙지 않는다', async () => {
    // 상품0,1,2를 보냈는데 AI가 상품1을 빠뜨리고 0,2만 돌려준 상황
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        apiResponse([
          { input_name: '상품0', title: '상품0 최적화', alt_title: 'a', keywords: [], tags: [] },
          { input_name: '상품2', title: '상품2 최적화', alt_title: 'a', keywords: [], tags: [] },
        ])
      )
    )
    const { rows, failedCount } = await generateBatch(ENV, { system: 's', products: products(3) })
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.input_name)).toEqual(['상품0', '상품1', '상품2'])
    // 상품2의 결과가 상품1 자리로 밀려오면 안 된다
    expect(rows[1].title).not.toContain('상품2')
    expect(rows[2].title).toBe('상품2 최적화')
    expect(failedCount).toBe(1)
  })

  it('제목이 깨진 항목이 앞에 있어도 뒤 상품이 밀리지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        apiResponse([
          { input_name: '상품0', title: '   ' },
          { input_name: '상품1', title: '상품1 최적화', alt_title: 'a', keywords: [], tags: [] },
          { input_name: '상품2', title: '상품2 최적화', alt_title: 'a', keywords: [], tags: [] },
        ])
      )
    )
    const { rows } = await generateBatch(ENV, { system: 's', products: products(3) })
    expect(rows.map((r) => r.input_name)).toEqual(['상품0', '상품1', '상품2'])
    expect(rows[1].title).toBe('상품1 최적화')
    expect(rows[2].title).toBe('상품2 최적화')
  })

  it('AI가 순서를 바꿔 돌려줘도 상품명 기준으로 제자리에 놓는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        apiResponse([
          { input_name: '상품2', title: '상품2 최적화', alt_title: 'a', keywords: [], tags: [] },
          { input_name: '상품0', title: '상품0 최적화', alt_title: 'a', keywords: [], tags: [] },
          { input_name: '상품1', title: '상품1 최적화', alt_title: 'a', keywords: [], tags: [] },
        ])
      )
    )
    const { rows } = await generateBatch(ENV, { system: 's', products: products(3) })
    expect(rows.map((r) => r.title)).toEqual(['상품0 최적화', '상품1 최적화', '상품2 최적화'])
  })
})

describe('중복 응답이 다른 상품 자리를 차지하지 않는다', () => {
  it('같은 상품을 두 번 쓰고 하나를 빠뜨린 응답에서 행이 섞이지 않는다', async () => {
    // 감사 재현: A를 두 번, B를 빠뜨림 → 예전에는 남은 A안2가 B 자리에 들어가
    // "입력 상품명: 상품1 / 최적화 상품명: 상품0 안2"가 됐고 CSV째로 등록됐다.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        apiResponse([
          { input_name: '상품0', title: '상품0 안1', alt_title: 'a', keywords: [], tags: [] },
          { input_name: '상품0', title: '상품0 안2', alt_title: 'a', keywords: [], tags: [] },
          { input_name: '상품2', title: '상품2 최적화', alt_title: 'a', keywords: [], tags: [] },
        ])
      )
    )
    const { rows, failedCount } = await generateBatch(ENV, { system: 's', products: products(3) })
    expect(rows.map((r) => r.input_name)).toEqual(['상품0', '상품1', '상품2'])
    expect(rows[0].title).toBe('상품0 안1')
    // 상품1 자리에 상품0의 중복 응답이 오면 안 된다 — 예시로 채워야 한다
    expect(rows[1].title).not.toContain('상품0')
    expect(rows[1].filled).toBe(true)
    expect(rows[2].title).toBe('상품2 최적화')
    expect(failedCount).toBe(1)
  })

  it('이름이 깨진 응답은 여전히 남은 자리로 구제한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        apiResponse([
          { input_name: '', title: '이름없는 결과', alt_title: 'a', keywords: [], tags: [] },
          { input_name: '상품1', title: '상품1 최적화', alt_title: 'a', keywords: [], tags: [] },
        ])
      )
    )
    const { rows } = await generateBatch(ENV, { system: 's', products: products(2) })
    expect(rows[0].title).toBe('이름없는 결과')
    expect(rows[1].title).toBe('상품1 최적화')
  })
})

describe('예시로 채운 행은 라이브 결과와 구분된다', () => {
  it('부분 실패로 채운 행에 filled 표시가 붙는다', async () => {
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        if (call++ === 1) throw new Error('down')
        return apiResponse(rowsFor(JSON.parse(init.body)))
      })
    )
    const { rows } = await generateBatch(ENV, { system: 's', products: products(15) })
    const filled = rows.filter((r) => r.filled)
    const live = rows.filter((r) => !r.filled)
    expect(filled).toHaveLength(CHUNK_SIZE)
    expect(live).toHaveLength(10)
    // 라이브 행에는 표시가 붙지 않아야 한다 (거짓 경고 방지)
    expect(live.every((r) => r.filled === undefined)).toBe(true)
  })

  it('전부 라이브면 어떤 행에도 표시가 없다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => apiResponse(rowsFor(JSON.parse(init.body)))))
    const { rows } = await generateBatch(ENV, { system: 's', products: products(10) })
    expect(rows.some((r) => r.filled)).toBe(false)
  })
})
