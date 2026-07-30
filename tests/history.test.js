import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  pushHistory,
  listHistory,
  removeHistory,
  clearHistory,
  countViolations,
} from '../src/lib/history.js'

// 브라우저 저장소·이벤트 스텁 (이력은 전적으로 브라우저에만 저장된다)
function makeStorage(limitBytes = Infinity) {
  const map = new Map()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (String(v).length > limitBytes) {
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        throw err
      }
      map.set(k, String(v))
    },
    removeItem: (k) => map.delete(k),
  }
}

function stub(storage) {
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', {
    dispatchEvent: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubGlobal('CustomEvent', class {})
}

beforeEach(() => stub(makeStorage()))
afterEach(() => vi.unstubAllGlobals())

const entry = (label, result = {}) => ({ feature: 'detail', label, input: { name: label }, result })

describe('생성 이력 저장·복원', () => {
  it('최신 생성이 맨 앞에 오도록 쌓인다', () => {
    pushHistory(entry('첫 번째'))
    pushHistory(entry('두 번째'))
    expect(listHistory().map((e) => e.label)).toEqual(['두 번째', '첫 번째'])
  })

  it('복원에 필요한 입력과 결과를 함께 보관한다', () => {
    pushHistory(entry('유산균 30포', { headline: '헤드라인', demo: false }))
    const [saved] = listHistory()
    expect(saved.input).toEqual({ name: '유산균 30포' })
    expect(saved.result.headline).toBe('헤드라인')
    expect(saved.ts).toBeTypeOf('number')
  })

  it('최대 20건까지만 보관한다 (오래된 것부터 밀려난다)', () => {
    for (let i = 1; i <= 25; i++) pushHistory(entry(`생성 ${i}`))
    const list = listHistory()
    expect(list).toHaveLength(20)
    expect(list[0].label).toBe('생성 25')
    expect(list.some((e) => e.label === '생성 5')).toBe(false)
  })

  it('알 수 없는 기능이나 빈 결과는 기록하지 않는다', () => {
    expect(pushHistory({ feature: '없는기능', result: {} })).toBeNull()
    expect(pushHistory({ feature: 'detail', result: null })).toBeNull()
    expect(listHistory()).toHaveLength(0)
  })

  it('개별 삭제와 전체 비우기가 동작한다', () => {
    const a = pushHistory(entry('A'))
    pushHistory(entry('B'))
    removeHistory(a.id)
    expect(listHistory().map((e) => e.label)).toEqual(['B'])
    clearHistory()
    expect(listHistory()).toEqual([])
  })

  it('저장 공간이 부족하면 오래된 이력을 버리고 최신 것은 지켜낸다', () => {
    stub(makeStorage(900)) // 아주 작은 저장소
    for (let i = 1; i <= 6; i++) pushHistory(entry(`생성 ${i}`, { filler: 'x'.repeat(120) }))
    const list = listHistory()
    expect(list.length).toBeGreaterThan(0)
    expect(list[0].label).toBe('생성 6')
  })

  it('저장 자체가 불가능한 환경에서도 예외를 던지지 않는다', () => {
    stub(makeStorage(0))
    expect(() => pushHistory(entry('저장 불가'))).not.toThrow()
    expect(listHistory()).toEqual([])
  })
})

describe('countViolations (이력에 남길 위반 건수)', () => {
  it('항목별 결과가 있으면 행에서만 센다 (최상위는 같은 값의 합집합이라 중복이다)', () => {
    // 이 테스트는 예전에 4를 기대했다 — 최상위 2건 + 행 2건.
    // 그런데 서버는 행 단위 누락을 모아 최상위 집계로도 함께 내보내므로,
    // 둘을 더하면 같은 위반을 두 번 세는 것이다. 실제 위반은 행에 있는 2건이다.
    expect(
      countViolations({
        ad_check: [{ word: '1위' }],
        brand_missing: ['필수 문구'],
        results: [{ ad_check: [{ word: '최고' }] }, { brand_missing: ['문구2'] }],
      })
    ).toBe(2)
  })

  it('온보딩처럼 여러 기능을 묶은 결과도 합산한다', () => {
    expect(
      countViolations({
        detail: { ad_check: [{ word: '치료' }] },
        listing: { ad_check: [{ word: '1위' }] },
        content: { results: [{ ad_check: [{ word: '디톡스' }] }] },
      })
    ).toBe(3)
  })

  it('위반이 없거나 결과가 없으면 0', () => {
    expect(countViolations({ ad_check: [] })).toBe(0)
    expect(countViolations(null)).toBe(0)
  })
})

describe('규정 위반 건수를 중복으로 세지 않는다', () => {
  it('서버가 행 단위 누락을 최상위에도 담아 보내도 한 번만 센다', () => {
    // 리뷰 응대 응답 모양: 행에 brand_missing이 있고 최상위는 그 합집합이다
    const result = {
      brand_missing: ['무료배송'],
      results: [
        { reply: 'a', brand_missing: ['무료배송'] },
        { reply: 'b' },
      ],
    }
    // 실제 위반은 1건 (예전에는 2건으로 표시됐다)
    expect(countViolations(result)).toBe(1)
  })

  it('누락 답변이 3건이면 3건으로 센다', () => {
    const result = {
      brand_missing: ['무료배송'],
      results: [1, 2, 3].map(() => ({ brand_missing: ['무료배송'] })),
    }
    expect(countViolations(result)).toBe(3)
  })

  it('항목별 결과가 없는 응답(상세페이지)은 최상위로 센다', () => {
    expect(countViolations({ ad_check: [{ word: '치료' }], brand_missing: ['무료배송'] })).toBe(2)
  })

  it('온보딩 묶음은 기능별로 합산한다', () => {
    const bundle = {
      detail: { ad_check: [{ word: '치료' }] },
      listing: { ad_check: [{ word: '최고' }] },
      content: { results: [{ ad_check: [{ word: '1위' }] }] },
    }
    expect(countViolations(bundle)).toBe(3)
  })
})
