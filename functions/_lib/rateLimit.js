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

async function purge(env, bucket, windowSeconds) {
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
}

// 조회와 기록을 한 문장으로 — 동시 요청이 같은 빈자리를 두 번 차지하지 못하게 한다.
async function consume(env, bucket, maxHits) {
  const res = await env.DB.prepare(
    `INSERT INTO rate_limit_hits (bucket)
     SELECT ?
     WHERE (SELECT COUNT(*) FROM rate_limit_hits WHERE bucket = ?) < ?`
  )
    .bind(bucket, bucket, maxHits)
    .run()

  // 삽입이 일어났으면 허용, 아니면 상한 도달
  const changes = res?.meta?.changes
  return { ok: typeof changes === 'number' ? changes > 0 : true, rowId: res?.meta?.last_row_id ?? null }
}

// 기록하지 않고 남은 자리만 확인한다
async function peek(env, bucket, maxHits, windowSeconds) {
  await purge(env, bucket, windowSeconds)
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_limit_hits WHERE bucket = ?')
    .bind(bucket)
    .first()
  return (Number(row?.n) || 0) < maxHits
}

async function undo(env, rowIds) {
  if (rowIds.length === 0) return
  try {
    await env.DB.prepare(`DELETE FROM rate_limit_hits WHERE id IN (${rowIds.map(() => '?').join(',')})`)
      .bind(...rowIds)
      .run()
  } catch {
    /* 되돌리기가 실패하면 한 번 더 센 상태로 남는다 — 보수적인 방향이므로 무시한다 */
  }
}

// 여러 상한을 한 번에 판정한다. 막힌 상한을 돌려주고, 모두 통과하면 null.
//
// 핵심은 **어느 하나라도 막히면 아무 버킷에도 기록하지 않는다**는 것이다.
// 예전에는 IP 상한을 조건부 INSERT로 먼저 검사했으므로, 그 뒤의 전역 상한에 걸려
// AI 호출이 일어나지 않아도 방문자의 IP 몫은 이미 차감된 채로 남았다. 전역 혼잡이
// 풀린 뒤에도 그 사람은 자기 히트가 만료되기까지(최대 1시간) 계속 예시 결과만 보게 된다 —
// 실제로는 AI 생성을 한 번도 받지 못했는데 자기 몫을 다 쓴 것으로 처리된다.
// 순서만 뒤집으면 대칭 문제(IP에 걸린 요청이 전역 몫을 소모)가 생기므로,
// "기록 없는 확인 → 전부 통과할 때만 기록"으로 나눈다.
export async function checkRateLimitGroup(env, limits) {
  if (!env.DB) return null // 로컬 개발 등 D1 미설정
  const list = (limits || []).filter(Boolean)

  // 1) 아무것도 기록하지 않고 모든 상한을 확인한다
  for (const l of list) {
    let ok
    try {
      ok = await peek(env, l.bucket, l.maxHits, l.windowSeconds ?? 3600)
    } catch {
      ok = l.failOpen !== false
    }
    if (!ok) return l
  }

  // 2) 모두 통과 → 실제로 소모한다. 확인과 기록 사이의 경합(같은 순간의 다른 요청)으로
  //    뒤쪽이 밀리면 앞서 기록한 히트를 되돌려, 같은 문제가 좁은 창에서 재현되지 않게 한다.
  const inserted = []
  for (const l of list) {
    let res
    try {
      res = await consume(env, l.bucket, l.maxHits)
    } catch {
      res = { ok: l.failOpen !== false, rowId: null }
    }
    if (!res.ok) {
      await undo(env, inserted)
      return l
    }
    if (res.rowId) inserted.push(res.rowId)
  }
  return null
}
