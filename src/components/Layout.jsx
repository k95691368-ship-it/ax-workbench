import { NavLink, Outlet } from 'react-router-dom'

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
        <p>
          커머스 AX 워크벤치 — AI 업무자동화 포트폴리오 데모 · Claude Opus 4.8 기반 ·
          예시 제품은 모두 가상의 제품입니다.
        </p>
      </footer>
    </div>
  )
}
