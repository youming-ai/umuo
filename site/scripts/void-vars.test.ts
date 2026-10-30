import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import config from '../void.config'
import { readVar, writeVar } from './void-vars'

const real = readFileSync(join(import.meta.dirname, '..', 'void.config.ts'), 'utf8')
const comments = (text: string) => text.split('\n').filter((line) => line.trim().startsWith('//'))

describe('void.config.ts 的 vars 读写', () => {
  it('读出的 Waffo 值与 Void 配置一致', () => {
    const vars = config.worker?.vars ?? {}
    for (const name of ['WAFFO_ENV', 'WAFFO_MERCHANT_ID', 'WAFFO_STORE_ID'] as const) {
      expect(readVar(real, name)).toBe(vars[name])
    }
  })

  it('正式环境还没有买断商品：商品 ID 是注释占位，读出来是空，Worker 收费接口因此回 503', () => {
    expect(readVar(real, 'WAFFO_PRODUCT_LICENSE')).toBeNull()
    expect(config.worker?.vars).not.toHaveProperty('WAFFO_PRODUCT_LICENSE')
    expect(real).not.toMatch(/PREMIUM_(MONTHLY|YEARLY)/)
  })

  it('写入商品 ID 只改占位那一行，保留其他行与注释', () => {
    const next = writeVar(real, 'WAFFO_PRODUCT_LICENSE', 'PROD_test123')
    expect(readVar(next, 'WAFFO_PRODUCT_LICENSE')).toBe('PROD_test123')
    const placeholder = "      // WAFFO_PRODUCT_LICENSE: '',"
    expect(comments(next)).toEqual(comments(real).filter((line) => line !== placeholder))
    const changed = next.split('\n').filter((line, index) => line !== real.split('\n')[index])
    expect(changed).toEqual(["      WAFFO_PRODUCT_LICENSE: 'PROD_test123',"])
  })

  it('注释掉的占位不算已有值，写入时去掉注释并保留逗号', () => {
    const text = "  // A: '',\n  B: 'x',\n"
    expect(readVar(text, 'A')).toBeNull()
    expect(writeVar(text, 'A', 'PROD_1')).toBe("  A: 'PROD_1',\n  B: 'x',\n")
  })

  it('变量名、值不合法或找不到时拒绝写入', () => {
    expect(() => writeVar(real, 'NO_SUCH_VAR', 'x')).toThrow('找不到 NO_SUCH_VAR')
    expect(() => writeVar(real, 'WAFFO_ENV', "x'y")).toThrow('不像一个 ID')
    expect(() => readVar(real, 'bad.name')).toThrow('变量名不合法')
  })
})
