// 채널별 등록 양식 내보내기.
//
// 왜 이걸 만드는가:
// 지금까지 이 도구의 출력은 "사람이 읽는 결과"였다. 담당자는 그것을 보고 채널 관리자 화면에
// 다시 옮겨 적는다. 상품 20개면 20번이다. 생성과 등록 사이에 남아 있던 이 옮겨적기를 없앤다.
//
// 컬럼 매핑을 코드 한 곳에 모아 두는 이유:
// 채널 등록 양식의 컬럼명은 채널·시기·카테고리마다 다르다. 그래서 "정확한 공식 양식"을
// 코드에 박는 대신, 매핑표를 이 파일 한 곳에 두고 운영자가 실제 양식에 맞춰 고치게 한다.
// 아래 기본값은 각 채널의 일반 등록 양식에서 공통으로 요구되는 항목을 옮긴 것이며,
// 채널 관리자에서 받은 양식의 컬럼명과 다르면 이 표만 고치면 된다.

import { autoFixTitle, getChannelRule, CHANNEL_RULES } from './channelRules.js'
import { recommendPrice } from './pricing.js'

// 각 채널이 요구하는 열과, 우리 생성 결과에서 그 값을 어떻게 만드는지.
// value(ctx) — ctx: { title, product, listing, rule }
export const CHANNEL_EXPORTS = {
  smartstore: {
    label: '네이버 스마트스토어',
    fileTag: '스마트스토어',
    columns: [
      { header: '상품명', value: (c) => c.title },
      { header: '카테고리', value: (c) => (c.listing.category_paths || [])[0] || '' },
      { header: '판매가', required: true, value: (c) => c.price ?? '' },
      { header: '재고수량', required: true, manual: 'stock', value: (c) => c.defaults.stock ?? '' },
      { header: '태그', value: (c) => (c.listing.tags || []).slice(0, 10).join(',') },
      { header: '검색키워드', value: (c) => (c.listing.search_keywords || []).join(' ') },
      { header: '원산지', required: true, manual: 'origin', value: (c) => c.defaults.origin ?? '' },
      { header: '제조사', required: true, manual: 'maker', value: (c) => c.defaults.maker ?? '' },
    ],
  },
  coupang: {
    label: '쿠팡',
    fileTag: '쿠팡',
    columns: [
      { header: '노출상품명', value: (c) => c.title },
      { header: '등록상품명', value: (c) => c.title },
      { header: '카테고리', value: (c) => (c.listing.category_paths || [])[0] || '' },
      { header: '판매가', required: true, value: (c) => c.price ?? '' },
      { header: '재고수량', required: true, manual: 'stock', value: (c) => c.defaults.stock ?? '' },
      { header: '검색어', value: (c) => (c.listing.search_keywords || []).slice(0, 20).join(',') },
      { header: '브랜드', required: true, manual: 'brand', value: (c) => c.defaults.brand ?? '' },
      { header: '제조사', required: true, manual: 'maker', value: (c) => c.defaults.maker ?? '' },
    ],
  },
  eleven: {
    label: '11번가',
    fileTag: '11번가',
    columns: [
      { header: '상품명', value: (c) => c.title },
      { header: '카테고리', value: (c) => (c.listing.category_paths || [])[0] || '' },
      { header: '판매가', required: true, value: (c) => c.price ?? '' },
      { header: '재고수량', required: true, manual: 'stock', value: (c) => c.defaults.stock ?? '' },
      { header: '키워드', value: (c) => (c.listing.search_keywords || []).join(',') },
      { header: '원산지', required: true, manual: 'origin', value: (c) => c.defaults.origin ?? '' },
    ],
  },
  esm: {
    label: 'G마켓 · 옥션',
    fileTag: 'G마켓_옥션',
    columns: [
      { header: '상품명', value: (c) => c.title },
      { header: '카테고리', value: (c) => (c.listing.category_paths || [])[0] || '' },
      { header: '판매가', required: true, value: (c) => c.price ?? '' },
      { header: '재고수량', required: true, manual: 'stock', value: (c) => c.defaults.stock ?? '' },
      { header: '키워드', value: (c) => (c.listing.search_keywords || []).slice(0, 10).join(' ') },
    ],
  },
}

const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`

// 한 상품 = 한 행. 상품명은 그 채널 규정으로 자동 교정한 값을 쓴다.
// 교정 내역과 남은 문제를 함께 돌려주므로, 화면이 "무엇을 고쳐 내보냈는지" 말할 수 있다.
// pricing: { cost, marginRate, shipping } — 채널마다 수수료가 다르므로 권장 판매가도 달라야 한다.
// defaults: { stock, origin, maker, brand } — 사람만 아는 사실. 한 번 입력하면 전 채널이 쓴다.
//
// 이 함수는 "아직 채우지 못한 필수 칸"을 반드시 보고한다. 예전에는 필수 열이 통째로 비어
// 있는데도 화면이 '그대로 등록 가능'이라고 말했다 — 그 파일을 올리면 통째로 반려된다.
// 도구가 자기 산출물에 대해 사실과 다른 말을 하는 것이 이 저장소에서 가장 나쁜 실패다.
export function buildChannelRows(channelId, items, { pricing = null, defaults = {} } = {}) {
  const spec = CHANNEL_EXPORTS[channelId]
  if (!spec) throw new Error(`알 수 없는 채널: ${channelId}`)
  const rule = getChannelRule(channelId)

  const priced = pricing ? recommendPrice(channelId, pricing) : null
  const price = priced?.ok ? priced.price : ''

  const rows = []
  const adjusted = []
  const blocked = []

  for (const item of items || []) {
    const listing = item.listing || {}
    const source = String(item.title || (listing.titles || [])[0] || item.name || '').trim()
    if (!source) continue

    const fixed = autoFixTitle(source, channelId)
    // 상품별 값이 있으면 그것이 우선한다 (대량 등록에서는 상품마다 원가가 다르다)
    const ctx = {
      title: fixed.title,
      product: item,
      listing,
      rule,
      price: item.price ?? price,
      defaults: { ...defaults, ...item.defaults },
    }
    rows.push(spec.columns.map((col) => col.value(ctx)))

    if (fixed.changes.length > 0) adjusted.push({ name: item.name || source, from: source, to: fixed.title, changes: fixed.changes })
    if (!fixed.check.ok) blocked.push({ name: item.name || source, title: fixed.title, findings: fixed.check.findings })
  }

  // 모든 행에서 비어 있는 필수 열 = 이 파일로는 아직 등록할 수 없다는 뜻
  const missingRequired = spec.columns
    .map((col, i) => ({ col, i }))
    .filter(({ col, i }) => col.required && rows.length > 0 && rows.every((r) => String(r[i] ?? '').trim() === ''))
    .map(({ col }) => ({ header: col.header, manual: col.manual || null }))

  return {
    headers: spec.columns.map((c) => c.header),
    rows,
    adjusted,
    blocked,
    missingRequired,
    uploadable: rows.length > 0 && missingRequired.length === 0,
    pricing: priced,
    label: spec.label,
    fileTag: spec.fileTag,
  }
}

// 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다 (한국 실무에서 이게 없으면 항상 문제가 된다)
export function toCsv({ headers, rows }) {
  return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
}

export function channelCsv(channelId, items, opts = {}) {
  const built = buildChannelRows(channelId, items, opts)
  return { ...built, csv: toCsv(built) }
}

export function exportableChannels() {
  return CHANNEL_RULES.filter((c) => CHANNEL_EXPORTS[c.id]).map((c) => ({ id: c.id, label: c.label }))
}
