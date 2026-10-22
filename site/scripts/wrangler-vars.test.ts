import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unstable_readConfig } from 'wrangler'
import { readVar, writeVar } from './wrangler-vars'

const CONFIG = join(import.meta.dirname, '..', 'wrangler.jsonc')
const real = readFileSync(CONFIG, 'utf8')
const comments = (text: string) => text.split('\n').filter((l) => l.trim().startsWith('//'))

/** 交给 wrangler 自己解析，确认改写后仍是它认的配置 */
function parse(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'wrangler-vars-'))
  const path = join(dir, 'wrangler.jsonc')
  writeFileSync(path, text)
  return unstable_readConfig({ config: path })
}

describe('wrangler.jsonc 的 vars 读写', () => {
  it('读得到真实配置里 waffo-setup.ts 要的每一项', () => {
    const vars = parse(real).vars
    for (const name of [
      'WAFFO_ENV',
      'WAFFO_MERCHANT_ID',
      'WAFFO_STORE_ID',
      'WAFFO_PRODUCT_PREMIUM_MONTHLY',
      'WAFFO_PRODUCT_PREMIUM_YEARLY',
    ]) {
      expect(readVar(real, name)).toBe(vars[name])
    }
  })

  it('改写一项：只动这一行，注释原样保留，wrangler 解析出的 vars 只差这一项', () => {
    const next = writeVar(real, 'WAFFO_PRODUCT_PREMIUM_MONTHLY', 'PROD_test123')
    expect(readVar(next, 'WAFFO_PRODUCT_PREMIUM_MONTHLY')).toBe('PROD_test123')
    expect(comments(next)).toEqual(comments(real))
    // 只有这一行变了
    const changed = next.split('\n').filter((l, i) => l !== real.split('\n')[i])
    expect(changed).toEqual(['    "WAFFO_PRODUCT_PREMIUM_MONTHLY": "PROD_test123",'])
    expect(parse(next).vars).toEqual({
      ...parse(real).vars,
      WAFFO_PRODUCT_PREMIUM_MONTHLY: 'PROD_test123',
    })
  })

  it('注释掉的占位读出来是 null，写入时去掉注释并保留逗号', () => {
    const text = '{\n  "vars": {\n    // "A": "",\n    "B": "x"\n  }\n}\n'
    expect(readVar(text, 'A')).toBeNull()
    const next = writeVar(text, 'A', 'PROD_1')
    expect(next).toBe('{\n  "vars": {\n    "A": "PROD_1",\n    "B": "x"\n  }\n}\n')
    expect(readVar(next, 'B')).toBe('x')
  })

  it('找不到这一行就报错，而不是悄悄不写', () => {
    expect(() => writeVar(real, 'NO_SUCH_VAR', 'x')).toThrow('找不到 NO_SUCH_VAR')
  })
})
