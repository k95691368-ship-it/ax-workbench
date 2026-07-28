// 최소 기능 .xlsx 리더 — 외부 라이브러리 없이 브라우저 표준만 사용한다.
// xlsx는 XML 파일들을 담은 ZIP이므로, ZIP 목차를 직접 읽고 DecompressionStream으로 풀어서
// 첫 번째 시트를 문자열 행렬(string[][])로 돌려준다. 서식·수식은 다루지 않는다(값만 읽음).
//
// 왜 직접 구현했나: 표 업로드 하나 때문에 수백 KB짜리 스프레드시트 라이브러리를 번들에 넣으면
// 페이지 로딩이 느려진다. 읽기 전용, 첫 시트, 값만 — 필요한 범위가 좁아 자체 구현이 더 가볍다.

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50

function findEocd(view, len) {
  // 주석(comment)이 붙어 있을 수 있어 뒤에서부터 최대 64KB 범위를 훑는다
  const min = Math.max(0, len - 66_000)
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i
  }
  return -1
}

async function inflate(bytes, method) {
  if (method === 0) return bytes // 무압축 저장
  if (method !== 8) throw new Error('지원하지 않는 압축 방식의 엑셀 파일입니다.')
  if (typeof DecompressionStream === 'undefined')
    throw new Error('이 브라우저에서는 엑셀 파일을 열 수 없습니다. CSV로 저장해 올려주세요.')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ZIP 안의 파일들을 { 경로: Uint8Array } 로 읽는다.
async function readZipEntries(buffer, wanted) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(view, bytes.length)
  if (eocd < 0) throw new Error('엑셀 파일 형식이 아닙니다. .xlsx 또는 CSV 파일을 올려주세요.')

  const count = view.getUint16(eocd + 10, true)
  let ptr = view.getUint32(eocd + 16, true)
  const out = {}

  for (let i = 0; i < count; i++) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== SIG_CENTRAL) break
    const method = view.getUint16(ptr + 10, true)
    const compSize = view.getUint32(ptr + 20, true)
    const nameLen = view.getUint16(ptr + 28, true)
    const extraLen = view.getUint16(ptr + 30, true)
    const commentLen = view.getUint16(ptr + 32, true)
    const localAt = view.getUint32(ptr + 42, true)
    const name = new TextDecoder('utf-8').decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))

    if (wanted(name)) {
      // 로컬 헤더의 이름·extra 길이는 중앙 목차와 다를 수 있으므로 다시 읽는다
      const lNameLen = view.getUint16(localAt + 26, true)
      const lExtraLen = view.getUint16(localAt + 28, true)
      const start = localAt + 30 + lNameLen + lExtraLen
      out[name] = await inflate(bytes.subarray(start, start + compSize), method)
    }
    ptr += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, code) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return Number.isFinite(num) ? String.fromCodePoint(num) : m
    }
    return ENTITIES[code] ?? m
  })
}

const textOf = (xml) =>
  [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join('')

// 공유 문자열 테이블 — 셀이 t="s"면 이 배열의 인덱스를 가리킨다
function parseSharedStrings(xml) {
  const out = []
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    out.push(m[1] ? textOf(m[1]) : '')
  }
  return out
}

// "BC12" → 열 인덱스(0부터)
function colIndex(ref) {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

function parseSheet(xml, shared) {
  const rows = []
  for (const rowM of xml.matchAll(/<row(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = []
    for (const cM of (rowM[1] || '').matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cM[1] || ''
      const inner = cM[2] || ''
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]
      const type = /t="([^"]+)"/.exec(attrs)?.[1]
      let value = ''
      if (type === 'inlineStr') {
        value = textOf(inner)
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        if (raw != null) {
          value = type === 's' ? (shared[Number(raw)] ?? '') : decodeEntities(raw)
        }
      }
      const idx = ref ? colIndex(ref) : cells.length
      while (cells.length < idx) cells.push('')
      cells[idx] = value
    }
    // 완전히 빈 행은 버린다 (CSV 파서와 같은 규칙)
    if (cells.some((c) => String(c).trim() !== '')) rows.push(cells)
  }
  return rows
}

// .xlsx(ArrayBuffer) → 첫 번째 시트의 문자열 행렬
export async function readXlsxRows(buffer) {
  const files = await readZipEntries(
    buffer,
    (name) => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  )
  const decoder = new TextDecoder('utf-8')
  const sheetName = Object.keys(files)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))[0]
  if (!sheetName) throw new Error('엑셀 파일에서 시트를 찾지 못했습니다.')

  const shared = files['xl/sharedStrings.xml']
    ? parseSharedStrings(decoder.decode(files['xl/sharedStrings.xml']))
    : []
  const rows = parseSheet(decoder.decode(files[sheetName]), shared)
  if (rows.length === 0) throw new Error('엑셀 첫 번째 시트에 내용이 없습니다.')
  return rows
}

// 파일 앞 2바이트가 "PK"면 ZIP(=xlsx)이다. 확장자를 못 믿을 때 쓰는 판별.
export function looksLikeZip(buffer) {
  const b = new Uint8Array(buffer)
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b
}
