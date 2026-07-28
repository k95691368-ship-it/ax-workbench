const MODEL = 'claude-opus-5'

// 실패를 사유 코드와 함께 던진다 — 텔레메트리에 "왜 실패했는지"를 남기기 위해서다.
// 사유가 없으면 폴백 건수만 쌓이고, 무엇을 고쳐야 하는지는 사람이 손으로 찾아야 한다.
export function failure(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

export function failureCode(err) {
  return err?.code || 'unknown'
}

export function hasApiKey(env) {
  return Boolean(env.CLAUDE_API_KEY)
}

// tool 강제 호출로 구조화된 JSON을 받는 공용 헬퍼.
// 반환값: { input: tool_use 블록의 input 객체, usage: 토큰 사용량 }
// timeoutMs: 생성 분량이 많은 기능(상세페이지·채널 콘텐츠)은 더 길게 잡는다.
// Opus 5는 적응형 사고 토큰까지 생성하므로 긴 산출물은 40초를 넘길 수 있고,
// 그때 예시 결과로 강등되면 정작 핵심 기능이 라이브로 보이지 않는다.
export async function callClaudeTool(env, { system, user, tool, maxTokens = 4096, timeoutMs = 40000 }) {
  const apiKey = env.CLAUDE_API_KEY
  if (!apiKey) throw new Error('CLAUDE_API_KEY가 설정되지 않았습니다.')

  const doFetch = () =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      // 외부 API 지연이 Functions 실행 한도까지 매달리지 않게 타임아웃을 건다
      // (Cloudflare 엣지 자체 한도는 약 100초라 그보다 넉넉히 아래로 둔다)
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        // Opus 5는 적응형 사고가 기본 활성이라 사고 토큰이 max_tokens를 함께 소비한다.
        // 구조화 JSON 생성은 정형 작업이므로 effort를 medium으로 낮춰 지연·비용을 억제한다.
        output_config: { effort: 'medium' },
        system,
        messages: [{ role: 'user', content: user }],
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
      }),
    })

  let res
  try {
    res = await doFetch()
    // 일시적 과부하(429/529/5xx)는 짧게 기다렸다 1회 재시도
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500))
      res = await doFetch()
    }
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw failure('timeout', 'AI 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.')
    }
    throw failure('network', err?.message || 'AI 서비스에 연결하지 못했습니다.')
  }

  if (!res.ok) {
    throw failure(
      res.status === 429 ? 'rate_limited' : `http_${res.status}`,
      `AI 서비스가 혼잡합니다 (${res.status}). 잠시 후 다시 시도해주세요.`
    )
  }

  const data = await res.json()
  // max_tokens로 잘린 tool 입력은 불완전한 JSON일 수 있으므로 toolUse 존재 여부와 무관하게 거부한다.
  if (data.stop_reason === 'max_tokens') {
    throw failure('max_tokens', 'AI 응답이 너무 길어 중단되었습니다. 입력을 줄여 다시 시도해주세요.')
  }
  const toolUse = Array.isArray(data.content)
    ? data.content.find((block) => block.type === 'tool_use')
    : null
  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    throw failure('no_tool_use', 'AI 응답에서 결과를 찾을 수 없습니다. 잠시 후 다시 시도해주세요.')
  }
  const usage = data.usage
    ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens }
    : null
  return { input: toolUse.input, usage }
}

// live 응답이 프론트가 기대하는 계약(필수 배열/문자열)을 지키는지 검증한다.
// tool_choice 강제로도 스키마 준수가 보장되지 않으므로, 어긴 응답은 502로 돌려보낸다.
export function ensureContract(input, { arrays = [], strings = [] } = {}) {
  for (const key of arrays) {
    if (!Array.isArray(input[key])) {
      throw failure('contract', `AI 응답이 불완전합니다(${key} 누락). 다시 시도해주세요.`)
    }
  }
  for (const key of strings) {
    if (typeof input[key] !== 'string' || !input[key].trim()) {
      throw failure('contract', `AI 응답이 불완전합니다(${key} 누락). 다시 시도해주세요.`)
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
