import SwiftUI

/// 单词词卡（PRD §5.2），`apps/desktop/src/components/WordCard.tsx` 的移植。
///
/// 与「一行译文」的区别在于它要能被人**读进去**：音标在上、释义按常用度排、词形变化与例句跟在后面。
struct WordCardView: View {
    let card: WordCard
    let palette: Palette
    let t: Translate
    let speak: () -> Void
    @Environment(\.metrics) private var m

    var body: some View {
        let p = palette
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(card.word).font(.system(size: m.title, weight: .semibold))
                    .foregroundStyle(p.textPrimary.color)
                if let phonetic = card.phonetic, !phonetic.isEmpty {
                    Text(phonetic).font(.system(size: m.small)).foregroundStyle(p.textTertiary.color)
                }
                Spacer(minLength: 0)
                PanelButton(t("wordCard.speak"), size: m.caption, color: p.textSecondary, palette: p,
                            action: speak)
            }

            if !card.senses.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    // 行的标识由内容派生，不用下标：内容变化时下标会把状态错配到别的行上
                    ForEach(card.senses, id: \.self) { sense in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            if !sense.partOfSpeech.isEmpty {
                                Text(sense.partOfSpeech).foregroundStyle(p.textTertiary.color).fixedSize()
                            }
                            Text(sense.definition).foregroundStyle(p.textPrimary.color)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .font(.system(size: m.body))
                    }
                }
            }

            if !card.forms.isEmpty {
                Text(card.forms.joined(separator: " / "))
                    .font(.system(size: m.small)).foregroundStyle(p.textSecondary.color)
            }

            if !card.examples.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(card.examples, id: \.self) { example in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(example.source).foregroundStyle(p.textSecondary.color)
                            Text(example.target).foregroundStyle(p.textTertiary.color)
                        }
                        .font(.system(size: m.small))
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { Rectangle().fill(p.borderSecondary.color).frame(height: 1) }
            }
        }
        .textSelection(.enabled)
    }
}
