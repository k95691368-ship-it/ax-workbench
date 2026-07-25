const PATTERNS = [
  {
    name: '역할 + 맥락 + 형식 (RCF 패턴)',
    bad: '유산균 인스타 글 써줘',
    good:
      '너는 건강기능식품 유통사의 SNS 마케터야. 아래 제품 정보로 인스타그램 피드 글을 써줘.\n- 제품: 데일리 장편한 유산균 30포 (19종 균주, 보장균수 100억 CFU)\n- 타깃: 2040 직장인\n- 형식: 첫 줄 후킹 + 본문 4줄 + 해시태그 10개\n- 금지: 질병 치료·예방 표현, 최상급 표현',
    why: '역할을 정하면 말투가, 맥락을 주면 사실이, 형식을 주면 결과 구조가 고정됩니다. 특히 금지 조건은 건기식 업무에서 필수입니다.',
  },
  {
    name: '예시 주입 (Few-shot 패턴)',
    bad: '우리 스타일로 상품명 지어줘',
    good:
      '아래는 우리 회사가 실제 쓰는 상품명 스타일이야.\n예시1: 데일리 장편한 유산균 19종 스틱 100억 CFU 30포\n예시2: 바삭 곱창돌김 도시락김 들기름 16봉\n같은 스타일로 "멀티비타 츄어블 60정"의 상품명 4개를 만들어줘.',
    why: '"우리 스타일"은 AI가 모릅니다. 실제 예시 2~3개를 주면 어투·구조·키워드 배치를 그대로 학습해 따라합니다.',
  },
  {
    name: '검수 요청 (셀프 리뷰 패턴)',
    bad: '(생성된 문구를 그대로 사용)',
    good:
      '방금 쓴 광고 문구를 식품표시광고법 기준으로 다시 검토해줘.\n- 질병 예방·치료로 읽힐 수 있는 표현\n- 근거 없는 최상급·단정 표현\n각각 지적하고 안전한 대체 문구를 제안해줘.',
    why: '생성과 검수를 분리하면 정확도가 크게 오릅니다. AI가 만든 것을 AI에게 다시 공격시키는 것이 실무 요령입니다.',
  },
  {
    name: '표 변환 (정형화 패턴)',
    bad: '이 주문 내역 정리해줘',
    good:
      '아래 주문 문의 텍스트에서 [주문번호 / 상품명 / 요청사항 / 처리상태] 4개 컬럼의 표로 정리해줘. 값이 없으면 "-"로 표시해줘.',
    why: '컬럼을 지정하면 결과를 바로 엑셀에 붙여넣을 수 있습니다. "값이 없으면 -" 같은 빈값 규칙까지 정하는 것이 포인트입니다.',
  },
]

const TEAM_SCENARIOS = [
  {
    team: '영업팀',
    items: [
      '거래처 제안 메일 초안: 상품 리스트를 주고 거래처 업종별 맞춤 제안 문구 생성',
      '발주 수량 1차 검토: 최근 판매량 표를 붙여넣고 "다음 주 발주 수량 제안 + 근거" 요청',
      '경쟁 상품 비교표: 상품 상세 텍스트 2~3개를 주고 스펙 비교표로 변환',
    ],
  },
  {
    team: '마케팅팀',
    items: [
      '채널별 콘텐츠 초안: 이 워크벤치의 콘텐츠 팩토리 흐름 그대로',
      '리뷰 요약: 상품 리뷰 50개를 붙여넣고 "칭찬 포인트 / 불만 포인트 / 개선 아이디어" 3분류 요약',
      '광고 문구 사전점검: 셀프 리뷰 패턴으로 표시광고 리스크 점검',
    ],
  },
  {
    team: 'CS팀',
    items: [
      '답변 초안: 문의 유형별(배송/교환/성분) 답변 템플릿 생성 후 상황에 맞게 수정',
      '민감 문의 에스컬레이션: 건강 이상 호소 문의는 AI가 답하지 않고 담당자 이관 — 기준을 프롬프트에 명시',
      'FAQ 초안: 반복 문의 상위 10개를 붙여넣고 FAQ 문서 초안 생성',
    ],
  },
]

const RULES = [
  '개인정보(이름·연락처·주소)는 프롬프트에 넣지 않는다 — 붙여넣기 전에 마스킹한다.',
  'AI가 만든 광고 문구는 반드시 표시광고 사전점검을 거친 뒤 발행한다.',
  '성분·함량·인증 등 사실 정보는 AI 출력이 아니라 제품 표기사항으로 최종 확인한다.',
  '외부 공개 문서는 사람이 최종 검수하고, 검수자 이름을 남긴다.',
]

export default function EduPage() {
  return (
    <div className="tool-page edu-page">
      <header className="tool-header">
        <span className="tool-tag">담당업무 C · 직원 AI 사용 교육</span>
        <h1>직원 AI 교육 가이드</h1>
        <p>
          비개발 직군이 내일부터 쓸 수 있는 프롬프트 패턴 4가지와 팀별 활용 시나리오입니다. 이
          페이지 자체가 "직원 AI 교육" 업무의 샘플 결과물입니다.
        </p>
      </header>

      <section className="edu-section">
        <h2>1. 프롬프트 패턴 4가지</h2>
        <div className="edu-patterns">
          {PATTERNS.map((p, i) => (
            <article className="edu-pattern" key={p.name}>
              <h3>
                <span className="edu-num">{i + 1}</span> {p.name}
              </h3>
              <div className="edu-compare">
                <div className="edu-bad">
                  <span className="edu-label">이렇게 말고</span>
                  <pre>{p.bad}</pre>
                </div>
                <div className="edu-good">
                  <span className="edu-label">이렇게</span>
                  <pre>{p.good}</pre>
                </div>
              </div>
              <p className="edu-why">{p.why}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="edu-section">
        <h2>2. 팀별 활용 시나리오</h2>
        <div className="edu-teams">
          {TEAM_SCENARIOS.map((t) => (
            <article className="edu-team" key={t.team}>
              <h3>{t.team}</h3>
              <ul className="plain-list">
                {t.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="edu-section">
        <h2>3. 전사 공통 안전 수칙</h2>
        <ol className="edu-rules">
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </section>
    </div>
  )
}
