// 상세페이지 생성 파이프라인 — 단일 거대 호출을 "개요 → 섹션 병렬"로 쪼갠다.
//
// 왜 바꿨나 (실측 근거):
//   기능별 계측에서 상세페이지만 평균 37초, 폴백률 20%로 다른 기능(7~17초, 0%)과 달랐다.
//   원인은 구조였다 — 헤드라인·섹션 4~6개·FAQ·키워드·디자이너 메모를 **한 번의 호출로**
//   순차 생성하니 출력 토큰이 쌓이는 만큼 시간이 늘고, 그 한 번이 늦으면 페이지 전체가
//   예시 결과로 강등됐다. 즉 지연과 실패가 같은 원인에서 나왔다.
//
// 바뀐 구조:
//   1단계 — 개요 1회: 헤드라인·섹션 계획(제목/역할/이미지 지시)·FAQ·키워드·디자이너 메모.
//           출력이 짧아 빠르다.
//   2단계 — 섹션 본문을 **동시에** 생성. 전체 시간은 합이 아니라 "가장 느린 한 섹션"이 된다.
//
// 부수 효과가 더 크다: 한 섹션이 실패해도 나머지는 살아남는다.
// 예전에는 한 번의 지연이 페이지 전체를 예시로 떨어뜨렸지만, 이제는 그 섹션만 잃는다.

import { callClaudeTool, failure } from './claude.js'

const OUTLINE_TOOL = {
  name: 'record_detail_outline',
  description: '상세페이지의 전체 뼈대(헤드라인·섹션 계획·FAQ·키워드·디자이너 메모)를 기록한다. 섹션 본문은 쓰지 않는다.',
  input_schema: {
    type: 'object',
    required: ['headline', 'subheadline', 'section_plan', 'faq', 'keywords', 'designer_notes'],
    properties: {
      headline: { type: 'string', description: '상세페이지 최상단 후킹 헤드라인 (한 줄)' },
      subheadline: { type: 'string', description: '헤드라인을 보조하는 한 줄' },
      section_plan: {
        type: 'array',
        description:
          '본문 섹션 계획 4~5개. 문제 공감 → 해결(제품) → 핵심 특징 → 신뢰 요소 → 구매 안내 순서. 각 섹션의 역할이 겹치지 않게 나눈다.',
        items: {
          type: 'object',
          required: ['title', 'role', 'image_brief'],
          properties: {
            title: { type: 'string', description: '섹션 제목' },
            role: {
              type: 'string',
              description: '이 섹션이 맡을 내용 범위를 한 줄로. 다른 섹션과 겹치지 않게 구체적으로.',
            },
            image_brief: { type: 'string', description: '디자이너에게 전달할 이 섹션의 이미지 연출 지시 (한 줄)' },
          },
        },
      },
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

const SECTION_TOOL = {
  name: 'record_section_body',
  description: '지정된 상세페이지 섹션 하나의 본문 카피를 작성해 기록한다.',
  input_schema: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string', description: '섹션 본문 카피 (2~4문장)' },
      bullets: { type: 'array', items: { type: 'string' }, description: '요점 불릿 2~3개 (선택)' },
    },
  },
}

// 섹션 본문 호출에 넘길 맥락.
// 다른 섹션의 제목·역할을 함께 주어, 병렬로 써도 내용이 겹치지 않게 한다.
function sectionUserContent(productBlock, outline, index) {
  const me = outline.section_plan[index]
  const others = outline.section_plan
    .map((s, i) => (i === index ? null : `- ${s.title}: ${s.role}`))
    .filter(Boolean)
    .join('\n')

  return `[제품 정보]
${productBlock}

[상세페이지 전체 방향]
헤드라인: ${outline.headline}
보조 문구: ${outline.subheadline}
톤앤매너: ${outline.designer_notes}

[다른 섹션이 이미 맡은 내용 — 겹쳐 쓰지 마세요]
${others || '(없음)'}

[지금 쓸 섹션]
제목: ${me.title}
이 섹션이 맡은 범위: ${me.role}

이 섹션의 본문만 쓰세요. 제목은 다시 쓰지 말고, 다른 섹션이 맡은 내용은 반복하지 마세요.`
}

const MIN_SECTIONS = 2

// 상세페이지를 2단계로 생성한다.
// 반환: { result, usage, degraded } — degraded는 일부 섹션이 실패해 빠졌을 때의 안내 문구.
export async function generateDetail(env, { system, productBlock, outlineTimeoutMs = 55000, sectionTimeoutMs = 40000 }) {
  const t0 = Date.now()
  const { input: outline, usage: outlineUsage } = await callClaudeTool(env, {
    system,
    user: `[제품 정보]\n${productBlock}\n\n이 제품의 상세페이지 뼈대를 설계하세요. 섹션 본문은 쓰지 말고 계획만 세우세요.`,
    tool: OUTLINE_TOOL,
    maxTokens: 2048,
    timeoutMs: outlineTimeoutMs,
  })

  const plan = Array.isArray(outline.section_plan)
    ? outline.section_plan.filter((s) => s && typeof s.title === 'string' && s.title.trim())
    : []
  if (plan.length === 0) throw failure('contract', 'AI 응답이 불완전합니다(섹션 계획 누락). 다시 시도해주세요.')
  outline.section_plan = plan

  const outlineMs = Date.now() - t0
  const t1 = Date.now()

  // 섹션 본문을 동시에 생성한다 — 전체 시간이 "합"이 아니라 "가장 느린 하나"가 된다.
  // 한 섹션이 실패해도 페이지 전체를 버리지 않는다(예전 구조에서는 그랬다).
  // 각 호출의 개별 소요시간도 재둔다: 합계와 최대값이 비슷하다면 병렬이 실제로는
  // 직렬로 돌고 있다는 뜻이고, 그건 구조가 아니라 실행 환경의 문제다.
  const sectionMs = new Array(plan.length).fill(0)
  const settled = await Promise.allSettled(
    plan.map((_, i) => {
      const s = Date.now()
      return callClaudeTool(env, {
        system,
        user: sectionUserContent(productBlock, outline, i),
        tool: SECTION_TOOL,
        maxTokens: 1024,
        timeoutMs: sectionTimeoutMs,
      }).finally(() => {
        sectionMs[i] = Date.now() - s
      })
    })
  )

  const sectionsMs = Date.now() - t1

  const sections = []
  let sectionUsage = { input_tokens: 0, output_tokens: 0 }
  let failed = 0

  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled' || typeof r.value.input?.body !== 'string' || !r.value.input.body.trim()) {
      failed += 1
      return
    }
    const { body, bullets } = r.value.input
    sections.push({
      title: plan[i].title,
      body: body.trim(),
      bullets: Array.isArray(bullets) ? bullets.filter((b) => typeof b === 'string' && b.trim()) : [],
      image_brief: plan[i].image_brief || '',
    })
    if (r.value.usage) {
      sectionUsage = {
        input_tokens: sectionUsage.input_tokens + (r.value.usage.input_tokens || 0),
        output_tokens: sectionUsage.output_tokens + (r.value.usage.output_tokens || 0),
      }
    }
  })

  // 남은 섹션이 너무 적으면 상세페이지 구실을 못 한다 — 이때만 예시 결과로 강등한다.
  if (sections.length < MIN_SECTIONS) {
    throw failure('section_failed', `섹션 생성에 실패했습니다(${failed}/${plan.length}). 다시 시도해주세요.`)
  }

  return {
    result: {
      headline: outline.headline,
      subheadline: outline.subheadline,
      sections,
      faq: outline.faq,
      keywords: outline.keywords,
      designer_notes: outline.designer_notes,
    },
    usage: {
      input_tokens: (outlineUsage?.input_tokens || 0) + sectionUsage.input_tokens,
      output_tokens: (outlineUsage?.output_tokens || 0) + sectionUsage.output_tokens,
    },
    degraded: failed
      ? `섹션 ${failed}개는 생성이 지연되어 빠졌습니다. 나머지 ${sections.length}개 섹션은 정상 생성되었습니다.`
      : null,
    timing: {
      outline_ms: outlineMs,
      sections_ms: sectionsMs,
      section_max_ms: Math.max(0, ...sectionMs),
      section_sum_ms: sectionMs.reduce((a, b) => a + b, 0),
      section_count: plan.length,
    },
  }
}
