import { useEffect, useState } from 'react'
import type { ActivateContent } from '../content/types'

/** 轮询间隔与次数：webhook 通常几秒内到，等满一分半还没到就让访客稍后刷新 */
const POLL_MS = 2000
const MAX_POLLS = 45
/** 连续这么多次网络错误才放弃；之前按退避重试（付款结果正在路上，别因为一次抖动就停） */
const MAX_FAILURES = 5
/** 领取码离开地址栏后存在这里：刷新页面还能继续，但不留在浏览器历史里 */
const CLAIM_STORAGE = 'umuo-claim'

type ActivateState =
  | { kind: 'loading' }
  | { kind: 'pending'; polls: number }
  | { kind: 'ready'; key: string }
  | { kind: 'slow' }
  | { kind: 'missing' }
  | { kind: 'unknown' }
  | { kind: 'error' }

function storage(action: (store: Storage) => string | null | undefined): string | null {
  try {
    return action(window.sessionStorage) ?? null
  } catch {
    // 隐私模式等情况下 sessionStorage 不可用：只是刷新后要重新从付款跳转进来
    return null
  }
}

/** 读领取码：优先地址栏（读到后从地址里抹掉），其次本标签页之前存下的 */
function takeClaim(): string | null {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('claim')
  if (!fromUrl) return storage((store) => store.getItem(CLAIM_STORAGE))
  storage((store) => void store.setItem(CLAIM_STORAGE, fromUrl))
  params.delete('claim')
  const rest = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
  )
  return fromUrl
}

/**
 * 付款后的激活页 `/activate?claim=<领取码>`：轮询 `/api/license/claim`，拿到许可证密钥后展示，
 * 并给一个 `umuo://activate?key=…` 深链接。
 *
 * 领取码是拿密钥的凭证：读到就从地址栏抹掉（不进浏览器历史与同步的历史），只存在本标签页。
 * 只在 effect 里读：预渲染时没有地址栏，渲染期读 `window` 会让服务端与客户端结构不一致。
 */
export function ActivatePage({ activate }: { activate: ActivateContent }) {
  const [state, setState] = useState<ActivateState>({ kind: 'loading' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const claim = takeClaim()
    if (!claim) {
      setState({ kind: 'missing' })
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const next = (polls: number, failures: number, delay: number) => {
      if (polls >= MAX_POLLS) return setState({ kind: 'slow' })
      setState({ kind: 'pending', polls })
      timer = setTimeout(() => void poll(polls, failures), delay)
    }
    async function poll(polls: number, failures: number) {
      try {
        const response = await fetch(
          `/api/license/claim?claim=${encodeURIComponent(claim as string)}`,
        )
        if (stopped) return
        if (response.status === 404) {
          storage((store) => void store.removeItem(CLAIM_STORAGE))
          return setState({ kind: 'unknown' })
        }
        // 429、5xx 与网络错误一样算临时故障，下面统一退避重试
        if (!response.ok) throw new Error(String(response.status))
        const body = (await response.json()) as { status?: string; key?: string }
        if (body.status === 'ready' && body.key) return setState({ kind: 'ready', key: body.key })
        next(polls + 1, 0, POLL_MS)
      } catch {
        if (stopped) return
        if (failures + 1 >= MAX_FAILURES) return setState({ kind: 'error' })
        next(polls + 1, failures + 1, POLL_MS * 2 ** failures)
      }
    }
    void poll(0, 0)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])

  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(key)
      setCopied(true)
    } catch {
      // 剪贴板被拒时密钥仍在页面上，可以手动选中复制
    }
  }

  return (
    <article className="activate container-page">
      <h1 className="section-title">{activate.title}</h1>
      <div className="activate-body" aria-live="polite">
        {state.kind === 'ready' ? (
          <>
            <p className="lead">{activate.ready}</p>
            <p className="license-key">
              <span className="sr-only">{activate.keyLabel}</span>
              <code>{state.key}</code>
              <button type="button" className="btn-secondary" onClick={() => void copy(state.key)}>
                {copied ? activate.copied : activate.copy}
              </button>
            </p>
            <a
              className="btn-primary"
              href={`umuo://activate?key=${encodeURIComponent(state.key)}`}
            >
              {activate.openApp}
            </a>
            <ol className="activate-steps">
              {activate.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </>
        ) : (
          <p className="lead">
            {state.kind === 'missing'
              ? activate.missing
              : state.kind === 'unknown'
                ? activate.unknown
                : state.kind === 'slow'
                  ? activate.slow
                  : state.kind === 'error'
                    ? activate.error
                    : activate.pending}
          </p>
        )}
      </div>
    </article>
  )
}
