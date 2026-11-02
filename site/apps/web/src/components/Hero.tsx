import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useState,
} from 'react'
import type { DemoMode, DemoModeId, SiteContent } from '../content/types'
import { DownloadPanel } from './DownloadButton'

/**
 * 首页唯一的一屏：左边是标题与下载，右边是可以亲手试的演示。
 * 演示有划词 / 闪电替换 / 截图 / 语音四种模式，点上面的选项卡切换，划词、替换与语音也能直接按快捷键；
 * 默认停在第一项「划词翻译」；顺序由文案数据决定。
 * 切换时译文重新逐字流出（由访客触发的动效），首次加载时流一次。
 */
export function Hero({ content }: { content: SiteContent }) {
  const { hero } = content
  const headingId = useId()

  return (
    <section id="download" aria-labelledby={headingId} className="hero-stage">
      <div className="hero container-page">
        <div className="hero-copy">
          <h1 id={headingId} className="hero-title">
            {hero.title}
          </h1>
          <p className="lead hero-gap">{hero.subtitle}</p>
          <div className="hero-gap-lg">
            <DownloadPanel platform={hero.platform} />
          </div>
        </div>
        <HeroDemo demo={hero.demo} />
      </div>
    </section>
  )
}

function HeroDemo({ demo }: { demo: SiteContent['hero']['demo'] }) {
  const [modeId, setModeId] = useState<DemoModeId>(demo.modes[0].id)
  // 首次渲染的流式动画要等首屏稳定后再开始；之后每次切换（含再点一次当前模式）立即重新流出
  const [run, setRun] = useState(0)
  const mode = demo.modes.find((item) => item.id === modeId) ?? demo.modes[0]

  useEffect(() => {
    const choose = (id: DemoModeId) => {
      setModeId(id)
      setRun((value) => value + 1)
    }
    // ⌥⌘O 与 ⌃⌘V 是浏览器与系统都可能占用的组合，截图与语音模式只能点按钮切换。
    // 与客户端同一套规则：连按两下 ⌃ 是划词、连按两下 ⌥ 是闪电替换——每一下 ≤250ms、
    // 两下间隔 ≤350ms、同一个物理键、中间没按别的键；按住超过 250ms 不算连按。
    let press: { code: string; at: number } | null = null
    let lastTap: { code: string; at: number } | null = null
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? ''))
        return
      if (event.repeat) return
      const held = [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey].filter(Boolean)
      if (/^(Control|Alt)(Left|Right)$/.test(event.code) && held.length === 1) {
        if (lastTap && lastTap.code !== event.code) lastTap = null
        press = { code: event.code, at: performance.now() }
      } else {
        press = null
        lastTap = null
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const now = performance.now()
      const current = press
      press = null
      if (current?.code !== event.code) {
        lastTap = null
        return
      }
      if (now - current.at > 250) {
        lastTap = null
      } else if (lastTap?.code === event.code && current.at - lastTap.at <= 350) {
        lastTap = null
        choose(event.code.startsWith('Control') ? 'read' : 'write')
      } else {
        lastTap = { code: event.code, at: now }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const baseId = useId()
  const tabId = (id: DemoModeId) => `${baseId}-tab-${id}`
  const select = (id: DemoModeId, focus = false) => {
    setModeId(id)
    setRun((value) => value + 1)
    if (focus) document.getElementById(tabId(id))?.focus()
  }
  // 标准选项卡的键盘操作：←/→ 循环切换，Home/End 到头尾，切换即选中
  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = demo.modes.length
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % count
        : event.key === 'ArrowLeft'
          ? (index - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : -1
    if (next < 0) return
    event.preventDefault()
    select(demo.modes[next].id, true)
  }

  return (
    <figure aria-label={demo.label} className="hero-demo">
      {/* 书签式选项卡：当前一页是白页、和下面的舞台连成一体，其余退到纸背 */}
      <div className="demo-tabs" role="tablist" aria-label={demo.label}>
        {demo.modes.map((item, index) => {
          const selected = item.id === mode.id
          return (
            <button
              key={item.id}
              id={tabId(item.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(item.id)}
              onKeyDown={(event) => onTabKey(event, index)}
            >
              <span className="demo-tab-name">{item.name}</span>
              {item.tag ? (
                <span className="tag">{item.tag}</span>
              ) : item.keys ? (
                <span className="demo-keys" aria-hidden="true">
                  {item.keys.map((key, keyIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 键帽是静态列表，且连按会出现两个相同的键
                    <kbd key={keyIndex} className="keycap keycap-xs">
                      {key}
                    </kbd>
                  ))}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {/* 四个场景叠在同一格里，只显示当前的一个：舞台高度始终等于最高的场景，切换时页面不跳 */}
      <div
        id={`${baseId}-panel`}
        className="demo-stage"
        role="tabpanel"
        aria-labelledby={tabId(mode.id)}
        aria-live="polite"
      >
        {demo.modes.map((item) =>
          item.id === mode.id ? (
            <div
              key={`${item.id}-${run}`}
              className="demo-scene"
              data-mode={item.id}
              data-active="true"
            >
              <DemoStage mode={item} delay={run > 0 ? 250 : 700} />
            </div>
          ) : (
            <div key={item.id} className="demo-scene" data-mode={item.id} aria-hidden="true">
              <DemoStage mode={item} />
            </div>
          ),
        )}
      </div>
      <figcaption className="demo-hint">{mode.hint}</figcaption>
    </figure>
  )
}

/**
 * 演示的上半部分：上一行经快捷键变成下一行。四种模式同一套记号：奶油选区或截图虚线框、灰色原话、墨色结果。
 * 不带 delay 时是占位用的静态场景（只撑高度，不流式）。
 */
function DemoStage({ mode, delay }: { mode: DemoMode; delay?: number }) {
  const result = delay === undefined ? mode.after : <Stream text={mode.after} delay={delay} />
  const note = mode.note ? <p className="demo-note">{mode.note}</p> : null

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

  if (mode.id === 'ocr') {
    return (
      <>
        <p className="demo-shot source-text">{mode.before}</p>
        <div className="demo-popover translation-text">{result}</div>
      </>
    )
  }

  // 闪电替换：同一个输入框里，原文划掉、译文写在它下面——静止时也是一组前后对照，看得出「换掉了」
  if (mode.id === 'write') {
    return (
      <>
        <div className="demo-field demo-field-replace">
          <p className="demo-replaced">{mode.before}</p>
          <p className="translation-text">{result}</p>
        </div>
        {note}
      </>
    )
  }

  return (
    <>
      <div className="demo-speak">
        <div className="demo-wave" aria-hidden="true">
          {WAVE.map((height, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 固定序列，下标就是身份
            <span key={index} style={{ '--h': `${height}%`, '--i': index } as CSSProperties} />
          ))}
        </div>
        <p className="source-text">{mode.before}</p>
      </div>
      <p className="demo-field translation-text">{result}</p>
      {note}
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
