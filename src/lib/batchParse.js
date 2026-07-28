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

// 엑셀/CSV 헤더 이름의 흔한 변형들 — 실무 파일마다 컬럼명이 제각각이라 별칭으로 흡수한다
const PRODUCT_ALIASES = {
  name: ['상품명', '제품명', '품명', '상품 이름', 'name', 'product', 'title'],
  category: ['카테고리', '분류', '대분류', '상품분류', 'category'],
  features: ['특징', '주요특징', '상품특징', '설명', '상품설명', 'features', 'description'],
}

function findCol(header, aliases) {
  return header.findIndex((h) => {
    const v = String(h ?? '').trim()
    return aliases.includes(v) || aliases.includes(v.toLowerCase())
  })
}

const cell = (row, i) => (i >= 0 ? String(row?.[i] ?? '').trim() : '')

// 엑셀/CSV 행렬 → 상품 목록.
// 헤더 행이 있으면 컬럼명으로 찾고, 없으면 1·2·3열을 상품명·카테고리·특징으로 본다.
export function rowsToProducts(rows) {
  const data = (Array.isArray(rows) ? rows : []).filter(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== '')
  )
  if (data.length === 0) return { products: [], skipped: 0, hasHeader: false }

  const header = data[0]
  const nameCol = findCol(header, PRODUCT_ALIASES.name)
  const hasHeader = nameCol !== -1
  const cols = hasHeader
    ? {
        name: nameCol,
        category: findCol(header, PRODUCT_ALIASES.category),
        features: findCol(header, PRODUCT_ALIASES.features),
      }
    : { name: 0, category: 1, features: 2 }
  const body = hasHeader ? data.slice(1) : data

  const products = []
  let skipped = 0
  for (const row of body) {
    const name = cell(row, cols.name)
    if (!name) {
      skipped++
      continue
    }
    products.push({
      name: name.slice(0, 100),
      category: cell(row, cols.category).slice(0, 100),
      features: cell(row, cols.features).slice(0, 300),
    })
  }
  return { products, skipped, hasHeader }
}

// 상품 목록 → 입력창 텍스트 (뒤쪽 빈 칸은 구분자까지 지운다)
export function productsToText(products) {
  return (products || [])
    .map((p) => {
      const parts = [p.name, p.category, p.features].map((v) => String(v || '').trim())
      while (parts.length > 1 && !parts[parts.length - 1]) parts.pop()
      return parts.join(' | ')
    })
    .join('\n')
}
