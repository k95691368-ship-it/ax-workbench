// 막대 차트 기하 계산 (순수 함수 — 화면과 분리해 테스트한다)
//
// 순매출이 음수인 날(환불이 판매를 넘은 날)은 실무에서 드물지 않고,
// 회계 서식 괄호 음수를 제대로 읽게 된 뒤로는 더 자주 나온다.
// 0을 항상 바닥으로 두면 음수 막대는 축 아래로 1px만 그려져 눈에 보이지 않는다 —
// 즉 "가장 나쁜 날"이 차트에서 사라진다. 0선을 값 범위에서 계산해야 위아래로 그릴 수 있다.
export function barGeometry(values, { top = 0, height = 100, minBar = 1 } = {}) {
  const nums = (values || []).map((v) => (Number.isFinite(v) ? v : 0))
  const max = Math.max(0, ...nums)
  const min = Math.min(0, ...nums)
  const span = max - min || 1
  const yOf = (v) => top + ((max - v) / span) * height
  const zeroY = yOf(0)
  const bars = nums.map((v) => {
    const y = yOf(v)
    return {
      value: v,
      negative: v < 0,
      top: v < 0 ? zeroY : y,
      height: Math.max(Math.abs(zeroY - y), minBar),
    }
  })
  const hasNegative = min < 0
  return {
    max,
    min,
    zeroY,
    hasNegative,
    yOf,
    bars,
    ticks: hasNegative ? [max, 0, min] : [max, Math.round(max * 0.5), 0],
  }
}
