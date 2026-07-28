// 브랜드 룰북 저장소 — 브라우저 localStorage에 보관한다.
// 로그인 없이 쓰는 포트폴리오이므로 서버에 회사 규정을 저장하지 않고,
// 생성 요청을 보낼 때마다 body.brand로 함께 실어 보낸다(src/lib/api.js).
import { EMPTY_BRAND, normalizeBrand, isBrandActive } from './brandRules.js'

const KEY = 'ax.brand.v1'
const EVENT = 'ax-brand-change'

export { EMPTY_BRAND, isBrandActive }

export function loadBrand() {
  try {
    return normalizeBrand(JSON.parse(localStorage.getItem(KEY)))
  } catch {
    // 저장값이 깨졌더라도 화면은 정상 동작해야 한다
    return { ...EMPTY_BRAND }
  }
}

export function saveBrand(brand) {
  const clean = normalizeBrand(brand)
  try {
    localStorage.setItem(KEY, JSON.stringify(clean))
  } catch {
    /* 시크릿 모드 등 저장 불가 환경 — 이번 세션에서만 미적용 */
  }
  window.dispatchEvent(new CustomEvent(EVENT))
  return clean
}

export function clearBrand() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new CustomEvent(EVENT))
}

// 요청에 실어 보낼 룰북. 비어 있으면 null(서버에서도 미적용으로 처리).
export function activeBrand() {
  const brand = loadBrand()
  return isBrandActive(brand) ? brand : null
}

// 다른 탭·다른 화면에서 룰북이 바뀌면 배지를 갱신하기 위한 구독
export function subscribeBrand(handler) {
  window.addEventListener(EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

// 줄바꿈 텍스트 ↔ 배열 (입력창은 여러 줄, 저장은 배열)
export const linesToList = (text) =>
  String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

export const listToLines = (list) => (Array.isArray(list) ? list.join('\n') : '')
