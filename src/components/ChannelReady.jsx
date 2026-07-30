// 채널 등록 준비 상태 — "이 결과를 지금 각 오픈마켓에 올릴 수 있는가"를 답하는 블록.
//
// 이 도구의 출력은 지금까지 "사람이 읽는 결과"였다. 담당자는 그것을 보고 채널 관리자 화면에
// 다시 옮겨 적었고, 상품명이 채널 규정(글자수·특수문자·중복 단어·홍보 문구)에 걸리면
// 반려된 뒤에야 알았다. 그 두 구간(규정 확인, 옮겨적기)을 화면에서 끝낸다.
import { useMemo, useState } from 'react'
import { CHANNEL_RULES } from '../lib/channelRules.js'
import { channelCsv } from '../lib/channelExport.js'
import { downloadFile, safeFileName } from '../lib/detailHtml.js'

const CODE_LABEL = {
  char: '특수문자',
  promo: '홍보 문구',
  contact: '연락처',
  repeat: '중복 단어',
  max_len: '길이 초과',
  truncate: '강제 절단',
  space: '공백',
}

export default function ChannelReady({ items, fileBase = '상품등록', unsafeCount = 0 }) {
  const [open, setOpen] = useState(null)
  const built = useMemo(
    () => CHANNEL_RULES.map((c) => ({ id: c.id, rule: c, ...channelCsv(c.id, items) })),
    [items]
  )
  const total = built[0]?.rows.length || 0
  if (total === 0) return null

  const cleanChannels = built.filter((b) => b.adjusted.length === 0 && b.blocked.length === 0).length

  function download(b) {
    downloadFile(`${safeFileName(fileBase)}_${b.fileTag}.csv`, b.csv, 'text/csv;charset=utf-8')
  }

  return (
    <section className="channel-ready">
      <h3>채널 등록 준비 상태</h3>
      <p className="channel-sub">
        상품 {total}개를 {CHANNEL_RULES.length}개 채널 규정으로 검사했습니다. 규정에 걸리는 상품명은
        채널별로 자동 교정한 뒤 각 채널의 등록 양식으로 내보냅니다 —{' '}
        {cleanChannels === CHANNEL_RULES.length
          ? '교정 없이 모든 채널에 그대로 올릴 수 있습니다.'
          : `${CHANNEL_RULES.length - cleanChannels}개 채널은 교정이 필요했습니다.`}
      </p>

      {unsafeCount > 0 && (
        <p className="channel-warn">
          ⚠ {unsafeCount}개 행은 AI 생성이 아니라 예시로 채운 값입니다. 내보내는 양식에도 그대로
          들어가므로, 재생성 후 다시 내려받으세요.
        </p>
      )}

      <div className="channel-grid">
        {built.map((b) => {
          const fixes = b.adjusted.length
          const blocked = b.blocked.length
          const state = blocked > 0 ? 'blocked' : fixes > 0 ? 'fixed' : 'ok'
          return (
            <div className={`channel-card channel-${state}`} key={b.id}>
              <div className="channel-head">
                <strong>{b.label}</strong>
                <span className="channel-state">
                  {state === 'ok' ? '그대로 등록 가능' : state === 'fixed' ? `${fixes}건 자동 교정` : `${blocked}건 확인 필요`}
                </span>
              </div>
              <p className="channel-rule">
                상품명 {b.rule.maxLen}자 이내
                {b.rule.recommendLen ? ` · 권장 ${b.rule.recommendLen}자` : ''} · 같은 단어{' '}
                {b.rule.maxRepeat + 1}회 이상 반복 불가
              </p>
              <div className="channel-actions">
                <button type="button" className="btn-ghost" onClick={() => download(b)}>
                  등록 양식 CSV
                </button>
                {(fixes > 0 || blocked > 0) && (
                  <button type="button" className="copy-mini" onClick={() => setOpen(open === b.id ? null : b.id)}>
                    {open === b.id ? '내역 닫기' : '교정 내역'}
                  </button>
                )}
              </div>

              {open === b.id && (
                <div className="channel-detail">
                  {b.adjusted.map((a, i) => (
                    <div className="channel-fix" key={`a${i}`}>
                      <p className="channel-fix-from">{a.from}</p>
                      <p className="channel-fix-to">→ {a.to}</p>
                      <ul className="plain-list">
                        {a.changes.map((c, j) => (
                          <li key={j}>
                            <strong>{CODE_LABEL[c.code] || c.code}</strong> — {c.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {b.blocked.map((x, i) => (
                    <div className="channel-fix channel-fix-bad" key={`b${i}`}>
                      <p className="channel-fix-from">{x.title || x.name}</p>
                      <ul className="plain-list warn-list">
                        {x.findings
                          .filter((f) => f.severity === 'high')
                          .map((f, j) => (
                            <li key={j}>{f.message}</li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <details className="channel-rules-note">
        <summary>적용한 채널 규정 보기 ({CHANNEL_RULES.length}개 채널)</summary>
        <ul className="plain-list">
          {CHANNEL_RULES.map((c) => (
            <li key={c.id}>
              <strong>{c.label}</strong> — {c.note}
            </li>
          ))}
        </ul>
        <p className="channel-foot">
          채널 정책과 등록 양식의 컬럼명은 시기·카테고리마다 다릅니다. 이 값들은 코드 한 곳
          (<code>src/lib/channelRules.js</code>, <code>src/lib/channelExport.js</code>)에 모아 두었고,
          실제 운영에서는 채널 공지 기준으로 이 표만 고치면 전체 화면과 내보내기가 함께 따라옵니다.
        </p>
      </details>
    </section>
  )
}
