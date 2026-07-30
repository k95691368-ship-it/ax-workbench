import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimitGroup, RATE_NOTICE } from '../../_lib/rateLimit.js'
import { checkDailyBudget, budgetNotice } from '../../_lib/budget.js'
import { callClaudeTool, hasApiKey, COMPLIANCE_RULES } from '../../_lib/claude.js'
import { checkTexts } from '../../_lib/adcheck.js'
import { logCall } from '../../_lib/telemetry.js'
import { verifyTurnstile } from '../../_lib/turnstile.js'
import { sanitizeBrand, brandPrompt, missingRequired } from '../../_lib/brand.js'
import { DATA_GUARD, userDataBlock, userDataJson, detectInjection, injectionNotice } from '../../_lib/promptSafety.js'
import { failureCode } from '../../_lib/claude.js'
import { normalizeChannelContents } from '../../_lib/shape.js'
import { checkClaims } from '../../../src/lib/factCheck.js'
import { runAll, sumUsage, withUsage, chunk as chunkBy } from '../../_lib/parallel.js'

function withAdCheck(results, brand) {
  for (const r of results) {
    r.ad_check = checkTexts([r.title, r.body, ...(r.hashtags || [])], brand)
  }
  return results
}

// 브랜드 룰북 적용 결과 — 필수 문구를 **채널별로** 확인한다.
//
// 예전에는 모든 채널 텍스트를 한 덩어리로 합쳐 검사했다. 그러면 6개 채널 중 1개에만
// 문구가 있어도 "누락 없음"이 되어 "브랜드 룰북 적용됨" 배지가 떴다.
// 그런데 채널 콘텐츠는 카드마다 따로 복사·발행되는 **별개 산출물**이다 — 한 곳에만 있는
// 문구는 나머지 발행물에서는 누락이다. 한 페이지를 조립하는 상세페이지와 달리
// 여기서는 합산 검사가 성립하지 않는다.
// 각 항목에 brand_missing을 담아 두면 위반 자동 교정 흐름도 그대로 붙는다.
export function brandMeta(results, brand) {
  if (!brand) return { brand_applied: false }
  const all = new Set()
  for (const r of results) {
    const missing = missingRequired([r.title, r.body], brand)
    if (missing.length) {
      r.brand_missing = missing
      missing.forEach((m) => all.add(m))
    }
  }
  return { brand_applied: true, brand_missing: [...all] }
}

const CHANNEL_SPECS = {
  instagram: '인스타그램 피드: 첫 줄 후킹 + 본문 3~5줄 + 해시태그 8~12개. 이모지 적절히.',
  cardnews: '카드뉴스: 표지 포함 슬라이드 5~6장. 각 장은 title(큰 글씨)과 caption(작은 글씨 1~2줄).',
  blog: '블로그 포스트: SEO 제목 + 서론/본론(소제목 2~3개)/결론 구조, 800자 내외.',
  threads: '스레드: 캐주얼한 톤의 짧은 글 1~3개 묶음. 각 500자 이내, 대화 걸듯이.',
  youtube: '유튜브 쇼츠(60초): 장면별 스크립트. 각 장면은 time(초), visual(화면 지시), narration(대사/자막).',
  tiktok: '틱톡(30~45초): 트렌디한 톤의 장면별 스크립트. 후킹 3초 규칙 적용. 각 장면은 time, visual, narration.',
}

const SYSTEM = `당신은 온라인 유통사의 SNS 콘텐츠 마케터입니다. 제품 정보 하나로 각 채널의 문법에 맞는 콘텐츠를 동시에 만듭니다.

규칙:
1. 채널마다 말투·길이·구조가 달라야 합니다. 아래 채널 스펙을 따르세요.
2. 제품 정보에 있는 사실만 사용하세요.
3. 바이럴을 노리되 신뢰를 깎는 낚시성 문구는 금지.
${COMPLIANCE_RULES}${DATA_GUARD}`

const DEMO_BODIES = {
  instagram: {
    title: '출근길 가방에 유산균 한 포, 챙기셨나요? 🌿',
    body: '아침은 걸러도 유산균은 거르지 마세요.\n물 없이 톡 털어 넣는 스틱 타입이라\n지하철에서도, 사무실에서도 하루 한 포면 끝.\n\n19종 유산균 · 보장균수 100억 CFU\n오늘부터 가방 앞주머니에 넣어두세요 👜',
    hashtags: ['유산균', '프로바이오틱스', '직장인루틴', '아침습관', '건강스타그램', '유산균추천', '스틱유산균', '출근길루틴'],
  },
  cardnews: {
    title: '직장인 장 건강 체크리스트 (카드뉴스 6장)',
    body: '1장(표지): "요즘 속이 편한 날이 없다면" — 체크리스트 카드뉴스\n2장: 아침을 자주 거른다 ☑ / 점심은 10분 만에 먹는다 ☑ / 야식·배달이 주 3회 이상 ☑\n3장: 셋 중 하나라도 해당된다면, 장이 보내는 신호에 귀 기울일 때\n4장: 유산균은 "꾸준히"가 핵심 — 물 없이 먹는 스틱이면 매일이 쉬워집니다\n5장: 19종 유산균, 유통기한까지 보장균수 100억 CFU\n6장(클로징): 내일 아침, 가방에 한 포 넣는 것부터 시작하세요',
    hashtags: ['카드뉴스', '장건강', '직장인건강'],
  },
  blog: {
    title: '직장인 유산균 고르는 법 3가지 — 보장균수·균주 수·섭취 편의성',
    body: '[서론] 유산균을 사놓고 서랍에서 유통기한을 넘겨본 적 있다면, 제품보다 "습관이 되는 형태"를 먼저 봐야 합니다.\n\n[본론1. 보장균수 확인] 제조 시 균수가 아니라 유통기한까지 보장하는 균수(CFU)를 확인하세요. 데일리 장편한 유산균은 보장균수 100억 CFU 기준입니다.\n\n[본론2. 균주 다양성] 단일 균주보다 여러 균주를 함께 담은 제품이 선택지로 꼽힙니다. 19종 혼합 유산균처럼 균주 구성을 표기하는 제품을 고르세요.\n\n[본론3. 섭취 편의성] 물 없이 먹는 개별 스틱은 사무실·이동 중에도 끊기지 않는 루틴을 만들어 줍니다.\n\n[결론] 유산균 선택의 기준은 결국 "내가 매일 먹을 수 있는가"입니다. 표기사항을 확인하고 내 생활 패턴에 맞는 형태를 고르세요.',
    hashtags: ['유산균고르는법', '보장균수', '프로바이오틱스'],
  },
  threads: {
    title: '유산균 사놓고 안 먹는 사람 손 🙋',
    body: '유산균 사놓고 안 먹는 사람 손 🙋\n\n냉장고에 모셔두고 유통기한 지나서 버린 게 벌써 두 통째… 그래서 스틱형으로 바꿨더니 가방에 넣어두고 지하철에서 먹게 됨. 결국 좋은 유산균 = 내가 까먹지 않는 유산균이었다.\n\n(19종 균주에 보장균수 100억 CFU면 스펙도 아쉽지 않음)',
    hashtags: [],
  },
  youtube: {
    title: '아침마다 속이 무거운 직장인, 딱 15초만 보세요 (쇼츠 60초)',
    body: '0-3초: [화면] 알람 끄고 헐레벌떡 뛰쳐나가는 출근길 / [자막] "아침 거르고 출근하는 사람?"\n3-15초: [화면] 편의점 김밥 급하게 먹는 컷 → 속 부여잡는 컷 / [내레이션] "점심은 10분 컷, 속은 하루 종일 불편하고"\n15-35초: [화면] 가방 앞주머니에서 스틱 꺼내 물 없이 섭취 / [내레이션] "그래서 요즘은 출근길에 유산균 한 포. 물도 필요 없어요"\n35-50초: [화면] 19종 균주 · 100억 CFU 인포그래픽 / [내레이션] "19종 유산균, 유통기한까지 보장균수 100억"\n50-60초: [화면] 제품 클로즈업 + 구매 링크 안내 / [자막] "내일 아침부터, 하루 한 포 습관"',
    hashtags: ['쇼츠', '직장인브이로그', '유산균'],
  },
  tiktok: {
    title: 'POV: 3년차 직장인의 가방 속 (틱톡 40초)',
    body: '0-3초: [화면] "3년차 직장인 가방 털기" 텍스트 후킹 + 가방 뒤집는 컷\n3-15초: [화면] 이어폰, 보조배터리, 립밤 차례로 등장 / [자막] "여기까진 국룰"\n15-30초: [화면] 유산균 스틱 등장, 물 없이 톡 / [자막] "요즘 국룰 하나 추가됨. 지하철에서 먹는 유산균"\n30-40초: [화면] 제품 패키지 클로즈업 / [자막] "하루 한 포 · 19종 유산균 · 100억 CFU"',
    hashtags: ['직장인틱톡', 'POV', '가방털기'],
  },
}

function demoResult(channels) {
  return {
    demo: true,
    results: channels.map((ch) => ({ channel: ch, ...DEMO_BODIES[ch] })),
  }
}

const CHANNELS_TOOL = {
  name: 'record_channel_contents',
  description: '지정된 채널들의 콘텐츠를 각 채널 문법에 맞게 작성해 기록한다.',
  input_schema: {
    type: 'object',
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        description: '요청된 각 채널별 콘텐츠',
        items: {
          type: 'object',
          required: ['channel', 'title', 'body'],
          properties: {
            channel: { type: 'string', description: '채널 id' },
            title: { type: 'string', description: '콘텐츠 제목 또는 첫 줄 후킹' },
            body: {
              type: 'string',
              description: '본문 전체. 카드뉴스는 "1장: ..." 형식, 영상은 "0-3초: ..." 형식으로 장면 구분',
            },
            hashtags: { type: 'array', items: { type: 'string' }, description: '해시태그 (# 제외)' },
          },
        },
      },
    },
  },
}

// 한 호출이 맡는 채널 수 — 실측으로 정한 값이다.
//
// 이 값을 정하면서 두 번 틀렸다.
//  1) 처음엔 채널마다 호출 하나씩 두고 "당연히 빠르다"고 봤다.
//  2) 개별 호출이 ~15초로 나오자 "호출당 고정 비용이 지배하니 묶는 게 낫다"고 보고
//     3채널 묶음으로 바꿨다. 근거로 삼은 예전 평균 9.5초는 표본이 호출 2건뿐이었다.
//
// 그래서 같은 입력으로 직접 A/B를 쟀다:
//              채널당 1호출   3채널 묶음
//   3채널        22.1초        23.6초
//   6채널        19.8초        32.2초
// 채널이 많아질수록 묶음은 그 안에서 순차 생성이라 시간이 쌓인다. 채널당 1호출이
// 두 경우 모두 같거나 빨랐다. 즉 처음 설계가 맞았고 2)가 퇴보였다.
//
// 값은 남겨둔다 — 모델이나 채널 스펙이 바뀌면 다시 재서 조정할 자리이기 때문이다.
export const CHANNEL_CHUNK = 1

export const chunkChannels = (channels, size = CHANNEL_CHUNK) => chunkBy(channels, size)

function groupUserContent({ product, group, channels, previous, feedback }) {
  const specs = group.map((c) => `- ${c}: ${CHANNEL_SPECS[c]}`).join('\n')
  const others = channels.filter((c) => !group.includes(c))
  let content = `[제품 정보]
${userDataJson('제품 정보', product)}

[지금 만들 채널과 스펙]
${specs}

[다른 채널은 동시에 따로 만들어지고 있습니다 — 위 채널만 만드세요]
${others.length ? others.join(', ') : '(없음)'}

위 채널 각각에 대해 콘텐츠를 만들어 기록하세요.`

  if (previous) {
    // 이 묶음이 맡은 채널의 이전 원고만 준다 — 다른 채널 원고까지 주면 톤이 섞인다.
    //
    // previous는 배열로 들어온다(onRequestPost가 p.slice(...).map(...)으로 만들고,
    // 배열이 아니면 400을 돌려준다). 예전에는 previous.results를 읽어서 **어떤 입력에서도
    // 항상 빈 배열**이었다 — 즉 "피드백 반영"이 이전 원고 없이 새로 생성하고 있었다.
    // 화면은 "잘된 부분은 유지됩니다"라고 안내하는데 모델은 유지할 원문을 받지 못했다.
    // 병렬 전환 때 "묶음이 맡은 채널의 이전 원고만 준다"는 의도가 여기서 끊겼다.
    const prevList = Array.isArray(previous) ? previous : previous?.results || []
    const mine = prevList.filter((r) => group.includes(r?.channel))
    content += `

[이 채널들의 이전 결과]
${userDataJson('이전 원고', mine)}

[사용자 피드백]
${userDataBlock('사용자 피드백', feedback)}

위 피드백을 반영한 개선판을 만드세요. 피드백과 무관하게 잘된 부분은 유지하세요.`
  }
  return content
}

// 채널을 묶음으로 나눠 동시에 생성한다.
// 한 묶음이 실패해도 나머지 채널은 그대로 살린다 — 예전에는 전부 예시 결과로 떨어졌다.
export async function generateChannels(env, { system, product, channels, previous, feedback }) {
  const groups = chunkChannels(channels)
  const { settled, timing } = await runAll(
    groups.map((group) => () =>
      callClaudeTool(env, {
        system,
        user: groupUserContent({ product, group, channels, previous, feedback }),
        tool: CHANNELS_TOOL,
        maxTokens: 8192,
        // 이제 timeoutMs는 재시도까지 포함한 전체 예산이다.
        // Cloudflare 엣지 한도(약 100초) 아래로 여유를 둔다 —
        // 넘으면 폴백 catch에 도달하지 못하고 게이트웨이 에러가 사용자에게 뜬다.
        // 실측 단일 채널 호출은 15~22초라 70초도 3배 여유다.
        timeoutMs: 70000,
      })
    )
  )

  const raw = []
  settled.forEach((r, gi) => {
    const got = r.status === 'fulfilled' ? r.value.input?.results : null
    if (!Array.isArray(got)) return
    // 요청하지 않은 채널이 섞여 오면 버린다 (묶음 단위로 검사)
    raw.push(...got.filter((x) => groups[gi].includes(x?.channel)))
  })

  // 항목 단위 정규화는 기존 계약 검증을 그대로 쓴다.
  // 쓸 수 있는 채널이 하나도 없으면 여기서 계약 위반으로 던져 폴백 경로로 넘어간다.
  let results
  try {
    results = normalizeChannelContents(raw, channels)
  } catch (err) {
    // 성공한 채널 호출의 토큰은 이미 청구됐다 — 예산 집계에 남긴다
    throw withUsage(err, settled)
  }

  // 빠진 채널은 **정규화까지 끝난 뒤** 확정한다.
  //
  // 예전에는 묶음 응답에 채널 id가 있으면 성공으로 셌다. 그런데 실제 채택 기준은
  // 더 엄격하다(title이 문자열이고 body가 비어 있지 않아야 한다 — shape.js).
  // 그래서 body가 빈 문자열인 응답은 "성공"으로 세어져 failed에서 빠지는데
  // 정규화 단계에서 탈락했다 — 결과에도 없고 안내도 없이 **조용히 사라졌다**.
  // 최종 결과에 없는 채널은 이유가 무엇이든 빠진 것으로 본다.
  const done = new Set(results.map((r) => r.channel))
  const failed = channels.filter((c) => !done.has(c))

  return { results, usage: sumUsage(settled), timing, failed }
}

export async function onRequestPost(context) {
  const { request, env } = context
  const body = await readJsonBody(request)
  if (!body || typeof body.product?.name !== 'string' || !body.product.name.trim())
    return errorJson('제품 정보를 입력해주세요.')
  const channels = Array.isArray(body.channels)
    ? body.channels.filter((c) => CHANNEL_SPECS[c]).slice(0, 6)
    : []
  if (channels.length === 0) return errorJson('채널을 1개 이상 선택해주세요.')

  const product = {
    name: String(body.product.name).slice(0, 100),
    category: String(body.product.category || '').slice(0, 100),
    features: String(body.product.features || '').slice(0, 500),
    target: String(body.product.target || '').slice(0, 200),
    tone: String(body.product.tone || '').slice(0, 100),
  }

  // 피드백 반영 모드: 이전 채널 콘텐츠와 피드백을 함께 받아 개선판을 만든다
  let feedback = ''
  let previous = null
  if (body.revision && typeof body.revision === 'object') {
    if (typeof body.revision.feedback !== 'string' || !body.revision.feedback.trim())
      return errorJson('피드백 내용을 입력해주세요.')
    feedback = body.revision.feedback.trim().slice(0, 300)
    const p = body.revision.previous
    if (Array.isArray(p) && p.length > 0) {
      previous = p.slice(0, 6).map((r) => ({
        channel: String(r?.channel || '').slice(0, 20),
        title: String(r?.title || '').slice(0, 200),
        body: String(r?.body || '').slice(0, 2000),
        hashtags: Array.isArray(r?.hashtags) ? r.hashtags.slice(0, 15).map((h) => String(h).slice(0, 40)) : [],
      }))
    }
    if (!previous) return errorJson('이전 결과가 없어 피드백을 반영할 수 없습니다. 먼저 생성해주세요.')
  }

  // 브랜드 룰북(사용자 브라우저에 저장된 회사 규정) — 없으면 null
  const brand = sanitizeBrand(body.brand)
  const injected = injectionNotice(detectInjection([product.name, product.features, product.target, product.tone, feedback]))

  const startedAt = Date.now()

  // 보안 검증 실패도 하드 차단하지 않는다 — 예시 결과로 강등하고 사유를 기록한다
  const guard = await verifyTurnstile(env, request)
  if (!guard.ok) {
    logCall(context, { endpoint: 'content', mode: 'unverified', startedAt })
    const demo = demoResult(channels)
    return json({ ...demo, results: withAdCheck(demo.results, brand), ...brandMeta(demo.results, brand), notice: `보안 검증을 완료하지 못해 예시 결과를 표시합니다. (사유: ${guard.codes})` })
  }

  if (!hasApiKey(env)) {
    const demo = demoResult(channels)
    logCall(context, { endpoint: 'content', mode: 'demo', startedAt })
    return json({ ...demo, results: withAdCheck(demo.results, brand), ...brandMeta(demo.results, brand) })
  }

  // 일일 예산(USD) 상한 — 회수가 아니라 실제 지출로 막는다
  const budget = await checkDailyBudget(env, undefined, { calls: chunkChannels(channels).length })
  if (!budget.ok) {
    // 예산 강등도 계측한다 — 기록하지 않으면 지표에서 이 요청이 통째로 빠진다
    logCall(context, { endpoint: 'content', mode: 'demo', startedAt, reason: 'budget' })
    const demo = demoResult(channels)
    return json({ ...demo, results: withAdCheck(demo.results, brand), ...brandMeta(demo.results, brand), notice: budgetNotice(budget) })
  }

  // 한도에 걸려도 화면을 막다른 길로 만들지 않는다 — AI 호출만 막고 예시 결과로 강등한다.
  // 두 상한을 함께 판정한다 — 하나라도 막히면 어느 쪽 몫도 소모하지 않는다.
  const ip = clientIp(request)
  const blocked = await checkRateLimitGroup(env, [
    { bucket: `ax:content:${ip}`, maxHits: 8, notice: RATE_NOTICE.ip },
    { bucket: 'ax:content:all', maxHits: 60, failOpen: false, notice: RATE_NOTICE.all },
  ])
  const rateNotice = blocked?.notice || null
  if (rateNotice) {
    const demo = demoResult(channels)
    logCall(context, { endpoint: 'content', mode: 'demo', startedAt, reason: 'rate_limit' })
    return json({ ...demo, results: withAdCheck(demo.results, brand), ...brandMeta(demo.results, brand), notice: rateNotice })
  }

  try {
    const { results, usage, timing, failed } = await generateChannels(env, {
      system: SYSTEM + brandPrompt(brand),
      product,
      channels,
      previous,
      feedback,
    })
    const checked = withAdCheck(results, brand)
    const factCheck = checkClaims(
      checked.flatMap((r) => [r.title, r.body]),
      [product.name, product.category, product.features, product.target]
    )
    logCall(context, {
      endpoint: 'content',
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
      fact_check: factCheck,
      input_warning: injected,
      notice: failed.length
        ? `${failed.join('·')} 채널은 생성이 지연되어 빠졌습니다. 나머지 채널은 정상 생성되었습니다.`
        : null,
      ...brandMeta(checked, brand),
    })
  } catch (err) {
    const demo = demoResult(channels)
    logCall(context, { endpoint: 'content', mode: 'fallback', startedAt, reason: failureCode(err), usage: err.usage })
    return json({ ...demo, results: withAdCheck(demo.results, brand), ...brandMeta(demo.results, brand), notice: `일시적인 AI 혼잡으로 예시 결과를 표시합니다. (${err.message})` })
  }
}
