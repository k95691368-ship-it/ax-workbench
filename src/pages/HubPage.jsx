import { Link } from 'react-router-dom'

const DEMOS = [
  {
    to: '/detail-page',
    tag: '담당업무 B · 필수 자격요건',
    title: 'AI 상품 상세페이지 생성기',
    desc: '제품 정보를 넣으면 섹션 구조·카피·디자이너 인계 지시서까지 생성합니다. 결과는 HTML로 내려받아 디자이너와 협업합니다.',
  },
  {
    to: '/content',
    tag: '담당업무 B',
    title: '채널 콘텐츠 팩토리',
    desc: '제품 1개로 인스타·카드뉴스·블로그·스레드·유튜브 쇼츠·틱톡 콘텐츠를 채널 문법에 맞춰 동시에 생성합니다.',
  },
  {
    to: '/listing',
    tag: '담당업무 A',
    title: '상품등록 · 검색어 최적화',
    desc: '검색최적화 상품명 조합, 태그·카테고리 추천에 더해 건강기능식품 표시광고 금칙어를 사전 점검합니다.',
  },
  {
    to: '/sales',
    tag: '담당업무 A',
    title: '매출 리포트 자동화',
    desc: '판매 CSV를 올리면 브라우저에서 즉시 집계·차트를 그리고, AI가 인사이트·발주 제안이 담긴 주간 리포트를 작성합니다.',
  },
  {
    to: '/edu',
    tag: '담당업무 C',
    title: '직원 AI 교육 가이드',
    desc: '비개발 직군(영업·마케팅·CS)을 위한 프롬프트 패턴과 팀별 활용 시나리오. 사내 교육 자료의 샘플입니다.',
  },
]

const PIPELINE = ['실무자 입력', 'AI 생성 (Claude Opus 4.8)', '규정 사전점검', '사람 검수', '발행 · 등록']

export default function HubPage() {
  return (
    <div className="hub">
      <section className="hub-hero">
        <p className="hub-eyebrow">AX 취업 포트폴리오 — AI 업무자동화 데모</p>
        <h1>
          온라인 유통 실무 3가지를
          <br />
          그대로 자동화한 워크벤치
        </h1>
        <p className="hub-sub">
          채용공고의 담당업무(자동화 파이프라인 · 채널 콘텐츠 · 반복업무 효율화)를 1:1로 구현한
          라이브 데모입니다. 예시 제품은 모두 가상이며, 생성 문구는 식품표시광고법 기준으로
          사전 점검됩니다.
        </p>
        <div className="hub-cta">
          <Link to="/detail-page" className="btn-primary">
            핵심 데모 보기 — 상세페이지 생성
          </Link>
          <Link to="/sales" className="btn-ghost">
            매출 리포트 데모
          </Link>
        </div>
      </section>

      <section className="hub-pipeline" aria-label="자동화 파이프라인">
        <h2>자동화 파이프라인 설계</h2>
        <p className="hub-pipeline-sub">
          모든 데모는 같은 원칙으로 설계했습니다 — AI가 초안을 만들고, 규정을 기계적으로 걸러내고,
          사람이 최종 결정합니다.
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
        <h2>데모 목록</h2>
        <div className="hub-grid">
          {DEMOS.map((d) => (
            <Link key={d.to} to={d.to} className="hub-card">
              <span className="hub-card-tag">{d.tag}</span>
              <h3>{d.title}</h3>
              <p>{d.desc}</p>
              <span className="hub-card-go">데모 실행 →</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
