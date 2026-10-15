/**
 * 极简 PNG 编码器（仅供 `scripts/` 下的资产生成脚本使用）。
 *
 * 为什么自己写而不引 sharp / canvas：
 * 我们只需要「画几何图形 → RGBA 像素 → PNG」这一件事，而这类原生依赖会给
 * `bun install` 加上几十兆的平台相关二进制，CI 上还得按平台装不同的包。
 * PNG 的容器格式足够简单，几十行就能写完，而且输出**确定性**——
 * 同样的输入在任何机器上得到同样的字节，便于用 sha256 校验重构没有改变行为。
 *
 * 用法示例见 `make-icons.ts`。
 */

import { deflateSync } from 'node:zlib'

export type RGB = [number, number, number]

export interface Canvas {
  width: number
  height: number
  /** RGBA，长度 = width * height * 4。 */
  data: Uint8Array
}

export function createCanvas(width: number, height: number): Canvas {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

// ---------------------------------------------------------------- 编码

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** 把 RGBA 画布编码成 8-bit RGBA PNG。 */
export function encodePng(canvas: Canvas): Buffer {
  const { width, height, data } = canvas
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', new Uint8Array()),
  ])
}
