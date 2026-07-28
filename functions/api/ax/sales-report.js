import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { callClaudeTool, ensureContract, hasApiKey, failureCode } from '../../_lib/claude.js'
import { logCall } from '../../_lib/telemetry.js'
import { verifyTurnstile } from '../../_lib/turnstile.js'
import { DATA_GUARD, userDataJson, detectInjection, injectionNotice } from '../../_lib/promptSafety.js'

const TOOL = {
  name: 'record_sales_report',
  description: '판매 데이터 집계 요약을 바탕으로 주간 매출 리포트를 작성해 기록한다.',
  input_schema: {
    type: 'object',
    required: ['headline', 'summary', 'insights', 'actions', 'risks'],
    properties: {
      headline: { type: 'string', description: '리포트 한 줄 헤드라인 (핵심 수치 포함)' },
      summary: { type: 'string', description: '전체 요약 2~3문장' },
      insights: {
        type: 'array',
        description: '데이터에서 읽어낸 인사이트 3~5개 (수치 근거 포함)',
        items: { type: 'string' },
      },
      actions: {
        type: 'array',
        description: '영업지원팀이 이번 주에 실행할 액션 제안 2~4개 (발주, 채널, 프로모션 등)',
        items: { type: 'string' },
      },
      risks: { type: 'array', description: '주의할 리스크·이상 신호 1~3개', items: { type: 'string' } },
    },
  },
}

const SYSTEM = `당신은 온라인 유통사 영업지원팀의 데이터 분석가입니다. 판매 데이터 집계를 받아 실무자가 바로 쓰는 주간 리포트를 작성합니다.

규칙:
1. 제공된 집계 수치만 근거로 사용하고, 수치를 지어내지 마세요.
2. 인사이트는 "무엇이 → 왜 중요한가" 구조로, 액션은 담당자가 오늘 실행할 수 있는 수준으로 구체적으로 쓰세요.
3. 금액은 천 단위 구분(예: 1,234,000원)으로 표기하세요.${DATA_GUARD}`

function demoResult(summary) {
  const total = summary?.totalAmount ? summary.totalAmount.toLocaleString('ko-KR') : '18,540,000'
  const topChannel = summary?.byChannel?.[0]?.[0] || '스마트스토어'
  const topProduct = summary?.byProduct?.[0]?.[0] || '데일리 장편한 유산균 30포'
  return {
    demo: true,
    headline: `주간 매출 ${total}원 — ${topChannel} 채널이 성장을 견인`,
    summary: `이번 기간 총매출은 ${total}원이며, 최상위 채널은 ${topChannel}, 최다 매출 상품은 ${topProduct}입니다. 상위 상품 집중도가 높아 재고와 광고 예산을 상위 상품에 우선 배분할 시점입니다.`,
    insights: [
      `${topChannel} 채널이 전체 매출에서 가장 큰 비중을 차지했습니다. 채널 상위 노출(기획전·카테고리 광고) 효과를 점검할 가치가 있습니다.`,
      `${topProduct}이(가) 매출 1위 상품입니다. 품절 시 전체 매출 타격이 큰 구조이므로 안전재고 기준을 상향할 필요가 있습니다.`,
      '일별 매출 변동 폭이 평균 대비 ±50%를 넘는 날이 관측되었습니다. 프로모션·노출 순위 변화와 대조해 원인을 기록해 두세요.',
      '하위 채널은 매출 기여가 낮지만 등록·운영 비용은 동일하게 발생합니다. 채널별 공헌이익 점검을 권장합니다.',
    ],
    actions: [
      `${topProduct} 안전재고를 최근 주간 판매량의 2주치로 상향하고, 발주 리드타임을 확인하세요.`,
      `${topChannel} 채널의 상위 노출 키워드를 확인하고, 동일 키워드를 하위 채널 상품명에도 반영하세요.`,
      '매출 급증일의 유입 경로(광고/외부 링크)를 확인해 재현 가능한 프로모션인지 판단하세요.',
    ],
    risks: [
      '특정 상품·채널 집중도가 높아, 단일 채널 정책 변경(수수료·노출 로직)에 매출이 흔들릴 수 있습니다.',
      '매출 급감일이 있다면 품절·페이지 오류 여부를 우선 점검하세요.',
    ],
  }
}

export async function onRequestPost(context) {
  const { request, env } = context
  const body = await readJsonBody(request)
  const summary = body?.summary
  if (!summary || !Array.isArray(summary.byDate) || summary.byDate.length === 0)
    return errorJson('집계 데이터가 없습니다. CSV를 먼저 업로드해주세요.')

  // 서버에는 집계 요약만 전달 (원본 판매 데이터는 브라우저를 벗어나지 않음)
  const compact = {
    totalAmount: Number(summary.totalAmount) || 0,
    totalQty: Number(summary.totalQty) || 0,
    count: Number(summary.count) || 0,
    dailyAvg: Math.round(Number(summary.dailyAvg) || 0),
    byDate: summary.byDate.slice(0, 60),
    byChannel: summary.byChannel.slice(0, 10),
    byProduct: summary.byProduct.slice(0, 10),
    anomalies: (summary.anomalies || []).slice(0, 10),
  }

  const startedAt = Date.now()

  // 보안 검증 실패도 하드 차단하지 않는다 — 예시 결과로 강등하고 사유를 기록한다
  const guard = await verifyTurnstile(env, request)
  if (!guard.ok) {
    logCall(context, { endpoint: 'sales-report', mode: 'unverified', startedAt })
    return json({ ...demoResult(compact), notice: `보안 검증을 완료하지 못해 예시 결과를 표시합니다. (사유: ${guard.codes})` })
  }

  if (!hasApiKey(env)) {
    logCall(context, { endpoint: 'sales-report', mode: 'demo', startedAt })
    return json(demoResult(compact))
  }

  if (!(await checkRateLimit(env, 'ax:daily:all', 300, 86400)))
    return json({ ...demoResult(compact), notice: '오늘의 라이브 생성 예산이 소진되어 예시 결과를 표시합니다.' })

  const ip = clientIp(request)
  if (!(await checkRateLimit(env, `ax:sales:${ip}`, 10, 3600)))
    return errorJson('요청이 너무 잦습니다. 1시간 후 다시 시도해주세요.', 429)
  if (!(await checkRateLimit(env, 'ax:sales:all', 80, 3600)))
    return errorJson('사용량이 많아 잠시 후 다시 시도해주세요.', 429)

  // 상품명·채널명은 고객사가 올린 CSV에서 그대로 온다 — 지시문을 심어 둘 수 있는 자리다
  const injected = injectionNotice(
    detectInjection([
      ...compact.byProduct.map((r) => r?.[0]),
      ...compact.byChannel.map((r) => r?.[0]),
    ])
  )

  try {
    const { input: result, usage } = await callClaudeTool(env, {
      system: SYSTEM,
      user: `[판매 데이터 집계]\n${userDataJson('판매 데이터 집계', compact)}`,
      tool: TOOL,
      maxTokens: 4096,
    })
    ensureContract(result, {
      arrays: ['insights', 'actions', 'risks'],
      strings: ['headline', 'summary'],
    })
    logCall(context, { endpoint: 'sales-report', mode: 'live', startedAt, usage })
    return json({ demo: false, usage, input_warning: injected, ...result })
  } catch (err) {
    logCall(context, { endpoint: 'sales-report', mode: 'fallback', startedAt, reason: failureCode(err) })
    return json({ ...demoResult(compact), notice: `일시적인 AI 혼잡으로 예시 결과를 표시합니다. (${err.message})` })
  }
}
