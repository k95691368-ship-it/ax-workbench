import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { callClaudeTool, ensureContract, hasApiKey, COMPLIANCE_RULES } from '../../_lib/claude.js'
import { checkTexts } from '../../_lib/adcheck.js'
import { logCall } from '../../_lib/telemetry.js'
import { verifyTurnstile } from '../../_lib/turnstile.js'

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
2. 답변은 정중한 한국어(합니다체), 3~5문장. 공감 → 안내/조치 → 마무리 인사 구조.
3. **에스컬레이션 원칙 (가장 중요)**: 건강 이상·부작용 호소, 알레르기 반응, 법적 조치 언급, 과도한 보상 요구, 분쟁 소지가 있는 리뷰는 escalate=true로 표시하고, 답변 초안은 "확인 후 개별 연락드리겠습니다" 수준의 보수적 문구만 작성하세요. 의학적 판단·보상 약속·책임 인정을 절대 하지 마세요.
4. 배송 지연은 사과 + 조회 안내, 품질 문의는 보관법/섭취법 안내, 환불/교환은 절차 안내로 답하세요.
${COMPLIANCE_RULES}`

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

function demoResult(reviews) {
  return {
    demo: true,
    results: reviews.map((rv) => {
      const hit = DEMO_MAP.find((d) => d.match.test(rv))
      if (hit) {
        const { match: _match, ...rest } = hit
        return { ...rest, escalate_reason: rest.escalate_reason || null }
      }
      return {
        category: '사용문의',
        escalate: false,
        escalate_reason: null,
        reply:
          '고객님, 문의 주셔서 감사합니다. 말씀하신 내용을 확인해 정확히 안내드리겠습니다. 제품 상세페이지의 표기사항도 함께 참고해 주시면 도움이 됩니다. 추가로 궁금한 점이 있으시면 언제든 문의해 주세요.',
      }
    }),
  }
}

function withAdCheck(results) {
  return results.map((r) => ({ ...r, ad_check: checkTexts([r.reply]) }))
}

export async function onRequestPost(context) {
  const { request, env } = context
  const body = await readJsonBody(request)
  const reviews = (Array.isArray(body?.reviews) ? body.reviews : [])
    .filter((r) => typeof r === 'string' && r.trim())
    .slice(0, MAX_REVIEWS)
    .map((r) => r.trim().slice(0, 500))
  if (reviews.length === 0) return errorJson('리뷰를 1개 이상 입력해주세요. (한 줄에 하나)')

  if (!(await verifyTurnstile(env, request)))
    return errorJson('보안 검증에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.', 403)

  const startedAt = Date.now()

  if (!hasApiKey(env)) {
    const demo = demoResult(reviews)
    logCall(context, { endpoint: 'reviews', mode: 'demo', startedAt })
    return json({ ...demo, results: withAdCheck(demo.results) })
  }

  if (!(await checkRateLimit(env, 'ax:daily:all', 300, 86400))) {
    const demo = demoResult(reviews)
    return json({ ...demo, results: withAdCheck(demo.results), notice: '오늘의 라이브 생성 예산이 소진되어 예시 결과를 표시합니다.' })
  }

  const ip = clientIp(request)
  if (!(await checkRateLimit(env, `ax:reviews:${ip}`, 6, 3600)))
    return errorJson('리뷰 일괄 처리는 시간당 6회까지 가능합니다. 잠시 후 다시 시도해주세요.', 429)
  if (!(await checkRateLimit(env, 'ax:reviews:all', 40, 3600)))
    return errorJson('데모 사용량이 많아 잠시 후 다시 시도해주세요.', 429)

  try {
    const { input: result, usage } = await callClaudeTool(env, {
      system: SYSTEM,
      user: `[고객 리뷰 (${reviews.length}건)]\n${reviews.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n모든 리뷰에 대해 순서대로 분류·답변·에스컬레이션 판단을 기록하세요.`,
      tool: TOOL,
      maxTokens: 8192,
    })
    ensureContract(result, { arrays: ['results'] })
    result.results = result.results
      .filter((r) => r && typeof r.reply === 'string')
      .slice(0, reviews.length)
    if (result.results.length === 0) throw new Error('AI 응답이 불완전합니다. 다시 시도해주세요.')
    const checked = withAdCheck(result.results)
    logCall(context, {
      endpoint: 'reviews',
      mode: 'live',
      startedAt,
      usage,
      findingsCount: checked.reduce((s, r) => s + r.ad_check.length, 0),
    })
    return json({ demo: false, usage, results: checked })
  } catch (err) {
    const demo = demoResult(reviews)
    logCall(context, { endpoint: 'reviews', mode: 'fallback', startedAt })
    return json({ ...demo, results: withAdCheck(demo.results), notice: `일시적인 AI 혼잡으로 예시 결과를 표시합니다. (${err.message})` })
  }
}
