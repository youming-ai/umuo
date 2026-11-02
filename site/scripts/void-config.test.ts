import base from '../void.config'

describe('Void', () => {
  it('正式配置保留域名、现有绑定与访问开关', () => {
    expect(base.cloudflare).toMatchObject({
      name: 'umuo',
      routes: [{ pattern: 'umuo.app', custom_domain: true }],
      workers_dev: false,
      preview_urls: false,
      version_metadata: { binding: 'VERSION_METADATA' },
    })
    // 上线通知（KV）与安装包（R2）都已下线：Worker 不再绑定任何 KV / R2
    expect(base.cloudflare).not.toHaveProperty('kv_namespaces')
    expect(base.cloudflare).not.toHaveProperty('r2_buckets')
    expect(base.worker?.compatibility_date).toBe('2026-07-17')
    expect(base.worker?.compatibility_flags).toEqual(['nodejs_compat'])
  })
})
