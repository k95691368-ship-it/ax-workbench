// 판매 데이터 CSV 파싱·집계 (브라우저 로컬 처리 — 서버 전송 없음)
// 기대 컬럼: 날짜(YYYY-MM-DD), 채널, 상품명, 수량, 매출액

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

const HEADER_ALIASES = {
  date: ['날짜', 'date', '일자', '주문일'],
  channel: ['채널', 'channel', '판매채널', '몰'],
  product: ['상품명', 'product', '상품', '품명'],
  qty: ['수량', 'qty', 'quantity', '판매수량'],
  amount: ['매출액', 'amount', '매출', '판매금액', '금액'],
}

function findCol(header, aliases) {
  return header.findIndex((h) => aliases.includes(h.trim().toLowerCase()) || aliases.includes(h.trim()))
}

// CSV 행렬 → 정규화된 판매 레코드 배열
export function normalizeSales(rows) {
  if (rows.length < 2) throw new Error('데이터 행이 없습니다. 헤더 + 1행 이상이 필요합니다.')
  const header = rows[0].map((h) => h.trim())
  const col = {}
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    col[key] = findCol(header, aliases)
    if (col[key] === -1) throw new Error(`필수 컬럼을 찾을 수 없습니다: ${aliases[0]} (헤더: ${header.join(', ')})`)
  }
  const records = []
  for (const row of rows.slice(1)) {
    const amount = Number(String(row[col.amount]).replace(/[,원\s]/g, ''))
    const qty = Number(String(row[col.qty]).replace(/[,\s]/g, ''))
    const date = String(row[col.date]).trim()
    if (!date || Number.isNaN(amount) || Number.isNaN(qty)) continue
    records.push({
      date,
      channel: String(row[col.channel]).trim() || '기타',
      product: String(row[col.product]).trim() || '(상품명 없음)',
      qty,
      amount,
    })
  }
  if (records.length === 0) throw new Error('유효한 데이터 행이 없습니다. 날짜/수량/매출액 형식을 확인해주세요.')
  return records
}

function sumBy(records, keyFn) {
  const map = new Map()
  for (const r of records) {
    const key = keyFn(r)
    map.set(key, (map.get(key) || 0) + r.amount)
  }
  return map
}

// 리포트·차트에 쓰는 집계 요약
export function aggregate(records) {
  const byDate = [...sumBy(records, (r) => r.date).entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const byChannel = [...sumBy(records, (r) => r.channel).entries()].sort((a, b) => b[1] - a[1])
  const byProduct = [...sumBy(records, (r) => r.product).entries()].sort((a, b) => b[1] - a[1])
  const totalAmount = records.reduce((s, r) => s + r.amount, 0)
  const totalQty = records.reduce((s, r) => s + r.qty, 0)

  // 이상 감지(데모): 일별 매출이 전체 일평균의 ±50%를 벗어나면 표시
  const dailyAvg = byDate.length ? totalAmount / byDate.length : 0
  const anomalies = byDate
    .filter(([, amt]) => dailyAvg > 0 && (amt > dailyAvg * 1.5 || amt < dailyAvg * 0.5))
    .map(([date, amt]) => ({
      date,
      amount: amt,
      direction: amt > dailyAvg ? 'spike' : 'drop',
      ratio: Math.round((amt / dailyAvg) * 100),
    }))

  return { byDate, byChannel, byProduct, totalAmount, totalQty, dailyAvg, anomalies, count: records.length }
}
