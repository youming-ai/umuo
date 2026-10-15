import { useEffect, useRef, useState } from 'react'

import { comboFromKey, createDoubleTapRecorder, hotkeyParts } from '../lib/hotkey-format'
import type { Translate } from '../lib/i18n'
import { api } from '../lib/ipc'

/** 录键最多等这么久就自动放弃（Rust 侧的暂停截止是 30 秒，这里留出余量）。 */
const RECORD_TIMEOUT_MS = 25_000

/** 同一时刻只允许一个录键器在录：开始录时广播，其它正在录的自己停下。 */
const RECORDER_START = 'umuo:hotkey-recorder-start'

/**
 * 录快捷键：点一下进入录制，按下新的组合就保存。
 *
 * 录制期间让 Rust 侧暂停所有全局快捷键——否则录 ⌥D 的那一下会顺手触发一次划词翻译。
 * Esc、窗口失焦、超时、组件卸载都会结束录制并恢复快捷键。
 */
export function HotkeyRecorder({
  id,
  value,
  t,
  onCommit,
}: {
  id: string
  value: string
  t: Translate
  onCommit: (next: string) => Promise<unknown>
}) {
  const [recording, setRecording] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // 录制期间的回调里要读最新的值，但不能因为它们变了就重启录制（那会反复开关快捷键暂停）。
  const latest = useRef({ onCommit, value, t })
  latest.current = { onCommit, value, t }

  useEffect(() => {
    if (!recording) return
    void api.setHotkeyRecording(true).catch(() => {})
    const stop = () => setRecording(false)
    // 连按两下修饰键（⌃⌃、右⌘⌘）只能从按下/松开的节奏里认出来，单看一次 keydown 不够。
    const taps = createDoubleTapRecorder()
    const save = (value: string) => {
      stop()
      if (value !== latest.current.value) {
        void latest.current.onCommit(value).catch(() => {})
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const tapped = taps.up(event.code, event.timeStamp)
      if (tapped) save(tapped)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        stop()
        return
      }
      if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code)) {
        taps.down(event.code, event.timeStamp)
      } else {
        taps.other()
      }
      const result = comboFromKey(event)
      if (result.kind === 'waiting') return
      if (result.kind === 'unsupported') {
        setNotice(latest.current.t('prefs.hotkey.unsupported'))
        return
      }
      save(result.value)
    }
    const onOtherStart = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) stop()
    }
    const timer = window.setTimeout(stop, RECORD_TIMEOUT_MS)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    // 两下之间点了鼠标也要打断连按（与 Rust 侧判定同一规则）
    window.addEventListener('pointerdown', taps.other, true)
    window.addEventListener('blur', stop)
    window.addEventListener(RECORDER_START, onOtherStart)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('pointerdown', taps.other, true)
      window.removeEventListener('blur', stop)
      window.removeEventListener(RECORDER_START, onOtherStart)
      void api.setHotkeyRecording(false).catch(() => {})
    }
  }, [recording, id])

  const parts = hotkeyParts(value, t('prefs.hotkey.right'))

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        id={id}
        type="button"
        aria-pressed={recording}
        className={['pref-hotkey', recording ? 'pref-hotkey-recording' : ''].join(' ')}
        onClick={() => {
          setNotice(null)
          if (!recording) window.dispatchEvent(new CustomEvent(RECORDER_START, { detail: id }))
          setRecording((current) => !current)
        }}
      >
        {recording ? (
          <span className="text-text-tertiary">{t('prefs.hotkey.recording')}</span>
        ) : parts.length > 0 ? (
          parts.map((part, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同一组合里可能出现重复的键帽
            <kbd key={index} className="pref-keycap">
              {part}
            </kbd>
          ))
        ) : (
          <span className="text-text-tertiary">{t('prefs.hotkey.unset')}</span>
        )}
      </button>
      {recording && notice && <span className="text-[11px] text-warning">{notice}</span>}
    </div>
  )
}
