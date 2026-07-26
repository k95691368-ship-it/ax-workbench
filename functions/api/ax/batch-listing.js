import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { callClaudeTool, ensureContract, hasApiKey, COMPLIANCE_RULES } from '../../_lib/claude.js'
import { checkTexts } from '../../_lib/adcheck.js'
import { logCall } from '../../_lib/telemetry.js'
import { verifyTurnstile } from '../../_lib/turnstile.js'

const MAX_PRODUCTS = 5

const TOOL = {
  name: 'record_batch_listing',
  description: '여러 상품의 등록 정보를 한 번에 최적화해 기록한다.',
  input_schema: {
    type: 'object',
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        description: '입력된 상품 순서 그대로, 상품별 최적화 결과',
        items: {
          type: 'object',
          required: ['input_name', 'title', 'alt_title', 'keywords', 'tags'],
          properties: {
            input_name: { type: 'string', description: '입력된 원래 상품명 (그대로 echo)' },
            title: { type: 'string', description: '검색최적화 대표 상품명 (50자 이내)' },
            alt_title: { type: 'string', description: '대안 상품명 1개 (50자 이내)' },
            keywords: { type: 'array', items: { type: 'string' }, description: '검색 키워드 5개' },
            tags: { type: 'array', items: { type: 'string' }, description: '등록 태그 6개' },
          },
        },
      },
    },
  },
}

const SYSTEM = `당신은 오픈마켓 상품 대량 등록 담당자입니다. 여러 상품의 등록 정보를 한 번에, 상품마다 빠짐없이 최적화합니다.

규칙:
1. 입력된 모든 상품에 대해 각각 결과를 만드세요. 순서를 유지하고 input_name에 원래 상품명을 그대로 적으세요.
2. 상품명은 [수식어] + 핵심키워드 + 규격 구조, 50자 이내.
3. 제품 정보에 없는 속성을 지어내지 마세요.
${COMPLIANCE_RULES}`

function demoResult(products) {
  return {
    demo: true,
    results: products.map((p) => {
      const tokens = p.name.split(/\s+/).filter(Boolean)
      return {
        input_name: p.name,
        title: `${p.name}${p.category ? ` ${p.category.split('>').pop().trim()}` : ''} 인기 상품`.slice(0, 50),
        alt_title: `${tokens.slice(0, 3).join(' ')} 추천 베스트`.slice(0, 50),
        keywords: [...new Set([...tokens, ...(p.category ? p.category.split(/[>\s]+/).filter(Boolean) : [])])].slice(0, 5),
        tags: [...new Set([...tokens, '인기상품', '추천'])].slice(0, 6),
      }
    }),
  }
}

function withAdCheck(results, products) {
  return results.map((r, i) => ({
    ...r,
    ad_check: checkTexts([
      r.title,
      r.alt_title,
      ...(r.keywords || []),
      ...(r.tags || []),
      products[i]?.features,
    ]),
  }))
}

export async function onRequestPost(context) {
  const { request, env } = context
  const body = await readJsonBody(request)
  const raw = Array.isArray(body?.products) ? body.products : []
  const products = raw
    .filter((p) => p && typeof p.name === 'string' && p.name.trim())
    .slice(0, MAX_PRODUCTS)
    .map((p) => ({
      name: String(p.name).trim().slice(0, 100),
      category: String(p.category || '').slice(0, 100),
      features: String(p.features || '').slice(0, 300),
    }))
  if (products.length === 0) return errorJson('상품을 1개 이상 입력해주세요. (한 줄에 하나)')

  if (!(await verifyTurnstile(env, request)))
    return errorJson('보안 검증에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.', 403)

  const startedAt = Date.now()

  if (!hasApiKey(env)) {
    const demo = demoResult(products)
    logCall(context, { endpoint: 'batch-listing', mode: 'demo', startedAt })
    return json({ ...demo, results: withAdCheck(demo.results, products) })
  }

  if (!(await checkRateLimit(env, 'ax:daily:all', 300, 86400))) {
    const demo = demoResult(products)
    return json({ ...demo, results: withAdCheck(demo.results, products), notice: '오늘의 라이브 생성 예산이 소진되어 예시 결과를 표시합니다.' })
  }

  const ip = clientIp(request)
  if (!(await checkRateLimit(env, `ax:batch:${ip}`, 4, 3600)))
    return errorJson('대량 처리는 시간당 4회까지 가능합니다. 잠시 후 다시 시도해주세요.', 429)
  if (!(await checkRateLimit(env, 'ax:batch:all', 30, 3600)))
    return errorJson('데모 사용량이 많아 잠시 후 다시 시도해주세요.', 429)

  try {
    const { input: result, usage } = await callClaudeTool(env, {
      system: SYSTEM,
      user: `[상품 목록 (${products.length}개)]\n${JSON.stringify(products, null, 2)}\n\n목록의 모든 상품에 대해 각각 결과를 기록하세요.`,
      tool: TOOL,
      maxTokens: 8192,
    })
    ensureContract(result, { arrays: ['results'] })
    result.results = result.results
      .filter((r) => r && typeof r.title === 'string')
      .slice(0, products.length)
    if (result.results.length === 0) throw new Error('AI 응답이 불완전합니다. 다시 시도해주세요.')
    const checked = withAdCheck(result.results, products)
    logCall(context, {
      endpoint: 'batch-listing',
      mode: 'live',
      startedAt,
      usage,
      findingsCount: checked.reduce((s, r) => s + r.ad_check.length, 0),
    })
    return json({ demo: false, usage, results: checked })
  } catch (err) {
    const demo = demoResult(products)
    logCall(context, { endpoint: 'batch-listing', mode: 'fallback', startedAt })
    return json({ ...demo, results: withAdCheck(demo.results, products), notice: `일시적인 AI 혼잡으로 예시 결과를 표시합니다. (${err.message})` })
  }
}
