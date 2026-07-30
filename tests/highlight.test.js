import { describe, it, expect } from 'vitest'
import { highlightSegments } from '../src/lib/highlight.js'
import { scanText } from '../src/lib/compliance.js'

// 하이라이트 구간을 다시 문자열로 합쳐 원문과 같은지 확인 (글자 유실·중복 방지)
const rejoin = (segs) => segs.map((s) => s.text).join('')
const marked = (segs) => segs.filter((s) => s.severity).map((s) => s.text)

describe('금칙어 하이라이트 — 원문 기준 구간으로 칠한다', () => {
  it('우회 표기의 실제 구간을 전부 칠한다 (예전엔 일부만 칠했다)', () => {
    const text = '치 료 효과가 뛰어납니다'
    const segs = highlightSegments(text, scanText(text))
    // f.word는 '치료'(2자)지만 원문은 '치 료'(3자)다
    expect(marked(segs)).toContain('치 료')
    expect(rejoin(segs)).toBe(text)
  })

  it('붙어 있는 위반 두 개를 모두 표시한다 (예전엔 뒤쪽이 사라졌다)', () => {
    const text = '당뇨개선치료'
    const findings = scanText(text)
    const segs = highlightSegments(text, findings)
    // 표에 있는 위반 수와 화면에 칠해진 수가 같아야 한다
    expect(marked(segs).length).toBe(findings.length)
    expect(rejoin(segs)).toBe(text)
  })

  it('어떤 입력에서도 원문을 그대로 재구성한다', () => {
    for (const text of [
      '변비 치료에 즉시 효과! 국내 1위 유일한 유산균',
      '최 고 품질 100% 효과',
      '평범한 상품 설명입니다',
      '',
    ]) {
      expect(rejoin(highlightSegments(text, scanText(text)))).toBe(text)
    }
  })

  it('length가 없는 옛 형태의 finding도 처리한다', () => {
    const segs = highlightSegments('치료 효과', [{ index: 0, word: '치료', severity: 'high' }])
    expect(marked(segs)).toEqual(['치료'])
  })
})
