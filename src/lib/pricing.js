// 채널별 권장 판매가 계산.
//
// 왜 이걸 만드는가:
// 채널 등록 양식을 내보내기 시작했더니 '판매가' 열이 비어 있었다. 담당자는 결국 채널마다
// 계산기를 두드려 채워 넣는다. 그런데 이 계산은 채널마다 답이 다르다 —
// 판매 수수료율이 다르기 때문에, **같은 마진을 지키려면 채널마다 판매가가 달라야 한다.**
// 이걸 눈대중으로 하면 수수료가 높은 채널에서 조용히 마진이 깎인다.
//
// 수수료율은 카테고리·계약·프로모션에 따라 달라진다. 그래서 채널 규정과 같은 원칙으로
// 데이터를 한 곳에 두고 운영자가 자기 계약 요율로 고치게 한다. 아래 기본값은 공개된
// 일반 요율대를 옮긴 것이며, 실제 정산은 계약서 기준이다.

export const CHANNEL_FEES = {
  smartstore: { label: '네이버 스마트스토어', rate: 0.0574, note: '주문관리 수수료 + 결제 수수료' },
  coupang: { label: '쿠팡', rate: 0.108, note: '카테고리별 판매수수료 (건강기능식품대 기준)' },
  eleven: { label: '11번가', rate: 0.13, note: '카테고리별 판매수수료' },
  esm: { label: 'G마켓 · 옥션', rate: 0.12, note: '카테고리별 판매수수료' },
}

export const PRICING_DEFAULTS = { cost: 0, marginRate: 0.3, shipping: 0, stock: 100, round: 100 }

export function feeRate(channelId) {
  return CHANNEL_FEES[channelId]?.rate ?? 0
}

// 100원 단위 등 실무에서 쓰는 자리로 올림한다 (12,345원 같은 가격표는 쓰지 않는다)
export function roundPrice(value, unit = 100) {
  const u = Math.max(1, Math.round(unit))
  return Math.ceil(value / u) * u
}

// 목표 마진율을 지키는 판매가.
//
//   판매가 P, 수수료율 f, 원가 c, 배송비 s, 목표 마진율 m (판매가 대비)
//   P - P·f - c - s = P·m   →   P = (c + s) / (1 - f - m)
//
// 1 - f - m 이 0 이하면 그 마진은 그 채널에서 성립하지 않는다(수수료가 마진을 다 먹는다).
// 이 경우 억지로 숫자를 만들지 않고 왜 불가능한지 돌려준다 — 조용히 이상한 가격이
// 등록 양식에 실려 나가는 것이 가장 나쁘다.
export function recommendPrice(channelId, { cost = 0, marginRate = 0, shipping = 0, round = 100 } = {}) {
  const f = feeRate(channelId)
  const denom = 1 - f - marginRate
  const base = Number(cost) + Number(shipping)
  if (!(base > 0)) return { ok: false, reason: '원가를 입력하면 채널별 권장 판매가를 계산합니다.' }
  // 음수 마진은 "원가보다 싸게 팔겠다"는 뜻이다. 식은 성립하므로 원가 아래 가격이 조용히
  // 나오는데, 그 숫자가 등록 양식의 판매가 칸으로 그대로 들어간다. 계산이 되는 것과
  // 말이 되는 것은 다르므로, 사용자가 의도한 값인지 되묻는다.
  if (marginRate < 0)
    return { ok: false, reason: '목표 마진율이 음수입니다 — 원가보다 싸게 파는 가격이 나옵니다. 값을 확인해 주세요.', feeRate: f }
  if (denom <= 0) {
    return {
      ok: false,
      reason: `${CHANNEL_FEES[channelId]?.label || channelId} 수수료 ${(f * 100).toFixed(1)}%로는 마진율 ${(marginRate * 100).toFixed(0)}%를 만들 수 없습니다. 마진 목표를 낮추거나 다른 채널을 쓰세요.`,
      feeRate: f,
    }
  }
  const raw = base / denom
  const price = roundPrice(raw, round)
  return { ok: true, price, feeRate: f, ...marginOf(price, { cost, shipping, channelId }) }
}

// 판매가가 정해졌을 때 실제로 남는 돈
export function marginOf(price, { cost = 0, shipping = 0, channelId } = {}) {
  const p = Number(price) || 0
  const fee = Math.round(p * feeRate(channelId))
  const profit = p - fee - Number(cost) - Number(shipping)
  return { fee, profit, marginRate: p > 0 ? profit / p : 0 }
}

// 채널별 비교표 — "어디서 얼마에 팔아야 같은 마진이 남는가"
export function pricingTable(channelIds, input) {
  return (channelIds || Object.keys(CHANNEL_FEES)).map((id) => ({
    channel: id,
    label: CHANNEL_FEES[id]?.label || id,
    feeNote: CHANNEL_FEES[id]?.note || '',
    ...recommendPrice(id, input),
  }))
}

// 부가세 분리 (판매가는 소비자가 = VAT 포함이 관행이다)
export function splitVat(price, vatRate = 0.1) {
  const p = Number(price) || 0
  const supply = Math.round(p / (1 + vatRate))
  return { supply, vat: p - supply }
}

export const won = (n) => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`
export const pct = (n) => `${((Number(n) || 0) * 100).toFixed(1)}%`
