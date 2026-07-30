// 생성 이력 — 무엇을 언제 만들었고 어떤 결과였는지 브라우저에 남긴다.
// 실무에서 "아까 그거가 더 나았는데"를 되살리기 위한 장치이자,
// 담당자가 AI를 얼마나·어디에 썼는지 돌아볼 수 있는 최소한의 운영 기록.
// (서버에 저장하지 않는다 — 결과물에는 회사 자산이 섞여 있을 수 있다)

const KEY = 'ax.history.v1'
const EVENT = 'ax-history-change'
const MAX_ENTRIES = 20

export const FEATURES = {
  onboard: { label: '원클릭 온보딩', path: '/onboard' },
  detail: { label: '상세페이지', path: '/detail-page' },
  content: { label: '채널 콘텐츠', path: '/content' },
  listing: { label: '상품등록', path: '/listing' },
  batch: { label: '대량 등록', path: '/batch' },
  reviews: { label: '리뷰 응대', path: '/reviews' },
}

// 결과 하나에 남아 있는 규정 위반 총 건수 (항목별 결과까지 합산)
export function countViolations(result) {
  if (!result || typeof result !== 'object') return 0

  // 항목별 결과가 있으면 **행에서만** 센다.
  //
  // 서버는 행 단위 누락을 모아 최상위 집계로도 함께 내보낸다(같은 값이 두 곳에 있다).
  // 둘을 더하면 누락 1건이 2건으로, 3건이 4건으로 보인다 — 이력 화면의 "검출된 규정 위반"
  // 합계와 행별 배지가 실제보다 크게 표시됐다.
  const rows = result.results || []
  let n = 0
  if (rows.length > 0) {
    for (const r of rows) {
      n += (r?.ad_check?.length || 0) + (r?.brand_missing?.length || 0)
    }
  } else {
    n += (result.ad_check?.length || 0) + (result.brand_missing?.length || 0)
  }
  // 온보딩처럼 여러 기능의 결과를 한 묶음으로 담은 경우까지 합산한다
  for (const key of ['detail', 'listing', 'content']) {
    if (result[key] && typeof result[key] === 'object') n += countViolations(result[key])
  }
  return n
}

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function write(entries) {
  // 용량 초과 시 오래된 것부터 버리며 재시도한다 (이력 때문에 기능이 멈추면 안 된다)
  let list = entries.slice(0, MAX_ENTRIES)
  while (list.length > 0) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list))
      window.dispatchEvent(new CustomEvent(EVENT))
      return true
    } catch {
      list = list.slice(0, list.length - 1)
    }
  }
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new CustomEvent(EVENT))
  return false
}

// 최신순
export function listHistory() {
  return read()
}

function newId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `h${Date.now()}${listHistory().length}`
  }
}

export function pushHistory({ feature, label, input, result }) {
  if (!FEATURES[feature] || !result) return null
  const entry = {
    id: newId(),
    ts: Date.now(),
    feature,
    label: String(label || '').slice(0, 80),
    input,
    result,
    demo: Boolean(result.demo),
    violations: countViolations(result),
    usage: result.usage || null,
  }
  write([entry, ...read()])
  return entry
}

export function removeHistory(id) {
  write(read().filter((e) => e.id !== id))
}

export function clearHistory() {
  write([])
}

export function subscribeHistory(handler) {
  window.addEventListener(EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

export function formatWhen(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
