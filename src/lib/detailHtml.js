// 상세페이지 결과 → 배포용 HTML / 디자이너 브리프 변환.
// 상세페이지 생성기와 원클릭 온보딩이 같은 함수를 공유한다(결과물 일관성 보장).
import { getTheme } from './themes.js'

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function buildHtml(result, product, theme) {
  const t = theme || getTheme('green')
  const orbs = (t.orbs || [])
    .map((o) => {
      const pos = [
        o.top != null ? `top:${o.top}px;` : '',
        o.bottom != null ? `bottom:${o.bottom}px;` : '',
        o.left != null ? `left:${o.left}px;` : '',
        o.right != null ? `right:${o.right}px;` : '',
      ].join('')
      return `<i style="position:absolute;${pos}width:${o.size}px;height:${o.size}px;border-radius:50%;background:${o.bg};${o.blur ? `filter:blur(${o.blur}px);` : ''}"></i>`
    })
    .join('')
  const cardStyle = t.card
    ? `background:${t.card.bg};border-radius:${t.card.radius}px;${t.card.border ? `border:${t.card.border};` : ''}${t.card.shadow ? `box-shadow:${t.card.shadow};` : ''}${t.card.blur ? `-webkit-backdrop-filter:blur(${t.card.blur}px);backdrop-filter:blur(${t.card.blur}px);` : ''}margin:16px auto;max-width:720px;padding:32px 24px;`
    : 'padding:48px 24px;max-width:720px;margin:0 auto;border-bottom:1px solid rgba(128,128,128,.18);'
  const headingStyle = t.headingClip
    ? `font-size:24px;background:${t.headingClip};-webkit-background-clip:text;background-clip:text;color:transparent;`
    : `font-size:24px;color:${t.heading};`
  const sections = (result.sections || [])
    .map(
      (s) => `
  <section style="${cardStyle}">
    <h2 style="${headingStyle}">${esc(s.title)}</h2>
    <p style="font-size:16px;line-height:1.8;color:${t.text};">${esc(s.body)}</p>
    ${(s.bullets || []).length ? `<ul style="color:${t.text};">${s.bullets.map((b) => `<li style="line-height:1.9;">${esc(b)}</li>`).join('')}</ul>` : ''}
    <p style="font-size:12px;color:${t.briefText};background:${t.briefBg};padding:8px 12px;border-radius:6px;">[이미지 지시] ${esc(s.image_brief)}</p>
  </section>`
    )
    .join('')
  const faq = (result.faq || [])
    .map(
      (f) =>
        `<dt style="font-weight:700;margin-top:16px;color:${t.faqQ};">Q. ${esc(f.q)}</dt><dd style="margin:4px 0 0;color:${t.faqA};line-height:1.7;">A. ${esc(f.a)}</dd>`
    )
    .join('')
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(product.name)} 상세페이지 초안</title></head>
<body style="margin:0;font-family:Pretendard,'Malgun Gothic',sans-serif;background:${t.bodyBg};">
  <header style="position:relative;overflow:hidden;background:${t.heroBg};color:${t.heroText};text-align:center;padding:72px 24px;">
    ${orbs}
    <div style="position:relative;z-index:1;">
      <h1 style="font-size:30px;margin:0 0 12px;">${esc(result.headline)}</h1>
      <p style="font-size:17px;opacity:.85;margin:0;">${esc(result.subheadline)}</p>
    </div>
  </header>
  ${sections}
  <section style="${cardStyle}">
    <h2 style="${headingStyle.replace('font-size:24px', 'font-size:22px')}">자주 묻는 질문</h2>
    <dl>${faq}</dl>
  </section>
  <footer style="background:${t.footerBg};padding:24px;text-align:center;font-size:12px;color:${t.footerText};">
    본 문서는 AI가 생성한 초안입니다 · 디자인 테마: ${esc(t.label)} · 디자이너 메모: ${esc(result.designer_notes)}
  </footer>
</body></html>`
}

export function buildBrief(result, product, theme) {
  const t = theme || getTheme('green')
  return [
    `[상세페이지 디자인 브리프] ${product.name}`,
    '',
    `헤드라인: ${result.headline}`,
    `서브: ${result.subheadline}`,
    `디자인 테마: ${t.label} (포인트 ${t.accent} / 배경 ${t.bodyBg})`,
    `톤앤매너: ${result.designer_notes}`,
    '',
    '섹션 구성:',
    ...(result.sections || []).map((s, i) => `${i + 1}. ${s.title}\n   - 이미지: ${s.image_brief}`),
  ].join('\n')
}

// 브라우저에서 파일 하나를 내려받는다 (여러 페이지가 공유)
export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function safeFileName(name, fallback = '제품') {
  return String(name || fallback).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || fallback
}
