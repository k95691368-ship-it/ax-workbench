import { describe, it, expect } from 'vitest'
import { checkRateLimitGroup, RATE_NOTICE } from '../functions/_lib/rateLimit.js'

// rate_limit_hits 테이블을 메모리로 흉내낸다 (D1 없이 버킷 소모를 관찰하기 위해)
function fakeDb({ seed = {}, failOn = null } = {}) {
  let nextId = 1
  const rows = []
  for (const [bucket, n] of Object.entries(seed)) {
    for (let i = 0; i < n; i++) rows.push({ id: nextId++, bucket })
  }
  const count = (bucket) => rows.filter((r) => r.bucket === bucket).length

  const db = {
    rows,
    countOf: count,
    prepare(sql) {
      let args = []
      const stmt = {
        bind: (...a) => {
          args = a
          return stmt
        },
        first: async () => {
          if (failOn && sql.includes(failOn)) throw new Error('D1 down')
          if (sql.includes('SELECT COUNT(*)')) return { n: count(args[0]) }
          return null
        },
        run: async () => {
          if (failOn && sql.includes(failOn)) throw new Error('D1 down')
          if (sql.includes('INSERT INTO rate_limit_hits')) {
            const [bucket, , maxHits] = args
            if (count(bucket) < maxHits) {
              const id = nextId++
              rows.push({ id, bucket })
              return { meta: { changes: 1, last_row_id: id } }
            }
            return { meta: { changes: 0, last_row_id: null } }
          }
          if (sql.includes('WHERE id IN')) {
            for (const id of args) {
              const at = rows.findIndex((r) => r.id === id)
              if (at >= 0) rows.splice(at, 1)
            }
            return { meta: { changes: args.length } }
          }
          return { meta: { changes: 0 } } // 만료 정리 등
        },
      }
      return stmt
    },
  }
  return db
}

const limits = () => [
  { bucket: 'ax:batch:1.2.3.4', maxHits: 4, notice: RATE_NOTICE.ip },
  { bucket: 'ax:batch:all', maxHits: 30, failOpen: false, notice: RATE_NOTICE.all },
]

describe('checkRateLimitGroup — 막힌 상한이 있으면 아무 몫도 쓰지 않는다', () => {
  it('모두 통과하면 각 버킷에 한 번씩만 기록한다', async () => {
    const DB = fakeDb()
    expect(await checkRateLimitGroup({ DB }, limits())).toBeNull()
    expect(DB.countOf('ax:batch:1.2.3.4')).toBe(1)
    expect(DB.countOf('ax:batch:all')).toBe(1)
  })

  it('전역 상한이 꽉 찼으면 방문자의 IP 몫을 소모하지 않는다', async () => {
    // 예전 동작: IP 검사가 조건부 INSERT라 통과하는 순간 히트가 기록됐고,
    // 뒤이어 전역 상한에 걸려 AI 호출은 없었는데도 IP 몫 1회가 차감됐다.
    // 4번 시도하면 실제 생성은 0회인데 IP 상한(4회)이 소진되어,
    // 혼잡이 풀린 뒤에도 최대 1시간 동안 예시 결과만 보게 됐다.
    const DB = fakeDb({ seed: { 'ax:batch:all': 30 } })
    for (let i = 0; i < 4; i++) {
      const blocked = await checkRateLimitGroup({ DB }, limits())
      expect(blocked?.notice).toBe(RATE_NOTICE.all)
    }
    expect(DB.countOf('ax:batch:1.2.3.4')).toBe(0)

    // 전역 혼잡이 풀리면 이 방문자는 자기 몫 4회를 온전히 쓸 수 있다
    DB.rows.length = 0
    for (let i = 0; i < 4; i++) expect(await checkRateLimitGroup({ DB }, limits())).toBeNull()
    expect((await checkRateLimitGroup({ DB }, limits()))?.notice).toBe(RATE_NOTICE.ip)
  })

  it('IP 상한이 꽉 찼으면 전역 몫도 소모하지 않는다 (대칭)', async () => {
    const DB = fakeDb({ seed: { 'ax:batch:1.2.3.4': 4 } })
    const blocked = await checkRateLimitGroup({ DB }, limits())
    expect(blocked?.notice).toBe(RATE_NOTICE.ip)
    expect(DB.countOf('ax:batch:all')).toBe(0)
  })

  it('기록 단계에서 경합에 밀리면 앞서 기록한 히트를 되돌린다', async () => {
    // 확인은 통과했지만 기록 순간 전역 자리가 다른 요청에 채워진 경우.
    // 되돌리지 않으면 같은 문제(쓰지 않은 몫 차감)가 좁은 창에서 재현된다.
    const DB = fakeDb({ seed: { 'ax:batch:all': 29 } })
    const race = [
      { bucket: 'ax:batch:1.2.3.4', maxHits: 4, notice: RATE_NOTICE.ip },
      { bucket: 'ax:batch:all', maxHits: 29, failOpen: false, notice: RATE_NOTICE.all },
    ]
    const blocked = await checkRateLimitGroup({ DB }, race)
    expect(blocked?.notice).toBe(RATE_NOTICE.all)
    expect(DB.countOf('ax:batch:1.2.3.4')).toBe(0)
  })

  it('D1 오류: 비용 상한은 막고(fail-closed) 편의 상한은 통과시킨다(fail-open)', async () => {
    const costFail = await checkRateLimitGroup({ DB: fakeDb({ failOn: 'SELECT COUNT(*)' }) }, [
      { bucket: 'ax:batch:all', maxHits: 30, failOpen: false, notice: RATE_NOTICE.all },
    ])
    expect(costFail?.notice).toBe(RATE_NOTICE.all)

    const ipFail = await checkRateLimitGroup({ DB: fakeDb({ failOn: 'SELECT COUNT(*)' }) }, [
      { bucket: 'ax:batch:1.2.3.4', maxHits: 4, notice: RATE_NOTICE.ip },
    ])
    expect(ipFail).toBeNull()
  })

  it('D1 미설정(로컬 개발)에서는 제한 없이 통과한다', async () => {
    expect(await checkRateLimitGroup({}, limits())).toBeNull()
  })
})
