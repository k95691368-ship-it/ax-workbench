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
    // 단서 앞에 절 경계가 있으면 다른 절의 부정이므로 인정하지 않는다
    if (at !== -1 && !hasClauseBreak(after.slice(0, at))) return true
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

// index 위치가 "거절·불가 안내" 절 안에 있는지 판정한다.
// 절은 문장부호로 끊고, 그 절 안에 거절 표현이 있으면 참으로 본다.
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
  const clause = source.slice(start, end)
  return DISCLAIMER_CLAUSES.some((c) => clause.includes(c))
}
