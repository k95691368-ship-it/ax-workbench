import { json, errorJson, readJsonBody, clientIp } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { callClaudeTool, hasApiKey, COMPLIANCE_RULES } from '../../_lib/claude.js'

const CHANNEL_SPECS = {
  instagram: '인스타그램 피드: 첫 줄 후킹 + 본문 3~5줄 + 해시태그 8~12개. 이모지 적절히.',
  cardnews: '카드뉴스: 표지 포함 슬라이드 5~6장. 각 장은 title(큰 글씨)과 caption(작은 글씨 1~2줄).',
  blog: '블로그 포스트: SEO 제목 + 서론/본론(소제목 2~3개)/결론 구조, 800자 내외.',
  threads: '스레드: 캐주얼한 톤의 짧은 글 1~3개 묶음. 각 500자 이내, 대화 걸듯이.',
  youtube: '유튜브 쇼츠(60초): 장면별 스크립트. 각 장면은 time(초), visual(화면 지시), narration(대사/자막).',
  tiktok: '틱톡(30~45초): 트렌디한 톤의 장면별 스크립트. 후킹 3초 규칙 적용. 각 장면은 time, visual, narration.',
}

const TOOL = {
  name: 'record_channel_contents',
  description: '하나의 제품 정보로 여러 SNS 채널별 콘텐츠를 작성해 기록한다.',
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
            channel: { type: 'string', description: '채널 id (instagram, cardnews, blog, threads, youtube, tiktok 중 하나)' },
            title: { type: 'string', description: '콘텐츠 제목 또는 첫 줄 후킹' },
            body: { type: 'string', description: '본문 전체. 카드뉴스는 "1장: ..." 형식, 영상은 "0-3초: ..." 형식으로 장면 구분' },
            hashtags: { type: 'array', items: { type: 'string' }, description: '해시태그 (# 제외, 해당 채널만)' },
          },
        },
      },
    },
  },
}

const SYSTEM = `당신은 온라인 유통사의 SNS 콘텐츠 마케터입니다. 제품 정보 하나로 각 채널의 문법에 맞는 콘텐츠를 동시에 만듭니다.

규칙:
1. 채널마다 말투·길이·구조가 달라야 합니다. 아래 채널 스펙을 따르세요.
2. 제품 정보에 있는 사실만 사용하세요.
3. 바이럴을 노리되 신뢰를 깎는 낚시성 문구는 금지.
${COMPLIANCE_RULES}`

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

export async function onRequestPost(context) {
  const { request, env } = context
  const body = await readJsonBody(request)
  if (!body || !body.product?.name?.trim()) return errorJson('제품 정보를 입력해주세요.')
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

  if (!hasApiKey(env)) return json(demoResult(channels))

  const ip = clientIp(request)
  if (!(await checkRateLimit(env, `ax:content:${ip}`, 8, 3600)))
    return errorJson('요청이 너무 잦습니다. 1시간 후 다시 시도해주세요.', 429)
  if (!(await checkRateLimit(env, 'ax:content:all', 60, 3600)))
    return errorJson('데모 사용량이 많아 잠시 후 다시 시도해주세요.', 429)

  const specs = channels.map((c) => `- ${c}: ${CHANNEL_SPECS[c]}`).join('\n')
  try {
    const result = await callClaudeTool(env, {
      system: SYSTEM,
      user: `[제품 정보]\n${JSON.stringify(product, null, 2)}\n\n[요청 채널과 스펙]\n${specs}\n\n요청된 채널 각각에 대해 콘텐츠를 만들어 기록하세요.`,
      tool: TOOL,
      maxTokens: 8192,
    })
    return json({ demo: false, ...result })
  } catch (err) {
    return errorJson(err.message, 502)
  }
}
