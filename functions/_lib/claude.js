const MODEL = 'claude-opus-4-8'

export function hasApiKey(env) {
  return Boolean(env.CLAUDE_API_KEY)
}

// tool 강제 호출로 구조화된 JSON을 받는 공용 헬퍼.
// 반환값: tool_use 블록의 input 객체.
export async function callClaudeTool(env, { system, user, tool, maxTokens = 4096 }) {
  const apiKey = env.CLAUDE_API_KEY
  if (!apiKey) throw new Error('CLAUDE_API_KEY가 설정되지 않았습니다.')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const data = await res.json()
  // max_tokens로 잘린 tool 입력은 불완전한 JSON일 수 있으므로 toolUse 존재 여부와 무관하게 거부한다.
  if (data.stop_reason === 'max_tokens') {
    throw new Error('AI 응답이 너무 길어 중단되었습니다. 입력을 줄여 다시 시도해주세요.')
  }
  const toolUse = Array.isArray(data.content)
    ? data.content.find((block) => block.type === 'tool_use')
    : null
  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    throw new Error('AI 응답에서 결과를 찾을 수 없습니다. 잠시 후 다시 시도해주세요.')
  }
  return toolUse.input
}

// live 응답이 프론트가 기대하는 계약(필수 배열/문자열)을 지키는지 검증한다.
// tool_choice 강제로도 스키마 준수가 보장되지 않으므로, 어긴 응답은 502로 돌려보낸다.
export function ensureContract(input, { arrays = [], strings = [] } = {}) {
  for (const key of arrays) {
    if (!Array.isArray(input[key])) {
      throw new Error(`AI 응답이 불완전합니다(${key} 누락). 다시 시도해주세요.`)
    }
  }
  for (const key of strings) {
    if (typeof input[key] !== 'string' || !input[key].trim()) {
      throw new Error(`AI 응답이 불완전합니다(${key} 누락). 다시 시도해주세요.`)
    }
  }
  return input
}

// 공용 표시광고 안전 규칙 — 모든 생성 프롬프트에 포함
export const COMPLIANCE_RULES = `[표시광고 안전 규칙 — 반드시 지킬 것]
- 질병의 예방·치료 효능을 표방하는 표현 금지 (예: 치료, 완치, 예방, 항암, 혈압을 낮춘다)
- 의약품으로 오인할 수 있는 표현 금지 (예: 약효, 처방, 천연 항생제)
- 근거 없는 최상급·단정 표현 금지 (예: 최고, 1위, 100% 효과, 즉시 효과)
- 신체 변화를 단정하는 표현 금지 (예: 살이 빠진다, 독소 배출, 디톡스)
- 건강기능식품은 기능성 원료의 고시된 기능성 문구 범위 안에서만 서술 (예: "유산균 증식 및 유해균 억제에 도움을 줄 수 있음")`
