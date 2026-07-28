import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { checkDailyBudget, budgetNotice } from '../../_lib/budget.js'
import { callClaudeTool, ensureContract, hasApiKey, COMPLIANCE_RULES } from '../../_lib/claude.js'
import { checkTexts } from '../../_lib/adcheck.js'
import { logCall } from '../../_lib/telemetry.js'
import { verifyTurnstile } from '../../_lib/turnstile.js'
import { sanitizeBrand, brandPrompt } from '../../_lib/brand.js'
import { DATA_GUARD, userDataJson, detectInjection, injectionNotice } from '../../_lib/promptSafety.js'
import { failureCode } from '../../_lib/claude.js'
import { normalizeListing } from '../../_lib/shape.js'
import { checkClaims } from '../../../src/lib/factCheck.js'

function adCheckListing(result, brand) {
  return checkTexts(
    [...(result.titles || []), ...(result.search_keywords || []), ...(result.tags || [])],
    brand
  )
}

const TOOL = {
  name: 'record_listing_optimization',
  description: '오픈마켓 상품등록에 쓸 검색최적화 상품명·태그·카테고리 추천을 기록한다.',
  input_schema: {
    type: 'object',
    required: ['titles', 'search_keywords', 'tags', 'category_paths', 'compliance_notes'],
    properties: {
      titles: {
        type: 'array',
        description: '검색최적화 상품명 후보 4~5개. [브랜드/수식어] + 핵심키워드 + 규격 구조, 50자 이내',
        items: { type: 'string' },
      },
      search_keywords: {
        type: 'array',
        description: '구매 의도가 있는 검색 키워드 8~12개 (대표키워드+세부키워드 혼합)',
        items: { type: 'string' },
      },
      tags: { type: 'array', description: '오픈마켓 등록용 태그 10개 내외', items: { type: 'string' } },
      category_paths: {
        type: 'array',
        description: '추천 카테고리 경로 2~3개 (예: 식품 > 건강식품 > 유산균)',
        items: { type: 'string' },
      },
      compliance_notes: {
        type: 'array',
        description: '이 상품을 등록·광고할 때 주의할 표시광고 유의사항 2~4개',
        items: { type: 'string' },
      },
    },
  },
}

const SYSTEM = `당신은 오픈마켓(네이버 스마트스토어, 쿠팡 등) 상품등록 최적화 전문가입니다. 제품 정보를 받아 검색 노출과 클릭에 유리한 상품명·키워드·태그·카테고리를 제안합니다.

규칙:
1. 상품명은 [브랜드/수식어] + 핵심키워드 + 속성/규격 구조로, 특수문자 남용 없이 50자 이내로 작성하세요.
2. 키워드는 검색량이 있을 법한 실제 구매 검색어 위주로, 대표키워드와 세부(롱테일)키워드를 섞으세요.
3. 제품 정보에 없는 속성을 지어내지 마세요.
${COMPLIANCE_RULES}${DATA_GUARD}`

function demoResult() {
  return {
    demo: true,
    titles: [
      '데일리 장편한 유산균 19종 프로바이오틱스 스틱 100억 CFU 30포',
      '장편한 데일리 유산균 스틱 30포 물없이 먹는 프로바이오틱스',
      '직장인 휴대용 유산균 19종 혼합 프로바이오틱스 아연 30포 1개월분',
      '데일리 유산균 100억 보장균수 스틱분말 30포 프로바이오틱스',
    ],
    search_keywords: [
      '유산균', '프로바이오틱스', '유산균 스틱', '물없이 먹는 유산균', '직장인 유산균',
      '휴대용 유산균', '유산균 30포', '아연 유산균', '보장균수 100억', '스틱 유산균 추천',
    ],
    tags: ['유산균', '프로바이오틱스', '스틱형', '휴대용', '분말유산균', '19종유산균', '아연', '1개월분', '직장인건강', '간편섭취'],
    category_paths: [
      '식품 > 건강식품 > 유산균/프로바이오틱스',
      '출산/육아 > 건강식품 > 유산균 (타깃 확장 시)',
      '식품 > 건강식품 > 영양제 > 아연',
    ],
    compliance_notes: [
      '"장 트러블 치료", "변비 예방" 등 질병 예방·치료 표현은 상품명·상세·리뷰 이벤트 문구 모두에서 금지됩니다.',
      '기능성 문구는 고시된 범위("유산균 증식 및 유해균 억제에 도움을 줄 수 있음") 그대로만 사용하세요.',
      '"최고", "1위" 등 최상급 표현은 객관적 근거 자료 없이는 사용할 수 없습니다.',
      '건강기능식품은 상품페이지에 표시광고 사전심의 결과(심의필)를 함께 게시해야 합니다.',
    ],
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
  }

  // 브랜드 룰북(사용자 브라우저에 저장된 회사 규정) — 없으면 null
  const brand = sanitizeBrand(body.brand)
  const injected = injectionNotice(detectInjection([input.name, input.features]))

  const startedAt = Date.now()

  // 보안 검증 실패도 하드 차단하지 않는다 — 예시 결과로 강등하고 사유를 기록한다
  const guard = await verifyTurnstile(env, request)
  if (!guard.ok) {
    logCall(context, { endpoint: 'listing', mode: 'unverified', startedAt })
    const demo = demoResult(input)
    return json({ ...demo, ad_check: adCheckListing(demo, brand), brand_applied: Boolean(brand), notice: `보안 검증을 완료하지 못해 예시 결과를 표시합니다. (사유: ${guard.codes})` })
  }

  if (!hasApiKey(env)) {
    const demo = demoResult(input)
    logCall(context, { endpoint: 'listing', mode: 'demo', startedAt })
    return json({ ...demo, ad_check: adCheckListing(demo, brand), brand_applied: Boolean(brand) })
  }

  // 일일 예산(USD) 상한 — 회수가 아니라 실제 지출로 막는다
  const budget = await checkDailyBudget(env)
  if (!budget.ok) {
    const demo = demoResult(input)
    return json({ ...demo, ad_check: adCheckListing(demo, brand), brand_applied: Boolean(brand), notice: budgetNotice(budget) })
  }

  const ip = clientIp(request)
  if (!(await checkRateLimit(env, `ax:listing:${ip}`, 10, 3600)))
    return errorJson('요청이 너무 잦습니다. 1시간 후 다시 시도해주세요.', 429)
  if (!(await checkRateLimit(env, 'ax:listing:all', 80, 3600, { failOpen: false })))
    return errorJson('사용량이 많아 잠시 후 다시 시도해주세요.', 429)

  try {
    const { input: result, usage } = await callClaudeTool(env, {
      system: SYSTEM + brandPrompt(brand),
      // 제품 정보는 데이터 블록으로 격리한다 (입력 속 지시문을 따르지 않도록)
      user: `[제품 정보]\n${userDataJson('제품 정보', input)}`,
      tool: TOOL,
      maxTokens: 4096,
      timeoutMs: 60000,
    })
    ensureContract(result, {
      arrays: ['titles', 'search_keywords', 'tags', 'category_paths', 'compliance_notes'],
    })
    const shaped = normalizeListing(result)
    const adCheck = adCheckListing(shaped, brand)
    const factCheck = checkClaims([...shaped.titles, ...shaped.search_keywords], [input.name, input.category, input.features])
    logCall(context, { endpoint: 'listing', mode: 'live', startedAt, usage, findingsCount: adCheck.length })
    return json({ demo: false, usage, ad_check: adCheck, fact_check: factCheck, brand_applied: Boolean(brand), input_warning: injected, ...shaped })
  } catch (err) {
    const demo = demoResult(input)
    logCall(context, { endpoint: 'listing', mode: 'fallback', startedAt, reason: failureCode(err) })
    return json({ ...demo, ad_check: adCheckListing(demo, brand), brand_applied: Boolean(brand), notice: `일시적인 AI 혼잡으로 예시 결과를 표시합니다. (${err.message})` })
  }
}
