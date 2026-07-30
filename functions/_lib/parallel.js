// 여러 AI 호출을 동시에 돌리는 공용 실행기.
//
// 상세페이지·대량 등록·채널 콘텐츠가 모두 같은 모양의 코드를 갖게 됐다:
//   "N개 호출을 동시에 → 실패한 것만 격리 → 토큰 합산 → 병렬로 번 시간 계측".
// 같은 로직을 세 곳에 복사하면 언젠가 한 곳만 고쳐진다. 실제로 프롬프트 주입 방어와
// 실패 사유 계측이 sales-report 한 곳에만 빠져 있었고, 그건 복사본이 갈라진 결과였다.
//
// 그래서 실행 방식은 여기 한 곳에 두고, 각 기능은 "무엇을 보낼지"와
// "실패했을 때 무엇으로 대신할지"만 정한다.

// 항목을 size개씩 묶는다.
// 대량 등록(상품)과 채널 콘텐츠(채널)가 같은 코드를 각자 갖고 있었다 — 한 곳에 둔다.
export function chunk(items, size) {
  const step = Math.max(1, size)
  const out = []
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step))
  return out
}

// tasks: () => Promise<{ input, usage }> 배열
// 반환: { settled, timing } — settled는 Promise.allSettled 결과 그대로
export async function runAll(tasks) {
  const started = Date.now()
  const elapsed = Array.from({ length: tasks.length }, () => 0)

  const settled = await Promise.allSettled(
    tasks.map((task, i) => {
      const s = Date.now()
      return task().finally(() => {
        elapsed[i] = Date.now() - s
      })
    })
  )

  return {
    settled,
    timing: {
      total_ms: Date.now() - started,
      // 개별 호출 시간의 합 — 한 번에 다 만들던 예전 구조였다면 걸렸을 시간이다.
      // total_ms와의 차이가 병렬로 번 시간이고, 이 값을 화면에도 그대로 보여준다.
      serial_ms: elapsed.reduce((a, b) => a + b, 0),
      slowest_ms: Math.max(0, ...elapsed),
      calls: tasks.length,
    },
  }
}

// 성공한 모든 호출의 토큰을 더한다.
//
// "쓸 수 있는 결과만" 세지 않는다는 점이 중요하다. 응답이 와서 토큰을 소비했다면
// 그 결과를 버렸더라도 비용은 이미 발생했다. 화면의 비용 표시가 실제 청구보다
// 작아 보이면 안 된다.
export function sumUsage(settled) {
  let input_tokens = 0
  let output_tokens = 0
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    input_tokens += r.value?.usage?.input_tokens || 0
    output_tokens += r.value?.usage?.output_tokens || 0
  }
  return { input_tokens, output_tokens }
}
