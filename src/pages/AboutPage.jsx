import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// claude-opus-5 단가 (USD / 토큰)
const INPUT_PRICE = 5 / 1_000_000
const OUTPUT_PRICE = 25 / 1_000_000

// 계측 테이블의 endpoint 값을 화면에서 읽히는 기능 이름으로 바꾼다
const ENDPOINT_LABELS = {
  'detail-page': '상세페이지 생성',
  content: '채널 콘텐츠',
  listing: '상품등록 최적화',
  'batch-listing': '대량 등록',
  reviews: '리뷰 자동 응대',
  'sales-report': '매출 리포트',
}

// 사유 코드를 비개발자도 읽을 수 있게 옮긴다.
// rate_limit·max_tokens처럼 "고장"이 아닌 것도 섞여 있어, 무엇이 문제이고 무엇이 정책인지 구분한다.
const REASON_LABELS = {
  timeout: 'AI 응답 지연 (고쳐야 할 문제)',
  rate_limit: '사용량 한도 (의도된 비용 보호)',
  contract: 'AI 응답 형식 불완전 (고쳐야 할 문제)',
  max_tokens: '응답 길이 초과 (고쳐야 할 문제)',
  section_failed: '섹션 생성 실패 (고쳐야 할 문제)',
  network: '네트워크 오류',
  rate_limited: 'AI 서비스 혼잡',
  no_tool_use: 'AI 응답 파싱 실패 (고쳐야 할 문제)',
  budget: '예산 상한 (의도된 비용 보호)',
  refusal: 'AI가 생성을 거절 (입력 문구 조정 필요)',
}

// 거절 사유는 분류에 따라 refusal_cyber처럼 뒤에 항목이 붙어 온다 —
// 정확 일치로만 찾으면 라벨이 안 붙어 사용자에게 코드가 그대로 노출된다.
function reasonLabel(reason) {
  if (REASON_LABELS[reason]) return REASON_LABELS[reason]
  if (String(reason).startsWith('refusal')) return REASON_LABELS.refusal
  return null
}

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
    title: '업무를 분해하는 것부터',
    body: '온라인 유통 담당자의 반복 업무 세 줄을 기능 명세로 바꾸고, "AI로 상품페이지 제작"을 1순위 기능으로 배치했습니다. 건강기능식품처럼 표시광고 규제가 있는 카테고리를 상정해, 규제 리스크 관리를 차별화 포인트로 잡았습니다.',
  },
  {
    step: '설계',
    title: 'AI는 초안, 규정은 기계, 결정은 사람',
    body: '모든 생성 프롬프트에 표시광고 금지 규칙을 주입하고, 등록·광고 문구는 규칙 기반 금칙어 스캐너로 한 번 더 점검한 뒤 사람이 최종 결정하는 흐름으로 설계했습니다. 규제 카테고리에서 AI를 실무에 넣을 때 필요한 최소한의 안전장치입니다.',
  },
  {
    step: '구현',
    title: '실제 배포되는 풀스택',
    body: 'React 19 + Vite 프론트, Cloudflare Pages Functions 백엔드, D1 레이트리밋, Claude Opus 5 tool 강제 호출(구조화 JSON 응답). API 키가 없어도 전체 흐름이 시연되도록 샘플 폴백 모드를 설계했습니다.',
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
    basis: '엑셀·CSV 업로드 → 일괄 처리(AI 1회 호출) → 결과 표·등록용 CSV. 위반 상품만 골라 재생성해 통과 상품은 건드리지 않음',
  },
  {
    req: '반복 업무 자동화 (CS 응대)',
    proof: '/reviews',
    proofLabel: '리뷰 자동 응대',
    basis: '리뷰 분류·답변 초안 일괄 생성, 건강 이상 호소 등은 에스컬레이션. 규정 위반 답변만 다시 쓰기 지원',
  },
  {
    req: '인스타·블로그·스레드·유튜브·틱톡 콘텐츠 생성',
    proof: '/content',
    proofLabel: '콘텐츠 팩토리',
    basis: '제품 1개 → 6개 채널 문법에 맞는 콘텐츠 동시 생성, 채널 목업 미리보기',
  },
  {
    req: 'AI 활용 기준·가이드 수립 (조직 단위 운영)',
    proof: '/brand',
    proofLabel: '브랜드 룰북',
    basis: '회사 톤·금지어·필수 문구를 1회 정의 → 6개 생성 기능이 자동 준수, 결과물 준수 여부 기계 검증',
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
        <h1>담당업무를, 동작하는 제품으로</h1>
        <p>
          이 사이트는 "AI 활용 및 자동화 담당자"가 실제로 하는 일을 그대로 만들어 본 포트폴리오입니다.
          할 수 있다는 문장 대신, 그 일을 미리 해서 보여드리는 방식을 택했습니다.
        </p>
      </header>

      <section className="about-section">
        <h2>요건 체크리스트 — 3분 검증용</h2>
        <div className="req-table-wrap">
          <table className="req-table">
            <thead>
              <tr>
                <th>요건</th>
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
            {/* 상한은 "최근 24시간" 롤링이므로 7일 누적만 보면 소진 임박을 알 수 없다.
                상한과 같은 창으로 재서 남은 예산을 함께 보여준다. */}
            {stats.day && (
              <div className="stat-tile">
                <span className="stat-label">최근 24시간 예산</span>
                <span className={stats.day.used_pct >= 80 ? 'stat-value budget-tight' : 'stat-value'}>
                  ${stats.day.spent_usd.toFixed(2)} / ${stats.day.limit_usd.toFixed(2)}
                </span>
                <span className="stat-sub">
                  {stats.day.remaining_usd > 0
                    ? `남은 예산 $${stats.day.remaining_usd.toFixed(2)}`
                    : '소진 — 예시 결과로 표시 중'}
                </span>
              </div>
            )}
          </div>
          {stats.failure_reasons?.length > 0 && (
            <div className="fail-reasons">
              {/* 여기 쌓이는 사유에는 진짜 실패(timeout·contract)만 있는 게 아니라
                  정책에 따른 강등(rate_limit)도 섞인다. "실패"라고 부르면 지표가 과장된다. */}
              <p className="fail-reasons-title">라이브 생성 대신 예시가 나간 사유</p>
              <ul>
                {stats.failure_reasons.map((f) => (
                  <li key={f.reason}>
                    <code>{f.reason}</code> {f.calls}건
                    {reasonLabel(f.reason) ? ` — ${reasonLabel(f.reason)}` : ''}
                  </li>
                ))}
              </ul>
              <p className="about-point">
                "폴백 N건"만 세면 무엇을 고쳐야 할지 알 수 없어, 실패할 때마다 사유 코드를 함께
                남깁니다. 실제로 이 기록이 없던 시절 상세페이지 타임아웃 문제를 손으로 찾아야 했고,
                그 경험이 이 항목을 만든 이유입니다.
              </p>
            </div>
          )}
          {stats.by_endpoint?.length > 0 && (
            <div className="fail-reasons">
              <p className="fail-reasons-title">기능별 안정성</p>
              <table className="endpoint-table">
                <thead>
                  <tr>
                    <th>기능</th>
                    <th>요청</th>
                    <th>라이브</th>
                    <th>폴백률</th>
                    <th>평균</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_endpoint.map((e) => (
                    <tr key={e.endpoint}>
                      <td>{ENDPOINT_LABELS[e.endpoint] || e.endpoint}</td>
                      <td>{e.calls}</td>
                      <td>{e.live_calls}</td>
                      <td className={e.fallback_rate >= 20 ? 'rate-bad' : ''}>{e.fallback_rate}%</td>
                      <td>{e.avg_ms != null ? `${(e.avg_ms / 1000).toFixed(1)}초` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="about-point">
                사유별 건수만 보면 "무엇이 실패했나"는 알아도 "어디가 아픈가"는 모릅니다. 기능별
                폴백률을 함께 보면 다음에 손볼 곳이 바로 정해집니다 — 상세페이지 타임아웃도 이
                관점으로 찾아냈습니다.
              </p>
            </div>
          )}
          <p className="about-point">
            호출마다 모드(라이브/샘플/폴백)·소요시간·토큰·실패 사유를 D1에 기록하고 집계합니다.
            개인정보는 저장하지 않습니다.
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
              <strong>Claude Opus 5</strong>
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
        <h2>담당업무 ↔ 기능 매핑</h2>
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
