// AI가 생성한 문구를 발행 전에 표시광고 금칙어 규칙으로 서버측에서 재점검한다.
// 프론트의 스캐너(src/lib/compliance.js)와 같은 규칙을 공유해 기준 불일치를 막는다.
import { scanText } from '../../src/lib/compliance.js'

// 여러 텍스트 조각을 합쳐 스캔하고, 같은 단어는 1건으로 요약해 반환한다.
// brand(브랜드 룰북)가 있으면 회사가 지정한 금지어까지 같은 결과에 포함한다.
export function checkTexts(texts, brand = null) {
  const joined = texts.filter(Boolean).join('\n')
  const seen = new Map()
  for (const f of scanText(joined, brand?.banned || [])) {
    if (!seen.has(f.word)) {
      seen.set(f.word, { word: f.word, label: f.label, severity: f.severity, reason: f.reason })
    }
  }
  return [...seen.values()]
}
