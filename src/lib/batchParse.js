// 대량 등록 입력 파서 — 한 줄에 상품 1개, "상품명 | 카테고리 | 특징" 형식(카테고리·특징 생략 가능)
// 서버가 상품을 5개씩 묶어 동시에 처리하므로, 20개를 넣어도 걸리는 시간은
// "가장 느린 묶음 하나"에 가깝다. 예전 한도 5는 한 호출에 전부 담아야 했던 제약이었다.
export const BATCH_MAX = 20

export function parseProducts(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const products = []
  for (const line of lines) {
    // 구분자를 4개 이상 쓴 줄에서 4번째 조각을 조용히 버리지 않는다 —
    // 예전에는 구조분해가 앞 3개만 취해 '유산균 | 건강식품 | 19종 | 100억 CFU'의
    // '100억 CFU'가 사라진 채 AI에 전송됐고, 그 특징은 금칙어 점검 대상에서도 빠졌다.
    const [name, category, ...rest] = line.split('|').map((s) => (s || '').trim())
    const features = rest.join('|').trim()
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

// 셀 값 하나를 "한 줄 한 상품 | 구분" 형식에 안전한 텍스트로 만든다.
//
// 엑셀 Alt+Enter로 넣은 셀 내부 줄바꿈(특징·설명 열에 매우 흔하다)을 그대로 두면,
// 업로드 → productsToText → textarea → parseProducts를 거치는 동안 줄바꿈이
// **상품 구분자로 승격**된다. 감사 재현: 상품 2개 파일이 '2개 인식'이라고 안내되고
// 바로 아래 카운터는 '4개 인식됨'이 되며, '저온 2회 구이' 같은 존재하지 않는 상품이
// AI 등록 요청으로 들어가 등록용 CSV에 섞이고 20개 한도까지 잡아먹었다.
// 셀 안의 '|'도 같은 이유로 칸을 밀어내므로 '/'로 바꾼다.
const cell = (row, i) =>
  i >= 0
    ? String(row?.[i] ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\|/g, '/')
        .replace(/ {2,}/g, ' ')
        .trim()
    : ''

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
