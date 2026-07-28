import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { callClaudeTool, ensureContract, hasApiKey, COMPLIANCE_RULES, failureCode } from '../../_lib/claude.js'
import { checkTexts } from '../../_lib/adcheck.js'
import { logCall } from '../../_lib/telemetry.js'
import { verifyTurnstile } from '../../_lib/turnstile.js'
import { sanitizeBrand, brandPrompt, missingRequired } from '../../_lib/brand.js'
import { DATA_GUARD, userDataBlock, detectInjection, injectionNotice } from '../../_lib/promptSafety.js'
import { detectEscalation, SAFE_REPLY } from '../../../src/lib/escalation.js'

const MAX_REVIEWS = 8

const TOOL = {
  name: 'record_review_replies',
  description: '고객 리뷰들을 분류하고 답변 초안을 작성하며, 사람의 판단이 필요한 건을 표시한다.',
  input_schema: {
    type: 'object',
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        description: '입력된 리뷰 순서 그대로',
        items: {
          type: 'object',
          required: ['category', 'reply', 'escalate'],
          properties: {
            category: {
              type: 'string',
              enum: ['칭찬', '배송', '품질', '환불/교환', '사용문의', '기타'],
              description: '리뷰 유형',
            },
            reply: { type: 'string', description: '정중한 한국어 답변 초안 (3~5문장)' },
            escalate: {
              type: 'boolean',
              description: '사람 담당자의 판단이 필요한 건이면 true (건강 이상·부작용 호소, 법적 클레임, 보상 요구, 분쟁 소지)',
            },
            escalate_reason: { type: ['string', 'null'], description: 'escalate가 true인 이유 한 줄' },
          },
        },
      },
    },
  },
}

const SYSTEM = `당신은 온라인 유통사 CS팀의 리뷰 답변 어시스턴트입니다. 고객 리뷰를 분류하고 답변 초안을 만듭니다.

규칙:
1. 입력된 모든 리뷰에 대해 순서대로 결과를 만드세요.
1-1. category는 반드시 **가장 구체적인 것**을 고르세요. '기타'는 나머지 다섯 개 중 어디에도 해당하지 않을 때만 씁니다.
     예) 만족·재구매·맛 칭찬 → 칭찬 / 배송 지연·미도착 → 배송 / 제품 이상·이물·신체 불편 → 품질
         환불·교환·반품 요청 → 환불/교환 / 섭취법·보관법·표기 확인 → 사용문의
2. 답변은 정중한 한국어(합니다체), 3~5문장. 공감 → 안내/조치 → 마무리 인사 구조.
3. **에스컬레이션 원칙 (가장 중요)**: 건강 이상·부작용 호소, 알레르기 반응, 법적 조치 언급, 과도한 보상 요구, 분쟁 소지가 있는 리뷰는 escalate=true로 표시하고, 답변 초안은 "확인 후 개별 연락드리겠습니다" 수준의 보수적 문구만 작성하세요. 의학적 판단·보상 약속·책임 인정을 절대 하지 마세요.
4. 배송 지연은 사과 + 조회 안내, 품질 문의는 보관법/섭취법 안내, 환불/교환은 절차 안내로 답하세요.
${COMPLIANCE_RULES}${DATA_GUARD}`

const DEMO_MAP = [
  {
    match: /아프|아파|두드러기|부작용|알레르기|병원|응급|탈이 났/,
    category: '품질',
    escalate: true,
    escalate_reason: '건강 이상 호소 — 의학적 판단·보상이 얽힐 수 있어 담당자 확인 필요',
    reply:
      '고객님, 불편을 겪으셨다니 진심으로 죄송합니다. 말씀해주신 내용은 저희가 가볍게 답변드릴 사안이 아니라, 담당자가 자세히 확인한 뒤 개별적으로 연락드리겠습니다. 빠른 확인을 위해 주문번호를 남겨주시면 감사하겠습니다.',
  },
  {
    // 칭찬을 배송보다 먼저 검사 — "배송도 빨라요" 같은 긍정 리뷰의 오분류 방지
    match: /맛|좋|만족|최고|잘 먹|재구매/,
    category: '칭찬',
    escalate: false,
    reply:
      '고객님, 소중한 후기 감사합니다! 만족하셨다니 저희도 기쁩니다. 앞으로도 좋은 품질로 보답하겠습니다. 다음 구매 시에도 변함없는 만족을 드릴 수 있도록 노력하겠습니다.',
  },
  {
    match: /늦|배송|안 와|안와|도착/,
    category: '배송',
    escalate: false,
    reply:
      '고객님, 배송이 지연되어 불편을 드려 죄송합니다. 주문 내역을 확인해 현재 배송 상태를 조회해 드리겠습니다. 주문번호를 알려주시면 더 빠르게 확인이 가능합니다. 기다려주셔서 감사합니다.',
  },
  {
    match: /환불|교환|반품/,
    category: '환불/교환',
    escalate: false,
    reply:
      '고객님, 불편을 드려 죄송합니다. 환불·교환은 마이페이지 > 주문내역에서 신청하실 수 있으며, 신청 후 영업일 기준 2~3일 내 처리됩니다. 진행 중 어려움이 있으시면 언제든 문의해 주세요.',
  },
]

// 재작성 요청일 때는 예시 답변에서도 검출된 표현이 든 문장을 덜어낸다.
// (예시 결과라도 "다시 썼는데 그대로"인 화면을 보여주지 않기 위한 처리)
function stripSentences(reply, violations) {
  if (!violations?.length) return reply
  const kept = reply
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !violations.some((w) => sentence.includes(w)))
    .join(' ')
    .trim()
  return kept || '고객님, 문의 주신 내용은 담당자가 확인 후 개별적으로 안내드리겠습니다.'
}

function demoResult(reviews, fixes = []) {
  return {
    demo: true,
    results: reviews.map((rv, i) => {
      const violations = fixes[i]?.violations || []
      const hit = DEMO_MAP.find((d) => d.match.test(rv))
      if (hit) {
        const { match: _match, ...rest } = hit
        return {
          ...rest,
          reply: stripSentences(rest.reply, violations),
          escalate_reason: rest.escalate_reason || null,
        }
      }
      return {
        category: '사용문의',
        escalate: false,
        escalate_reason: null,
        reply: stripSentences(
          '고객님, 문의 주셔서 감사합니다. 말씀하신 내용을 확인해 정확히 안내드리겠습니다. 제품 상세페이지의 표기사항도 함께 참고해 주시면 도움이 됩니다. 추가로 궁금한 점이 있으시면 언제든 문의해 주세요.',
          violations
        ),
      }
    }),
  }
}

const CATEGORIES = ['칭찬', '배송', '품질', '환불/교환', '사용문의', '기타']

// AI 응답에서 판단 값이 빠질 수 있다(tool 강제 호출도 필드 누락까지 막아주지는 않는다).
// 이때 "에스컬레이션 아님"으로 넘겨 버리면 건강 이상 호소 같은 건이 자동 응대로 나갈 수 있으므로,
// 판단 값이 없으면 **사람 확인 쪽으로 안전하게 기울인다**(fail-safe).
export function normalizeReplies(results) {
  return results.map((r) => {
    const decided = typeof r.escalate === 'boolean'
    return {
      ...r,
      category: CATEGORIES.includes(r.category) ? r.category : '기타',
      escalate: decided ? r.escalate : true,
      escalate_reason: decided
        ? r.escalate_reason || null
        : 'AI가 판단 값을 남기지 않아 안전하게 담당자 확인으로 분류했습니다.',
    }
  })
}

// 규칙이 AI 판단을 덮어쓴다 — 안전한 쪽(사람 확인)으로만 기운다.
export function applyEscalationRules(results, reviews) {
  return results.map((r, i) => {
    const rule = detectEscalation(reviews[i])
    if (!rule.escalate) return { ...r, escalation_source: r.escalate ? 'ai' : null }
    if (r.escalate) {
      // AI도 이미 올렸다면 답변은 그대로 두고 사유만 보강한다
      return { ...r, escalate_reason: r.escalate_reason || rule.reason, escalation_source: 'ai' }
    }
    // AI가 놓쳤다 — 규칙이 강제로 올리고, 답변도 보수적 문구로 교체한다.
    // (AI 답변에 보상 약속이나 의학적 판단이 섞여 있을 수 있으므로 그대로 내보내지 않는다)
    return {
      ...r,
      escalate: true,
      escalate_reason: rule.reason,
      escalation_source: 'rule',
      escalation_matched: rule.matched,
      reply: SAFE_REPLY,
    }
  })
}

function withAdCheck(results, brand) {
  return results.map((r) => ({ ...r, ad_check: checkTexts([r.reply], brand) }))
}

// 답변별 룰북 준수 점검.
// 에스컬레이션 건은 "확인 후 개별 연락드리겠습니다" 수준의 보수적 문구만 쓰도록 설계했으므로
// 필수 문구(안내·홍보성 문구) 검증에서 의도적으로 제외한다.
function withBrandCheck(results, brand) {
  if (!brand) return { results, meta: { brand_applied: false } }
  const all = new Set()
  const checked = results.map((r) => {
    if (r.escalate) return r
    const missing = missingRequired([r.reply], brand)
    missing.forEach((m) => all.add(m))
    return missing.length ? { ...r, brand_missing: missing } : r
  })
  return { results: checked, meta: { brand_applied: true, brand_missing: [...all] } }
}

// 응답 조립 — 규칙 기반 에스컬레이션 → 표시광고 점검 → 룰북 점검 순서로 얹는다.
// 순서가 중요하다: 답변이 교체될 수 있으므로 점검은 항상 "최종 답변" 기준으로 돌아야 한다.
function withChecks(results, reviews, brand) {
  const forced = applyEscalationRules(results, reviews)
  const { results: checked, meta } = withBrandCheck(withAdCheck(forced, brand), brand)
  return { results: checked, ...meta }
}

// 최초 작성과 재작성(위반 답변만 다시)에 같은 도구를 쓰되, 지시문만 달라진다
function buildUserContent(reviews, fixes) {
  const list = reviews.map((r, i) => `${i + 1}. ${r}`).join('\n')
  // 리뷰 본문은 데이터 블록으로 격리한다 — 안에 지시문이 있어도 따르지 않도록
  const base = `[고객 리뷰 (${reviews.length}건)]\n${userDataBlock('고객 리뷰 원문', list)}\n\n각 리뷰에 대해 순서대로 분류·답변·에스컬레이션 판단을 기록하세요.`
  const retry = fixes.filter((f) => f.violations.length > 0)
  if (retry.length === 0) return base
  const detail = fixes
    .map((f, i) =>
      f.violations.length
        ? `${i + 1}번 답변 — 검출된 표현: ${f.violations.join(', ')}\n   이전 답변: ${f.previous}`
        : null
    )
    .filter(Boolean)
    .join('\n')
  return `${base}

[재작성 지시 — 중요]
이 요청은 이전 답변에서 규정 위반이 검출되어 다시 쓰는 것입니다.
${detail}
- 검출된 표현과 그 동의어·변형을 절대 쓰지 말고, 같은 뜻을 다른 방식으로 표현하세요.
- 이전 답변을 그대로 되풀이하지 말고 문장을 새로 구성하세요.
- 필수 문구가 누락으로 지적됐다면 표기를 바꾸지 말고 그대로 넣으세요.
- 에스컬레이션 판단 기준은 그대로 유지하세요.`
}

export async function onRequestPost(context) {
  const { request, env } = context
  const body = await readJsonBody(request)
  const reviews = (Array.isArray(body?.reviews) ? body.reviews : [])
    .filter((r) => typeof r === 'string' && r.trim())
    .slice(0, MAX_REVIEWS)
    .map((r) => r.trim().slice(0, 500))
  if (reviews.length === 0) return errorJson('리뷰를 1개 이상 입력해주세요. (한 줄에 하나)')

  // 재작성 모드: 이전 답변과 검출된 표현을 리뷰 순서에 맞춰 받는다 (없으면 최초 작성)
  const fixes = (Array.isArray(body?.fix) ? body.fix : []).slice(0, MAX_REVIEWS).map((f) => ({
    previous: String(f?.previous || '').slice(0, 600),
    violations: Array.isArray(f?.violations)
      ? f.violations.filter((v) => typeof v === 'string' && v.trim()).slice(0, 10).map((v) => v.trim().slice(0, 40))
      : [],
  }))

  // 브랜드 룰북(사용자 브라우저에 저장된 회사 규정) — 답변 말투·금지어에 적용된다
  const brand = sanitizeBrand(body?.brand)

  // 프롬프트 주입 의심 표현 — 요청을 막지는 않고(데이터 격리로 무력화) 사람에게 알린다
  const injected = injectionNotice(detectInjection(reviews))

  const startedAt = Date.now()

  // 보안 검증 실패도 하드 차단하지 않는다 — 예시 결과로 강등하고 사유를 기록한다
  const guard = await verifyTurnstile(env, request)
  if (!guard.ok) {
    logCall(context, { endpoint: 'reviews', mode: 'unverified', startedAt })
    const demo = demoResult(reviews, fixes)
    return json({ ...demo, input_warning: injected, ...withChecks(demo.results, reviews, brand), notice: `보안 검증을 완료하지 못해 예시 결과를 표시합니다. (사유: ${guard.codes})` })
  }

  if (!hasApiKey(env)) {
    const demo = demoResult(reviews, fixes)
    logCall(context, { endpoint: 'reviews', mode: 'demo', startedAt })
    return json({ ...demo, input_warning: injected, ...withChecks(demo.results, reviews, brand) })
  }

  if (!(await checkRateLimit(env, 'ax:daily:all', 300, 86400))) {
    const demo = demoResult(reviews, fixes)
    return json({ ...demo, input_warning: injected, ...withChecks(demo.results, reviews, brand), notice: '오늘의 라이브 생성 예산이 소진되어 예시 결과를 표시합니다.' })
  }

  const ip = clientIp(request)
  if (!(await checkRateLimit(env, `ax:reviews:${ip}`, 6, 3600)))
    return errorJson('리뷰 일괄 처리는 시간당 6회까지 가능합니다. 잠시 후 다시 시도해주세요.', 429)
  if (!(await checkRateLimit(env, 'ax:reviews:all', 40, 3600)))
    return errorJson('사용량이 많아 잠시 후 다시 시도해주세요.', 429)

  try {
    const { input: result, usage } = await callClaudeTool(env, {
      system: SYSTEM + brandPrompt(brand),
      user: buildUserContent(reviews, fixes),
      tool: TOOL,
      maxTokens: 8192,
      timeoutMs: 70000,
    })
    ensureContract(result, { arrays: ['results'] })
    result.results = normalizeReplies(
      result.results.filter((r) => r && typeof r.reply === 'string').slice(0, reviews.length)
    )
    if (result.results.length === 0) throw new Error('AI 응답이 불완전합니다. 다시 시도해주세요.')
    const checked = withChecks(result.results, reviews, brand)
    logCall(context, {
      endpoint: 'reviews',
      mode: 'live',
      startedAt,
      usage,
      findingsCount: checked.results.reduce((s, r) => s + r.ad_check.length, 0),
    })
    return json({ demo: false, usage, input_warning: injected, ...checked })
  } catch (err) {
    const demo = demoResult(reviews, fixes)
    logCall(context, { endpoint: 'reviews', mode: 'fallback', startedAt, reason: failureCode(err) })
    return json({ ...demo, input_warning: injected, ...withChecks(demo.results, reviews, brand), notice: `일시적인 AI 혼잡으로 예시 결과를 표시합니다. (${err.message})` })
  }
}
