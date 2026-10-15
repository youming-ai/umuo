//! macOS 文字识别（Apple Vision，本机运行、不联网、免费）。
//!
//! 之所以选 Vision 而不是「把图发给多模态大模型」：截图 OCR 是高频动作，
//! 每次调用都要上传一张图，既慢又贵，而且用户截的往往是自己屏幕上的东西——
//! 能不出本机就不出本机。多模态识图留给「图片、复杂排版」这类 Vision 做不好的场景，
//! 那是 PRD §5.5 里「可选」的那条路。
//!
//! ## 为什么要把 RGBA 重新包成 CGImage
//!
//! Vision 只吃 `CGImage`。跨平台 trait 传的是裸 RGBA 字节，所以这里按**同样的**
//! 位图信息（预乘、32 位大端）重新包一次。两边用的是同一组常量，
//! 写在两个文件里，改动其中一处就会认不出字——所以两边都注明了这一点。

use core_graphics::base::{kCGBitmapByteOrder32Big, kCGImageAlphaPremultipliedLast};
use core_graphics::color_space::CGColorSpace;
use core_graphics::data_provider::CGDataProvider;
use core_graphics::image::CGImage;
use foreign_types::ForeignType;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AnyThread;
use objc2_foundation::{NSArray, NSDictionary, NSString};
use objc2_vision::{
    VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest,
    VNRequestTextRecognitionLevel,
};
use std::sync::Arc;

use umuo_platform::capture::ScreenImage;
use umuo_platform::ocr::{Ocr, OcrLine, OcrResult};
use umuo_platform::PlatformError;

/// 默认要识别的语言。
///
/// 中英日三种覆盖了本产品的主要用户；Vision 对这些语种的语言模型是随系统内置的。
/// 顺序有意义：识别时它会按这个优先级挑最像的语种。
const RECOGNITION_LANGUAGES: [&str; 3] = ["zh-Hans", "en-US", "ja-JP"];

pub struct MacOcr;

impl Ocr for MacOcr {
    fn recognize(&self, image: &ScreenImage) -> Result<OcrResult, PlatformError> {
        if image.width == 0 || image.height == 0 {
            return Ok(OcrResult::from_lines(Vec::new()));
        }

        let provider = CGDataProvider::from_buffer(Arc::new(image.rgba.clone()));
        let cg_image = CGImage::new(
            image.width,
            image.height,
            8,
            32,
            image.bytes_per_row,
            &CGColorSpace::create_device_rgb(),
            // 必须与 capture.rs 里写位图时用的是同一组常量。
            kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big,
            &provider,
            true,
            0,
        );

        let lines = unsafe {
            // `core_graphics::sys::CGImage` 与 `objc2_core_graphics::CGImage` 是两个
            // 不同的 Rust 类型，但都只是指向同一个 CF 对象的**不透明指针**。
            // 这里转的是指针本身，没有所有权转移，也没有布局假设——是安全的。
            run_vision(cg_image.as_ptr() as *mut objc2_core_graphics::CGImage)
        }?;
        Ok(OcrResult::from_lines(lines))
    }
}

/// # Safety
/// `image` 必须是有效的 CGImage 指针，且在本次调用期间保持存活。
unsafe fn run_vision(
    image: *mut objc2_core_graphics::CGImage,
) -> Result<Vec<OcrLine>, PlatformError> {
    let request = VNRecognizeTextRequest::new();
    // Accurate 比 Fast 慢一点，但截图 OCR 是「看清楚这一小块」，
    // 认错字的代价远高于多等一两百毫秒。
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(true);
    let languages = NSArray::from_retained_slice(&RECOGNITION_LANGUAGES.map(NSString::from_str));
    request.setRecognitionLanguages(&languages);

    let handler = VNImageRequestHandler::initWithCGImage_options(
        VNImageRequestHandler::alloc(),
        &*image,
        &NSDictionary::<VNImageOption, AnyObject>::new(),
    );

    // VNRequestTextRequest 的父类是 VNImageBasedRequest，再往上是 VNRequest——
    // 要交给 performRequests 就得一路上溯到基类。
    let base: Retained<VNRequest> = Retained::into_super(Retained::into_super(request.clone()));
    let requests = NSArray::from_retained_slice(&[base]);

    handler
        .performRequests_error(&requests)
        .map_err(|error| PlatformError::Other(format!("Vision 识别失败：{error:?}")))?;

    let Some(observations) = request.results() else {
        return Ok(Vec::new());
    };

    Ok(observations
        .iter()
        .filter_map(|observation| {
            // 每行只取置信度最高的那个候选——一行给多个候选是给「选字」用的，
            // 我们这里没有那个交互。
            let candidates = observation.topCandidates(1);
            let best = candidates.firstObject()?;
            Some(OcrLine {
                text: best.string().to_string(),
                confidence: best.confidence(),
            })
        })
        .collect())
}
