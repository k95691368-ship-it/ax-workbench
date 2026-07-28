// 서버측 브랜드 룰북 어댑터.
// 규칙 자체는 프론트와 공유(src/lib/brandRules.js)하고, 여기서는 요청 본문 정제만 담당한다.
import { normalizeBrand, isBrandActive } from '../../src/lib/brandRules.js'

export { brandPrompt, missingRequired } from '../../src/lib/brandRules.js'

// 요청 본문의 brand를 신뢰하지 않고 재정제한다. 내용이 비어 있으면 null(미적용).
export function sanitizeBrand(raw) {
  const brand = normalizeBrand(raw)
  return isBrandActive(brand) ? brand : null
}
