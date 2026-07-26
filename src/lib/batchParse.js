// 대량 등록 입력 파서 — 한 줄에 상품 1개, "상품명 | 카테고리 | 특징" 형식(카테고리·특징 생략 가능)
export const BATCH_MAX = 5

export function parseProducts(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const products = []
  for (const line of lines) {
    const [name, category, features] = line.split('|').map((s) => (s || '').trim())
    if (!name) continue
    products.push({
      name: name.slice(0, 100),
      category: (category || '').slice(0, 100),
      features: (features || '').slice(0, 300),
    })
  }
  return { products: products.slice(0, BATCH_MAX), overflow: Math.max(0, products.length - BATCH_MAX) }
}
