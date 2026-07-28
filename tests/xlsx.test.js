import { describe, it, expect } from 'vitest'
import { readXlsxRows, looksLikeZip } from '../src/lib/xlsx.js'

// 테스트용 최소 ZIP 생성기 (무압축/압축 두 방식 모두 만든다)
async function makeZip(files, { compress = false } = {}) {
  const enc = new TextEncoder()
  const chunks = []
  const central = []
  let offset = 0

  for (const f of files) {
    const name = enc.encode(f.name)
    const raw = enc.encode(f.data)
    let data = raw
    let method = 0
    if (compress) {
      const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      data = new Uint8Array(await new Response(stream).arrayBuffer())
      method = 8
    }
    const local = new Uint8Array(30 + name.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(8, method, true)
    dv.setUint32(18, data.length, true)
    dv.setUint32(22, raw.length, true)
    dv.setUint16(26, name.length, true)
    local.set(name, 30)
    chunks.push(local, data)
    central.push({ name, method, size: data.length, raw: raw.length, offset })
    offset += local.length + data.length
  }

  const cdStart = offset
  for (const c of central) {
    const h = new Uint8Array(46 + c.name.length)
    const dv = new DataView(h.buffer)
    dv.setUint32(0, 0x02014b50, true)
    dv.setUint16(10, c.method, true)
    dv.setUint32(20, c.size, true)
    dv.setUint32(24, c.raw, true)
    dv.setUint16(28, c.name.length, true)
    dv.setUint32(42, c.offset, true)
    h.set(c.name, 46)
    chunks.push(h)
    offset += h.length
  }

  const eocd = new Uint8Array(22)
  const dv = new DataView(eocd.buffer)
  dv.setUint32(0, 0x06054b50, true)
  dv.setUint16(8, central.length, true)
  dv.setUint16(10, central.length, true)
  dv.setUint32(12, offset - cdStart, true)
  dv.setUint32(16, cdStart, true)
  chunks.push(eocd)

  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out.buffer
}

const SHARED = `<sst><si><t>상품명</t></si><si><t>카테고리</t></si><si><t>특징</t></si><si><t>유산균 &amp; 김</t></si></sst>`

const SHEET = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2" t="inlineStr"><is><t>특징만</t></is></c></row>
<row r="3"><c r="A3"><v>123</v></c></row>
<row r="4"/>
</sheetData></worksheet>`

const FILES = [
  { name: 'xl/sharedStrings.xml', data: SHARED },
  { name: 'xl/worksheets/sheet1.xml', data: SHEET },
]

describe('readXlsxRows (외부 라이브러리 없는 엑셀 읽기)', () => {
  it('무압축 저장된 xlsx의 첫 시트를 행렬로 읽는다', async () => {
    const rows = await readXlsxRows(await makeZip(FILES))
    expect(rows).toEqual([
      ['상품명', '카테고리', '특징'],
      ['유산균 & 김', '', '특징만'],
      ['123'],
    ])
  })

  it('deflate 압축된 실제 엑셀 형식도 읽는다', async () => {
    const rows = await readXlsxRows(await makeZip(FILES, { compress: true }))
    expect(rows[1][0]).toBe('유산균 & 김')
  })

  it('빈 행은 버리고, 중간이 빈 셀은 위치를 지켜 채운다', async () => {
    const rows = await readXlsxRows(await makeZip(FILES))
    expect(rows).toHaveLength(3) // 빈 <row r="4"/> 제외
    expect(rows[1][1]).toBe('') // B2는 비어 있지만 자리를 지킨다
  })

  it('엑셀이 아닌 파일은 안내 메시지와 함께 거부한다', async () => {
    const notZip = new TextEncoder().encode('상품명,카테고리\n김,식품').buffer
    await expect(readXlsxRows(notZip)).rejects.toThrow(/엑셀 파일 형식이 아닙니다/)
  })
})

describe('looksLikeZip', () => {
  it('PK 시그니처로 엑셀 파일을 알아본다 (확장자를 못 믿을 때)', async () => {
    expect(looksLikeZip(await makeZip(FILES))).toBe(true)
    expect(looksLikeZip(new TextEncoder().encode('a,b,c\n1,2,3').buffer)).toBe(false)
  })
})
