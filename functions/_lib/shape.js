// AI 응답 모양 정규화.
//
// tool 강제 호출은 "JSON이 온다"는 것까지만 보장한다. 중첩 필드가 빠지거나 타입이 어긋나면
// 화면에는 빈 칸·undefined가 그대로 그려진다. 최상위 키 존재만 확인하던 계약 검증을
// 항목 단위까지 내려 확인하고, 못 쓸 항목은 버린 뒤 남은 것으로 응답한다.
import { failure } from './claude.js'

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const arr = (v) => (Array.isArray(v) ? v : [])
const strList = (v, max, count) =>
  arr(v)
    .filter((x) => typeof x === 'string' && x.trim())
    .slice(0, count)
    .map((x) => x.slice(0, max))

export function normalizeDetail(result) {
  const sections = arr(result.sections)
    .filter((s) => s && typeof s.title === 'string' && typeof s.body === 'string')
    .slice(0, 8)
    .map((s) => ({
      title: str(s.title, 120),
      body: str(s.body, 1200),
      bullets: strList(s.bullets, 160, 8),
      image_brief: str(s.image_brief, 300),
    }))
  const faq = arr(result.faq)
    .filter((f) => f && typeof f.q === 'string' && typeof f.a === 'string')
    .slice(0, 6)
    .map((f) => ({ q: str(f.q, 200), a: str(f.a, 600) }))

  if (sections.length === 0) {
    throw failure('contract', 'AI 응답의 본문 섹션이 비어 있습니다. 다시 시도해주세요.')
  }

  return {
    headline: str(result.headline, 200),
    subheadline: str(result.subheadline, 300),
    sections,
    faq,
    keywords: strList(result.keywords, 40, 12),
    designer_notes: str(result.designer_notes, 1000),
  }
}

export function normalizeChannelContents(results, allowedChannels) {
  const normalized = arr(results)
    .filter(
      (r) =>
        r &&
        typeof r.channel === 'string' &&
        typeof r.title === 'string' &&
        typeof r.body === 'string' &&
        r.body.trim() &&
        allowedChannels.includes(r.channel)
    )
    .slice(0, allowedChannels.length)
    .map((r) => ({
      channel: r.channel,
      title: str(r.title, 200),
      body: str(r.body, 4000),
      hashtags: strList(r.hashtags, 40, 15),
    }))

  if (normalized.length === 0) {
    throw failure('contract', 'AI 응답에 사용할 수 있는 채널 콘텐츠가 없습니다. 다시 시도해주세요.')
  }
  return normalized
}

export function normalizeListing(result) {
  const titles = strList(result.titles, 80, 6)
  if (titles.length === 0) {
    throw failure('contract', 'AI 응답에 상품명이 없습니다. 다시 시도해주세요.')
  }
  return {
    titles,
    search_keywords: strList(result.search_keywords, 40, 20),
    tags: strList(result.tags, 40, 20),
    category_paths: strList(result.category_paths, 120, 6),
    compliance_notes: strList(result.compliance_notes, 300, 6),
  }
}
