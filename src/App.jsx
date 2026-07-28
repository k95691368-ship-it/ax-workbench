import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import HubPage from './pages/HubPage.jsx'

const AboutPage = lazy(() => import('./pages/AboutPage.jsx'))
const DetailPage = lazy(() => import('./pages/DetailPage.jsx'))
const ContentPage = lazy(() => import('./pages/ContentPage.jsx'))
const ListingPage = lazy(() => import('./pages/ListingPage.jsx'))
const SalesPage = lazy(() => import('./pages/SalesPage.jsx'))
const EduPage = lazy(() => import('./pages/EduPage.jsx'))
const BatchPage = lazy(() => import('./pages/BatchPage.jsx'))
const ReviewsPage = lazy(() => import('./pages/ReviewsPage.jsx'))
const OnboardPage = lazy(() => import('./pages/OnboardPage.jsx'))
const BrandPage = lazy(() => import('./pages/BrandPage.jsx'))

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HubPage />} />
        <Route
          path="/about"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <AboutPage />
            </Suspense>
          }
        />
        <Route
          path="/detail-page"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <DetailPage />
            </Suspense>
          }
        />
        <Route
          path="/onboard"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <OnboardPage />
            </Suspense>
          }
        />
        <Route
          path="/batch"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <BatchPage />
            </Suspense>
          }
        />
        <Route
          path="/reviews"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <ReviewsPage />
            </Suspense>
          }
        />
        <Route
          path="/content"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <ContentPage />
            </Suspense>
          }
        />
        <Route
          path="/listing"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <ListingPage />
            </Suspense>
          }
        />
        <Route
          path="/sales"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <SalesPage />
            </Suspense>
          }
        />
        <Route
          path="/brand"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <BrandPage />
            </Suspense>
          }
        />
        <Route
          path="/edu"
          element={
            <Suspense fallback={<p className="page-loading">불러오는 중...</p>}>
              <EduPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  )
}

export default App
