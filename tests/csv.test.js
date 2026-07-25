import { describe, it, expect } from 'vitest'
import { parseCsv, normalizeSales, aggregate, normalizeDate, decodeCsvBuffer, weekdayAverages } from '../src/lib/csv.js'
import { SAMPLE_CSV } from '../src/lib/sampleSales.js'

describe('decodeCsvBuffer', () => {
  it('UTF-8 텍스트를 그대로 디코딩하고 BOM을 제거한다', () => {
    const buf = new TextEncoder().encode('﻿날짜,채널\n2026-07-01,쿠팡')
    expect(decodeCsvBuffer(buf.buffer)).toBe('날짜,채널\n2026-07-01,쿠팡')
  })

  it('UTF-8로 해석 불가능한 바이트(CP949 등)는 EUC-KR 폴백으로 디코딩한다', () => {
    // '가나' 의 EUC-KR 바이트
    const bytes = new Uint8Array([0xb0, 0xa1, 0xb3, 0xaa])
    expect(decodeCsvBuffer(bytes.buffer)).toBe('가나')
  })
})

describe('normalizeDate', () => {
  it('슬래시·점 표기를 ISO로 정규화한다', () => {
    expect(normalizeDate('2026/07/13')).toBe('2026-07-13')
    expect(normalizeDate('2026.7.3')).toBe('2026-07-03')
    expect(normalizeDate('2026-07-13')).toBe('2026-07-13')
  })

  it('인식 불가 형식은 원문을 유지한다', () => {
    expect(normalizeDate('7월 13일')).toBe('7월 13일')
  })
})

describe('parseCsv', () => {
  it('따옴표·쉼표가 섞인 필드를 파싱한다', () => {
    const rows = parseCsv('a,"b,c",d\n1,"say ""hi""",3')
    expect(rows).toEqual([
      ['a', 'b,c', 'd'],
      ['1', 'say "hi"', '3'],
    ])
  })

  it('CRLF와 빈 줄을 처리한다', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n\r\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('normalizeSales', () => {
  it('한국어 헤더를 인식하고 금액의 쉼표를 제거한다', () => {
    const rows = parseCsv('날짜,채널,상품명,수량,매출액\n2026-07-01,쿠팡,유산균,3,"1,500,000"')
    const records = normalizeSales(rows)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ channel: '쿠팡', qty: 3, amount: 1500000 })
  })

  it('필수 컬럼이 없으면 예외를 던진다', () => {
    const rows = parseCsv('날짜,채널\n2026-07-01,쿠팡')
    expect(() => normalizeSales(rows)).toThrow(/필수 컬럼/)
  })

  it('숫자가 아닌 행은 건너뛴다', () => {
    const rows = parseCsv('날짜,채널,상품명,수량,매출액\n2026-07-01,쿠팡,유산균,abc,100\n2026-07-02,쿠팡,유산균,1,100')
    expect(normalizeSales(rows)).toHaveLength(1)
  })

  it('빈 수량/매출액 셀은 0이 아니라 누락으로 처리해 건너뛴다', () => {
    const rows = parseCsv('날짜,채널,상품명,수량,매출액\n2026-07-01,쿠팡,유산균,,\n2026-07-02,쿠팡,유산균,1,100')
    const records = normalizeSales(rows)
    expect(records).toHaveLength(1)
    expect(records[0].date).toBe('2026-07-02')
  })

  it('통화기호가 붙은 금액(₩1,500)을 파싱한다', () => {
    const rows = parseCsv('날짜,채널,상품명,수량,매출액\n2026-07-01,쿠팡,유산균,2개,₩1500')
    const records = normalizeSales(rows)
    expect(records[0]).toMatchObject({ qty: 2, amount: 1500 })
  })

  it('슬래시 날짜 CSV도 요일별 집계에 포함된다', () => {
    const rows = parseCsv('날짜,채널,상품명,수량,매출액\n2026/07/13,쿠팡,유산균,1,100\n2026/07/14,쿠팡,유산균,1,200')
    const summary = aggregate(normalizeSales(rows))
    expect(summary.byDate[0][0]).toBe('2026-07-13')
    expect(weekdayAverages(summary.byDate)).toHaveLength(2)
  })
})

describe('aggregate', () => {
  const records = normalizeSales(parseCsv(SAMPLE_CSV))
  const summary = aggregate(records)

  it('총합이 레코드 합계와 일치한다', () => {
    const manual = records.reduce((s, r) => s + r.amount, 0)
    expect(summary.totalAmount).toBe(manual)
  })

  it('채널별 집계는 매출 내림차순이다', () => {
    const values = summary.byChannel.map(([, v]) => v)
    expect([...values].sort((a, b) => b - a)).toEqual(values)
  })

  it('샘플 데이터의 프로모션 급증일(7/18)을 이상치로 감지한다', () => {
    expect(summary.anomalies.some((a) => a.date === '2026-07-18' && a.direction === 'spike')).toBe(true)
  })

  it('샘플 데이터의 품절 급감일(7/21)을 이상치로 감지한다', () => {
    expect(summary.anomalies.some((a) => a.date === '2026-07-21' && a.direction === 'drop')).toBe(true)
  })
})
