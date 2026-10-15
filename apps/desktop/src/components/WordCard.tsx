import { api, type WordCard } from '../lib/ipc'

/**
 * 单词词卡（PRD §5.2）。
 *
 * 与「一行译文」的区别在于它要能被人**读进去**：音标在上、释义按常用度排、
 * 词形变化与例句跟在后面。所以它单独一个组件，而不是往现有那段文本里塞更多行。
 */
export function WordCardView({ card }: { card: WordCard }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold text-text-primary">{card.word}</span>
        {card.phonetic && <span className="text-xs text-text-tertiary">{card.phonetic}</span>}
        <button
          type="button"
          className="umuo-pressable ml-auto rounded-control px-2 py-0.5 text-[11px] text-text-secondary"
          onClick={() => void api.speakText(card.word)}
        >
          朗读
        </button>
      </div>

      {card.senses.length > 0 && (
        <ul className="space-y-1">
          {card.senses.map((sense) => (
            // key 由内容派生，不用下标——React 的 reconciliation 依赖 key 的稳定性，
            // 下标在内容变化时会把状态错配到别的行上（这条也被 lint 拦下来了）。
            <li key={`${sense.partOfSpeech}|${sense.definition}`} className="flex gap-2 text-sm">
              {sense.partOfSpeech && (
                <span className="shrink-0 text-text-tertiary">{sense.partOfSpeech}</span>
              )}
              <span className="text-text-primary">{sense.definition}</span>
            </li>
          ))}
        </ul>
      )}

      {card.forms.length > 0 && (
        <p className="text-xs text-text-secondary">{card.forms.join(' / ')}</p>
      )}

      {card.examples.length > 0 && (
        <ul className="space-y-1 border-t border-border-secondary pt-2">
          {card.examples.map((example) => (
            <li key={`${example.source}|${example.target}`} className="text-xs">
              <p className="text-text-secondary">{example.source}</p>
              <p className="text-text-tertiary">{example.target}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
