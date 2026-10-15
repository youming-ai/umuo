//! 文字识别（PRD §5.5 截图 OCR 的后半段）。

use crate::capture::ScreenImage;
use crate::error::PlatformError;

/// 识别出的一行文字。
#[derive(Debug, Clone, PartialEq)]
pub struct OcrLine {
    pub text: String,
    /// 0..1。Vision 给的是这个量级。
    pub confidence: f32,
}

/// 一次识别的结果。
#[derive(Debug, Clone, PartialEq)]
pub struct OcrResult {
    /// 按行拼好的整段文本——直接拿去翻译的就是它。
    pub text: String,
    pub lines: Vec<OcrLine>,
}

impl OcrResult {
    /// 从行构造结果。空行会被丢掉：它们在翻译 prompt 里只会变成噪声。
    pub fn from_lines(lines: Vec<OcrLine>) -> Self {
        let kept: Vec<OcrLine> = lines
            .into_iter()
            .filter(|line| !line.text.trim().is_empty())
            .collect();
        let text = kept
            .iter()
            .map(|line| line.text.trim())
            .collect::<Vec<_>>()
            .join("\n");
        Self { text, lines: kept }
    }

    /// 什么都没识别出来。截图 OCR 里这很常见（截的是图片、纯色区域），
    /// 需要有别于「识别失败」的独立处理。
    pub fn is_empty(&self) -> bool {
        self.text.trim().is_empty()
    }
}

pub trait Ocr: Send + Sync {
    /// 识别一张位图里的文字。
    ///
    /// 实现约定：识别不出文字是**正常结果**（返回空的 [`OcrResult`]），
    /// 只有「引擎本身不可用」才返回 `Err`。
    fn recognize(&self, image: &ScreenImage) -> Result<OcrResult, PlatformError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, confidence: f32) -> OcrLine {
        OcrLine {
            text: text.to_string(),
            confidence,
        }
    }

    #[test]
    fn lines_are_joined_with_newlines_in_reading_order() {
        let result = OcrResult::from_lines(vec![line("Hello", 0.9), line("world", 0.8)]);
        assert_eq!(result.text, "Hello\nworld");
        assert_eq!(result.lines.len(), 2);
    }

    #[test]
    fn blank_lines_are_dropped_so_they_do_not_pollute_the_prompt() {
        // 空行进了翻译 prompt 只会变成噪声，还可能让模型输出多余的空行。
        let result = OcrResult::from_lines(vec![
            line("Hello", 0.9),
            line("   ", 0.5),
            line("world", 0.8),
        ]);
        assert_eq!(result.text, "Hello\nworld");
        assert_eq!(result.lines.len(), 2);
    }

    #[test]
    fn surrounding_whitespace_is_trimmed_per_line() {
        let result = OcrResult::from_lines(vec![line("  Hello  ", 0.9)]);
        assert_eq!(result.text, "Hello");
    }

    #[test]
    fn no_text_is_a_normal_empty_result_not_an_error() {
        // 截到图片或纯色区域时很常见，必须有别于「识别失败」。
        let result = OcrResult::from_lines(vec![]);
        assert!(result.is_empty());
        assert!(result.text.is_empty());
        assert!(result.lines.is_empty());
    }

    #[test]
    fn confidence_is_preserved_per_line() {
        let result = OcrResult::from_lines(vec![line("low", 0.31), line("high", 0.99)]);
        assert!((result.lines[0].confidence - 0.31).abs() < 1e-6);
        assert!((result.lines[1].confidence - 0.99).abs() < 1e-6);
    }
}
