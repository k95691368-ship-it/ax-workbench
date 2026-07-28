// 상세페이지 생성 파이프라인 — 모든 호출을 처음부터 동시에 띄운다.
//
// 어떻게 여기까지 왔나 (실측 3단계):
//   1) 기능별 계측: 상세페이지만 평균 37초·폴백률 20% (다른 기능은 7~17초·0%).
//      실측 재확인 49.7초 / 45.4초.
//   2) 단일 거대 호출을 "개요 → 섹션 병렬"로 쪼갬 → 43.9초. 겨우 10% 개선.
//   3) 단계별 시간 계측: 개요 33.2초 / 섹션 13.5초(개별 합 52.2초).
//      → 병렬화 자체는 3.9배로 완벽히 작동했다. 병목은 그 앞의 개요였고,
//         섹션들이 개요를 기다리느라 전체가 다시 직렬이 됐다.
//
// 그래서 의존성을 없앴다.
//   섹션 구조를 AI에게 매번 새로 설계시키지 않고, 검증된 5단 구성을 코드에 고정한다.
//   (문제 공감 → 해결 → 특징 → 신뢰 → 구매 안내 — 원래도 프롬프트에 "권장"으로 적어
//    사실상 이 구조가 나오고 있었다. 명시하는 대가는 작고, 얻는 건 크다.)
//   구조가 고정되면 섹션은 개요를 기다릴 이유가 없다. 헤드라인·FAQ·키워드까지
//   전부 t=0에 동시에 띄운다. 전체 시간은 "가장 느린 호출 하나"가 된다.
//
// 겹침 방지: 각 호출에 다른 섹션이 맡은 범위를 함께 준다. 서로를 못 봐도 역할을 안다.
// 부분 실패 격리: 한 섹션이 실패해도 나머지로 페이지를 완성한다.

import { callClaudeTool, failure } from './claude.js'
import { runAll, sumUsage } from './parallel.js'

// 상세페이지 5단 구성. 각 섹션의 범위가 겹치지 않도록 역할을 명확히 나눈다.
export const SECTION_BLUEPRINT = [
  {
    key: 'hook',
    role: '타깃 고객이 실제로 겪는 상황과 불편에 공감하는 도입부. 아직 제품의 특징·성분을 말하지 말고, 읽는 사람이 "내 이야기"라고 느끼게 쓴다.',
  },
  {
    key: 'solution',
    role: '그 문제에 대한 답으로 제품을 처음 소개. 이 제품이 다른 선택지와 다른 지점 한 가지를 중심으로 쓴다. 세부 스펙 나열은 다음 섹션에 맡긴다.',
  },
  {
    key: 'feature',
    role: '제품의 구체적인 특징·원료·제조 방식을 사실 위주로 설명. 입력에 있는 정보만 쓰고, 없는 수치나 인증은 지어내지 않는다.',
  },
  {
    key: 'trust',
    role: '믿고 살 수 있는 근거(원산지·제조 방식·포장 형태 등 입력에 있는 사실). 근거가 부족하면 실제 사용 상황을 구체적으로 그려 신뢰를 만든다.',
  },
  {
    key: 'guide',
    role: '구성·보관 방법·사용(섭취) 방법과 구매 전 확인 사항 안내. 과장 없이 담백하게 정리한다.',
  },
]

const SECTION_TOOL = {
  name: 'record_section',
  description: '지정된 역할을 맡은 상세페이지 섹션 하나를 제목·본문·이미지 지시까지 작성해 기록한다.',
  input_schema: {
    type: 'object',
    required: ['title', 'body', 'image_brief'],
    properties: {
      title: { type: 'string', description: '이 섹션의 제목 (한 줄, 고객의 언어로)' },
      body: { type: 'string', description: '섹션 본문 카피 (2~4문장)' },
      bullets: { type: 'array', items: { type: 'string' }, description: '요점 불릿 2~3개 (선택)' },
      image_brief: { type: 'string', description: '디자이너에게 전달할 이 섹션의 이미지 연출 지시 (한 줄)' },
    },
  },
}

const FRAME_TOOL = {
  name: 'record_detail_frame',
  description: '상세페이지의 헤드라인·FAQ·검색 키워드·디자이너 인계 메모를 기록한다. 본문 섹션은 쓰지 않는다.',
  input_schema: {
    type: 'object',
    required: ['headline', 'subheadline', 'faq', 'keywords', 'designer_notes'],
    properties: {
      headline: { type: 'string', description: '상세페이지 최상단 후킹 헤드라인 (한 줄)' },
      subheadline: { type: 'string', description: '헤드라인을 보조하는 한 줄' },
      faq: {
        type: 'array',
        description: '자주 묻는 질문 2~3개',
        items: { type: 'object', required: ['q', 'a'], properties: { q: { type: 'string' }, a: { type: 'string' } } },
      },
      keywords: { type: 'array', items: { type: 'string' }, description: '검색 노출용 핵심 키워드 5~8개' },
      designer_notes: { type: 'string', description: '디자이너 인계 메모: 전체 톤앤매너, 컬러, 강조 포인트' },
    },
  },
}

// 전체 구성표 — 모든 호출에 공통으로 붙여, 서로를 보지 못해도 역할이 겹치지 않게 한다.
function blueprintOverview() {
  return SECTION_BLUEPRINT.map((s, i) => `${i + 1}. ${s.role}`).join('\n')
}

function sectionUserContent(productBlock, index) {
  const others = SECTION_BLUEPRINT.map((s, i) => (i === index ? null : `${i + 1}. ${s.role}`))
    .filter(Boolean)
    .join('\n')

  return `[제품 정보]
${productBlock}

[상세페이지 전체 구성 — 이 중 한 섹션만 맡습니다]
${blueprintOverview()}

[다른 섹션이 맡은 범위 — 겹쳐 쓰지 마세요]
${others}

[지금 쓸 섹션: ${index + 1}번]
${SECTION_BLUEPRINT[index].role}

이 섹션의 제목·본문·이미지 연출 지시만 쓰세요. 다른 섹션이 맡은 내용은 반복하지 마세요.`
}

function frameUserContent(productBlock) {
  return `[제품 정보]
${productBlock}

[본문 섹션 구성 — 다른 작업자가 동시에 쓰고 있습니다]
${blueprintOverview()}

위 구성으로 본문이 채워진다는 전제로, 페이지 최상단 헤드라인과 FAQ·검색 키워드·디자이너 인계 메모를 작성하세요. 본문 섹션은 쓰지 마세요.`
}

const REVISE_FRAME_TOOL = {
  ...FRAME_TOOL,
  name: 'record_revised_frame',
  description: '피드백을 반영해 상세페이지의 헤드라인·FAQ·검색 키워드·디자이너 메모를 다시 작성해 기록한다.',
}

const REVISE_SECTION_TOOL = {
  ...SECTION_TOOL,
  name: 'record_revised_section',
  description: '피드백을 반영해 상세페이지 섹션 하나를 다시 작성해 기록한다.',
}

const REVISE_GUIDE = `피드백이 요구한 방향은 확실하게 반영하고, 피드백과 무관하게 잘된 부분(사실 정보·구조)은 그대로 두세요. 디자인 방향에 대한 피드백이면 이미지 연출 지시에도 반영하세요.`

// 호출당 max_tokens.
// 쪼갠 뒤 각 호출의 산출물이 작아졌다고 한도까지 같이 줄였더니, 라이브 재생성에서
// 프레임 호출이 잘려 실패했다. Opus 5는 적응형 사고 토큰도 max_tokens를 함께 쓰기 때문에
// "산출물 길이"만 보고 한도를 잡으면 안 된다. 실제 청구는 생성한 만큼만 되므로
// 한도는 넉넉히 두고, 길이 제어는 프롬프트(2~4문장 등)에 맡긴다.
const FRAME_MAX_TOKENS = 3000
const SECTION_MAX_TOKENS = 2400

const MIN_SECTIONS = 2

// 상세페이지를 한 번에 병렬로 생성한다.
// 반환: { result, usage, degraded, timing }
// system: 공통 시스템 프롬프트 (필수 표기 문구는 넣지 말라고 지시된 버전)
// systemWithRequired: 필수 표기 문구를 넣어야 하는 호출에만 쓰는 버전.
//   한 페이지를 여러 호출로 나눠 만들기 때문에, 필수 문구를 모든 호출에 요구하면
//   같은 문구가 페이지에 여러 번 박힌다. 마지막 섹션(구매 안내)에만 맡긴다 —
//   법정 표기 문구가 놓이기에도 자연스러운 자리다.
export async function generateDetail(env, { system, systemWithRequired = system, productBlock, timeoutMs = 60000 }) {
  // 프레임(헤드라인·FAQ·키워드·메모)과 섹션 5개를 t=0에 함께 띄운다.
  // 어느 것도 다른 것의 결과를 기다리지 않는다 — 그게 이 구조의 핵심이다.
  const { settled, timing } = await runAll([
    () =>
      callClaudeTool(env, {
        system,
        user: frameUserContent(productBlock),
        tool: FRAME_TOOL,
        maxTokens: FRAME_MAX_TOKENS,
        timeoutMs,
      }),
    ...SECTION_BLUEPRINT.map((_, i) => () =>
      callClaudeTool(env, {
        system: i === SECTION_BLUEPRINT.length - 1 ? systemWithRequired : system,
        user: sectionUserContent(productBlock, i),
        tool: SECTION_TOOL,
        maxTokens: SECTION_MAX_TOKENS,
        timeoutMs,
      })
    ),
  ])

  const [frameResult, ...sectionResults] = settled

  // 헤드라인이 없으면 상세페이지라고 부를 수 없다 — 프레임 실패는 강등 사유다.
  if (frameResult.status !== 'fulfilled' || typeof frameResult.value.input?.headline !== 'string') {
    throw frameResult.status === 'rejected'
      ? frameResult.reason
      : failure('contract', 'AI 응답이 불완전합니다(헤드라인 누락). 다시 시도해주세요.')
  }
  const frame = frameResult.value.input

  const sections = []
  let failed = 0

  sectionResults.forEach((r) => {
    const got = r.status === 'fulfilled' ? r.value.input : null
    if (!got || typeof got.body !== 'string' || !got.body.trim() || !String(got.title || '').trim()) {
      failed += 1
      return
    }
    sections.push({
      title: got.title.trim(),
      body: got.body.trim(),
      bullets: Array.isArray(got.bullets) ? got.bullets.filter((b) => typeof b === 'string' && b.trim()) : [],
      image_brief: String(got.image_brief || '').trim(),
    })
  })

  // 남은 섹션이 너무 적으면 상세페이지 구실을 못 한다 — 이때만 예시 결과로 강등한다.
  if (sections.length < MIN_SECTIONS) {
    throw failure('section_failed', `섹션 생성에 실패했습니다(${failed}/${SECTION_BLUEPRINT.length}). 다시 시도해주세요.`)
  }

  return {
    result: {
      headline: frame.headline,
      subheadline: frame.subheadline,
      sections,
      faq: frame.faq,
      keywords: frame.keywords,
      designer_notes: frame.designer_notes,
    },
    usage: sumUsage(settled),
    degraded: failed
      ? `섹션 ${failed}개는 생성이 지연되어 빠졌습니다. 나머지 ${sections.length}개 섹션은 정상 생성되었습니다.`
      : null,
    timing,
  }
}

// 피드백 반영(재생성)도 같은 방식으로 동시에 돌린다.
//
// 예전에는 이전 결과 전체를 한 번의 호출로 다시 쓰게 했다. 본 생성보다 입력이 길어
// 더 느렸고, 그 한 번이 실패하면 고치려던 페이지까지 통째로 잃었다.
//
// 재생성은 오히려 병렬에 더 잘 맞는다 — 각 섹션은 "자기 이전 원고 + 피드백"만 있으면
// 고쳐 쓸 수 있기 때문이다. 그리고 실패했을 때 잃을 것도 없다: 이전 원고를 그대로 두면 된다.
export async function reviseDetail(env, { system, systemWithRequired = system, productBlock, previous, feedback, timeoutMs = 60000 }) {
  const prevSections = Array.isArray(previous.sections) ? previous.sections : []
  if (prevSections.length === 0) throw failure('contract', '이전 결과에 섹션이 없어 피드백을 반영할 수 없습니다.')

  const outline = prevSections.map((s, i) => `${i + 1}. ${s.title}`).join('\n')

  const { settled, timing } = await runAll([
    () =>
      callClaudeTool(env, {
        system,
        user: `[제품 정보]
${productBlock}

[이전 결과 — 헤드라인과 부속 정보]
${JSON.stringify({
  headline: previous.headline,
  subheadline: previous.subheadline,
  faq: previous.faq,
  keywords: previous.keywords,
  designer_notes: previous.designer_notes,
})}

[본문 섹션 구성 — 다른 작업자가 동시에 고치고 있습니다]
${outline}

[사용자 피드백]
${feedback}

${REVISE_GUIDE} 본문 섹션은 쓰지 마세요.`,
        tool: REVISE_FRAME_TOOL,
        maxTokens: FRAME_MAX_TOKENS,
        timeoutMs,
      }),
    ...prevSections.map((s, i) => () =>
      callClaudeTool(env, {
        system: i === prevSections.length - 1 ? systemWithRequired : system,
        user: `[제품 정보]
${productBlock}

[상세페이지 전체 구성 — 이 중 ${i + 1}번만 맡습니다]
${outline}

[지금 고칠 섹션의 이전 원고]
${JSON.stringify(s)}

[사용자 피드백]
${feedback}

${REVISE_GUIDE} 이 섹션만 다시 쓰고, 다른 섹션이 맡은 내용은 가져오지 마세요.`,
        tool: REVISE_SECTION_TOOL,
        maxTokens: SECTION_MAX_TOKENS,
        timeoutMs,
      })
    ),
  ])

  const [frameResult, ...sectionResults] = settled

  // 프레임 재작성이 실패하면 이전 헤드라인을 그대로 쓴다 — 고치려다 잃는 것보다 낫다.
  const frameOk = frameResult.status === 'fulfilled' && typeof frameResult.value.input?.headline === 'string'
  const frame = frameOk ? frameResult.value.input : previous
  let kept = frameOk ? 0 : 1

  const sections = sectionResults.map((r, i) => {
    const got = r.status === 'fulfilled' ? r.value.input : null
    if (!got || typeof got.body !== 'string' || !got.body.trim() || !String(got.title || '').trim()) {
      // 재작성 실패 — 이전 원고를 유지한다. 예전 구조에서는 페이지 전체를 잃었다.
      kept += 1
      return prevSections[i]
    }
    return {
      title: got.title.trim(),
      body: got.body.trim(),
      bullets: Array.isArray(got.bullets) ? got.bullets.filter((b) => typeof b === 'string' && b.trim()) : [],
      image_brief: String(got.image_brief || '').trim() || prevSections[i].image_brief || '',
    }
  })

  return {
    result: {
      headline: frame.headline,
      subheadline: frame.subheadline,
      sections,
      faq: frame.faq,
      keywords: frame.keywords,
      designer_notes: frame.designer_notes,
    },
    usage: sumUsage(settled),
    degraded: kept ? `${kept}개 항목은 재작성이 지연되어 이전 내용을 그대로 두었습니다.` : null,
    timing,
  }
}
