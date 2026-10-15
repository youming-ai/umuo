import { LANGUAGES } from '../lib/languages'

/**
 * 语言下拉。
 *
 * 从设置页抽出来，因为现在有两个用户：设置页与首次引导。
 * 两处各写一份，迟早出现「引导里选得到的语言，设置页里没有」。
 */
export function LanguageSelect({
  id,
  value,
  onChange,
  className = 'w-full rounded-control border border-border bg-background px-2 py-1.5 text-sm',
}: {
  id: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {LANGUAGES.map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  )
}
