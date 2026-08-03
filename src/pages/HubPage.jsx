import { Link } from 'react-router-dom'

const PROOFS = [
  { before: '상세페이지 초안 반나절', after: '30초', label: '제품 정보만 넣으면 섹션 구조까지' },
  { before: '채널별 콘텐츠 각각 작성', after: '6종 동시', label: '인스타부터 틱톡까지 한 번에' },
  { before: '금칙어 육안 검수', after: '즉시 검출', label: '표시광고법 기준 4분류 자동 점검' },
  { before: '주간 매출 정리 2시간', after: '클릭 1번', label: '엑셀·CSV 올리면 차트·리포트까지' },
  { before: '담당자마다 다른 말투', after: '룰북 1회 정의', label: '전 기능이 회사 규정을 자동 준수' },
  { before: '걸린 문구는 손으로 수정', after: '클릭 한 번', label: '위반 항목만 골라 AI가 다시 작성' },
]

const DEMOS = [
  {
    to: '/onboard',
    tag: '⚡ 파이프라인 통합',
    title: '신상품 원클릭 온보딩',
    desc: '제품 정보를 한 번만 넣으면 상세페이지·상품등록 정보·채널 콘텐츠가 동시에 만들어지고, 표시광고 점검까지 마친 작업 패키지로 묶여 나와요.',
    featured: true,
  },
  {
    to: '/detail-page',
    tag: '담당업무 B · 필수 자격요건',
    title: 'AI 상품 상세페이지 생성기',
    desc: '제품 정보를 넣으면 섹션 구조·카피·디자이너 인계 지시서까지 만들어 드려요. 결과는 HTML로 내려받아 디자이너와 바로 협업합니다.',
  },
  {
    to: '/content',
    tag: '담당업무 B',
    title: '채널 콘텐츠 팩토리',
    desc: '제품 1개로 인스타·카드뉴스·블로그·스레드·유튜브 쇼츠·틱톡 콘텐츠를 채널 문법에 맞춰 동시에 생성해요.',
  },
  {
    to: '/listing',
    tag: '담당업무 A',
    title: '상품등록 · 검색어 최적화',
    desc: '검색최적화 상품명 조합, 태그·카테고리 추천에 더해 건강기능식품 표시광고 금칙어를 등록 전에 걸러냅니다.',
  },
  {
    to: '/batch',
    tag: '담당업무 A · 연 1,000개 대응',
    title: '대량 등록 도우미',
    desc: '쓰던 엑셀·CSV를 그대로 올리면 전 상품의 상품명·태그·금칙어 점검을 일괄 처리해요. 사람은 플래그 붙은 상품만 확인합니다.',
  },
  {
    to: '/reviews',
    tag: '담당업무 C',
    title: '리뷰 자동 응대',
    desc: '리뷰를 분류하고 답변 초안을 일괄 작성해요. 건강 이상 호소처럼 판단이 필요한 건은 AI가 답하지 않고 담당자에게 올립니다.',
  },
  {
    to: '/sales',
    tag: '담당업무 A',
    title: '매출 리포트 자동화',
    desc: '판매 엑셀·CSV를 올리면 브라우저에서 즉시 집계·차트를 그리고, AI가 인사이트·발주 제안이 담긴 주간 리포트를 써 드려요.',
  },
  {
    to: '/brand',
    tag: '전 기능 공통 · 조직 규정',
    title: '브랜드 룰북',
    desc: '회사의 말투·금지어·필수 문구를 한 번 정의하면 모든 생성 기능이 자동으로 따릅니다. 사람이 매번 손보는 대신 규칙을 한 곳에서 관리해요.',
  },
  {
    to: '/edu',
    tag: '담당업무 C',
    title: '직원 AI 교육 가이드',
    desc: '비개발 직군(영업·마케팅·CS)을 위한 프롬프트 패턴과 팀별 활용 시나리오. 사내 교육 자료의 샘플입니다.',
  },
]

const PIPELINE = ['실무자 입력', 'AI 생성 (Claude Opus 5)', '규정 사전점검', '사람 검수', '발행 · 등록']

export default function HubPage() {
  return (
    <div className="hub">
      <section className="hub-hero">
        <p className="hub-eyebrow">AI 업무자동화 워크벤치 — 지금 실제로 동작합니다</p>
        <h1>
          반복 업무는 AI에게,
          <br />
          판단은 사람에게
        </h1>
        <p className="hub-sub">
          온라인 유통 실무의 세 가지 반복 업무 — 상품등록, 콘텐츠 제작, 매출분석 — 를 그대로
          자동화한 워크벤치입니다. 지금 바로 눌러서 써볼 수 있어요.
        </p>
        <div className="hub-cta">
          <Link to="/detail-page" className="btn-primary">
            30초 만에 상세페이지부터 만들어 보세요
          </Link>
          <Link to="/sales" className="btn-ghost">
            매출 리포트 바로 보기
          </Link>
        </div>
      </section>

      <section className="proof-strip" aria-label="자동화 효과">
        {PROOFS.map((p) => (
          <div className="proof-card" key={p.after}>
            <p className="proof-before">{p.before}</p>
            <p className="proof-after">→ {p.after}</p>
            <p className="proof-label">{p.label}</p>
          </div>
        ))}
      </section>

      <section className="hub-pipeline" aria-label="자동화 파이프라인">
        <h2>모든 기능에 같은 원칙을 넣었습니다</h2>
        <p className="hub-pipeline-sub">
          AI가 초안을 만들고, 규정 위반은 기계적으로 걸러내고, 최종 결정은 사람이 합니다.
          건강기능식품처럼 규제가 있는 카테고리에서 특히 중요한 설계입니다.
        </p>
        <ol className="pipeline-flow">
          {PIPELINE.map((step, i) => (
            <li key={step}>
              <span className="pipeline-step-num">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section className="hub-demos">
        <h2>기능 9가지 — 채용공고의 담당업무 그대로</h2>
        <div className="hub-grid">
          {DEMOS.map((d) => (
            <Link key={d.to} to={d.to} className={d.featured ? 'hub-card featured' : 'hub-card'}>
              <span className="hub-card-tag">{d.tag}</span>
              <h3>{d.title}</h3>
              <p>{d.desc}</p>
              <span className="hub-card-go">직접 써보기 →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="hub-closing">
        <h2>궁금하시다면, 지금 하나만 눌러 보세요</h2>
        <p>
          모든 기능은 예시 데이터가 채워져 있어 입력 없이 버튼 한 번으로 결과를 확인할 수
          있습니다.
        </p>
        <div className="hub-cta">
          <Link to="/detail-page" className="btn-primary">
            상세페이지 생성해 보기
          </Link>
          <Link to="/listing" className="btn-ghost">
            금칙어 점검해 보기
          </Link>
        </div>
      </section>
    </div>
  )
}
