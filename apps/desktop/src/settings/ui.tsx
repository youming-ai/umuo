import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * 设置窗的排版积木：一组（标题 + 圆角底板）里放若干行，每行左边是名字和一句说明，右边是控件。
 *
 * 所有控件都是「改了就存」：下拉框与开关立刻提交；文本框是草稿，失焦或回车才提交，
 * 提交失败就退回上一次存好的值，并把原因写在这一行下面——而不是让人去页面底部找。
 */

export function Group({
  title,
  aside,
  children,
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      {(title || aside) && (
        <div className="flex items-baseline justify-between gap-3 px-1">
          {title && <h2 className="text-[13px] font-semibold text-text-primary">{title}</h2>}
          {aside}
        </div>
      )}
      <div className="pref-group">{children}</div>
    </section>
  )
}

export function Row({
  title,
  description,
  control,
  error,
  children,
  controlId,
}: {
  title: ReactNode
  description?: ReactNode
  /** 右侧控件。 */
  control?: ReactNode
  /** 这一行保存失败时的原因。 */
  error?: string | null
  /** 放在说明下方、占满整行的内容（列表、编辑器等）。 */
  children?: ReactNode
  /** 右侧控件的 id，用于把标题关联成 label。 */
  controlId?: string
}) {
  const Title = controlId ? 'label' : 'p'
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Title
            className="block text-[13px] font-medium text-text-primary"
            {...(controlId ? { htmlFor: controlId } : {})}
          >
            {title}
          </Title>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">{description}</p>
          )}
        </div>
        {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
      </div>
      {error && <p className="mt-1.5 text-xs text-error">{error}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** 读屏用的名字（视觉上的名字在行标题里）。 */
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="pref-switch"
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function Select<T extends string | number>({
  id,
  value,
  options,
  onChange,
  label,
}: {
  id?: string
  value: T
  options: Array<[T, string]>
  onChange: (next: T) => void
  label?: string
}) {
  return (
    <select
      id={id}
      aria-label={label}
      className="pref-select"
      value={String(value)}
      onChange={(event) => {
        const raw = event.target.value
        const picked = options.find(([option]) => String(option) === raw)
        if (picked) onChange(picked[0])
      }}
    >
      {options.map(([option, text]) => (
        <option key={String(option)} value={String(option)}>
          {text}
        </option>
      ))}
    </select>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  tone = 'default',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      className={['pref-button', tone === 'danger' ? 'text-error' : ''].join(' ')}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * 文本草稿：边打边改本地值，失焦或回车才提交；提交失败退回 `value` 并抛出原因给调用方显示。
 * 外部值变化（例如导入配置、保存失败回滚）时同步草稿。
 */
export function DraftInput({
  id,
  value,
  onCommit,
  placeholder,
  width = 'w-56',
  multiline = false,
  type = 'text',
  list,
  label,
  onError,
  badInputMessage,
}: {
  id?: string
  value: string
  onCommit: (next: string) => Promise<unknown> | undefined
  placeholder?: string
  width?: string
  multiline?: boolean
  type?: 'text' | 'number'
  list?: string
  label?: string
  onError?: (message: string | null) => void
  /** 数字框里填了浏览器认不出的内容（如「10,5」）时显示的提示。 */
  badInputMessage?: string
}) {
  const [draft, setDraft] = useState(value)
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  // 外部值变了（导入、回滚、别处写入）就同步草稿——但用户正在这个框里打字时不同步，
  // 否则一次迟到的保存失败回滚会把他刚敲的内容冲掉。
  useEffect(() => {
    if (document.activeElement !== field.current) setDraft(value)
  }, [value])

  // 提交时读输入框此刻的内容，而不是 state 里的草稿：不依赖「失焦前 React 已经重新渲染过」。
  const commit = (next: string) => {
    // 数字框填了「10,5」这类内容时，浏览器给出的 value 是空串——直接提交会被当成「清空」，
    // 月度上限就这样被悄悄删掉了。认不出来就拒绝提交、说明原因，草稿留着让用户改。
    if (type === 'number' && field.current?.validity.badInput) {
      onError?.(badInputMessage ?? null)
      return
    }
    if (next === value) return
    onError?.(null)
    const pending = onCommit(next)
    if (pending) {
      pending.catch((error: unknown) => {
        setDraft(value)
        onError?.(String(error))
      })
    }
  }

  const common = {
    ref: field,
    id,
    'aria-label': label,
    value: draft,
    placeholder,
    spellCheck: false,
    onBlur: (event: { currentTarget: { value: string } }) => commit(event.currentTarget.value),
    className: `pref-input ${multiline ? 'w-full' : width}`,
  }
  return multiline ? (
    <textarea {...common} rows={4} onChange={(event) => setDraft(event.target.value)} />
  ) : (
    <input
      {...common}
      type={type}
      list={list}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(event.currentTarget.value)
      }}
    />
  )
}

/** 一行的保存错误：给需要在行下显示原因的控件用。 */
export function useRowError() {
  return useState<string | null>(null)
}

/** 右侧那种「›」或「↗」样式的跳转。 */
export function LinkRowButton({
  onClick,
  external = false,
  label,
}: {
  onClick: () => void
  external?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="umuo-pressable rounded-control px-2 py-1 text-text-tertiary"
      onClick={onClick}
    >
      <span aria-hidden="true">{external ? '↗' : '›'}</span>
    </button>
  )
}
