import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimit, RATE_NOTICE } from '../../_lib/rateLimit.js'
import { checkDailyBudget, budgetNotice } from '../../_lib/budget.js'
import { callClaudeTool, ensureContract, hasApiKey, COMPLIANCE_RULES, failure } from '../../_lib/claude.js'
import { checkTexts } from '../../_lib/adcheck.js'
import { logCall } from '../../_lib/telemetry.js'
import { verifyTurnstile } from '../../_lib/turnstile.js'
import { sanitizeBrand, brandPrompt } from '../../_lib/brand.js'
import { DATA_GUARD, userDataJson, detectInjection, injectionNotice } from '../../_lib/promptSafety.js'
import { failureCode } from '../../_lib/claude.js'
import { checkClaims } from '../../../src/lib/factCheck.js'

// 한 번에 처리하는 상품 수.
//
// 예전에는 5개였다. 상품 전부를 한 호출에 담아야 했기 때문이다 — 더 넣으면 응답이 길어져
// 잘리거나 타임아웃이 났다. 즉 "대량 등록"이라는 이름과 달리 실무의 대량과는 거리가 있었다.
//
// 상세페이지에서 검증한 병렬 구조를 그대로 쓴다: 상품을 CHUNK_SIZE개씩 묶어 **동시에** 보낸다.
// 20개를 처리해도 걸리는 시간은 "가장 느린 묶음 하나"라 5개일 때와 큰 차이가 없다.
// 한 묶음이 실패해도 그 묶음만 예시 결과로 채우고 나머지는 그대로 살린다.
export const MAX_PRODUCTS = 20
export const CHUNK_SIZE = 5

export function chunk(items, size = CHUNK_SIZE) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

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
${COMPLIANCE_RULES}${DATA_GUARD}`

function demoResult(products) {
  return {
    demo: true,
    results: products.map((p) => {
      // 재생성 요청이면 검출된 표현을 빼고 만든다 (예시 결과도 같은 원칙을 지킨다).
      // 글자만 도려내면 "최고급 유산균" → "급 유산균"처럼 깨지므로 해당 단어를 통째로 뺀다.
      const strip = (text) =>
        String(text)
          .split(/\s+/)
          .filter((token) => token && !(p.violations || []).some((w) => token.includes(w)))
          .join(' ')
          .trim()
      const tokens = strip(p.name).split(/\s+/).filter(Boolean)
      return {
        input_name: p.name,
        title: strip(`${p.name}${p.category ? ` ${p.category.split('>').pop().trim()}` : ''} 인기 상품`).slice(0, 50),
        alt_title: `${tokens.slice(0, 3).join(' ')} 추천 베스트`.slice(0, 50),
        keywords: [...new Set([...tokens, ...(p.category ? p.category.split(/[>\s]+/).filter(Boolean) : [])])].slice(0, 5),
        tags: [...new Set([...tokens, '인기상품', '추천'])].slice(0, 6),
      }
    }),
  }
}

// 점검 결과를 두 갈래로 나눈다.
// - ad_check: AI가 만든 문구의 위반 → 다시 생성하면 해결된다
// - input_check: 입력한 상품 특징에 이미 들어 있던 표현 → 재생성으로는 해결되지 않으므로
//   사람이 원문을 고쳐야 한다. 둘을 섞으면 "다시 생성해도 위반이 안 없어지는" 함정이 생긴다.
function withAdCheck(results, products, brand) {
  return results.map((r, i) => ({
    ...r,
    ad_check: checkTexts([r.title, r.alt_title, ...(r.keywords || []), ...(r.tags || [])], brand),
    input_check: checkTexts([products[i]?.features], brand),
    fact_check: checkClaims(
      [r.title, r.alt_title],
      [products[i]?.name, products[i]?.category, products[i]?.features]
    ),
  }))
}

// 최초 생성과 재생성(위반 상품만 다시)에 같은 도구를 쓰되, 지시문만 달라진다
function buildUserContent(products) {
  // 상품 목록은 데이터 블록으로 격리한다 (입력 속 지시문을 따르지 않도록)
  const base = `[상품 목록 (${products.length}개)]
${userDataJson('상품 목록', products)}

목록의 모든 상품에 대해 각각 결과를 기록하세요.`
  const retry = products.filter((p) => p.violations.length > 0)
  if (retry.length === 0) return base
  return `${base}

[재생성 지시 — 중요]
이 요청은 이전 결과에서 규정 위반이 검출되어 다시 만드는 것입니다.
- 각 상품의 previous는 이전 상품명, violations는 그때 검출된 표현입니다.
- 검출된 표현과 그 동의어·변형을 절대 사용하지 말고, 완전히 다른 각도의 표현으로 새로 작성하세요.
- previous를 그대로 되풀이하지 마세요. 검색 노출에 유리한 다른 키워드 조합을 찾으세요.`
}

// 한 묶음의 응답을 화면이 기대하는 모양으로 맞춘다.
// input_name은 화면의 행 식별자이자 재생성 대상 매칭 기준이라, AI 응답을 믿지 않고
// 우리가 보낸 상품명으로 확정한다 (상품이 뒤바뀌는 사고 방지).
function shapeRows(raw, groupProducts) {
  return (Array.isArray(raw) ? raw : [])
    .filter((r) => r && typeof r.title === 'string' && r.title.trim())
    .slice(0, groupProducts.length)
    .map((r, i) => ({
      input_name: groupProducts[i]?.name || (typeof r.input_name === 'string' ? r.input_name : ''),
      title: r.title,
      alt_title: typeof r.alt_title === 'string' ? r.alt_title : '',
      keywords: Array.isArray(r.keywords) ? r.keywords.filter((k) => typeof k === 'string') : [],
      tags: Array.isArray(r.tags) ? r.tags.filter((k) => typeof k === 'string') : [],
    }))
}

// 상품을 묶음으로 나눠 동시에 생성한다.
// 한 묶음이 실패하거나 일부 상품이 빠져도 그 자리만 예시 결과로 채우고 나머지는 살린다.
// 전부 실패했을 때만 예외를 던져 기존 폴백 경로로 넘긴다.
export async function generateBatch(env, { system, products }) {
  const started = Date.now()
  const groups = chunk(products)
  const elapsed = Array.from({ length: groups.length }, () => 0)

  const settled = await Promise.allSettled(
    groups.map((group, gi) => {
      const s = Date.now()
      return callClaudeTool(env, {
        system,
        user: buildUserContent(group),
        tool: TOOL,
        maxTokens: 8192,
        timeoutMs: 70000,
      }).finally(() => {
        elapsed[gi] = Date.now() - s
      })
    })
  )

  const rows = []
  let inputTokens = 0
  let outputTokens = 0
  let liveGroups = 0
  let demoFilled = 0

  // 이 묶음(또는 묶음의 남은 자리)을 예시 결과로 채운다
  const fillDemo = (items) => {
    rows.push(...demoResult(items).results)
    demoFilled += items.length
  }

  settled.forEach((res, gi) => {
    const group = groups[gi]
    if (res.status !== 'fulfilled') return fillDemo(group)

    let shaped = []
    try {
      ensureContract(res.value.input, { arrays: ['results'] })
      shaped = shapeRows(res.value.input.results, group)
    } catch {
      return fillDemo(group)
    }
    if (shaped.length === 0) return fillDemo(group)

    liveGroups += 1
    inputTokens += res.value.usage?.input_tokens || 0
    outputTokens += res.value.usage?.output_tokens || 0
    rows.push(...shaped)
    // 묶음 안에서 일부 상품이 빠졌으면 그 자리만 예시로 채운다 (행 수와 순서를 지킨다)
    if (shaped.length < group.length) fillDemo(group.slice(shaped.length))
  })

  // 전부 실패했을 때만 예외를 던져 기존 폴백 경로로 넘긴다
  if (liveGroups === 0) throw failure('contract', 'AI 응답이 불완전합니다. 다시 시도해주세요.')

  return {
    rows,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    failedCount: demoFilled,
    timing: {
      total_ms: Date.now() - started,
      serial_ms: elapsed.reduce((a, b) => a + b, 0),
      slowest_ms: Math.max(0, ...elapsed),
      calls: groups.length,
    },
  }
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
      // 재생성 모드: 이전 상품명과 검출된 위반 표현 (없으면 최초 생성)
      previous: String(p.previous || '').slice(0, 120),
      violations: Array.isArray(p.violations)
        ? p.violations.filter((v) => typeof v === 'string' && v.trim()).slice(0, 10).map((v) => v.trim().slice(0, 40))
        : [],
    }))
  if (products.length === 0) return errorJson('상품을 1개 이상 입력해주세요. (한 줄에 하나)')

  // 브랜드 룰북(사용자 브라우저에 저장된 회사 규정) — 없으면 null
  const brand = sanitizeBrand(body?.brand)
  const injected = injectionNotice(detectInjection(products.flatMap((p) => [p.name, p.features])))

  const startedAt = Date.now()

  // 보안 검증 실패도 하드 차단하지 않는다 — 예시 결과로 강등하고 사유를 기록한다
  const guard = await verifyTurnstile(env, request)
  if (!guard.ok) {
    logCall(context, { endpoint: 'batch-listing', mode: 'unverified', startedAt })
    const demo = demoResult(products)
    return json({ ...demo, results: withAdCheck(demo.results, products, brand), brand_applied: Boolean(brand), notice: `보안 검증을 완료하지 못해 예시 결과를 표시합니다. (사유: ${guard.codes})` })
  }

  if (!hasApiKey(env)) {
    const demo = demoResult(products)
    logCall(context, { endpoint: 'batch-listing', mode: 'demo', startedAt })
    return json({ ...demo, results: withAdCheck(demo.results, products, brand), brand_applied: Boolean(brand) })
  }

  // 일일 예산(USD) 상한 — 회수가 아니라 실제 지출로 막는다
  const budget = await checkDailyBudget(env)
  if (!budget.ok) {
    const demo = demoResult(products)
    return json({ ...demo, results: withAdCheck(demo.results, products, brand), brand_applied: Boolean(brand), notice: budgetNotice(budget) })
  }

  // 한도에 걸려도 화면을 막다른 길로 만들지 않는다 — AI 호출만 막고 예시 결과로 강등한다
  const limited = async (bucket, max, opts) => !(await checkRateLimit(env, bucket, max, 3600, opts))
  const ip = clientIp(request)
  const rateNotice = (await limited(`ax:batch:${ip}`, 4))
    ? RATE_NOTICE.ip
    : (await limited('ax:batch:all', 30, { failOpen: false }))
      ? RATE_NOTICE.all
      : null
  if (rateNotice) {
    const demo = demoResult(products)
    logCall(context, { endpoint: 'batch-listing', mode: 'demo', startedAt, reason: 'rate_limit' })
    return json({ ...demo, results: withAdCheck(demo.results, products, brand), brand_applied: Boolean(brand), notice: rateNotice })
  }

  try {
    const { rows, usage, failedCount, timing } = await generateBatch(env, {
      system: SYSTEM + brandPrompt(brand),
      products,
    })
    const checked = withAdCheck(rows, products, brand)
    logCall(context, {
      endpoint: 'batch-listing',
      mode: 'live',
      startedAt,
      usage,
      findingsCount: checked.reduce((s, r) => s + r.ad_check.length, 0),
    })
    return json({
      demo: false,
      usage,
      timing,
      results: checked,
      brand_applied: Boolean(brand),
      input_warning: injected,
      notice: failedCount
        ? `상품 ${failedCount}개는 생성이 지연되어 예시 결과로 채웠습니다. 해당 행만 다시 실행하면 됩니다.`
        : null,
    })
  } catch (err) {
    const demo = demoResult(products)
    logCall(context, { endpoint: 'batch-listing', mode: 'fallback', startedAt, reason: failureCode(err) })
    return json({ ...demo, results: withAdCheck(demo.results, products, brand), brand_applied: Boolean(brand), notice: `일시적인 AI 혼잡으로 예시 결과를 표시합니다. (${err.message})` })
  }
}
