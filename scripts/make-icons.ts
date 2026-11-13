/**
 * 生成 umuo 的图标资产：应用图标（.icns）、菜单栏图标（tray.png）与官网 logo（favicon.svg）。
 *
 * 三处是同一张图——实心的水獭剪影：椭圆的头、两侧小耳朵，眼睛和鼻子镂空，下面一道水波。
 * 几何只在这里写一份（OTTER，100×100 设计坐标）：菜单栏与应用图标由它光栅化，favicon.svg 由它
 * 导出成路径；官网页眉的 `LogoMark` 抄的是 favicon 那两条路径，site 的 logo.test.ts 盯着两者一致。
 * 改图形只改 OTTER，再跑一遍本脚本，然后把 favicon.svg 里的路径同步进 LogoMark（测试会提醒）。
 *
 * 为什么手写光栅化而不是引一个绘图库：图标只需要「圆、椭圆、多边形、圆头线段」，
 * 为此引入 canvas / sharp 这类依赖，会让 `bun install` 多出几十兆原生二进制，
 * 而且 CI 上还要按平台装不同的包。自己画的输出是确定性的——同一个脚本在任何机器上
 * 都得到同样的字节。曲线（SVG 里的二次贝塞尔）拆成折线，图标尺寸下看不出差别。
 *
 * 运行：bun run scripts/make-icons.ts（加 --preview 在终端打 ASCII 自检形状）
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Canvas, createCanvas, encodePng, type RGB } from './png'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ICON_DIR = join(ROOT, 'apps/macos/packaging')
const TRAY_DIR = join(ROOT, 'apps/macos/Sources/Umuo/Resources/Tray')
const FAVICON = join(ROOT, 'site/apps/web/public/favicon.svg')

// ---------------------------------------------------------------- 配色（取自 site/DESIGN.md）

const hex = (value: string): RGB => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
]
/** 咖啡墨 ink：官网浅色主题的墨，也是 favicon 的颜色 */
const INK = '#2a1f1a'
/** 奶油：官网深色主题的墨，favicon 在深色标签栏上用它 */
const CREAM = '#f4e6d2'
const BLACK: RGB = [0, 0, 0]

// ---------------------------------------------------------------- 图元（设计坐标 0..100）

type Pt = [number, number]
interface Shape {
  /** 外接框 [x0, y0, x1, y1]，只在框内采样 */
  box: [number, number, number, number]
  inside(x: number, y: number): boolean
}

function ellipse(cx: number, cy: number, rx: number, ry = rx): Shape {
  return {
    box: [cx - rx, cy - ry, cx + rx, cy + ry],
    inside: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
  }
}

function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Shape {
  return {
    box: [x0, y0, x1, y1],
    inside: (x, y) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false
      const dx = x - Math.min(Math.max(x, x0 + r), x1 - r)
      const dy = y - Math.min(Math.max(y, y0 + r), y1 - r)
      return dx * dx + dy * dy <= r * r
    },
  }
}

function bounds(points: Pt[], pad = 0): Shape['box'] {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ]
}

/** 圆头折线（SVG 的 stroke-linecap="round"），粗细为 width */
function stroke(points: Pt[], width: number): Shape {
  const r = width / 2
  return {
    box: bounds(points, r),
    inside: (x, y) => {
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1]
        const [bx, by] = points[i]
        const lx = bx - ax
        const ly = by - ay
        const t = Math.max(
          0,
          Math.min(1, ((x - ax) * lx + (y - ay) * ly) / (lx * lx + ly * ly || 1)),
        )
        if ((x - ax - t * lx) ** 2 + (y - ay - t * ly) ** 2 <= r * r) return true
      }
      return false
    },
  }
}

/** 二次贝塞尔拆成折线点（不含起点） */
function quad(from: Pt, control: Pt, to: Pt, steps = 12): Pt[] {
  const out: Pt[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push([
      u * u * from[0] + 2 * u * t * control[0] + t * t * to[0],
      u * u * from[1] + 2 * u * t * control[1] + t * t * to[1],
    ])
  }
  return out
}

/** 把图形缩放 k 倍再平移 (dx, dy)：新坐标 = 原坐标 × k + (dx, dy) */
function place(shape: Shape, k: number, dx: number, dy: number): Shape {
  const [x0, y0, x1, y1] = shape.box
  return {
    box: [x0 * k + dx, y0 * k + dy, x1 * k + dx, y1 * k + dy],
    inside: (x, y) => shape.inside((x - dx) / k, (y - dy) / k),
  }
}

// ---------------------------------------------------------------- 画布

function blend(canvas: Canvas, x: number, y: number, color: RGB, alpha: number): void {
  if (alpha <= 0 || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
  const i = (y * canvas.width + x) * 4
  const a = Math.min(1, alpha)
  const src = canvas.data
  const dstA = src[i + 3] / 255
  const outA = a + dstA * (1 - a)
  if (outA === 0) return
  for (let c = 0; c < 3; c++) {
    src[i + c] = Math.round((color[c] * a + src[i + c] * dstA * (1 - a)) / outA)
  }
  src[i + 3] = Math.round(outA * 255)
}

/** 把设计坐标映射到画布：设计坐标 (0,0)-(100,100) 落在 [x, x+size] × [y, y+size] */
interface View {
  x: number
  y: number
  size: number
}

type Layer = [Shape, RGB, number?]

/** 4×4 超采样填充一个图元；clip 外的部分不画 */
function paint(canvas: Canvas, view: View, [shape, color, alpha = 1]: Layer, clip?: Shape): void {
  const S = 4
  const k = view.size / 100
  const [bx0, by0, bx1, by1] = shape.box
  const px0 = Math.max(0, Math.floor(view.x + bx0 * k))
  const py0 = Math.max(0, Math.floor(view.y + by0 * k))
  const px1 = Math.min(canvas.width, Math.ceil(view.x + bx1 * k))
  const py1 = Math.min(canvas.height, Math.ceil(view.y + by1 * k))
  for (let py = py0; py < py1; py++) {
    for (let px = px0; px < px1; px++) {
      let hits = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = (px + (sx + 0.5) / S - view.x) / k
          const v = (py + (sy + 0.5) / S - view.y) / k
          if (shape.inside(u, v) && (!clip || clip.inside(u, v))) hits++
        }
      }
      if (hits > 0) blend(canvas, px, py, color, (hits / (S * S)) * alpha)
    }
  }
}

// ---------------------------------------------------------------- 水獭剪影（唯一的几何来源）

/** 椭圆 [cx, cy, rx, ry] */
type Oval = [number, number, number, number]

const OTTER = {
  /** 实心部分：扁宽的头，两侧偏低的小耳朵 */
  solid: [
    [50, 50, 44, 30],
    [9, 38, 8, 8],
    [91, 38, 8, 8],
  ] as Oval[],
  /** 镂空：两只眼睛和鼻子，透出底色 */
  holes: [
    [34, 46, 6.5, 7],
    [66, 46, 6.5, 7],
    [50, 59, 10, 6],
  ] as Oval[],
  /** 水波：从 x0 到 x1 的几段二次曲线，控制点在 y ∓ swing 上下交替；圆头描边，线宽 line */
  wave: { x0: 4, x1: 96, y: 91, swing: 6, segments: 4, line: 7 },
  /** 图形的外接范围（含描边） */
  bounds: { x0: 0.5, y0: 20, x1: 99.5, y1: 97.5 },
}
const OTTER_CENTER: Pt = [
  (OTTER.bounds.x0 + OTTER.bounds.x1) / 2,
  (OTTER.bounds.y0 + OTTER.bounds.y1) / 2,
]
const WAVE_STEP = (OTTER.wave.x1 - OTTER.wave.x0) / OTTER.wave.segments
const waveControlY = (i: number) => OTTER.wave.y + (i % 2 === 0 ? -1 : 1) * OTTER.wave.swing

const oval = ([cx, cy, rx, ry]: Oval) => ellipse(cx, cy, rx, ry)

/** 水波的光栅图形：曲线拆成折线再加圆头描边 */
function waveShape(): Shape {
  const { x0, y, segments, line } = OTTER.wave
  const points: Pt[] = [[x0, y]]
  for (let i = 0; i < segments; i++) {
    const x = x0 + i * WAVE_STEP
    points.push(...quad([x, y], [x + WAVE_STEP / 2, waveControlY(i)], [x + WAVE_STEP, y], 24))
  }
  return stroke(points, line)
}

/**
 * 把剪影画到画布上：设计坐标先缩放 k 倍、再平移到 (dx, dy)（都在 view 的 0..100 坐标里）。
 * 给了 paper 就用它把眼鼻涂回底色（应用图标）；不给就挖成透明（菜单栏模板图）。
 */
function drawOtter(
  canvas: Canvas,
  view: View,
  ink: RGB,
  at: { k: number; dx: number; dy: number },
  paper?: RGB,
): void {
  const put = (shape: Shape) => place(shape, at.k, at.dx, at.dy)
  for (const item of OTTER.solid) paint(canvas, view, [put(oval(item)), ink])
  const holes = OTTER.holes.map((item) => put(oval(item)))
  if (paper) for (const hole of holes) paint(canvas, view, [hole, paper])
  else punch(canvas, view, holes)
  paint(canvas, view, [put(waveShape()), ink])
}

/** 让剪影在 0..100 的画面里居中、横向占 width 个单位 */
function centered(width: number): { k: number; dx: number; dy: number } {
  const k = width / (OTTER.bounds.x1 - OTTER.bounds.x0)
  return { k, dx: 50 - OTTER_CENTER[0] * k, dy: 50 - OTTER_CENTER[1] * k }
}

// ---------------------------------------------------------------- 官网 logo（SVG）

/** SVG 里的数字：最多两位小数 */
const num = (value: number) => String(Math.round(value * 100) / 100)

/** 一个椭圆的路径；sweep 1 顺时针（实心），0 逆时针（在 nonzero 规则下把实心挖空） */
const ovalPath = ([cx, cy, rx, ry]: Oval, sweep: 0 | 1) =>
  `M${num(cx - rx)} ${num(cy)}a${rx} ${ry} 0 1 ${sweep} ${num(rx * 2)} 0` +
  `a${rx} ${ry} 0 1 ${sweep}${num(-rx * 2)} 0Z`

/**
 * favicon.svg：墨色剪影，标签栏是深色时换成奶油色。取景框是以图形为中心的正方形，四周各留 2.5 个单位。
 * LogoMark（site/apps/web/src/components/icons.tsx）用同样的取景框、两条路径和线宽。
 */
function faviconSvg(): string {
  const { x0, y, segments, line } = OTTER.wave
  const side = OTTER.bounds.x1 - OTTER.bounds.x0 + 5
  const viewBox = [OTTER_CENTER[0] - side / 2, OTTER_CENTER[1] - side / 2, side, side].map(num)
  const body =
    OTTER.solid.map((item) => ovalPath(item, 1)).join('') +
    OTTER.holes.map((item) => ovalPath(item, 0)).join('')
  let wave = `M${x0} ${y}`
  for (let i = 0; i < segments; i++) {
    const end = `${num(x0 + (i + 1) * WAVE_STEP)} ${y}`
    // 第一段写出控制点，后面用 T：控制点自动镜像，正好一上一下
    wave += i === 0 ? `Q${num(x0 + WAVE_STEP / 2)} ${waveControlY(0)} ${end}` : `T${end}`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}" role="img" aria-label="umuo">
  <!-- 由仓库根的 scripts/make-icons.ts 生成（bun run icons），不要手改。
       实心水獭剪影：头、两只耳朵，眼睛和鼻子镂空（反向绕行），下面一道水波；菜单栏图标与应用图标是同一张图。
       src/components/icons.tsx 的 LogoMark 用同样两条路径，__tests__/logo.test.ts 盯着两者一致。
       墨色取 DESIGN.md 的 ink，标签栏是深色时换成深色主题的墨（奶油）。 -->
  <style>
    g { color: ${INK} }
    @media (prefers-color-scheme: dark) { g { color: ${CREAM} } }
  </style>
  <g>
    <path fill="currentColor" d="${body}" />
    <path fill="none" stroke="currentColor" stroke-width="${line}" stroke-linecap="round" d="${wave}" />
  </g>
</svg>
`
}

function punch(canvas: Canvas, view: View, holes: Shape[]): void {
  const S = 4
  const k = view.size / 100
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < canvas.width; px++) {
      let hits = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = (px + (sx + 0.5) / S - view.x) / k
          const v = (py + (sy + 0.5) / S - view.y) / k
          if (holes.some((hole) => hole.inside(u, v))) hits++
        }
      }
      if (hits > 0) {
        const i = (py * canvas.width + px) * 4 + 3
        canvas.data[i] = Math.round(canvas.data[i] * (1 - hits / (S * S)))
      }
    }
  }
}

// ---------------------------------------------------------------- 渲染

/**
 * 应用图标的配色：奶油底、墨色剪影，与 favicon 在浅色标签栏上的样子一致；边缘那一圈比底色深一档。
 * 试过深咖底配奶油剪影：在深色桌面上方块和背景靠得太近，五官的对比也不如这一组。
 */
const APP_TILE = hex(CREAM)
const APP_EDGE = hex('#d9c3a5')
const APP_INK = hex(INK)

/**
 * macOS 应用图标：1024 画布里圆角方块本体占 824，四周留白（Big Sur 起的图标网格）。
 * 方块外沿留一圈略深的细边，浅色桌面上不至于和背景糊在一起；剪影横向占方块的 68%。
 */
function renderAppIcon(size: number): Canvas {
  const SS = 2 // 再乘一层超采样，让 16px 的边缘也不毛
  const canvas = createCanvas(size * SS, size * SS)
  const inset = (100 / 1024) * size * SS
  const view = { x: inset, y: inset, size: size * SS - inset * 2 }
  paint(canvas, view, [roundRect(0, 0, 100, 100, 22), APP_EDGE])
  paint(canvas, view, [roundRect(0.7, 0.7, 99.3, 99.3, 21.3), APP_TILE])
  drawOtter(canvas, view, APP_INK, centered(68), APP_TILE)
  return downsample(canvas, size)
}

/**
 * 菜单栏模板图：黑色剪影、眼鼻透明，运行时设 isTemplate，由系统按菜单栏明暗着色。
 * 20pt 的画布里剪影横向占 18.8pt、纵向约 14.7pt，比 Wi-Fi、电池这些系统符号略高一点。
 * 图形宽高比是 99:77.5，方画布里再放大就要顶到左右两边；想更高得先把画布加宽（并改 StatusBar.swift 的尺寸）。
 */
function renderTrayIcon(size: number): Canvas {
  const canvas = createCanvas(size, size)
  drawOtter(canvas, { x: 0, y: 0, size }, BLACK, centered(94))
  return canvas
}

function downsample(source: Canvas, size: number): Canvas {
  const scale = source.width / size
  const out = createCanvas(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const i = ((y * scale + sy) * source.width + (x * scale + sx)) * 4
          const alpha = source.data[i + 3] / 255
          r += source.data[i] * alpha
          g += source.data[i + 1] * alpha
          b += source.data[i + 2] * alpha
          a += alpha
          n++
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        out.data[o] = Math.round(r / a)
        out.data[o + 1] = Math.round(g / a)
        out.data[o + 2] = Math.round(b / a)
      }
      out.data[o + 3] = Math.round((a / n) * 255)
    }
  }
  return out
}

/**
 * 组装 .icns。格式是「容器 + 若干 (类型码, 长度, PNG)」，够简单，自己写，不依赖 iconutil 之类的外部工具。
 */
function encodeIcns(entries: Array<{ type: string; png: Buffer }>): Buffer {
  const chunks = entries.map(({ type, png }) => {
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const total = 8 + chunks.reduce((sum, c) => sum + c.length, 0)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(total, 4)
  return Buffer.concat([header, ...chunks])
}

/**
 * 把图标打成 ASCII 打到终端：图标是**生成**出来的，没人肉看过一眼就没法确认形状
 * （`file` 只能告诉你「这是个合法 PNG」）。`bun run scripts/make-icons.ts --preview`
 */
function preview(canvas: Canvas, byAlpha = false): string {
  // 应用图标用「亮度 × alpha」：整块都不透明，只看 alpha 看不出图案；
  // 菜单栏模板图是纯黑剪影，亮度恒为 0，只能看 alpha
  const ramp = ' .:-=+*#%@'
  const rows: string[] = []
  for (let y = 0; y < canvas.height; y++) {
    let row = ''
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      const alpha = canvas.data[i + 3] / 255
      const luma =
        (0.299 * canvas.data[i] + 0.587 * canvas.data[i + 1] + 0.114 * canvas.data[i + 2]) / 255
      const value = byAlpha ? alpha : luma * alpha
      row += ramp[Math.min(ramp.length - 1, Math.round(value * (ramp.length - 1)))]
    }
    rows.push(row)
  }
  return rows.join('\n')
}

// ---------------------------------------------------------------- 输出

if (process.argv.includes('--preview')) {
  process.stdout.write('\n=== 应用图标（32×32）===\n')
  process.stdout.write(`${preview(renderAppIcon(32))}\n`)
  process.stdout.write('\n=== 菜单栏模板图（40×40）===\n')
  process.stdout.write(`${preview(renderTrayIcon(40), true)}\n`)
}

mkdirSync(ICON_DIR, { recursive: true })
mkdirSync(TRAY_DIR, { recursive: true })

// 菜单栏图标：只有模板图一份
const trayPng = encodePng(renderTrayIcon(40))
writeFileSync(join(TRAY_DIR, 'tray.png'), trayPng)
console.log(`写入 tray.png (40×40, ${trayPng.length} 字节)`)

writeFileSync(FAVICON, faviconSvg())
console.log('写入 favicon.svg')

const icns = encodeIcns([
  { type: 'ic07', png: encodePng(renderAppIcon(128)) },
  { type: 'ic08', png: encodePng(renderAppIcon(256)) },
  { type: 'ic09', png: encodePng(renderAppIcon(512)) },
  { type: 'ic10', png: encodePng(renderAppIcon(1024)) },
  { type: 'ic11', png: encodePng(renderAppIcon(32)) },
  { type: 'ic13', png: encodePng(renderAppIcon(256)) },
  { type: 'ic14', png: encodePng(renderAppIcon(512)) },
])
writeFileSync(join(ICON_DIR, 'icon.icns'), icns)
console.log(`写入 icon.icns (${icns.length} 字节)`)
