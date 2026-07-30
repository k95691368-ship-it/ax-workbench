import { describe, it, expect } from 'vitest'
import {
  parseCsv,
  normalizeSales,
  aggregate,
  normalizeDate,
  decodeCsvBuffer,
  weekdayAverages,
  skippedNotice,
  parseAmount,
} from '../src/lib/csv.js'
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

describe('엑셀 날짜 시리얼', () => {
  it('날짜 서식 셀(시리얼 숫자)을 ISO 날짜로 바꾼다', () => {
    // 감사에서 실제 xlsx로 재현: 날짜 열이 46216 같은 숫자로 도착했다
    expect(normalizeDate('46216')).toBe('2026-07-13')
    expect(normalizeDate('46217')).toBe('2026-07-14')
    // 소수부(시각)는 버린다
    expect(normalizeDate('45658.5')).toBe('2025-01-01')
    // 경계: 시리얼 하한이 1970-01-01
    expect(normalizeDate('25569')).toBe('1970-01-01')
  })

  it('날짜가 아닌 숫자는 건드리지 않는다 (수량·금액 오인 방지)', () => {
    expect(normalizeDate('100')).toBe('100')
    expect(normalizeDate('999999')).toBe('999999')
    expect(normalizeDate('상품A')).toBe('상품A')
  })

  it('기존 표기도 그대로 처리한다', () => {
    expect(normalizeDate('2026/07/13')).toBe('2026-07-13')
    expect(normalizeDate('2026.7.3')).toBe('2026-07-03')
  })
})

describe('필드 중간의 따옴표가 행을 병합하지 않는다', () => {
  // 감사 재현: 인치 표기(27") 상품명 때문에 4행이 2행으로 병합되고
  // 총매출 170,000원이 90,000원으로 표시됐다 — 경고는 없었다.
  const csv = [
    '날짜,채널,상품명,수량,매출액',
    '2026-07-13,쿠팡,27"모니터 거치대,5,50000',
    '2026-07-14,네이버,키보드,3,30000',
    '2026-07-15,쿠팡,32"모니터 거치대,7,70000',
    '2026-07-16,쿠팡,마우스,2,20000',
  ].join('\n')

  it('행이 병합되지 않고 총매출이 맞는다', () => {
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(5)
    const summary = aggregate(normalizeSales(rows))
    expect(summary.totalAmount).toBe(170000)
    expect(summary.count).toBe(4)
  })

  it('상품명 안의 따옴표를 지우지 않는다', () => {
    expect(parseCsv(csv)[1][2]).toBe('27"모니터 거치대')
  })

  it('필드 맨 앞의 따옴표는 여전히 인용으로 처리한다 (쉼표 포함 금액)', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']])
  })

  it('따옴표 짝이 맞지 않는 파일은 사실을 알려준다', () => {
    const broken = '날짜,채널,상품명,수량,매출액\n2026-07-13,쿠팡,"열린 채 끝난 상품명,5,50000'
    const rows = parseCsv(broken)
    expect(rows.unclosedQuote).toBe(true)
    const rows2 = parseCsv('날짜,채널,상품명,수량,매출액\n2026-07-13,쿠팡,김,5,50000')
    expect(rows2.unclosedQuote).toBeUndefined()
    expect(skippedNotice(normalizeSales(rows2))).toBeNull()
  })
})

describe('parseAmount (금액·수량 셀 해석)', () => {
  it('통화기호·쉼표·단위를 걷어낸다', () => {
    expect(parseAmount('₩1,500,000')).toBe(1500000)
    expect(parseAmount('2개')).toBe(2)
    expect(parseAmount('1,500 원')).toBe(1500)
  })

  it('회계 서식 괄호는 음수다 (환불이 양수로 뒤집히지 않는다)', () => {
    expect(parseAmount('(1,500)')).toBe(-1500)
    expect(parseAmount('(₩1,500)')).toBe(-1500)
    expect(parseAmount('-1500')).toBe(-1500)
  })

  it('지수 표기를 제대로 읽는다', () => {
    expect(parseAmount('1.23457E+11')).toBe(123457000000)
    expect(parseAmount('1.0E-07')).toBeCloseTo(1e-7)
  })

  it('엑셀 오류 셀은 0이 아니라 해석 불가다', () => {
    expect(parseAmount('#DIV/0!')).toBeNull()
    expect(parseAmount('#N/A')).toBeNull()
    expect(parseAmount('#VALUE!')).toBeNull()
  })

  it('숫자로 볼 수 없는 표기는 일부만 떼어 쓰지 않는다', () => {
    expect(parseAmount('12만')).toBeNull()
    expect(parseAmount('3.5%')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(null)).toBeNull()
  })
})

describe('해석할 수 없는 금액을 0원 행으로 삼키지 않는다', () => {
  const rows = [
    ['날짜', '채널', '상품명', '수량', '매출액'],
    ['2026-07-13', '쿠팡', '김', '2', '12,000'],
    ['2026-07-14', '쿠팡', '김', '1', '#DIV/0!'],
    ['2026-07-15', '쿠팡', '김', '1', '12만'],
  ]

  it('#DIV/0! 행이 매출 0원으로 집계에 들어가지 않는다', () => {
    const records = normalizeSales(rows)
    expect(records).toHaveLength(1)
    expect(records.map((r) => r.date)).toEqual(['2026-07-13'])
    // 예전에는 0원 행이 들어가 존재하지 않는 '급감(일평균의 0%)'이 이상감지에 떴다
    expect(aggregate(records).anomalies).toEqual([])
  })

  it('사유와 원문을 함께 알려준다 (사용자가 어느 셀인지 찾을 수 있게)', () => {
    const note = skippedNotice(normalizeSales(rows))
    expect(note).toContain('숫자로 읽을 수 없는 행 2개')
    expect(note).toContain('#DIV/0!')
    expect(note).toContain('12만')
  })

  it('괄호 음수(환불)는 버리지 않고 음수로 집계한다', () => {
    const refund = [
      ['날짜', '채널', '상품명', '수량', '매출액'],
      ['2026-07-13', '쿠팡', '김', '2', '12,000'],
      ['2026-07-14', '쿠팡', '김', '1', '(1,500)'],
    ]
    const records = normalizeSales(refund)
    expect(records).toHaveLength(2)
    expect(aggregate(records).totalAmount).toBe(10500)
  })
})

describe('집계에서 빠진 행을 조용히 넘기지 않는다', () => {
  const rows = [
    ['날짜', '채널', '상품명', '수량', '매출액'],
    ['46216', '스마트스토어', '김', '2', '12,000'],
    ['', '몰', '김', '1', '5000'],
    ['2026-07-14', '몰', '김', '', '3000'],
  ]

  it('날짜 없는 행이 date="undefined"로 집계에 들어가지 않는다', () => {
    const r = normalizeSales(rows)
    expect(r).toHaveLength(1)
    expect(r.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date))).toBe(true)
  })

  it('버린 행을 사유별로 알려준다', () => {
    const note = skippedNotice(normalizeSales(rows))
    expect(note).toContain('날짜 형식을 인식하지 못한 행 1개')
    expect(note).toContain('수량·금액이 비어 있는 행 1개')
  })

  it('버릴 게 없으면 안내하지 않는다', () => {
    const clean = [rows[0], rows[1]]
    expect(skippedNotice(normalizeSales(clean))).toBeNull()
  })
})
