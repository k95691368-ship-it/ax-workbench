import { NavLink, Outlet, Link } from 'react-router-dom'

const MENU = [
  { to: '/', label: '홈', end: true },
  { to: '/detail-page', label: '상세페이지 생성' },
  { to: '/content', label: '콘텐츠 팩토리' },
  { to: '/listing', label: '상품등록 최적화' },
  { to: '/sales', label: '매출 리포트' },
  { to: '/edu', label: 'AI 교육' },
]

export default function Layout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="topbar-brand">
          <span className="topbar-logo">AX</span>
          커머스 AX 워크벤치
        </NavLink>
        <nav className="topbar-nav">
          {MENU.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'topbar-link active' : 'topbar-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <div className="footer-grid">
          <div className="footer-col">
            <p className="footer-title">데모 바로가기</p>
            <Link to="/detail-page">상세페이지 생성기</Link>
            <Link to="/content">채널 콘텐츠 팩토리</Link>
            <Link to="/listing">상품등록 최적화</Link>
            <Link to="/sales">매출 리포트 자동화</Link>
            <Link to="/edu">직원 AI 교육 가이드</Link>
          </div>
          <div className="footer-col">
            <p className="footer-title">이 포트폴리오</p>
            <p className="footer-text">
              온라인 유통사의 "AI 활용 및 자동화 담당자" 직무를 위해 만든 취업 포트폴리오입니다.
              채용공고의 담당업무 3가지를 실제 동작하는 도구로 구현했습니다.
            </p>
          </div>
          <div className="footer-col">
            <p className="footer-title">기술 스택</p>
            <p className="footer-text">
              React 19 · Vite · Cloudflare Pages Functions · Cloudflare D1 · Claude Opus 4.8
              (tool 강제 호출로 구조화 응답)
            </p>
          </div>
        </div>
        <p className="footer-bottom">
          예시 제품은 모두 가상의 제품입니다 · 생성 문구는 식품표시광고법 기준 사전점검을 거칩니다
        </p>
      </footer>
    </div>
  )
}
