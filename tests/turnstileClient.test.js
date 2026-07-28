import { describe, it, expect, beforeEach, vi } from 'vitest'

// 브라우저 API를 최소한으로 흉내 내어 동시 호출 동작만 검증한다.
function installDom() {
  const created = []
  const removed = []
  globalThis.document = {
    createElement: () => {
      const el = { style: {}, remove: () => removed.push(el) }
      created.push(el)
      return el
    },
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
  }
  return { created, removed }
}

describe('getTurnstileToken — 병렬 호출 안전성', () => {
  let dom

  beforeEach(() => {
    vi.resetModules()
    dom = installDom()
  })

  it('동시에 3번 불러도 각 호출이 서로 다른 컨테이너를 쓴다 (위젯 충돌 방지)', async () => {
    const renderedOn = []
    let live = 0
    let maxLive = 0
    globalThis.window = {
      turnstile: {
        render: (el, opts) => {
          renderedOn.push(el)
          live += 1
          maxLive = Math.max(maxLive, live)
          setTimeout(() => {
            live -= 1
            opts.callback(`token-${renderedOn.length}`)
          }, 10)
          return renderedOn.length
        },
        remove: () => {},
      },
    }

    const { getTurnstileToken } = await import('../src/lib/turnstile.js')
    const tokens = await Promise.all([getTurnstileToken(), getTurnstileToken(), getTurnstileToken()])

    // 요청마다 전용 컨테이너 — 하나도 공유되지 않아야 한다
    expect(new Set(renderedOn).size).toBe(3)
    // 발급이 직렬화되어 위젯이 동시에 떠 있지 않아야 한다
    expect(maxLive).toBe(1)
    // 각 호출이 자기 토큰을 받는다 (토큰은 1회용이므로 중복이면 서버가 거부한다)
    expect(new Set(tokens).size).toBe(3)
    // 사용한 컨테이너는 모두 정리된다
    expect(dom.removed.length).toBe(3)
  })

  it('위젯이 오류를 내도 null을 반환하고 다음 호출을 막지 않는다', async () => {
    let call = 0
    globalThis.window = {
      turnstile: {
        render: (el, opts) => {
          call += 1
          const n = call
          setTimeout(() => (n === 1 ? opts['error-callback']() : opts.callback('ok')), 5)
          return n
        },
        remove: () => {},
      },
    }

    const { getTurnstileToken } = await import('../src/lib/turnstile.js')
    const [first, second] = await Promise.all([getTurnstileToken(), getTurnstileToken()])
    expect(first).toBeNull()
    expect(second).toBe('ok')
  })

  it('render가 예외를 던져도 호출자에게 전파하지 않는다', async () => {
    globalThis.window = {
      turnstile: {
        render: () => {
          throw new Error('widget boom')
        },
        remove: () => {},
      },
    }
    const { getTurnstileToken } = await import('../src/lib/turnstile.js')
    await expect(getTurnstileToken()).resolves.toBeNull()
  })
})
