// 부정 문맥 인식 — 규칙 검출의 "오탐"을 걷어내는 공용 판정기.
//
// 왜 필요한가:
//  - 에스컬레이션: "부작용 없었어요", "벌레 하나 없이 깨끗해요"는 칭찬인데도
//    키워드만 보면 담당자 확인으로 올라간다. 안전망이 칭찬으로 가득 차면
//    담당자가 큐 자체를 신뢰하지 않게 되고, 결국 진짜 위험 건을 놓친다.
//  - 금칙어 점검: "치료 효과는 안내드릴 수 없습니다"처럼 **규정을 지키려고 쓴 문장**이
//    위반으로 잡힌다. 담당자가 이걸 고치면 오히려 규정을 어기는 방향으로 간다.
//
// 설계 원칙 — 안전한 쪽으로만 좁게 판정한다:
//  1) 부정 단서가 키워드에 "붙어 있을 때"만 인정한다(짧은 창). 멀리 떨어진 부정은
//     다른 절의 이야기일 수 있어 무시한다. 예: "치료 효과가 뛰어나며 부작용도 없습니다"
//     → '치료'는 여전히 위반.
//  2) 절 경계(마침표·쉼표·접속)를 넘어서면 부정으로 보지 않는다.

// 키워드 뒤에 붙어 부정을 만드는 단서
const AFTER_CUES = ['없', '않', '아니', '아닙', '불가', '무관', '전혀']

// **서술어 부정**은 키워드 부정이 아니다 — 오히려 증상이 계속된다는 뜻이다.
//
//   "부작용 없었어요"      → 키워드(부작용) 자체가 없다  → 완화해야 한다
//   "설사가 멈추지 않아요"  → 멈추는 것이 없다 = 설사가 계속된다 → 절대 완화하면 안 된다
//
// 둘 다 단서('없'·'않')가 키워드 뒤 8글자 안에 있어서, 창만 보는 판정으로는 구별되지 않았다.
// 실제로 "설사가 멈추지 않아요"·"복통이 가라앉지 않아요"·"구토가 멈추지 않습니다"가
// 모두 escalate=false로 빠져, 증상이 지속된다고 호소한 고객에게 자동 응대가 나갈 수 있었다.
//
// 구별 기준은 어미다: 단서 바로 앞이 '-지'(멈추지·가라앉지·낫지·사라지지)면 그 부정은
// 키워드가 아니라 **서술어**에 걸린 것이다.
const PREDICATE_NEGATION = /지\s*$/

// 단서 자체가 다시 부정된 경우 — 이중부정이므로 완화가 아니다.
//   "어지럼증이 없어지지 않아요"
// 여기서 '없'은 키워드가 없다는 뜻이 아니라 동사 '없어지다'의 일부이고, 그 동사가 '않'으로
// 부정됐다. 즉 "없어지지 않는다 = 계속된다". 단서 뒤에 '-지 않/-지 못'이 이어지면 완화하지 않는다.
const CUE_ITSELF_NEGATED = /^.{0,6}?지\s*(?:않|못)/

// 키워드 앞에 붙는 부정 부사 ("안 갔어요", "못 먹었어요").
//
// 반드시 **독립된 낱말**이어야 한다. 예전에는 맨 '안'·'못'도 단서로 인정했는데,
// 그러면 앞 단어의 끝 글자가 우연히 안/못이기만 해도 부정으로 오판한다.
// 에스컬레이션에서 오판은 "진짜 항의를 자동 응답으로 내보내는" 방향이라, 안전 게이트를
// 약화시키는 규칙은 두지 않는다.
const BEFORE_ADVERB = /(?:^|\s)(?:안|못)\s*$/
// 키워드 뒤에 오는 부정 부사 ("곰팡이 안 생기고") — 한국어는 부사가 서술어 앞에 붙으므로
// 목적어가 먼저 오는 어순에서는 부정이 키워드 "뒤"에 온다.
// '안내'·'안전'처럼 '안'으로 시작하는 다른 단어와 섞이지 않도록 앞뒤 공백을 요구한다.
const ADVERB_AFTER = /(?:^|\s)(?:안|못)\s/
// 절 경계 — 여기를 넘어간 부정 단서는 다른 이야기로 본다
const CLAUSE_BREAKS = ['.', '!', '?', '\n', ',', ';', '·', '…', '"', "'"]

// 키워드 뒤쪽으로 몇 글자까지 부정 단서를 인정할지.
// "벌레 하나 없이"(+6), "부작용 없었어요"(+1)는 잡히고,
// 한 문장 건너뛴 부정은 잡히지 않는 폭이다.
const AFTER_WINDOW = 8
const BEFORE_WINDOW = 3

function hasClauseBreak(segment) {
  return [...segment].some((ch) => CLAUSE_BREAKS.includes(ch))
}

// text의 [index, index+length) 위치에 있는 검출이 부정 문맥인지 판정한다.
export function isNegated(text, index, length) {
  const source = String(text || '')
  const after = source.slice(index + length, index + length + AFTER_WINDOW)
  for (const cue of AFTER_CUES) {
    const at = after.indexOf(cue)
    if (at === -1) continue
    const gap = after.slice(0, at)
    // 단서 앞에 절 경계가 있으면 다른 절의 부정이므로 인정하지 않는다
    if (hasClauseBreak(gap)) continue
    // 서술어에 걸린 부정("멈추지 않아요")은 키워드 부정이 아니라 증상 지속을 뜻한다
    if (PREDICATE_NEGATION.test(gap)) continue
    // 단서가 다시 부정된 이중부정("없어지지 않아요")도 증상 지속이다.
    // 창(8글자)을 넘어갈 수 있으므로 원문에서 단서 뒤를 본다.
    const afterCue = source.slice(index + length + at + cue.length, index + length + at + cue.length + 10)
    if (CUE_ITSELF_NEGATED.test(afterCue)) continue
    return true
  }

  const adverb = ADVERB_AFTER.exec(after)
  if (adverb && !hasClauseBreak(after.slice(0, adverb.index))) return true

  const before = source.slice(Math.max(0, index - BEFORE_WINDOW), index)
  return BEFORE_ADVERB.test(before)
}

// "안내드릴 수 없습니다" 류 — 규정을 지키려고 쓰는 거절·불가 안내 문장.
// 이런 절 안에서는 금칙어가 나와도 그것을 광고하는 게 아니라 "할 수 없다"고 말하는 것이다.
export const DISCLAIMER_CLAUSES = [
  '안내드릴 수 없',
  '안내해 드릴 수 없',
  '말씀드릴 수 없',
  '말씀드리기 어렵',
  '답변드릴 수 없',
  '답변드리기 어렵',
  '표방할 수 없',
  '광고할 수 없',
  '드릴 수 없는 점',
  '확인해 드리기 어렵',
  '해당하지 않습니다',
  '보장하지 않습니다',
  '효과를 약속드릴 수 없',
]

// 거절 표현과 금칙어가 "같은 서술" 안에 있다고 볼 수 있는 최대 거리(글자).
//
// 예전에는 문장부호로만 절을 끊고 그 구간 전체를 면제했다. 한국어는 '-지만/-이며/다만'으로
// 문장부호 없이 절을 이으므로, 문장 끝에 완충 문구 하나만 붙이면 문장 앞부분의 진짜 위반까지
// 전부 지워졌다. 실제로 이런 문장이 0건으로 통과했다:
//   "이 제품은 당뇨를 치료합니다 다만 개인차가 있어 효과를 약속드릴 수 없습니다"
//   "아토피와 변비 치료에 탁월하며 자세한 상담은 답변드리기 어렵습니다"
// 같은 문장에 마침표만 넣으면 정상 검출됐다 — 즉 문장부호를 빼는 것만으로 사전점검이
// 우회됐다. 면제는 "치료 효과는 안내드릴 수 없습니다"처럼 거절이 그 금칙어에 직접 붙은
// 경우만 인정해야 한다.
const DISCLAIMER_NEAR = 30

// 금칙어와 거절 표현 사이에 **다른 서술어가 끝났는지**를 본다.
//
// 거리만으로는 가를 수 없다. 실측해보면 우회 문장이 정당한 문장보다 오히려 가깝다:
//   정당: "질병 치료나 예방 효과에 대해서는 안내드릴 수 없는" → '질병'에서 거절까지 19자
//   우회: "당뇨를 치료합니다 다만 … 효과를 약속드릴 수 없습니다" → '치료'에서 거절까지 17자
// 실제 차이는 우회 문장에는 사이에 '치료합니다'라는 **완결된 서술**과 '다만'이라는 새 절
// 시작이 있다는 점이다. 서술이 한 번 끝났으면 그 뒤의 거절은 앞의 주장을 취소하지 못한다.
const INTERVENING_PREDICATE = /니다|습니다|어요|아요|예요|네요|지요|죠|다만|하지만|그러나|그런데|지만|며\s/

// index 위치의 금칙어가 "거절·불가 안내"에 직접 걸려 있는지 판정한다.
// 절 안에 거절 표현이 있는 것만으로는 부족하고, 그 표현이 금칙어에서 DISCLAIMER_NEAR
// 글자 안에 있어야 한다. 절 경계는 여전히 넘지 않는다.
export function inDisclaimerClause(text, index) {
  const source = String(text || '')
  let start = 0
  for (let i = index - 1; i >= 0; i--) {
    if (CLAUSE_BREAKS.includes(source[i])) {
      start = i + 1
      break
    }
  }
  let end = source.length
  for (let i = index; i < source.length; i++) {
    if (CLAUSE_BREAKS.includes(source[i])) {
      end = i
      break
    }
  }

  // 절 안에서, 금칙어 위치 기준으로 앞뒤 DISCLAIMER_NEAR 글자만 본다
  const from = Math.max(start, index - DISCLAIMER_NEAR)
  const to = Math.min(end, index + DISCLAIMER_NEAR)
  const near = source.slice(from, to)

  return DISCLAIMER_CLAUSES.some((c) => {
    const at = near.indexOf(c)
    if (at === -1) return false
    // 금칙어와 거절 표현 사이에 다른 서술이 끝났으면, 그 거절은 이 금칙어를 취소하지 못한다
    const here = index - from
    const between = at > here ? near.slice(here, at) : near.slice(at + c.length, here)
    return !INTERVENING_PREDICATE.test(between)
  })
}
