// Cloudflare Turnstile (Invisible) — API 호출마다 1회용 보안 토큰을 발급받는다.
// 방문자에게는 아무 UI도 보이지 않는다. 실패 시 null을 반환하고 요청은 그대로 진행되며,
// 차단 여부는 서버(TURNSTILE_SECRET 설정 시)가 결정한다.
//
// 중요: 토큰은 1회용이라 요청마다 새로 받아야 하고, 위젯은 컨테이너를 공유하면
// 서로를 망가뜨린다. 그래서 (1) 요청마다 전용 컨테이너를 만들고 (2) 발급을 직렬화한다.
// 원클릭 온보딩처럼 API를 병렬 호출하는 화면에서도 각 요청이 자기 토큰을 갖게 된다.
const SITE_KEY = '0x4AAAAAAD9ftUjgMxSP9zwt'

let scriptPromise = null
let queue = Promise.resolve()

function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
  return scriptPromise
}

async function requestToken() {
  await loadScript()
  if (!window.turnstile) return null

  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;bottom:0;right:0;width:0;height:0;overflow:hidden'
  document.body.appendChild(el)

  let widgetId = null
  try {
    return await new Promise((resolve) => {
      let settled = false
      const finish = (token) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(token || null)
      }
      const timer = setTimeout(() => finish(null), 15000)
      // render()가 반환하기 전에 콜백이 먼저 불릴 수 있으므로 id에 의존하지 않는다
      widgetId = window.turnstile.render(el, {
        sitekey: SITE_KEY,
        callback: finish,
        'error-callback': () => finish(null),
        'timeout-callback': () => finish(null),
      })
      if (widgetId == null) finish(null)
    })
  } finally {
    try {
      if (widgetId != null) window.turnstile.remove(widgetId)
    } catch {
      /* 이미 제거된 경우 무시 */
    }
    el.remove()
  }
}

export function getTurnstileToken() {
  // 앞선 발급이 끝난 뒤 시작 — 위젯이 동시에 렌더되어 충돌하는 것을 막는다
  const next = queue.then(() => requestToken().catch(() => null))
  queue = next.then(
    () => undefined,
    () => undefined
  )
  return next
}
