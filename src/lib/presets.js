// 데모용 가상 제품 프리셋 — 실존 브랜드·제품과 무관한 창작 예시.
// 표시광고 규제가 실제로 걸리는 카테고리(건강기능식품·식품) 계열로 구성했다 —
// 금칙어 점검이 의미를 갖는 영역이라야 시연이 시연으로 끝나지 않는다.
export const PRODUCT_PRESETS = [
  {
    id: 'probiotic',
    name: '데일리 장편한 유산균 30포',
    category: '건강기능식품 > 프로바이오틱스',
    features: '19종 혼합 유산균, 보장균수 100억 CFU, 개별 스틱 분말, 아연 함유(정상적인 면역기능에 필요)',
    target: '출근길에 챙겨 먹을 간편한 유산균을 찾는 2040 직장인',
    tone: '신뢰감 있고 담백한 설명형',
  },
  {
    id: 'seaweed',
    name: '바삭 곱창돌김 도시락김 16봉',
    category: '식품 > 김/해조류',
    features: '남해안 원초, 저온 2회 구이, 들기름+참기름 블렌딩, 개별 소포장 16봉',
    target: '아이 반찬과 혼밥 도시락을 자주 싸는 30대 가정',
    tone: '따뜻하고 생활감 있는 톤',
  },
  {
    id: 'vitamin',
    name: '멀티비타 올인원 츄어블 60정',
    category: '건강기능식품 > 비타민/미네랄',
    features: '비타민 12종 + 미네랄 4종, 물 없이 씹어 먹는 츄어블, 오렌지맛, 1일 1정',
    target: '알약 삼키기를 부담스러워하는 수험생과 부모님 선물 수요',
    tone: '활기차고 친근한 톤',
  },
]

export const CHANNELS = [
  { id: 'instagram', label: '인스타그램 피드' },
  { id: 'cardnews', label: '카드뉴스 (블로그/인스타)' },
  { id: 'blog', label: '블로그 포스트' },
  { id: 'threads', label: '스레드' },
  { id: 'youtube', label: '유튜브 쇼츠 스크립트' },
  { id: 'tiktok', label: '틱톡 스크립트' },
]
