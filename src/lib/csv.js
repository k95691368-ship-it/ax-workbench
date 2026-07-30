// 판매 데이터 CSV 파싱·집계 (브라우저 로컬 처리 — 서버 전송 없음)
// 기대 컬럼: 날짜(YYYY-MM-DD), 채널, 상품명, 수량, 매출액

// 한국 Excel의 기본 CSV 저장(CP949/EUC-KR)과 UTF-8을 모두 처리한다.
// UTF-8로 엄격 디코딩이 실패하면 EUC-KR로 재시도한다. BOM은 제거.
export function decodeCsvBuffer(buffer) {
  const bytes = new Uint8Array(buffer)
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('euc-kr').decode(bytes)
  }
  return text.replace(/^﻿/, '')
}

// "2026/07/13", "2026.7.3" 등 흔한 날짜 표기를 ISO(YYYY-MM-DD)로 정규화.
// 인식할 수 없는 형식은 원문 그대로 반환한다(해당 행은 요일 집계에서만 제외).
// 엑셀은 날짜를 1899-12-30 기준 일수(시리얼)로 저장한다 — 2026-07-13은 46216이다.
// xlsx 리더는 셀 서식을 해석하지 않고 <v>를 원문 그대로 넘기므로, 날짜 서식 열은
// '46216' 같은 숫자 문자열로 도착한다. 이걸 그대로 두면 조회 기간이 "46216 ~ 46217"로
// 표시되고, 요일 집계는 전부 NaN으로 걸러져 차트가 사라지고, AI 리포트는 존재하지 않는
// 날짜를 근거로 인용한다 — 그런데 오류도 경고도 없다.
// 범위(1970-01-01 ~ 2149년경)를 벗어난 숫자는 날짜가 아닌 것으로 보고 건드리지 않는다.
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const EXCEL_SERIAL_MIN = 25569 // 1970-01-01
const EXCEL_SERIAL_MAX = 90000 // 2146년경

export function excelSerialToIso(serial) {
  const ms = EXCEL_EPOCH_UTC + Math.floor(serial) * 86400000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function normalizeDate(raw) {
  const text = String(raw ?? '').trim()
  const m = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`

  // 엑셀 날짜 시리얼 (소수점은 시각이므로 버린다)
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text)
    if (n >= EXCEL_SERIAL_MIN && n <= EXCEL_SERIAL_MAX) {
      const iso = excelSerialToIso(n)
      if (iso) return iso
    }
  }
  return text
}

// 날짜로 인식된 값인지 — 인식 실패한 행을 조용히 통과시키지 않기 위해 쓴다
export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

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
  // 버린 행을 사유별로 센다. 조용히 버리면 총매출이 실제보다 적게 나오는데
  // 사용자는 그 사실을 알 방법이 없다 — 화면에 알려주기 위해 함께 돌려준다.
  const skipped = { dates: 0, numbers: 0 }
  for (const row of rows.slice(1)) {
    // 통화기호(₩,$)·단위(원, 개)·쉼표를 걷어내고 숫자만 남긴다.
    const amountStr = String(row[col.amount]).replace(/[^0-9.-]/g, '')
    const qtyStr = String(row[col.qty]).replace(/[^0-9.-]/g, '')
    const date = normalizeDate(row[col.date])
    // 빈 셀은 0이 아니라 "값 없음"이므로 건너뛴다 (Number('') === 0 함정 방지)
    if (amountStr === '' || qtyStr === '') {
      skipped.numbers += 1
      continue
    }
    // 날짜 칸이 아예 없으면 String(undefined) === 'undefined'가 되어 !date 가드를 통과한다.
    // 그러면 date가 'undefined'인 레코드가 집계에 들어가 조회 기간이 'undefined'로 표시된다.
    // 형식까지 확인해야 그 구멍이 막힌다.
    if (!isIsoDate(date)) {
      skipped.dates += 1
      continue
    }
    const amount = Number(amountStr)
    const qty = Number(qtyStr)
    if (Number.isNaN(amount) || Number.isNaN(qty)) continue
    records.push({
      date,
      channel: String(row[col.channel]).trim() || '기타',
      product: String(row[col.product]).trim() || '(상품명 없음)',
      qty,
      amount,
    })
  }
  if (records.length === 0) throw new Error('유효한 데이터 행이 없습니다. 날짜/수량/매출액 형식을 확인해주세요.')
  // 배열로 쓰는 기존 호출부를 깨지 않으면서 건너뛴 내역을 함께 전달한다
  records.skipped = skipped
  return records
}

// 건너뛴 행을 사람이 읽을 안내 문구로 (없으면 null)
export function skippedNotice(records) {
  const s = records?.skipped
  if (!s) return null
  const parts = []
  if (s.dates) parts.push(`날짜 형식을 인식하지 못한 행 ${s.dates}개`)
  if (s.numbers) parts.push(`수량·금액이 비어 있는 행 ${s.numbers}개`)
  if (parts.length === 0) return null
  return `${parts.join(', ')}는 집계에서 제외했습니다. 총매출이 파일 합계와 다를 수 있습니다.`
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
      // 음수 매출(환불 집중일)에서는 백분율이 무의미하므로 표기 생략
      ratio: amt >= 0 ? Math.round((amt / dailyAvg) * 100) : null,
    }))

  return { byDate, byChannel, byProduct, totalAmount, totalQty, dailyAvg, anomalies, count: records.length }
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

// 요일별 "하루 평균 매출" (해당 요일이 여러 번 있으면 평균)
export function weekdayAverages(byDate) {
  const sums = new Map()
  for (const [date, amount] of byDate) {
    const day = new Date(`${date}T00:00:00`).getDay()
    if (Number.isNaN(day)) continue
    const cur = sums.get(day) || { total: 0, days: 0 }
    cur.total += amount
    cur.days += 1
    sums.set(day, cur)
  }
  // 월요일 시작 순서로 반환
  const order = [1, 2, 3, 4, 5, 6, 0]
  return order
    .filter((d) => sums.has(d))
    .map((d) => [WEEKDAYS[d], Math.round(sums.get(d).total / sums.get(d).days)])
}
