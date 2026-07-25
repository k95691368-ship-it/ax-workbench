// 상세페이지 미리보기·다운로드 HTML에 적용되는 디자인 테마.
// AI 호출 없이 즉시 전환되며, 다운로드 HTML과 디자인 브리프에도 반영된다.
export const DP_THEMES = [
  {
    id: 'green',
    label: '클린 그린',
    desc: '신뢰·건강 중심의 기본 테마',
    accent: '#14532d',
    heading: '#14532d',
    surface: '#ffffff',
    footer: '#f6f6f6',
  },
  {
    id: 'ivory',
    label: '아이보리 프리미엄',
    desc: '선물세트·프리미엄 라인 무드',
    accent: '#4a3f30',
    heading: '#8a6a3b',
    surface: '#faf6ee',
    footer: '#f1ead9',
  },
  {
    id: 'pop',
    label: '비비드 팝',
    desc: '2030 타깃의 경쾌한 무드',
    accent: '#4f46e5',
    heading: '#4f46e5',
    surface: '#ffffff',
    footer: '#eef2ff',
  },
]

export function getTheme(id) {
  return DP_THEMES.find((t) => t.id === id) || DP_THEMES[0]
}
