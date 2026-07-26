import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// claude-opus-4-8 단가 (USD / 토큰)
const INPUT_PRICE = 5 / 1_000_000
const OUTPUT_PRICE = 25 / 1_000_000

const MAPPING = [
  {
    duty: 'A. 자동화 파이프라인 구축 — 매출분석, 상품등록/검색어 최적화, 판매통계',
    demos: [
      { to: '/listing', label: '상품등록 · 검색어 최적화' },
      { to: '/sales', label: '매출 리포트 자동화' },
    ],
    point: 'CSV 집계는 브라우저 로컬 처리, AI에는 요약만 전달 — 데이터 최소 전송 설계',
  },
  {
    duty: 'B. 콘텐츠 생성 및 관리 — 채널별 콘텐츠, AI로 상품페이지 제작 (필수 자격요건)',
    demos: [
      { to: '/detail-page', label: 'AI 상품 상세페이지 생성기' },
      { to: '/content', label: '채널 콘텐츠 팩토리' },
    ],
    point: '결과물을 HTML·디자인 브리프로 내보내 디자이너 협업 흐름까지 구현',
  },
  {
    duty: 'C. 반복 업무 자동화·효율화, 직원 AI 사용 교육',
    demos: [{ to: '/edu', label: '직원 AI 교육 가이드' }],
    point: '교육 페이지 자체가 교육 업무의 샘플 결과물',
  },
]

const PROCESS = [
  {
    step: '기획',
    title: '공고를 분해하는 것부터',
    body: '채용공고의 담당업무 3줄을 기능 명세로 바꾸고, 자격요건("AI로 상품페이지 제작 가능")을 1순위 기능으로 배치했습니다. 회사가 건강기능식품 유통사라는 점에서 표시광고법 리스크 관리를 차별화 포인트로 잡았습니다.',
  },
  {
    step: '설계',
    title: 'AI는 초안, 규정은 기계, 결정은 사람',
    body: '모든 생성 프롬프트에 표시광고 금지 규칙을 주입하고, 등록·광고 문구는 규칙 기반 금칙어 스캐너로 한 번 더 점검한 뒤 사람이 최종 결정하는 흐름으로 설계했습니다. 규제 카테고리에서 AI를 실무에 넣을 때 필요한 최소한의 안전장치입니다.',
  },
  {
    step: '구현',
    title: '실제 배포되는 풀스택',
    body: 'React 19 + Vite 프론트, Cloudflare Pages Functions 백엔드, D1 레이트리밋, Claude Opus 4.8 tool 강제 호출(구조화 JSON 응답). API 키가 없어도 전체 흐름이 시연되도록 샘플 폴백 모드를 설계했습니다.',
  },
  {
    step: '개선 ×5',
    title: '실사이트 벤치마킹 반복',
    body: '배포 후 채널톡·토스·미리캔버스·Buffer·Mixpanel 등 실제 서비스를 벤치마킹하며 5차례 개선했습니다: 수치 기반 카피 → 모바일 미리보기 → 채널 목업 → 대시보드 필터 → 이 제작기 페이지. 전 과정은 저장소의 기획안·개선기획안 문서에 기록되어 있습니다.',
  },
]

const REQUIREMENTS = [
  {
    req: 'AI를 활용해 상품페이지 제작 가능 (필수 자격요건)',
    proof: '/detail-page',
    proofLabel: '상세페이지 생성기',
    basis: '제품 정보 → 섹션 구조·카피·이미지 지시서 생성, HTML·디자인 브리프로 디자이너 인계',
  },
  {
    req: '매출분석·판매통계 등 데이터 자동화',
    proof: '/sales',
    proofLabel: '매출 리포트',
    basis: 'CSV 즉시 집계·차트(채널 필터·이상 감지) + AI 주간 리포트, 원본 데이터 서버 미전송',
  },
  {
    req: '상품등록·검색어 최적화',
    proof: '/listing',
    proofLabel: '상품등록 최적화',
    basis: '검색최적화 상품명·태그·카테고리 + 식품표시광고법 금칙어 실시간 점검',
  },
  {
    req: '연 1,000개 상품 등록 (대량 반복 업무)',
    proof: '/batch',
    proofLabel: '대량 등록 도우미',
    basis: '상품 목록 일괄 처리(AI 1회 호출) → 결과 표 + 등록용 CSV, 금칙어 검출 상품만 사람이 확인',
  },
  {
    req: '반복 업무 자동화 (CS 응대)',
    proof: '/reviews',
    proofLabel: '리뷰 자동 응대',
    basis: '리뷰 분류·답변 초안 일괄 생성, 건강 이상 호소 등 판단 필요 건은 에스컬레이션',
  },
  {
    req: '인스타·블로그·스레드·유튜브·틱톡 콘텐츠 생성',
    proof: '/content',
    proofLabel: '콘텐츠 팩토리',
    basis: '제품 1개 → 6개 채널 문법에 맞는 콘텐츠 동시 생성, 채널 목업 미리보기',
  },
  {
    req: '반복 업무 효율화 · 직원 AI 사용 교육',
    proof: '/edu',
    proofLabel: 'AI 교육 가이드',
    basis: '프롬프트 패턴 4종 + 팀별(영업/마케팅/CS) 시나리오 — 교육 자료 샘플 그 자체',
  },
]

export default function AboutPage() {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch('/api/ax/stats')
      .then((r) => r.json())
      .then((d) => {
        if (d?.available && d.total > 0) setStats(d)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="tool-page about-page">
      <header className="tool-header">
        <span className="tool-tag">이 포트폴리오에 대하여</span>
        <h1>공고의 담당업무를, 동작하는 제품으로</h1>
        <p>
          이 사이트는 "AI 활용 및 자동화 담당자" 채용공고 하나를 위해 만든 맞춤 포트폴리오입니다.
          이력서 문장 대신, 입사 후 할 일을 미리 만들어 보여드리는 방식을 택했습니다.
        </p>
      </header>

      <section className="about-section">
        <h2>공고 요건 체크리스트 — 3분 검증용</h2>
        <div className="req-table-wrap">
          <table className="req-table">
            <thead>
              <tr>
                <th>공고 요건</th>
                <th>증명 기능</th>
                <th>구현 근거</th>
              </tr>
            </thead>
            <tbody>
              {REQUIREMENTS.map((r) => (
                <tr key={r.req}>
                  <td className="req-name">✓ {r.req}</td>
                  <td>
                    <Link to={r.proof} className="req-link">
                      {r.proofLabel} →
                    </Link>
                  </td>
                  <td className="req-basis">{r.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {stats && (
        <section className="about-section">
          <h2>실측 운영 지표 — 최근 7일</h2>
          <div className="stat-row">
            <div className="stat-tile">
              <span className="stat-label">AI 생성 요청</span>
              <span className="stat-value">{stats.total.toLocaleString('ko-KR')}회</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">라이브 생성</span>
              <span className="stat-value">{stats.live_calls.toLocaleString('ko-KR')}회</span>
            </div>
            {stats.live_avg_ms != null && (
              <div className="stat-tile">
                <span className="stat-label">평균 생성 시간</span>
                <span className="stat-value">{(stats.live_avg_ms / 1000).toFixed(1)}초</span>
              </div>
            )}
            <div className="stat-tile">
              <span className="stat-label">누적 추정 비용</span>
              <span className="stat-value">
                ${(stats.input_tokens * INPUT_PRICE + stats.output_tokens * OUTPUT_PRICE).toFixed(2)}
              </span>
            </div>
          </div>
          <p className="about-point">
            호출마다 모드(라이브/샘플/폴백)·소요시간·토큰을 D1에 기록하고 집계합니다. 개인정보는
            저장하지 않습니다.
          </p>
        </section>
      )}

      <section className="about-section">
        <h2>시스템 구조</h2>
        <div className="arch">
          <div className="arch-row">
            <div className="arch-box">
              <strong>브라우저 (React 19)</strong>
              <span>폼 입력 · CSV 로컬 파싱 · 결과 렌더</span>
            </div>
            <span className="arch-arrow" aria-hidden="true">→</span>
            <div className="arch-box arch-core">
              <strong>Cloudflare Pages Functions</strong>
              <span>입력 검증 · 레이트리밋 · 응답 계약 검증 · 금칙어 사후점검</span>
            </div>
            <span className="arch-arrow" aria-hidden="true">→</span>
            <div className="arch-box">
              <strong>Claude Opus 4.8</strong>
              <span>tool 강제 호출 = 구조화 JSON 보장</span>
            </div>
          </div>
          <div className="arch-notes">
            <p>• <strong>D1 데이터베이스</strong> — IP별·전체·일일 예산 레이트리밋 (비용 폭주 방지)</p>
            <p>• <strong>장애·한도 초과 시</strong> — 502 에러 대신 큐레이션된 예시 결과로 우아하게 강등 (서비스 무중단)</p>
            <p>• <strong>이중 컴플라이언스</strong> — 프롬프트에 표시광고 금지 규칙 주입 + 생성 결과를 규칙 엔진으로 재점검</p>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h2>공고 담당업무 ↔ 기능 매핑</h2>
        <div className="about-mapping">
          {MAPPING.map((m) => (
            <article className="about-map-card" key={m.duty}>
              <p className="about-duty">{m.duty}</p>
              <div className="about-demo-links">
                {m.demos.map((d) => (
                  <Link key={d.to} to={d.to} className="btn-ghost">
                    {d.label} →
                  </Link>
                ))}
              </div>
              <p className="about-point">{m.point}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="about-section">
        <h2>제작 과정</h2>
        <ol className="about-process">
          {PROCESS.map((p) => (
            <li key={p.step}>
              <span className="about-step">{p.step}</span>
              <div>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="about-section">
        <h2>품질을 지킨 방법</h2>
        <ul className="plain-list">
          <li>vitest 단위 테스트 15개 — CSV 파서·집계·이상 감지·금칙어 스캐너의 경계 사례 검증</li>
          <li>oxlint 정적 분석 무경고 유지, 모든 개선 사이클마다 테스트 통과 후 배포</li>
          <li>생성 문구는 식품표시광고법 제8조 기준 4분류 금칙어 규칙으로 이중 점검</li>
          <li>판매 데이터 원본은 서버로 전송하지 않음 — 집계 요약만 AI에 전달</li>
        </ul>
      </section>

      <section className="hub-closing">
        <h2>직접 확인해 보세요</h2>
        <p>모든 기능은 예시 데이터가 채워져 있어 버튼 한 번이면 결과가 나옵니다.</p>
        <div className="hub-cta">
          <Link to="/detail-page" className="btn-primary">
            상세페이지 생성기 실행
          </Link>
          <Link to="/sales" className="btn-ghost">
            매출 리포트 실행
          </Link>
        </div>
      </section>
    </div>
  )
}
