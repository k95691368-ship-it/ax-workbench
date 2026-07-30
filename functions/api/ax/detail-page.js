import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimit, RATE_NOTICE } from '../../_lib/rateLimit.js'
import { checkDailyBudget, budgetNotice } from '../../_lib/budget.js'
import { hasApiKey, COMPLIANCE_RULES } from '../../_lib/claude.js'
import { checkTexts } from '../../_lib/adcheck.js'
import { logCall } from '../../_lib/telemetry.js'
import { verifyTurnstile } from '../../_lib/turnstile.js'
import { sanitizeBrand, brandPrompt, missingRequired } from '../../_lib/brand.js'
import { DATA_GUARD, userDataBlock, userDataJson, detectInjection, injectionNotice } from '../../_lib/promptSafety.js'
import { failureCode } from '../../_lib/claude.js'
import { normalizeDetail } from '../../_lib/shape.js'
import { generateDetail, reviseDetail, SECTION_BLUEPRINT } from '../../_lib/detailPipeline.js'
import { checkClaims } from '../../../src/lib/factCheck.js'

function detailTexts(result) {
  return [
    result.headline,
    result.subheadline,
    ...(result.sections || []).flatMap((s) => [s.title, s.body, ...(s.bullets || [])]),
    ...(result.faq || []).flatMap((f) => [f.q, f.a]),
  ]
}

function adCheckDetail(result, brand) {
  return checkTexts(detailTexts(result), brand)
}

// 브랜드 룰북 적용 결과 — 필수 문구가 실제로 들어갔는지까지 확인해 함께 돌려준다
function brandMeta(result, brand) {
  if (!brand) return { brand_applied: false }
  return { brand_applied: true, brand_missing: missingRequired(detailTexts(result), brand) }
}

const SYSTEM = `당신은 온라인 유통사의 이커머스 상세페이지 기획 전문가입니다. 제품 정보를 받아 구매 전환에 최적화된 상세페이지 섹션 구조와 카피를 작성합니다.

규칙:
1. 주어진 제품 정보에 있는 사실만 사용하고, 성분·수치·인증을 지어내지 마세요.
2. 각 섹션의 image_brief는 디자이너가 바로 작업할 수 있게 구체적으로 쓰세요.
3. 타깃 고객의 언어로 쓰되, 과장 없이 신뢰감 있게 쓰세요.
${COMPLIANCE_RULES}${DATA_GUARD}`

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

  // 피드백 반영 모드: 이전 결과와 사용자 피드백을 함께 받아 개선판을 만든다
  let feedback = ''
  let previous = null
  if (body.revision && typeof body.revision === 'object') {
    if (typeof body.revision.feedback !== 'string' || !body.revision.feedback.trim())
      return errorJson('피드백 내용을 입력해주세요.')
    feedback = body.revision.feedback.trim().slice(0, 300)
    const p = body.revision.previous
    if (p && typeof p === 'object' && Array.isArray(p.sections) && p.sections.length > 0) {
      previous = {
        headline: String(p.headline || '').slice(0, 200),
        subheadline: String(p.subheadline || '').slice(0, 300),
        sections: p.sections.slice(0, 8).map((s) => ({
          title: String(s?.title || '').slice(0, 100),
          body: String(s?.body || '').slice(0, 600),
          bullets: Array.isArray(s?.bullets) ? s.bullets.slice(0, 6).map((b) => String(b).slice(0, 120)) : [],
          image_brief: String(s?.image_brief || '').slice(0, 200),
        })),
        faq: Array.isArray(p.faq)
          ? p.faq.slice(0, 5).map((f) => ({ q: String(f?.q || '').slice(0, 150), a: String(f?.a || '').slice(0, 300) }))
          : [],
        // 키워드도 받아둔다 — 프레임 재작성이 실패했을 때 되돌릴 값이 없으면
        // "고치려다 잃지 않는다"는 재생성의 전제가 이 항목에서만 깨진다.
        keywords: Array.isArray(p.keywords) ? p.keywords.slice(0, 12).map((k) => String(k).slice(0, 40)) : [],
        designer_notes: String(p.designer_notes || '').slice(0, 500),
      }
    }
    if (!previous) return errorJson('이전 결과가 없어 피드백을 반영할 수 없습니다. 먼저 생성해주세요.')
  }

  // 브랜드 룰북(사용자 브라우저에 저장된 회사 규정) — 없으면 null
  const brand = sanitizeBrand(body.brand)

  // 프롬프트 주입 의심 표현 — 요청을 막지 않고 데이터 격리로 무력화한 뒤 사람에게 알린다
  const injected = injectionNotice(detectInjection([input.name, input.features, input.target, input.tone, feedback]))

  const startedAt = Date.now()

  // 보안 검증 실패도 하드 차단하지 않는다 — 예시 결과로 강등하고 사유를 기록한다
  const guard = await verifyTurnstile(env, request)
  if (!guard.ok) {
    logCall(context, { endpoint: 'detail-page', mode: 'unverified', startedAt })
    const demo = demoResult(input)
    return json({ ...demo, ad_check: adCheckDetail(demo, brand), ...brandMeta(demo, brand), notice: `보안 검증을 완료하지 못해 예시 결과를 표시합니다. (사유: ${guard.codes})` })
  }

  if (!hasApiKey(env)) {
    const demo = demoResult(input)
    logCall(context, { endpoint: 'detail-page', mode: 'demo', startedAt })
    return json({ ...demo, ad_check: adCheckDetail(demo, brand), ...brandMeta(demo, brand) })
  }

  // 전역 일일 예산 캡 — 소진 시 서비스를 끊는 대신 예시 결과로 우아하게 강등
  // 일일 예산(USD) 상한 — 회수가 아니라 실제 지출로 막는다
  // 이번 요청이 만들 호출 수를 함께 넘긴다 — 한 요청이 여러 호출을 하므로,
  // 이미 쓴 금액만 보면 그 요청분만큼 상한을 넘겨 버린다.
  const plannedCalls = 1 + (previous ? previous.sections.length : SECTION_BLUEPRINT.length)
  const budget = await checkDailyBudget(env, undefined, { calls: plannedCalls })
  if (!budget.ok) {
    const demo = demoResult(input)
    return json({ ...demo, ad_check: adCheckDetail(demo, brand), ...brandMeta(demo, brand), notice: budgetNotice(budget) })
  }

  // 한도에 걸려도 화면을 막다른 길로 만들지 않는다 — AI 호출만 막고 예시 결과로 강등한다
  const limited = async (bucket, max, opts) => !(await checkRateLimit(env, bucket, max, 3600, opts))
  const ip = clientIp(request)
  const rateNotice = (await limited(`ax:detail:${ip}`, 8))
    ? RATE_NOTICE.ip
    : (await limited('ax:detail:all', 60, { failOpen: false }))
      ? RATE_NOTICE.all
      : null
  if (rateNotice) {
    const demo = demoResult(input)
    logCall(context, { endpoint: 'detail-page', mode: 'demo', startedAt, reason: 'rate_limit' })
    return json({ ...demo, ad_check: adCheckDetail(demo, brand), ...brandMeta(demo, brand), notice: rateNotice })
  }

  // 필수 표기 문구는 마지막 섹션에서 한 번만 넣는다 (호출마다 요구하면 페이지에 반복된다)
  const system = SYSTEM + brandPrompt(brand, { required: false })
  const systemWithRequired = SYSTEM + brandPrompt(brand)

  try {
    // 피드백 반영은 이전 결과 전체를 놓고 고치는 작업이라 한 번에 봐야 한다 — 기존 단일 호출을 쓴다.
    // 최초 생성은 2단계 파이프라인(개요 → 섹션 병렬)으로 만든다: 실측 37초의 원인이 구조였다.
    let result
    let usage
    let degraded = null
    let timing = null

    const built = previous
      ? await reviseDetail(env, {
          system,
          systemWithRequired,
          productBlock: userDataJson('제품 정보', input),
          previous,
          feedback: userDataBlock('사용자 피드백', feedback),
        })
      : await generateDetail(env, {
          system,
          systemWithRequired,
          productBlock: userDataJson('제품 정보', input),
        })
    result = built.result
    usage = built.usage
    degraded = built.degraded
    timing = built.timing

    // 중첩 항목까지 모양을 맞춘다 — 최상위 키만 보면 sections[].body 누락을 놓친다
    const shaped = normalizeDetail(result)
    const adCheck = adCheckDetail(shaped, brand)
    const factCheck = checkClaims(detailTexts(shaped), [input.name, input.category, input.features, input.target])
    logCall(context, { endpoint: 'detail-page', mode: 'live', startedAt, usage, findingsCount: adCheck.length + factCheck.length })
    return json({ demo: false, usage, timing, ad_check: adCheck, fact_check: factCheck, input_warning: injected, notice: degraded, ...brandMeta(shaped, brand), ...shaped })
  } catch (err) {
    // 외부 AI 장애/지연 시에도 빈 에러 화면 대신 예시 결과로 응답한다
    const demo = demoResult(input)
    logCall(context, { endpoint: 'detail-page', mode: 'fallback', startedAt, reason: failureCode(err) })
    return json({ ...demo, ad_check: adCheckDetail(demo, brand), ...brandMeta(demo, brand), notice: `일시적인 AI 혼잡으로 예시 결과를 표시합니다. (${err.message})` })
  }
}
