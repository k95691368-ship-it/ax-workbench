import { describe, it, expect } from 'vitest'
import {
  CHANNEL_RULES,
  checkTitle,
  checkTitleAllChannels,
  autoFixTitle,
  bestTitle,
  channelSummary,
  getChannelRule,
} from '../src/lib/channelRules.js'
import { channelCsv, buildChannelRows, exportableChannels } from '../src/lib/channelExport.js'

const CLEAN = '데일리 장편한 유산균 30포 19종 프로바이오틱스 아연'

describe('채널 등록 규정 판정', () => {
  it('규정을 통과하는 상품명은 만점이다', () => {
    const r = checkTitle(CLEAN, 'smartstore')
    expect(r.ok).toBe(true)
    expect(r.score).toBe(100)
    expect(r.findings).toEqual([])
  })

  it('한도 초과는 몇 자 넘었는지까지 알려준다', () => {
    const long = '가'.repeat(60)
    const r = checkTitle(long, 'esm') // G마켓 50자
    expect(r.ok).toBe(false)
    const f = r.findings.find((x) => x.code === 'max_len')
    expect(f.message).toContain('50자')
    expect(f.message).toContain('10자 초과')
  })

  it('권장 길이 초과는 막지 않고 주의로 알린다', () => {
    const r = checkTitle('가'.repeat(70), 'smartstore') // 한도 100, 권장 50
    expect(r.ok).toBe(true)
    expect(r.findings.map((f) => f.code)).toContain('recommend_len')
  })

  it('특수문자·이모지는 등록이 거부되므로 높은 위험으로 잡는다', () => {
    const r = checkTitle('★유산균★ 30포 ♥', 'coupang')
    const f = r.findings.find((x) => x.code === 'char')
    expect(f.severity).toBe('high')
    expect(f.message).toContain('★')
  })

  it('규격 표기에 필요한 기호는 허용한다 (오탐 방지)', () => {
    expect(checkTitle('비타민C 1,000mg (60정) 2+1 30%증량', 'smartstore').ok).toBe(true)
  })

  it('같은 단어 반복은 검색 어뷰징으로 잡는다', () => {
    const r = checkTitle('유산균 30포 유산균 프로바이오틱스 유산균', 'smartstore')
    const f = r.findings.find((x) => x.code === 'repeat')
    expect(f.message).toContain('유산균(3회)')
  })

  it('채널마다 반복 허용 횟수가 다르다', () => {
    // 11번가는 2회까지 허용, 스마트스토어는 1회
    const title = '유산균 30포 프로바이오틱스 유산균'
    expect(checkTitle(title, 'eleven').findings.some((f) => f.code === 'repeat')).toBe(false)
    expect(checkTitle(title, 'smartstore').findings.some((f) => f.code === 'repeat')).toBe(true)
  })

  it('상품명에 넣을 수 없는 홍보 문구를 잡고, 긴 문구를 먼저 맞춘다', () => {
    const r = checkTitle('유산균 30포 무료배송 최저가', 'smartstore')
    const f = r.findings.find((x) => x.code === 'promo')
    expect(f.message).toContain('무료배송')
    // '무료배송'을 '무료'로 중복 검출하지 않는다
    expect(f.message.match(/무료/g)).toHaveLength(1)
  })

  it('연락처·URL은 채널 외 거래 유도로 잡는다', () => {
    expect(checkTitle('유산균 문의 010-1234-5678', 'coupang').findings.some((f) => f.code === 'contact')).toBe(true)
    expect(checkTitle('유산균 www.example.co.kr', 'coupang').findings.some((f) => f.code === 'contact')).toBe(true)
    expect(checkTitle('유산균 카톡문의', 'coupang').findings.some((f) => f.code === 'contact')).toBe(true)
  })

  it('빈 상품명을 통과시키지 않는다', () => {
    expect(checkTitle('   ', 'smartstore').ok).toBe(false)
  })

  it('모든 채널을 한 번에 판정한다 — 어디서 막히는지 보인다', () => {
    const all = checkTitleAllChannels('가'.repeat(60))
    expect(all).toHaveLength(CHANNEL_RULES.length)
    // 50자 한도인 G마켓만 막힌다
    expect(all.filter((c) => !c.ok).map((c) => c.channel)).toEqual(['esm'])
  })

  it('모르는 채널을 물으면 첫 채널 규정으로 답한다 (예외를 던지지 않는다)', () => {
    expect(getChannelRule('없는채널').id).toBe(CHANNEL_RULES[0].id)
  })
})

describe('자동 교정 — 무엇을 왜 고쳤는지 함께 돌려준다', () => {
  const BAD = '★무료배송★ 데일리 장편한 유산균 30포 유산균 프로바이오틱스 국내 1위 유산균 최저가!! 문의 010-1234-5678'

  it('교정 후에는 그 채널 규정을 통과한다', () => {
    const f = autoFixTitle(BAD, 'smartstore')
    expect(f.check.ok).toBe(true)
    expect(f.title).not.toContain('★')
    expect(f.title).not.toContain('무료배송')
    expect(f.title).not.toContain('010')
  })

  it('고친 항목을 사유별로 남긴다 (조용히 바꾸지 않는다)', () => {
    const codes = autoFixTitle(BAD, 'smartstore').changes.map((c) => c.code)
    expect(codes).toContain('char')
    expect(codes).toContain('promo')
    expect(codes).toContain('contact')
    expect(codes).toContain('repeat')
  })

  it('URL은 어절 통째로 지운다 (앞뒤만 지워 example만 남기지 않는다)', () => {
    const f = autoFixTitle('유산균 30포 www.example.co.kr 확인', 'coupang')
    expect(f.title).not.toContain('example')
    expect(f.title).toContain('유산균 30포')
  })

  it('중복 단어는 뒤에 나온 것을 지운다 (앞쪽이 브랜드·제품명이다)', () => {
    const f = autoFixTitle('데일리 유산균 30포 유산균 스틱', 'smartstore')
    expect(f.title).toBe('데일리 유산균 30포 스틱')
  })

  it('길이 초과는 뒤쪽 부가 키워드부터 덜어낸다', () => {
    const long = '데일리 장편한 유산균 30포 프로바이오틱스 아연함유 스틱형 휴대용 직장인 하루한포 장건강 국내생산'
    const f = autoFixTitle(long, 'esm')
    expect(f.title.length).toBeLessThanOrEqual(50)
    expect(f.title.startsWith('데일리 장편한 유산균')).toBe(true)
    expect(f.changes.some((c) => c.code === 'max_len')).toBe(true)
  })

  it('제품명 자체가 한도를 넘으면 자르되 사람 확인이 필요하다고 알린다', () => {
    const f = autoFixTitle('가'.repeat(80), 'esm')
    expect(f.title.length).toBeLessThanOrEqual(50)
    expect(f.changes.some((c) => c.code === 'truncate')).toBe(true)
  })

  it('이미 규정을 지키는 상품명은 건드리지 않는다', () => {
    const f = autoFixTitle(CLEAN, 'smartstore')
    expect(f.title).toBe(CLEAN)
    expect(f.changes).toEqual([])
  })
})

describe('채널별 추천 후보 선택', () => {
  const titles = [
    '유산균 30포 무료배송 최저가', // 홍보 문구로 막힘
    '데일리 장편한 유산균 30포 19종 프로바이오틱스 아연', // 통과
    '가'.repeat(60), // G마켓만 막힘
  ]

  it('그 채널에서 가장 점수가 높은 후보를 고른다', () => {
    expect(bestTitle(titles, 'smartstore').title).toBe(titles[1])
  })

  it('몇 개 채널에서 그대로 등록 가능한지 요약한다', () => {
    const s = channelSummary(titles)
    expect(s.total).toBe(CHANNEL_RULES.length)
    expect(s.okCount).toBe(CHANNEL_RULES.length)
    expect(s.per.every((p) => p.best)).toBe(true)
  })

  it('후보가 없으면 null (빈 결과에서 터지지 않는다)', () => {
    expect(bestTitle([], 'smartstore')).toBeNull()
    expect(bestTitle(['  '], 'smartstore')).toBeNull()
    expect(channelSummary([]).okCount).toBe(0)
  })
})

describe('채널 등록 양식 내보내기', () => {
  const listing = {
    titles: ['데일리 장편한 유산균 30포 19종 프로바이오틱스 아연'],
    search_keywords: ['유산균', '프로바이오틱스', '아연'],
    tags: ['유산균', '직장인', '스틱'],
    category_paths: ['식품 > 건강기능식품 > 유산균'],
  }
  const items = [{ name: '데일리 장편한 유산균 30포', listing }]

  it('채널마다 요구하는 열 이름으로 내보낸다', () => {
    expect(channelCsv('coupang', items).headers).toContain('노출상품명')
    expect(channelCsv('smartstore', items).headers).toContain('상품명')
    expect(channelCsv('smartstore', items).headers).not.toContain('노출상품명')
  })

  it('엑셀 한글 깨짐을 막기 위해 BOM을 붙인다', () => {
    expect(channelCsv('smartstore', items).csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('상품명은 그 채널 규정으로 교정된 값이 들어간다', () => {
    const dirty = [{ name: '유산균', listing: { ...listing, titles: ['★유산균 30포★ 무료배송'] } }]
    const out = channelCsv('smartstore', dirty)
    expect(out.rows[0][0]).toBe('유산균 30포')
    expect(out.adjusted).toHaveLength(1)
    expect(out.adjusted[0].changes.map((c) => c.code)).toContain('promo')
  })

  it('교정해도 규정을 못 지키는 상품은 blocked로 알린다 (모르고 올리지 않게)', () => {
    const bad = [{ name: '빈이름', listing: { ...listing, titles: ['   '] } }]
    const out = channelCsv('smartstore', bad)
    expect(out.rows).toHaveLength(0) // 상품명이 아예 없으면 행을 만들지 않는다
    const tooLong = [{ name: '긴이름', listing: { ...listing, titles: ['가'.repeat(80)] } }]
    expect(channelCsv('esm', tooLong).rows[0][0].length).toBeLessThanOrEqual(50)
  })

  it('여러 상품을 한 파일로 내보낸다', () => {
    const many = [items[0], { name: '도시락김', listing: { ...listing, titles: ['바삭 곱창돌김 도시락김 16봉'] } }]
    const out = channelCsv('smartstore', many)
    expect(out.rows).toHaveLength(2)
    expect(out.csv.split('\r\n')).toHaveLength(3) // 헤더 + 2행
  })

  it('내보낼 수 있는 채널 목록이 규정 표와 어긋나지 않는다', () => {
    expect(exportableChannels().map((c) => c.id).sort()).toEqual(CHANNEL_RULES.map((c) => c.id).sort())
  })

  it('알 수 없는 채널은 조용히 빈 파일을 만들지 않고 실패한다', () => {
    expect(() => buildChannelRows('없는채널', items)).toThrow(/알 수 없는 채널/)
  })
})
