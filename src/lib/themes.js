// 상세페이지 디자인 테마 — 그라데이션·유사 3D 장식(광택 구체, 글래스 카드)을
// CSS만으로 구현한다(이미지 파일 없음 → 로딩 부담 없음, 다운로드 HTML에 그대로 포함).
// orbs: 히어로에 떠 있는 구체 장식. 하이라이트를 넣은 radial-gradient로 3D 광택을 낸다.

const glossyBall = (base, light) =>
  `radial-gradient(circle at 30% 28%, rgba(255,255,255,.95) 0%, rgba(255,255,255,.25) 22%, rgba(255,255,255,0) 55%), radial-gradient(circle at 50% 55%, ${light}, ${base})`

const softGlow = (color) =>
  `radial-gradient(circle at 35% 35%, ${color}, rgba(255,255,255,0) 65%)`

export const DP_THEMES = [
  {
    id: 'green',
    label: '클린 그린',
    desc: '신뢰·건강 중심의 기본 테마 — 프레시 그라데이션',
    accent: '#0f766e',
    heroBg: 'linear-gradient(135deg, #10b981 0%, #0f766e 45%, #134e4a 100%)',
    heroText: '#ffffff',
    orbs: [
      { size: 130, top: -40, right: -30, bg: softGlow('rgba(255,255,255,.4)') },
      { size: 70, bottom: -18, left: 14, bg: softGlow('rgba(167,243,208,.5)') },
    ],
    bodyBg: '#f6faf8',
    heading: '#0f766e',
    headingClip: null,
    text: '#374151',
    card: null,
    briefBg: '#eef4f0',
    briefText: '#6b7280',
    faqQ: '#111827',
    faqA: '#4b5563',
    footerBg: '#e8f3ee',
    footerText: '#4b5563',
  },
  {
    id: 'ivory',
    label: '아이보리 프리미엄',
    desc: '선물세트·프리미엄 라인 — 골드 새틴 무드',
    accent: '#8a6a3b',
    heroBg: 'linear-gradient(140deg, #2f2a22 0%, #5c4a2f 55%, #8a6a3b 100%)',
    heroText: '#f5ead2',
    orbs: [
      { size: 150, top: -50, right: -36, bg: softGlow('rgba(240,217,160,.55)') },
      { size: 60, bottom: -14, left: 20, bg: softGlow('rgba(240,217,160,.35)') },
    ],
    bodyBg: 'linear-gradient(180deg, #faf6ec 0%, #f4ecdb 100%)',
    heading: '#7c5f34',
    headingClip: null,
    text: '#4a4438',
    card: { bg: 'rgba(255,255,255,.78)', radius: 14, border: '1px solid rgba(160,130,70,.25)' },
    briefBg: 'rgba(160,130,70,.12)',
    briefText: '#7c6a4a',
    faqQ: '#3d3527',
    faqA: '#6b5f49',
    footerBg: '#efe6cf',
    footerText: '#7c6a4a',
  },
  {
    id: 'pop',
    label: '비비드 팝',
    desc: '2030 타깃 — 4색 그라데이션 + 광택 구슬',
    accent: '#a855f7',
    heroBg: 'linear-gradient(120deg, #4f46e5 0%, #a855f7 40%, #ec4899 72%, #f59e0b 100%)',
    heroText: '#ffffff',
    orbs: [
      { size: 96, top: -22, right: 18, bg: glossyBall('#a855f7', '#f0abfc') },
      { size: 52, bottom: -10, left: 16, bg: glossyBall('#f59e0b', '#fde68a') },
      { size: 34, top: 24, left: -12, bg: glossyBall('#ec4899', '#fbcfe8') },
    ],
    bodyBg: '#ffffff',
    heading: '#7c3aed',
    headingClip: 'linear-gradient(90deg, #4f46e5, #ec4899)',
    text: '#3f3f46',
    card: null,
    briefBg: '#faf5ff',
    briefText: '#8b5cf6',
    faqQ: '#312e81',
    faqA: '#52525b',
    footerBg: '#fdf2f8',
    footerText: '#9d5b83',
  },
  {
    id: 'glass',
    label: '글래스 3D',
    desc: '반투명 유리 카드 + 3D 구체 장식',
    accent: '#6366f1',
    heroBg: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%)',
    heroText: '#ffffff',
    orbs: [
      { size: 120, top: -30, right: -24, bg: glossyBall('#6366f1', '#c7d2fe') },
      { size: 64, bottom: -16, right: 90, bg: glossyBall('#38bdf8', '#bae6fd') },
      { size: 44, top: 30, left: -14, bg: glossyBall('#c084fc', '#f3e8ff') },
    ],
    bodyBg: 'linear-gradient(180deg, #eef4ff 0%, #f5f0ff 100%)',
    heading: '#4338ca',
    headingClip: null,
    text: '#3f3f46',
    card: {
      bg: 'rgba(255,255,255,.55)',
      radius: 16,
      border: '1px solid rgba(255,255,255,.75)',
      shadow: '0 8px 24px rgba(99,102,241,.14)',
      blur: 10,
    },
    briefBg: 'rgba(99,102,241,.1)',
    briefText: '#6d6a94',
    faqQ: '#312e81',
    faqA: '#52525b',
    footerBg: 'rgba(255,255,255,.6)',
    footerText: '#6d6a94',
  },
  {
    id: 'dark',
    label: '미드나잇 네온',
    desc: '다크 배경 + 네온 글로우 — 테크·이너뷰티 무드',
    accent: '#22d3ee',
    heroBg: 'linear-gradient(140deg, #0f172a 0%, #1e1b4b 60%, #312e81 100%)',
    heroText: '#e2e8f0',
    orbs: [
      { size: 130, top: -36, right: -26, bg: softGlow('rgba(34,211,238,.55)'), blur: 2 },
      { size: 80, bottom: -22, left: 10, bg: softGlow('rgba(236,72,153,.45)'), blur: 2 },
    ],
    bodyBg: '#0f172a',
    heading: '#22d3ee',
    headingClip: null,
    text: '#cbd5e1',
    card: { bg: 'rgba(30,41,59,.85)', radius: 14, border: '1px solid rgba(148,163,184,.16)' },
    briefBg: 'rgba(148,163,184,.12)',
    briefText: '#94a3b8',
    faqQ: '#e2e8f0',
    faqA: '#94a3b8',
    footerBg: '#0b1120',
    footerText: '#64748b',
  },
]

export function getTheme(id) {
  return DP_THEMES.find((t) => t.id === id) || DP_THEMES[0]
}

// 사용자가 업로드한 이미지를 히어로 배경으로 쓰는 커스텀 테마.
// 텍스트 가독성을 위해 어두운 반투명 오버레이를 이미지 위에 덧씌운다.
export function makeCustomTheme(imageUrl) {
  return {
    id: 'custom',
    label: '내 이미지',
    desc: '업로드한 이미지를 히어로 배경으로 사용',
    accent: '#334155',
    heroBg: `linear-gradient(rgba(15,23,42,.42), rgba(15,23,42,.58)), url(${imageUrl}) center/cover no-repeat`,
    heroText: '#ffffff',
    orbs: [],
    bodyBg: '#ffffff',
    heading: '#1f2937',
    headingClip: null,
    text: '#374151',
    card: null,
    briefBg: '#f3f4f6',
    briefText: '#6b7280',
    faqQ: '#111827',
    faqA: '#4b5563',
    footerBg: '#f3f4f6',
    footerText: '#6b7280',
  }
}

// 업로드 이미지를 최대 폭 1400px로 축소해 데이터 URL로 변환 (브라우저 로컬 처리)
export function fileToResizedDataUrl(file, maxWidth = 1400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('이미지 형식을 인식하지 못했습니다.'))
      img.onload = () => {
        if (img.width <= maxWidth) return resolve(reader.result)
        const canvas = document.createElement('canvas')
        const ratio = maxWidth / img.width
        canvas.width = maxWidth
        canvas.height = Math.round(img.height * ratio)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// 미리보기·내보내기 공용: 구체 장식의 위치 스타일 계산
export function orbStyle(o) {
  const s = {
    width: `${o.size}px`,
    height: `${o.size}px`,
    background: o.bg,
  }
  if (o.top != null) s.top = `${o.top}px`
  if (o.bottom != null) s.bottom = `${o.bottom}px`
  if (o.left != null) s.left = `${o.left}px`
  if (o.right != null) s.right = `${o.right}px`
  if (o.blur) s.filter = `blur(${o.blur}px)`
  return s
}
