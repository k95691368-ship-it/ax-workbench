import { describe, it, expect, vi, afterEach } from 'vitest'
import { verifyTurnstile } from '../functions/_lib/turnstile.js'

function req(headers = {}) {
  return { headers: { get: (k) => headers[k.toLowerCase()] ?? null } }
}

afterEach(() => vi.unstubAllGlobals())

describe('verifyTurnstile', () => {
  it('시크릿 미설정 시(로컬 개발) 통과시킨다', async () => {
    expect(await verifyTurnstile({}, req())).toEqual({ ok: true, codes: 'not-configured' })
  })

  it('시크릿이 있는데 토큰이 없으면 실패로 표시한다 (사유: missing-token)', async () => {
    expect(await verifyTurnstile({ TURNSTILE_SECRET: 's' }, req())).toEqual({
      ok: false,
      codes: 'missing-token',
    })
  })

  it('Cloudflare 검증 성공 시 통과시킨다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true }) })))
    const r = await verifyTurnstile({ TURNSTILE_SECRET: 's' }, req({ 'x-turnstile-token': 't' }))
    expect(r.ok).toBe(true)
  })

  it('검증 실패 시 Cloudflare가 준 사유 코드를 그대로 돌려준다 (진단용)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ success: false, 'error-codes': ['invalid-input-secret'] }),
      }))
    )
    const r = await verifyTurnstile({ TURNSTILE_SECRET: 's' }, req({ 'x-turnstile-token': 't' }))
    expect(r).toEqual({ ok: false, codes: 'invalid-input-secret' })
  })

  it('사유 코드가 여러 개면 쉼표로 합쳐 돌려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate', 'bad-request'] }),
      }))
    )
    const r = await verifyTurnstile({ TURNSTILE_SECRET: 's' }, req({ 'x-turnstile-token': 't' }))
    expect(r.codes).toBe('timeout-or-duplicate,bad-request')
  })

  it('검증 서비스 장애 시에는 서비스 연속성을 위해 통과시킨다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      })
    )
    const r = await verifyTurnstile({ TURNSTILE_SECRET: 's' }, req({ 'x-turnstile-token': 't' }))
    expect(r).toEqual({ ok: true, codes: 'verify-unreachable' })
  })
})
