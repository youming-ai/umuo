import { type CSSProperties, useEffect, useId, useState } from 'react'
import type { DemoMode, DemoModeId, Locale, SiteContent } from '../content/types'
import { DownloadButton } from './DownloadButton'

/**
 * 首页唯一的一屏：左边是标题与下载，右边是可以亲手试的演示。
 * 演示有读 / 写 / 说三种模式，点下面的键位或直接在页面上按快捷键切换；
 * 切换时译文重新逐字流出（由访客触发的动效），首次加载时流一次。
 */
export function Hero({ content }: { content: SiteContent; locale: Locale }) {
  const { hero } = content
  const headingId = useId()
  const macos = hero.platforms.find((platform) => platform.id === 'macos')
  const noteId = 'platform-macos-note'

  return (
    <section id="download" aria-labelledby={headingId} className="hero-stage">
      <div className="hero container-page">
        <div className="hero-copy">
          <h1 id={headingId} className="hero-title">
            {hero.title}
          </h1>
          <p className="lead hero-gap">{hero.subtitle}</p>
          {macos ? (
            <div className="hero-gap-lg">
              <DownloadButton
                label={macos.actionLabel}
                status={macos.statusLabel}
                describedBy={noteId}
                className="btn-solid"
              />
              <p id={noteId} className="mt-3 text-sm text-text-tertiary">
                {macos.requirement}
              </p>
            </div>
          ) : null}
        </div>
        <HeroDemo demo={hero.demo} />
      </div>
    </section>
  )
}

function HeroDemo({ demo }: { demo: SiteContent['hero']['demo'] }) {
  const [modeId, setModeId] = useState<DemoModeId>('read')
  // 首次渲染的流式动画要等首屏稳定后再开始；之后每次切换立即开始
  const [switched, setSwitched] = useState(false)
  const mode = demo.modes.find((item) => item.id === modeId) ?? demo.modes[0]

  useEffect(() => {
    const choose = (id: DemoModeId) => {
      setModeId(id)
      setSwitched(true)
    }
    // 单独按一下右 ⌥（中间没按别的键）才算「按住说话」，免得和 ⌥D 等组合键冲突
    let rightAltAlone = false
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? ''))
        return
      rightAltAlone = event.code === 'AltRight' && !event.repeat
      if (!event.altKey || event.metaKey || event.ctrlKey) return
      if (event.code === 'KeyD' && !event.shiftKey) choose('read')
      else if (event.code === 'KeyT' && event.shiftKey) choose('write')
      else return
      event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'AltRight' && rightAltAlone) choose('speak')
      rightAltAlone = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return (
    <figure aria-label={demo.label} className="hero-demo">
      <div key={mode.id} className="demo-stage" aria-live="polite">
        <DemoStage mode={mode} delay={switched ? 250 : 700} />
      </div>
      <div className="demo-switch">
        {demo.modes.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === mode.id}
            onClick={() => {
              setModeId(item.id)
              setSwitched(true)
            }}
          >
            <span className="flex gap-1" aria-hidden="true">
              {item.keys.map((key) => (
                <kbd key={key} className="keycap keycap-sm">
                  {key}
                </kbd>
              ))}
            </span>
            <span className="demo-switch-name">
              {item.name}
              {item.tag ? <span className="tag ms-1.5">{item.tag}</span> : null}
            </span>
          </button>
        ))}
      </div>
      <figcaption className="demo-hint">{demo.hint}</figcaption>
    </figure>
  )
}

/** 演示的上半部分：上一行经快捷键变成下一行。三种模式同一套记号：蓝色选区、灰色原话、墨色结果。 */
function DemoStage({ mode, delay }: { mode: DemoMode; delay: number }) {
  const result = <Stream text={mode.after} delay={delay} />

  if (mode.id === 'read') {
    return (
      <>
        <p className="source-text">
          <mark className="selection">{mode.before}</mark>
        </p>
        <div className="demo-popover translation-text">{result}</div>
      </>
    )
  }

  if (mode.id === 'write') {
    return (
      <>
        <p className="demo-replaced">{mode.before}</p>
        <p className="demo-field translation-text">{result}</p>
      </>
    )
  }

  return (
    <>
      <div className="demo-wave" aria-hidden="true">
        {WAVE.map((height, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 固定序列，下标就是身份
          <span key={index} style={{ '--h': `${height}%`, '--i': index } as CSSProperties} />
        ))}
      </div>
      <p className="source-text">{mode.before}</p>
      <p className="demo-field translation-text">{result}</p>
    </>
  )
}

/** 「说」的声波条高度（百分比）。写死而不是随机，预渲染与 hydration 才一致 */
const WAVE = [30, 55, 80, 45, 95, 60, 35, 70, 50, 85, 40, 65, 25, 75, 45, 30, 60, 40]

/** 逐字流出。读屏只读整句；减少动态效果时直接显示全文。 */
function Stream({ text, delay }: { text: string; delay: number }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" style={{ '--d': `${delay}ms` } as CSSProperties}>
        {[...text].map((char, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 字符序列固定，下标就是身份
          <span key={index} className="stream-char" style={{ '--i': index } as CSSProperties}>
            {char}
          </span>
        ))}
        <span className="stream-caret" />
      </span>
    </>
  )
}
