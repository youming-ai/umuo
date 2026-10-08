import { useEffect, useRef } from 'react'

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
const CELLS = Array.from({ length: 128 }, (_, index) => ({
  id: index,
  glyph: GLYPHS[(index * 7 + Math.floor(index / 16) * 3) % GLYPHS.length],
}))

/** 两层共用同一网格，亮层只在指针附近显露；不让每次移动触发 React 渲染。 */
export function LanguageGrid() {
  const ref = useRef<HTMLDivElement>(null)

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
      const bounds = element.getBoundingClientRect()
      x = event.clientX - bounds.left
      y = event.clientY - bounds.top
      if (frame) return
      frame = requestAnimationFrame(() => {
        element.style.setProperty('--grid-x', `${x}px`)
        element.style.setProperty('--grid-y', `${y}px`)
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
    <div ref={ref} className="language-grid" aria-hidden="true">
      {['base', 'glow'].map((layer) => (
        <div key={layer} className={`language-grid-layer language-grid-${layer}`}>
          <div className="language-grid-cells">
            {CELLS.map(({ id, glyph }) => (
              <span key={id}>{glyph}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
