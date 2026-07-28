// 사용량 제한.
//
// 예전 구현은 COUNT로 조회한 뒤 INSERT 했다. 두 문장 사이에 다른 요청이 끼어들면
// 상한을 넘겨 통과시킬 수 있고(경쟁 조건), D1 오류 시에는 무조건 통과(fail-open)라
// 장애가 나면 비용 상한이 통째로 사라졌다.
//
// 지금은 (1) 조건부 INSERT 한 문장으로 원자적으로 처리하고,
// (2) 비용을 지키는 상한은 오류 시 막는 쪽(fail-closed)으로 기울인다.
//    사용자 편의를 지키는 IP별 상한은 그대로 통과시킨다(fail-open).

// 한도에 걸렸을 때 사용자에게 보여줄 안내.
//
// 예전에는 429 에러를 그대로 돌려줬다. 하지만 이 서비스의 다른 모든 한도(보안 검증 실패,
// 일일 예산 소진, AI 혼잡)는 "차단"이 아니라 "예시 결과로 강등"으로 처리한다.
// 레이트리밋만 에러 벽을 세우면, 기능을 몇 번 눌러본 사람이 기능 대신 빨간 에러를 본다.
// AI 호출을 막는다는 목적(비용 보호)은 그대로 지키면서, 화면은 막다른 길이 되지 않게 한다.
export const RATE_NOTICE = {
  ip: '짧은 시간에 여러 번 생성하셔서 지금은 예시 결과를 표시합니다. 잠시 후 다시 시도하시면 실제 AI 생성으로 돌아갑니다.',
  all: '지금 이용자가 많아 예시 결과를 표시합니다. 잠시 후 다시 시도해주세요.',
}

export async function checkRateLimit(env, bucket, maxHits, windowSeconds, { failOpen = true } = {}) {
  if (!env.DB) return true // 로컬 개발 등 D1 미설정
  try {
    return await checkRateLimitInner(env, bucket, maxHits, windowSeconds)
  } catch {
    return failOpen
  }
}

async function checkRateLimitInner(env, bucket, maxHits, windowSeconds) {
  await env.DB.prepare(
    `DELETE FROM rate_limit_hits WHERE bucket = ? AND created_at < datetime('now', '-' || ? || ' seconds')`
  )
    .bind(bucket, windowSeconds)
    .run()

  // 가끔 전역 청소: 다시 조회되지 않는 콜드 버킷의 오래된 행이 누적되는 것을 막는다.
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM rate_limit_hits WHERE created_at < datetime('now', '-1 day')")
      .run()
      .catch(() => {})
  }

  // 조회와 기록을 한 문장으로 — 동시 요청이 같은 빈자리를 두 번 차지하지 못하게 한다.
  const res = await env.DB.prepare(
    `INSERT INTO rate_limit_hits (bucket)
     SELECT ?
     WHERE (SELECT COUNT(*) FROM rate_limit_hits WHERE bucket = ?) < ?`
  )
    .bind(bucket, bucket, maxHits)
    .run()

  // 삽입이 일어났으면 허용, 아니면 상한 도달
  const changes = res?.meta?.changes
  return typeof changes === 'number' ? changes > 0 : true
}
