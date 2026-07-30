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

  const doFetch = ({ effort = 'medium' } = {}) =>
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
        // (타임아웃 후 재시도에서는 low로 더 낮춰 응답 시간을 줄인다)
        output_config: { effort },
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
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    if (!timedOut) throw failure('network', err?.message || 'AI 서비스에 연결하지 못했습니다.')

    // 실측된 실패의 대부분은 과부하가 아니라 "긴 생성"이었다.
    // 예시 결과로 강등하기 전에, 사고 강도를 낮춰(effort low) 한 번 더 시도한다 —
    // 품질은 조금 내려가도 라이브 결과를 지키는 편이 사용자에게 이롭다.
    try {
      res = await doFetch({ effort: 'low' })
    } catch {
      throw failure('timeout', 'AI 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.')
    }
  }

  if (!res.ok) {
    throw failure(
      res.status === 429 ? 'rate_limited' : `http_${res.status}`,
      `AI 서비스가 혼잡합니다 (${res.status}). 잠시 후 다시 시도해주세요.`
    )
  }

  const data = await res.json()
  const usage = data.usage
    ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens }
    : null

  // 응답이 왔다면 토큰은 이미 청구됐다. 결과를 못 쓰더라도 계측에는 남겨야
  // 예산 상한이 "실제 지출"로 막는다는 전제가 유지된다.
  const reject = (code, message) => {
    const err = failure(code, message)
    err.usage = usage
    return err
  }

  // max_tokens로 잘린 tool 입력은 불완전한 JSON일 수 있으므로 toolUse 존재 여부와 무관하게 거부한다.
  if (data.stop_reason === 'max_tokens') {
    throw reject('max_tokens', 'AI 응답이 너무 길어 중단되었습니다. 입력을 줄여 다시 시도해주세요.')
  }
  // 안전 분류기가 요청을 거절하면 오류가 아니라 HTTP 200에 stop_reason='refusal'로 온다.
  // 따로 잡지 않으면 tool_use가 없다는 이유로 no_tool_use로 기록되어 계측에 **틀린 사유**가 남는다.
  // 건강기능식품 표시광고를 다루는 서비스라 실제로 일어날 수 있는 경로다.
  // stop_details는 null일 수 있으므로 판단은 항상 stop_reason으로 한다.
  if (data.stop_reason === 'refusal') {
    const category = data.stop_details?.category
    throw reject(
      category ? `refusal_${category}` : 'refusal',
      'AI가 이 요청의 생성을 거절했습니다. 입력 문구를 바꿔 다시 시도해주세요.'
    )
  }
  const toolUse = Array.isArray(data.content)
    ? data.content.find((block) => block.type === 'tool_use')
    : null
  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    throw reject('no_tool_use', 'AI 응답에서 결과를 찾을 수 없습니다. 잠시 후 다시 시도해주세요.')
  }
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
