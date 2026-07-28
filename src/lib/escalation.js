// 에스컬레이션 2차 안전망 — 규칙이 AI 판단을 덮어쓴다.
//
// 담당자에게 올릴지 말지를 AI 판단 하나에만 맡기면, 모델이 자신 있게 틀렸을 때
// 막을 방법이 없다. 건강 이상 호소·법적 분쟁·이물 신고처럼 "놓치면 회사 리스크"인 건은
// 확률 모델이 아니라 결정론적 규칙이 최종 게이트를 맡아야 한다.
//
// 이 규칙은 AI가 escalate=false로 답해도 무조건 담당자 확인으로 올린다.
// 반대 방향(AI가 올린 것을 규칙이 내리는 것)은 하지 않는다 — 안전한 쪽으로만 기운다.

export const ESCALATION_RULES = [
  {
    id: 'health',
    label: '건강 이상 호소',
    reason: '건강 이상·부작용 호소 — 의학적 판단과 보상이 얽힐 수 있어 담당자 확인이 필요합니다.',
    words: [
      '병원', '응급실', '입원', '진료', '처방', '부작용', '알레르기', '알러지', '두드러기',
      '발진', '복통', '배가 아', '설사', '구토', '토했', '어지럼', '어지러', '호흡', '식중독',
      '탈이 났', '탈났', '쓰러', '중독',
    ],
  },
  {
    id: 'legal',
    label: '법적 조치·기관 신고 언급',
    reason: '법적 조치나 기관 신고가 언급되어 임의 답변 시 회사 책임 문제가 생길 수 있습니다.',
    words: [
      '변호사', '소송', '고소', '고발', '법적', '민원', '소비자원', '소비자보호원', '식약처',
      '공정위', '공정거래위원회', '신고하겠', '신고할', '기자', '언론', '제보',
    ],
  },
  {
    id: 'compensation',
    label: '보상·배상 요구',
    reason: '보상·배상 요구는 금액과 책임 인정이 걸려 있어 담당자 판단이 필요합니다.',
    words: ['보상', '배상', '위자료', '치료비', '병원비', '손해'],
  },
  {
    id: 'contamination',
    label: '이물·변질 신고',
    reason: '이물·변질 신고는 식품 안전 사안이라 회수·조사 절차 판단이 필요합니다.',
    words: ['이물', '벌레', '곰팡이', '유리', '머리카락', '상한 것', '상했', '부패', '썩'],
  },
]

// 리뷰 본문에서 강제 에스컬레이션 사유를 찾는다.
export function detectEscalation(text) {
  const source = String(text || '')
  const hits = []
  for (const rule of ESCALATION_RULES) {
    const matched = rule.words.filter((w) => source.includes(w))
    if (matched.length > 0) hits.push({ id: rule.id, label: rule.label, reason: rule.reason, matched })
  }
  if (hits.length === 0) return { escalate: false, hits: [], reason: null }
  return {
    escalate: true,
    hits,
    reason: `${hits.map((h) => h.label).join(' · ')} — ${hits[0].reason}`,
    matched: hits.flatMap((h) => h.matched),
  }
}

// 규칙이 강제로 올린 건에 쓰는 보수적 답변.
// AI가 쓴 답변(보상 약속·의학적 판단이 섞였을 수 있다)을 그대로 내보내지 않는다.
export const SAFE_REPLY =
  '고객님, 말씀해주신 내용 확인했습니다. 이 건은 담당자가 직접 확인한 뒤 개별적으로 연락드리겠습니다. 정확한 확인을 위해 주문번호와 함께 상황을 남겨주시면 빠르게 도와드리겠습니다. 불편을 드려 죄송합니다.'
