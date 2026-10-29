import base from '../void.config'

describe('Void', () => {
  it('正式配置保留域名、现有绑定与访问开关', () => {
    expect(base.cloudflare).toMatchObject({
      name: 'umuo-app',
      routes: [{ pattern: 'umuo.app', custom_domain: true }],
      workers_dev: false,
      preview_urls: false,
      version_metadata: { binding: 'VERSION_METADATA' },
      kv_namespaces: [
        { binding: 'NOTIFY_KV', id: 'dad4b460f4a14797adc1e9491e42f7f1' },
        { binding: 'LICENSES', id: '9afc88feb77741739cbdb9929343e487' },
      ],
      r2_buckets: [{ binding: 'RELEASES', bucket_name: 'umuo-releases' }],
    })
    expect(base.worker?.compatibility_date).toBe('2026-07-17')
    expect(base.worker?.compatibility_flags).toEqual(['nodejs_compat'])
  })
})
