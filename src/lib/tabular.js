// 표 파일 읽기 통로 — 엑셀(.xlsx)과 CSV를 같은 결과(문자열 행렬)로 돌려준다.
// 실무자는 파일 형식을 신경 쓸 필요 없이 쓰던 파일을 그대로 올리면 된다.
import { decodeCsvBuffer, parseCsv } from './csv.js'
import { readXlsxRows, looksLikeZip } from './xlsx.js'

export const TABULAR_ACCEPT = '.xlsx,.csv,.txt,text/csv'

export async function readTabularFile(file) {
  const buffer = await file.arrayBuffer()
  const name = String(file?.name || '').toLowerCase()

  // 확장자보다 실제 내용(ZIP 시그니처)을 우선한다 — 이름만 .csv인 엑셀 파일도 열린다
  if (looksLikeZip(buffer)) {
    if (name.endsWith('.numbers') || name.endsWith('.ods'))
      throw new Error('이 형식은 지원하지 않습니다. 엑셀(.xlsx)이나 CSV로 저장해 올려주세요.')
    return readXlsxRows(buffer)
  }
  if (name.endsWith('.xls'))
    throw new Error('구형 .xls 형식은 지원하지 않습니다. 엑셀에서 .xlsx 또는 CSV로 저장해 올려주세요.')

  // CSV/텍스트 — 한국 엑셀 기본 저장(CP949)과 UTF-8을 자동 판별
  return parseCsv(decodeCsvBuffer(buffer))
}
