// 에스컬레이션 2차 안전망 — 규칙이 AI 판단을 덮어쓴다.
//
// 담당자에게 올릴지 말지를 AI 판단 하나에만 맡기면, 모델이 자신 있게 틀렸을 때
// 막을 방법이 없다. 건강 이상 호소·법적 분쟁·이물 신고처럼 "놓치면 회사 리스크"인 건은
// 확률 모델이 아니라 결정론적 규칙이 최종 게이트를 맡아야 한다.
//
// 이 규칙은 AI가 escalate=false로 답해도 무조건 담당자 확인으로 올린다.
// 반대 방향(AI가 올린 것을 규칙이 내리는 것)은 하지 않는다 — 안전한 쪽으로만 기운다.

import { isNegated } from './negation.js'

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

// 부정 문맥이어도 절대 내리지 않는 단어들.
// "응급실 안 갔어요"처럼 부정이 붙어도 사건 자체가 이미 일어났음을 뜻하거나,
// 놓쳤을 때의 손실이 오탐 비용보다 압도적으로 큰 표현들이다.
export const CRITICAL_WORDS = new Set([
  '응급실', '입원', '쓰러', '식중독', '중독', '사망',
  '소송', '고소', '고발', '변호사', '소비자원', '식약처', '공정거래위원회',
  '위자료', '치료비', '병원비',
])

// 리뷰 본문에서 강제 에스컬레이션 사유를 찾는다.
//
// 키워드가 들어 있다는 것만으로 올리면 "부작용 없었어요", "벌레 하나 없이 깨끗해요" 같은
// 칭찬 리뷰까지 담당자 큐에 쌓인다. 안전망이 오탐으로 가득 차면 담당자가 큐를 신뢰하지 않게 되고,
// 결국 진짜 위험 건을 놓친다 — 그래서 붙어 있는 부정만 좁게 인정해 걷어낸다.
// 다만 CRITICAL_WORDS는 이 완화에서 제외해, 완화가 새 구멍이 되지 않게 한다.
export function detectEscalation(text) {
  const source = String(text || '')
  const hits = []
  const softened = []

  for (const rule of ESCALATION_RULES) {
    const matched = []
    for (const word of rule.words) {
      const positions = []
      let at = source.indexOf(word)
      while (at !== -1) {
        positions.push(at)
        at = source.indexOf(word, at + 1)
      }
      if (positions.length === 0) continue

      const critical = CRITICAL_WORDS.has(word)
      const live = critical || positions.some((p) => !isNegated(source, p, word.length))
      if (live) matched.push(word)
      else softened.push(word)
    }
    if (matched.length > 0) hits.push({ id: rule.id, label: rule.label, reason: rule.reason, matched })
  }

  if (hits.length === 0) return { escalate: false, hits: [], reason: null, softened }
  return {
    escalate: true,
    hits,
    reason: `${hits.map((h) => h.label).join(' · ')} — ${hits[0].reason}`,
    matched: hits.flatMap((h) => h.matched),
    softened,
  }
}

// 규칙이 강제로 올린 건에 쓰는 보수적 답변.
// AI가 쓴 답변(보상 약속·의학적 판단이 섞였을 수 있다)을 그대로 내보내지 않는다.
export const SAFE_REPLY =
  '고객님, 말씀해주신 내용 확인했습니다. 이 건은 담당자가 직접 확인한 뒤 개별적으로 연락드리겠습니다. 정확한 확인을 위해 주문번호와 함께 상황을 남겨주시면 빠르게 도와드리겠습니다. 불편을 드려 죄송합니다.'
