/**
 * 生成 umuo 的图标资产（应用图标 + 菜单栏图标 + .icns）。
 *
 * 图形与官网 logo 是同一只水獭（umuo 仓库的 site/apps/web/public/favicon.svg，100×100 设计坐标），
 * 这里用几何图元重画。菜单栏图标是现行 logo 的线稿简化版；应用图标（otterTile）画的还是
 * 2026-11 精简之前的那版 logo（水獭偏右下、带胡须），尚未跟进，改它要重新生成 icon.icns。
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

// ---------------------------------------------------------------- 配色（与 favicon.svg 一致）

const hex = (value: string): RGB => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
]
const BG = hex('#0A84FF')
const FUR = hex('#A8734D')
const FUR_DARK = hex('#7E5236')
const CREAM = hex('#F4E6D2')
const INK = hex('#2A1F1A')
const WATER = hex('#5FB2FF')
const BLUSH = hex('#FF9FB0')
const WHITE: RGB = [255, 255, 255]
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

/** 奇偶规则的多边形 */
function polygon(points: Pt[]): Shape {
  return {
    box: bounds(points),
    inside: (x, y) => {
      let hit = false
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i]
        const [xj, yj] = points[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
      }
      return hit
    },
  }
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

const shift = (shape: Shape, dy: number): Shape => ({
  box: [shape.box[0], shape.box[1] + dy, shape.box[2], shape.box[3] + dy],
  inside: (x, y) => shape.inside(x, y - dy),
})

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

// ---------------------------------------------------------------- 水獭

/** SVG 的描边居中：白边画成外扩 half 的形状，填充画成内缩 half 的形状 */
const OUTLINE = 1.75

/** 应用图标：蓝底圆角方块，水獭从水里探出头。画的是 2026-11 精简之前的那版 logo（见文件头）。 */
function otterTile(): { clip: Shape; layers: Layer[] } {
  const nose = polygon([
    [53, 68],
    ...quad([53, 68], [60, 65], [67, 67.5]),
    ...quad([67, 67.5], [67.5, 72], [60, 74]),
    ...quad([60, 74], [52.5, 72.5], [53, 68]),
  ])
  const mouth: Pt[][] = [
    [
      [60, 74],
      [60, 77],
    ],
    [[60, 77], ...quad([60, 77], [56.5, 80.5], [53, 78])],
    [[60, 77], ...quad([60, 77], [63.5, 80.5], [67, 78])],
  ]
  const whiskers: Pt[][] = [
    [
      [43, 73],
      [30, 70],
    ],
    [
      [43, 77],
      [29, 78],
    ],
    [
      [77, 71],
      [91, 67],
    ],
    [
      [78, 75],
      [92, 74],
    ],
  ]
  // 水面：M0 89 Q8 84 16 89 T32 89 …，T 是对上一个控制点的镜像，即每段控制点在 y=84 / 94 交替
  const crest: Pt[] = [[0, 89]]
  for (let i = 0; i < 7; i++) {
    const x = i * 16
    crest.push(...quad([x, 89], [x + 8, i % 2 === 0 ? 84 : 94], [x + 16, 89]))
  }
  const water = polygon([...crest, [112, 100], [0, 100]])
  const ring = (cx: number, cy: number, r: number): Layer[] => [
    [ellipse(cx, cy, r + OUTLINE), WHITE],
    [ellipse(cx, cy, r - OUTLINE), FUR],
  ]

  return {
    clip: roundRect(0, 0, 100, 100, 22),
    layers: [
      [roundRect(0, 0, 100, 100, 22), BG],
      ...ring(27, 52, 7.5),
      ...ring(95, 47, 7.5),
      [ellipse(61, 70, 38 + OUTLINE, 33 + OUTLINE), WHITE],
      [ellipse(61, 70, 38 - OUTLINE, 33 - OUTLINE), FUR],
      [ellipse(27, 52, 5.8), FUR],
      [ellipse(95, 47, 5.8), FUR],
      [ellipse(28, 52, 3), FUR_DARK],
      [ellipse(94, 47, 3), FUR_DARK],
      [ellipse(61, 70, 36.2, 31.2), FUR],
      [ellipse(60, 77, 29, 17), CREAM],
      [ellipse(45, 61, 4.4, 5), INK],
      [ellipse(74, 58, 4.4, 5), INK],
      [ellipse(46.4, 59.3, 1.6), WHITE],
      [ellipse(75.4, 56.3, 1.6), WHITE],
      [nose, INK],
      ...mouth.map((line): Layer => [stroke(line, 1.8), INK]),
      ...whiskers.map((line): Layer => [stroke(line, 1.4), FUR_DARK]),
      [ellipse(36, 69, 4.2, 2.8), BLUSH, 0.55],
      [ellipse(84, 65, 4.2, 2.8), BLUSH, 0.55],
      // 水面的白边：整片水往上挪半个描边宽度先铺一层白
      [shift(water, -1.5), WHITE],
      [shift(water, 1.5), WATER],
      [ellipse(44, 89, 7 + 1.25, 4.5 + 1.25), WHITE],
      [ellipse(44, 89, 7 - 1.25, 4.5 - 1.25), FUR],
      [ellipse(77, 88, 7 + 1.25, 4.5 + 1.25), WHITE],
      [ellipse(77, 88, 7 - 1.25, 4.5 - 1.25), FUR],
    ],
  }
}

// ---------------------------------------------------------------- 菜单栏剪影
//
// logo 的线稿简化版：扁宽的头、两侧偏低的小耳朵、眼睛和鼻子三个点，下面一道水波，头的下缘
// 跟着水波裁掉，像刚从水里探出来。设计坐标 0..100 对应整张 20pt 画布（1pt = 5 个单位）：
// 图形横向占 9.5..90.5（约 16pt），四周各留约 2pt；线宽 1.4pt，与 SF Symbols 常规字重相近。

/** 头部轮廓与水波共用的线宽 */
const TRAY_LINE = 7
const TRAY_HEAD = { cx: 50, cy: 50, rx: 31, ry: 22 }
/** 头部下缘与水波之间留的空隙 */
const TRAY_GAP = 4.5

/** 水波中心线：两边高、中间低，头正好浮在中间的波谷上 */
const TRAY_WAVE: Pt[] = [[13, 70]]
for (let i = 0; i < 3; i++) {
  const x = 13 + (i * 74) / 3
  TRAY_WAVE.push(...quad([x, 70], [x + 37 / 3, i % 2 === 0 ? 64 : 76], [x + 74 / 3, 70]))
}

/** 水波中心线在 x 处的高度（折线插值） */
function trayWaveY(x: number): number {
  for (let i = 1; i < TRAY_WAVE.length; i++) {
    const [ax, ay] = TRAY_WAVE[i - 1]
    const [bx, by] = TRAY_WAVE[i]
    if (x <= bx) return x <= ax ? ay : ay + ((by - ay) * (x - ax)) / (bx - ax)
  }
  return TRAY_WAVE[TRAY_WAVE.length - 1][1]
}

/** 水面以上：头和耳朵只画这一部分 */
const ABOVE_WATER: Shape = {
  box: [0, 0, 100, 100],
  inside: (x, y) => y <= trayWaveY(x) - TRAY_LINE / 2 - TRAY_GAP,
}

/** 头的外形：上半是椭圆，中线以下两侧竖直入水（整个椭圆的话下巴会收窄，像悬在水面上） */
function trayDome(grow: number): Shape {
  const { cx, cy } = TRAY_HEAD
  const rx = TRAY_HEAD.rx + grow
  const ry = TRAY_HEAD.ry + grow
  return {
    box: [cx - rx, cy - ry, cx + rx, 100],
    inside: (x, y) =>
      y <= cy ? ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 : Math.abs(x - cx) <= rx,
  }
}

/** 眼睛和鼻子：实心点，@2x 下各约 3px 宽，再小就糊了 */
const TRAY_FACE = [
  ellipse(38, 43, 4.2, 4.8),
  ellipse(62, 43, 4.2, 4.8),
  ellipse(50, 52.5, 5.8, 3.6),
]

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

/** macOS 应用图标：1024 画布里图标本体占 824，四周留白（Big Sur 起的图标网格） */
function renderAppIcon(size: number): Canvas {
  const SS = 2 // 再乘一层超采样，让 16px 的边缘也不毛
  const canvas = createCanvas(size * SS, size * SS)
  const inset = (100 / 1024) * size * SS
  const view = { x: inset, y: inset, size: size * SS - inset * 2 }
  const { clip, layers } = otterTile()
  for (const layer of layers) paint(canvas, view, layer, clip)
  return downsample(canvas, size)
}

/**
 * 菜单栏模板图：黑色线稿，运行时设 isTemplate，由系统按菜单栏明暗着色（菜单栏图标只有这一种样式）。
 */
function renderTrayIcon(size: number): Canvas {
  const canvas = createCanvas(size, size)
  const view = { x: 0, y: 0, size }
  const half = TRAY_LINE / 2
  // 先铺实心的耳朵和头，再把头的内部挖空，剩下一圈轮廓和露在外面的半个耳朵
  const solid = [ellipse(19, 38, 6.5), ellipse(81, 38, 6.5), trayDome(half)]
  for (const shape of solid) paint(canvas, view, [shape, BLACK], ABOVE_WATER)
  punch(canvas, view, [trayDome(-half)])
  for (const shape of TRAY_FACE) paint(canvas, view, [shape, BLACK])
  paint(canvas, view, [stroke(TRAY_WAVE, TRAY_LINE), BLACK])
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
