/**
 * 设置的「改了就存」队列。
 *
 * 四条规则，各自防一种真实会出的坏状态：
 * 1. **逐个保存、不并发**：两次保存同时在路上时，后发先至会让旧值覆盖新值。
 * 2. **每次只提交自己的改动，叠在「后端此刻的值」之上**（由 `save` 负责现读现写）：
 *    设置窗开着的时候，浮窗、撰写窗也会写设置（例如按 App 记住的目标语言）。
 *    拿窗口里的旧快照整份写回，会把它们刚写的东西抹掉。
 * 3. **失败就把这几个字段退回存好的值**，并把错误交给调用方显示在那一行；
 *    一个字段的坏值不会搭上后面任何一次保存的车。只退回「这次提交仍是最新一次改它」的字段——
 *    同一个字段后面又改过的话，失败的旧提交不能把新值冲掉。
 * 4. **空闲时可以整体刷新**（窗口重新获得焦点时），让界面跟上别处写进来的值。
 */
export interface SettingsQueue<T extends object> {
  commit: (patch: Partial<T>) => Promise<void>
  /** 没有保存在路上时，用后端的最新值替换界面；有的话忽略（落定后自然会同步）。 */
  refresh: (latest: T) => void
  /** 当前界面上应显示的值（含尚在保存中的改动）。 */
  current: () => T
}

export function createSettingsQueue<T extends object>(
  initial: T,
  /** 把这次的改动叠在后端最新值上保存，返回规范化后的完整设置。 */
  save: (patch: Partial<T>) => Promise<T>,
  onChange: (shown: T) => void,
): SettingsQueue<T> {
  let saved = initial
  let shown = initial
  let pending = 0
  let chain: Promise<void> = Promise.resolve()
  /** 每个字段最近一次提交的序号：失败回滚时只退回仍由这次提交「拥有」的字段。 */
  const latest = new Map<keyof T, number>()
  let sequence = 0

  const show = (next: T) => {
    shown = next
    onChange(shown)
  }

  const commit = (patch: Partial<T>): Promise<void> => {
    show({ ...shown, ...patch })
    pending += 1
    const mine = ++sequence
    for (const key of Object.keys(patch) as Array<keyof T>) latest.set(key, mine)
    const run = chain.then(async () => {
      try {
        saved = await save(patch)
      } catch (error) {
        const revert: Partial<T> = {}
        for (const key of Object.keys(patch) as Array<keyof T>) {
          if (latest.get(key) === mine) revert[key] = saved[key]
        }
        show({ ...shown, ...revert })
        throw error
      } finally {
        pending -= 1
      }
      if (pending === 0) show(saved)
    })
    chain = run.catch(() => {})
    return run
  }

  const refresh = (latest: T) => {
    if (pending > 0) return
    saved = latest
    show(latest)
  }

  return { commit, refresh, current: () => shown }
}
