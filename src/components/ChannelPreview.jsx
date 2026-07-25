// 채널별 결과물을 실제 게시물 모양으로 렌더하는 미리보기 컴포넌트

function parseCardSlides(body) {
  const parts = body.split(/\n(?=\d+장)/).filter((s) => s.trim())
  if (parts.length < 2) return null
  return parts.map((p) => {
    const m = p.match(/^(\d+장[^:]*):\s*([\s\S]*)$/)
    return m ? { label: m[1], text: m[2].trim() } : { label: '', text: p.trim() }
  })
}

function parseScenes(body) {
  const lines = body.split('\n').filter((l) => l.trim())
  // "0-3초:", "0~3 초 :" 등 흔한 변형을 허용하고, 시간 표기가 없는 줄도
  // 버리지 않고 빈 타임 셀로 함께 보여준다 (내용 유실 방지).
  const scenes = lines.map((l) => {
    const m = l.match(/^(\d+\s*[-~]\s*\d+\s*초)\s*:\s*([\s\S]*)$/)
    return m ? { time: m[1].replace(/\s/g, ''), text: m[2].trim() } : { time: '', text: l.trim() }
  })
  return scenes.filter((s) => s.time).length >= 2 ? scenes : null
}

export function InstagramMock({ title, body, hashtags }) {
  return (
    <div className="ig-mock">
      <div className="ig-head">
        <span className="ig-avatar" aria-hidden="true" />
        <div>
          <p className="ig-account">ax_workbench.official</p>
          <p className="ig-sponsored">협찬 광고 표시 영역</p>
        </div>
      </div>
      <div className="ig-image" aria-hidden="true">
        <span>제품 이미지 영역</span>
      </div>
      <div className="ig-actions" aria-hidden="true">♡ ⌾ ✈</div>
      <div className="ig-caption">
        <p>
          <strong>ax_workbench.official</strong> {title}
        </p>
        <p className="ig-body">{body}</p>
        {hashtags?.length > 0 && (
          <p className="ig-tags">{hashtags.map((h) => `#${h}`).join(' ')}</p>
        )}
      </div>
    </div>
  )
}

export function CardNewsMock({ body }) {
  const slides = parseCardSlides(body)
  if (!slides) return <pre className="content-body">{body}</pre>
  return (
    <div className="cardnews-grid">
      {slides.map((s, i) => (
        <div className={i === 0 ? 'cardnews-slide cover' : 'cardnews-slide'} key={i}>
          <span className="cardnews-num">{s.label || `${i + 1}장`}</span>
          <p>{s.text}</p>
        </div>
      ))}
    </div>
  )
}

export function SceneScriptMock({ body }) {
  const scenes = parseScenes(body)
  if (!scenes) return <pre className="content-body">{body}</pre>
  return (
    <table className="scene-table">
      <thead>
        <tr>
          <th>타임</th>
          <th>장면 / 자막 / 내레이션</th>
        </tr>
      </thead>
      <tbody>
        {scenes.map((s, i) => (
          <tr key={i}>
            <td className="scene-time">{s.time}</td>
            <td>{s.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ThreadsMock({ body }) {
  return (
    <div className="ig-mock threads-mock">
      <div className="ig-head">
        <span className="ig-avatar" aria-hidden="true" />
        <div>
          <p className="ig-account">ax_workbench</p>
          <p className="ig-sponsored">지금</p>
        </div>
      </div>
      <div className="ig-caption">
        <p className="ig-body">{body}</p>
      </div>
      <div className="ig-actions" aria-hidden="true">♡ 💬 ↻ ✈</div>
    </div>
  )
}

export default function ChannelPreview({ item }) {
  if (item.channel === 'instagram') {
    return <InstagramMock title={item.title} body={item.body} hashtags={item.hashtags} />
  }
  if (item.channel === 'threads') {
    return <ThreadsMock body={item.body} />
  }
  if (item.channel === 'cardnews') {
    return <CardNewsMock body={item.body} />
  }
  if (item.channel === 'youtube' || item.channel === 'tiktok') {
    return <SceneScriptMock body={item.body} />
  }
  return <pre className="content-body">{item.body}</pre>
}
