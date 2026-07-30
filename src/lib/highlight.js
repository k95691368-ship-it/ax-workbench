// 금칙어 스캔 결과를 하이라이트 구간으로 쪼갠다.
//
// 화면(JSX)과 분리해 둔 이유: 이 계산이 한 번 틀린 적이 있어서다.
// f.word(정규화된 표준 표기) 길이로 구간을 잡으면 원문 span과 어긋난다 —
// 우회 표기("치 료")는 일부만 칠해지고, 반대로 길면 다음 글자를 침범하며
// cursor가 앞서 나가 뒤따르는 위반이 아예 표시되지 않았다.
// 표에는 위반이 있는데 본문에는 어디도 표시되지 않는 상태가 됐다.
// 순수 함수로 두면 테스트로 고정할 수 있다.
export function highlightSegments(text, findings) {
  const src = String(text ?? '')
  const segments = []
  let cursor = 0
  for (const f of findings || []) {
    // 원문 기준 길이를 쓴다 (없으면 실제 매치 문자열, 최후에 표준 표기)
    const len = f.length ?? f.matchedText?.length ?? f.word?.length ?? 0
    if (!len || f.index < cursor) continue
    if (f.index > cursor) segments.push({ text: src.slice(cursor, f.index) })
    segments.push({ text: src.slice(f.index, f.index + len), severity: f.severity })
    cursor = f.index + len
  }
  if (cursor < src.length) segments.push({ text: src.slice(cursor) })
  return segments
}
