import { type FormEvent, useId, useState } from 'react'
import type { NotifyFormContent } from '../content/types'
import { CloseIcon } from './icons'

interface NotifyFormProps {
  content: NotifyFormContent
  /** 卡片名（平台或方案），随订阅一起存下来用于区分来源 */
  platformName: string
  onClose: () => void
}

type Status = 'idle' | 'sending' | 'sent' | 'failed'

/**
 * 上线通知表单。提交走同源的 `/api/notify`（umuo.app 那个 Worker，见 docs/DEPLOY.md），
 * 名单存在 Workers KV 里。
 *
 * 为什么不再是 mailto：让用户为了订阅去配一个邮件客户端，是把我们自己的麻烦
 * 转嫁给他；而且 mailto 也让我们看不到「到底有多少人订阅了」。代价是站点开始
 * 存邮箱，所以文案里把「存了什么、怎么删」写清楚（PRD §10 把邮件订阅列为官网能力，
 * §517 要求上线前提供隐私政策）。
 */
export function NotifyForm({ content, platformName, onClose }: NotifyFormProps) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const fieldId = useId()
  const titleId = useId()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('sending')
    try {
      const response = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, source: platformName }),
      })
      // 限流（429）与校验失败（400）都归到「这次没成功」，对用户是同一件事：重试
      setStatus(response.ok ? 'sent' : 'failed')
    } catch {
      // 离线，或本地 `bun run dev:web` 时没有 Worker 在跑
      setStatus('failed')
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className="card-surface u-accent-border mt-8 bg-transparent text-left"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id={titleId} className="font-heading text-lg font-semibold text-text-primary">
            {content.title}
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">{content.description}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost h-10 w-10 min-w-10 shrink-0 p-0"
          aria-label={content.cancel}
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      {status === 'sent' ? (
        <p role="status" className="mt-6 text-sm text-text-secondary">
          {content.hint}
        </p>
      ) : (
        <form className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
          <div className="flex flex-1 flex-col gap-2">
            <label htmlFor={fieldId} className="text-sm font-medium text-text-secondary">
              {content.emailLabel}
            </label>
            <input
              id={fieldId}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={content.emailPlaceholder}
              className="h-12 border border-border bg-transparent px-4 text-text-primary placeholder:text-text-muted"
            />
          </div>
          <button type="submit" className="btn-primary" disabled={status === 'sending'}>
            {content.submit}
          </button>
        </form>
      )}

      {status === 'failed' ? (
        <p role="alert" className="mt-3 text-sm text-text-secondary">
          {content.error}
        </p>
      ) : null}
    </section>
  )
}
