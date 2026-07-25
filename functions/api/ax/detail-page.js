import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { callClaudeTool, ensureContract, hasApiKey, COMPLIANCE_RULES } from '../../_lib/claude.js'
import { checkTexts } from '../../_lib/adcheck.js'
import { logCall } from '../../_lib/telemetry.js'

function adCheckDetail(result) {
  return checkTexts([
    result.headline,
    result.subheadline,
    ...(result.sections || []).flatMap((s) => [s.title, s.body, ...(s.bullets || [])]),
    ...(result.faq || []).flatMap((f) => [f.q, f.a]),
  ])
}

const TOOL = {
  name: 'record_detail_page',
  description: '이커머스 상품 상세페이지의 섹션 구조와 카피를 작성해 기록한다.',
  input_schema: {
    type: 'object',
    required: ['headline', 'subheadline', 'sections', 'faq', 'keywords', 'designer_notes'],
    properties: {
      headline: { type: 'string', description: '상세페이지 최상단 후킹 헤드라인 (한 줄)' },
      subheadline: { type: 'string', description: '헤드라인을 보조하는 한 줄' },
      sections: {
        type: 'array',
        description: '상세페이지 본문 섹션 4~6개. 문제 공감 → 해결(제품) → 특징 → 신뢰 요소 → 구매 안내 순서 권장',
        items: {
          type: 'object',
          required: ['title', 'body', 'image_brief'],
          properties: {
            title: { type: 'string', description: '섹션 제목' },
            body: { type: 'string', description: '섹션 본문 카피 (2~4문장)' },
            bullets: { type: 'array', items: { type: 'string' }, description: '요점 불릿 (선택)' },
            image_brief: { type: 'string', description: '디자이너에게 전달할 이 섹션의 이미지 연출 지시 (한 줄)' },
          },
        },
      },
      faq: {
        type: 'array',
        description: '자주 묻는 질문 2~3개',
        items: {
          type: 'object',
          required: ['q', 'a'],
          properties: { q: { type: 'string' }, a: { type: 'string' } },
        },
      },
      keywords: { type: 'array', items: { type: 'string' }, description: '검색 노출용 핵심 키워드 5~8개' },
      designer_notes: { type: 'string', description: '디자이너 인계 메모: 전체 톤앤매너, 컬러, 강조 포인트' },
    },
  },
}

const SYSTEM = `당신은 온라인 유통사의 이커머스 상세페이지 기획 전문가입니다. 제품 정보를 받아 구매 전환에 최적화된 상세페이지 섹션 구조와 카피를 작성합니다.

규칙:
1. 주어진 제품 정보에 있는 사실만 사용하고, 성분·수치·인증을 지어내지 마세요.
2. 각 섹션의 image_brief는 디자이너가 바로 작업할 수 있게 구체적으로 쓰세요.
3. 타깃 고객의 언어로 쓰되, 과장 없이 신뢰감 있게 쓰세요.
${COMPLIANCE_RULES}`

function demoResult(input) {
  const name = input.name || '데일리 장편한 유산균 30포'
  return {
    demo: true,
    headline: `하루 한 포, 출근길이 가벼워지는 습관 — ${name}`,
    subheadline: '바쁜 아침에도 물 없이 톡, 스틱 하나로 챙기는 유산균 루틴',
    sections: [
      {
        title: '이런 아침, 익숙하지 않으세요?',
        body: '알람 세 번에 겨우 일어나 아침은 거르고, 점심은 급하게. 속이 편할 틈이 없는 하루가 반복됩니다. 챙겨야지 생각만 하던 유산균, 오늘부터는 가방에 넣어두세요.',
        bullets: ['아침을 자주 거르는 직장인', '외식·배달이 잦은 식습관', '유산균을 사놓고 잊어버리는 분'],
        image_brief: '출근길 지하철에서 스틱 제품을 꺼내는 20~30대 직장인 손 클로즈업, 밝은 아침 톤',
      },
      {
        title: '19종 유산균, 100억 CFU 보장',
        body: '19종 혼합 유산균을 제조 시점이 아닌 유통기한까지 보장균수 100억 CFU 기준으로 담았습니다. 유산균 증식 및 유해균 억제에 도움을 줄 수 있습니다.',
        bullets: ['19종 혼합 유산균', '보장균수 100억 CFU', '아연 함유 — 정상적인 면역기능에 필요'],
        image_brief: '균주 19종을 그리드 인포그래픽으로, 100억 CFU 숫자를 크게 강조',
      },
      {
        title: '물 없이, 어디서든 스틱 한 포',
        body: '개별 스틱 분말이라 물 없이 간편하게 섭취할 수 있습니다. 사무실 서랍, 가방, 차 안 어디에 두어도 하루 한 포면 충분합니다.',
        image_brief: '스틱을 뜯어 입에 털어 넣는 연출 컷 + 가방/서랍/차량 3분할 배치 컷',
      },
      {
        title: '깐깐하게 확인하고 선택하세요',
        body: '원료명과 함량, 섭취 시 주의사항을 상세페이지 하단 표기사항에서 모두 확인할 수 있습니다. 특정 원료에 알레르기가 있다면 성분표를 먼저 확인해 주세요.',
        image_brief: '제품 뒷면 표기사항 실사 + 돋보기 그래픽으로 신뢰감 연출',
      },
      {
        title: '오늘 주문하면 내일 만나요',
        body: '평일 오후 2시 이전 주문 시 당일 출고됩니다. 첫 구매라면 30포로 한 달, 부담 없이 시작해 보세요.',
        image_brief: '택배 박스와 제품 패키지, 배송 아이콘 중심의 클로징 배너',
      },
    ],
    faq: [
      { q: '언제 먹는 게 좋나요?', a: '섭취 시간에 정해진 기준은 없습니다. 잊지 않고 매일 챙길 수 있는 시간에 하루 1포를 섭취하세요.' },
      { q: '아이도 먹을 수 있나요?', a: '제품 표기사항의 섭취 대상·주의사항을 확인해 주세요. 특이 체질이라면 전문가와 상담 후 섭취를 권장합니다.' },
      { q: '냉장 보관해야 하나요?', a: '직사광선을 피해 서늘한 곳에 보관하면 됩니다. 자세한 내용은 패키지 보관방법 표기를 따라 주세요.' },
    ],
    keywords: ['유산균', '프로바이오틱스', '유산균 스틱', '직장인 유산균', '하루 한 포 유산균', '휴대용 유산균', '아연 유산균'],
    designer_notes:
      '전체 톤: 아이보리 배경 + 포인트 컬러 딥그린. 1번 섹션은 공감형 사진, 2번 섹션은 인포그래픽 중심. 기능성 문구는 고시형 문구 그대로 사용하고 임의 수정 금지. 100억 CFU 숫자 타이포를 키 비주얼로.',
  }
}

export async function onRequestPost(context) {
  const { request, env } = context
  const body = await readJsonBody(request)
  if (!body || typeof body.name !== 'string' || !body.name.trim())
    return errorJson('제품명을 입력해주세요.')

  const input = {
    name: String(body.name).slice(0, 100),
    category: String(body.category || '').slice(0, 100),
    features: String(body.features || '').slice(0, 500),
    target: String(body.target || '').slice(0, 200),
    tone: String(body.tone || '').slice(0, 100),
  }

  const startedAt = Date.now()

  if (!hasApiKey(env)) {
    const demo = demoResult(input)
    logCall(context, { endpoint: 'detail-page', mode: 'demo', startedAt })
    return json({ ...demo, ad_check: adCheckDetail(demo) })
  }

  // 전역 일일 예산 캡 — 소진 시 서비스를 끊는 대신 예시 결과로 우아하게 강등
  if (!(await checkRateLimit(env, 'ax:daily:all', 300, 86400))) {
    const demo = demoResult(input)
    return json({ ...demo, ad_check: adCheckDetail(demo), notice: '오늘의 라이브 생성 예산이 소진되어 예시 결과를 표시합니다.' })
  }

  const ip = clientIp(request)
  if (!(await checkRateLimit(env, `ax:detail:${ip}`, 8, 3600)))
    return errorJson('요청이 너무 잦습니다. 1시간 후 다시 시도해주세요.', 429)
  if (!(await checkRateLimit(env, 'ax:detail:all', 60, 3600)))
    return errorJson('데모 사용량이 많아 잠시 후 다시 시도해주세요.', 429)

  try {
    const { input: result, usage } = await callClaudeTool(env, {
      system: SYSTEM,
      user: `[제품 정보]\n${JSON.stringify(input, null, 2)}`,
      tool: TOOL,
      maxTokens: 4096,
    })
    ensureContract(result, {
      arrays: ['sections', 'faq', 'keywords'],
      strings: ['headline', 'subheadline', 'designer_notes'],
    })
    const adCheck = adCheckDetail(result)
    logCall(context, { endpoint: 'detail-page', mode: 'live', startedAt, usage, findingsCount: adCheck.length })
    return json({ demo: false, usage, ad_check: adCheck, ...result })
  } catch (err) {
    // 외부 AI 장애/지연 시에도 빈 에러 화면 대신 예시 결과로 응답한다
    const demo = demoResult(input)
    logCall(context, { endpoint: 'detail-page', mode: 'fallback', startedAt })
    return json({ ...demo, ad_check: adCheckDetail(demo), notice: `일시적인 AI 혼잡으로 예시 결과를 표시합니다. (${err.message})` })
  }
}
