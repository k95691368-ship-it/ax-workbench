import { getTurnstileToken } from './turnstile.js'
import { activeBrand } from './brand.js'

async function send(path, body, token) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-turnstile-token': token } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  return { res, data }
}

export async function postJson(path, body) {
  // 브랜드 룰북은 여기 한 곳에서 모든 생성 요청에 자동으로 실린다.
  // 기능 화면들은 룰북의 존재를 몰라도 되고, 룰북을 고치면 전 기능이 동시에 따른다.
  const brand = activeBrand()
  const payload = brand ? { ...body, brand } : body

  let { res, data } = await send(path, payload, await getTurnstileToken())

  // 보안 토큰은 1회용이고 만료도 있다. 검증 실패(403)는 새 토큰으로 한 번 자동 재시도한다
  // — 일시적 실패로 화면 전체가 빨갛게 뜨는 일을 막는 안전망.
  if (res.status === 403) {
    ;({ res, data } = await send(path, payload, await getTurnstileToken()))
  }

  if (!res.ok) {
    throw new Error(data?.error || `요청 실패 (${res.status})`)
  }
  return data
}
