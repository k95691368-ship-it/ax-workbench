import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary.jsx'

const MENU = [
  { to: '/', label: '홈', end: true },
  { to: '/onboard', label: '원클릭 온보딩' },
  { to: '/detail-page', label: '상세페이지' },
  { to: '/content', label: '콘텐츠' },
  { to: '/listing', label: '상품등록' },
  { to: '/batch', label: '대량 등록' },
  { to: '/reviews', label: '리뷰 응대' },
  { to: '/sales', label: '매출 리포트' },
  { to: '/brand', label: '브랜드 룰북' },
  { to: '/history', label: '이력' },
  { to: '/edu', label: 'AI 교육' },
  { to: '/about', label: '제작기' },
]

export default function Layout() {
  const location = useLocation()
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        본문으로 건너뛰기
      </a>
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
      <main className="app-main" id="main-content">
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <footer className="app-footer">
        <div className="footer-grid">
          <div className="footer-col">
            <p className="footer-title">기능 바로가기</p>
            <Link to="/onboard">신상품 원클릭 온보딩</Link>
            <Link to="/detail-page">상세페이지 생성기</Link>
            <Link to="/content">채널 콘텐츠 팩토리</Link>
            <Link to="/listing">상품등록 최적화</Link>
            <Link to="/batch">대량 등록 도우미</Link>
            <Link to="/reviews">리뷰 자동 응대</Link>
            <Link to="/sales">매출 리포트 자동화</Link>
            <Link to="/brand">브랜드 룰북</Link>
            <Link to="/history">생성 이력</Link>
            <Link to="/edu">직원 AI 교육 가이드</Link>
          </div>
          <div className="footer-col">
            <p className="footer-title">이 도구</p>
            <p className="footer-text">
              온라인 유통의 반복 업무 — 상품등록·콘텐츠 제작·매출분석 — 을 동작하는 도구로
              구현했습니다. AI가 초안을 만들고, 규정 위반은 기계적으로 걸러내고,
              최종 결정은 사람이 합니다.
            </p>
          </div>
          <div className="footer-col">
            <p className="footer-title">기술 스택</p>
            <p className="footer-text">
              React 19 · Vite · Cloudflare Pages Functions · Cloudflare D1 · Claude Opus 5
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
