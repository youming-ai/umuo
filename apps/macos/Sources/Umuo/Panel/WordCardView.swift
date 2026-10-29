import SwiftUI

/// 单词词卡（PRD §5.2）。
///
/// 与「一行译文」的区别在于它要能被人**读进去**：音标在上、释义按常用度排。
/// 词形变化与例句这类学习内容已退出（第四批精简）。
struct WordCardView: View {
    let card: WordCard
    let t: Translate
    let speak: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(card.word).font(.headline)
                    .foregroundStyle(Color.primary)
                if let phonetic = card.phonetic, !phonetic.isEmpty {
                    Text(phonetic).font(.callout).foregroundStyle(Color.secondary)
                }
                Spacer(minLength: 0)
                PanelButton(t("wordCard.speak"), systemImage: "speaker.wave.2", action: speak)
            }

            if !card.senses.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    // 行的标识由内容派生，不用下标：内容变化时下标会把状态错配到别的行上
                    ForEach(card.senses, id: \.self) { sense in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            if !sense.partOfSpeech.isEmpty {
                                Text(sense.partOfSpeech).foregroundStyle(Color.secondary).fixedSize()
                            }
                            Text(sense.definition).foregroundStyle(Color.primary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .font(.body)
                    }
                }
            }
        }
        .textSelection(.enabled)
    }
}
