import { type CSSProperties, useEffect, useRef, useState } from 'react'

const GLYPHS = [
  'あ',
  'A',
  '文',
  'Ü',
  '한',
  'Ş',
  'か',
  'ñ',
  'ع',
  'И',
  '語',
  'Ω',
  'さ',
  'ب',
  '字',
  'א',
]

/** 两层共用同一网格，亮层只在指针附近显露；不让每次移动触发 React 渲染。 */
export function LanguageGrid() {
  const ref = useRef<HTMLDivElement>(null)
  // 首次渲染固定尺寸以兼容预渲染，挂载后再按视口补齐行列。
  const [size, setSize] = useState({ columns: 16, rows: 8 })
  const cells = Array.from({ length: size.columns * size.rows }, (_, index) => ({
    id: index,
    glyph: GLYPHS[(index * 7 + Math.floor(index / size.columns) * 3) % GLYPHS.length],
  }))

  useEffect(() => {
    const resize = () => {
      const cellSize =
        (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 6
      const columns = Math.max(1, Math.ceil(window.innerWidth / cellSize))
      const rows = Math.max(1, Math.ceil(window.innerHeight / cellSize))
      setSize((previous) =>
        previous.columns === columns && previous.rows === rows ? previous : { columns, rows },
      )
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const element = ref.current
    const host = element?.parentElement
    if (!element || !host) return

    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let x = 0
    let y = 0

    const reset = () => {
      cancelAnimationFrame(frame)
      frame = 0
      element.style.setProperty('--grid-active', '0')
    }
    const syncPreference = () => {
      if (!pointer.matches || motion.matches) reset()
    }
    const move = (event: PointerEvent) => {
      if (!pointer.matches || motion.matches || event.pointerType === 'touch') return
      // 只记坐标；读布局放进帧回调里，每帧最多一次，而不是每次 pointermove 都强制回流
      x = event.clientX
      y = event.clientY
      if (frame) return
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect()
        element.style.setProperty('--grid-x', `${x - bounds.left}px`)
        element.style.setProperty('--grid-y', `${y - bounds.top}px`)
        element.style.setProperty('--grid-active', '1')
        frame = 0
      })
    }

    host.addEventListener('pointermove', move)
    host.addEventListener('pointerleave', reset)
    pointer.addEventListener('change', syncPreference)
    motion.addEventListener('change', syncPreference)
    return () => {
      reset()
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerleave', reset)
      pointer.removeEventListener('change', syncPreference)
      motion.removeEventListener('change', syncPreference)
    }
  }, [])

  return (
    <div
      ref={ref}
      className="language-grid"
      aria-hidden="true"
      style={{ '--grid-columns': size.columns } as CSSProperties}
    >
      {['base', 'glow'].map((layer) => (
        <div key={layer} className={`language-grid-layer language-grid-${layer}`}>
          <div className="language-grid-cells">
            {cells.map(({ id, glyph }) => (
              <span key={id}>{glyph}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
