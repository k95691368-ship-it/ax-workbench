import { describe, it, expect } from 'vitest'
import { barGeometry } from '../src/lib/chart.js'

// SVG 좌표계는 아래로 갈수록 y가 커진다 (top=16이 위, top+height=216이 아래)
const OPTS = { top: 16, height: 200 }

describe('barGeometry (일별 매출 막대)', () => {
  it('전부 양수면 0이 바닥이고 최대값이 천장이다', () => {
    const g = barGeometry([100, 50, 0], OPTS)
    expect(g.hasNegative).toBe(false)
    expect(g.zeroY).toBe(216)
    expect(g.bars[0].top).toBe(16)
    expect(g.bars[0].height).toBe(200)
    expect(g.bars[1].height).toBe(100)
  })

  it('음수인 날이 축 아래 1px로 사라지지 않는다', () => {
    // 예전 계산: h = value/max*innerH 가 음수 → height=Math.max(h,1)=1px,
    // y는 바닥보다 아래 → 환불이 판매를 넘은 날이 화면에서 보이지 않았다.
    const g = barGeometry([100, -100], OPTS)
    expect(g.hasNegative).toBe(true)
    expect(g.zeroY).toBe(116) // 범위가 -100~100이므로 0선이 정확히 가운데
    const neg = g.bars[1]
    expect(neg.negative).toBe(true)
    expect(neg.top).toBe(116) // 0선에서 시작해 아래로 자란다
    expect(neg.height).toBe(100) // 1px이 아니다
  })

  it('음수 막대는 0선 아래에, 양수 막대는 0선 위에 그려진다', () => {
    const g = barGeometry([80, -20], OPTS)
    const [pos, neg] = g.bars
    expect(pos.top + pos.height).toBeCloseTo(g.zeroY)
    expect(neg.top).toBeCloseTo(g.zeroY)
    expect(neg.top + neg.height).toBeGreaterThan(g.zeroY)
  })

  it('음수가 있으면 눈금에 최소값과 0을 함께 표시한다', () => {
    expect(barGeometry([80, -20], OPTS).ticks).toEqual([80, 0, -20])
    expect(barGeometry([80, 20], OPTS).ticks).toEqual([80, 40, 0])
  })

  it('전부 0이거나 빈 배열에서도 나눗셈이 깨지지 않는다', () => {
    expect(barGeometry([0, 0], OPTS).bars.every((b) => b.height === 1)).toBe(true)
    expect(barGeometry([], OPTS).bars).toEqual([])
    expect(Number.isFinite(barGeometry([], OPTS).zeroY)).toBe(true)
  })

  it('숫자가 아닌 값은 0으로 본다 (NaN 좌표로 막대가 사라지지 않게)', () => {
    const g = barGeometry([100, undefined, NaN], OPTS)
    expect(g.bars.every((b) => Number.isFinite(b.top) && Number.isFinite(b.height))).toBe(true)
  })
})
