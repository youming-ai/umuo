//! macOS 屏幕捕获。
//!
//! ## 权限
//!
//! macOS 10.15 起，截屏需要「屏幕录制」权限。两条 API 的分工要分清：
//!
//! - `CGPreflightScreenCaptureAccess()` —— **只查询**，不弹窗。用在「先看看有没有权限」。
//! - `CGRequestScreenCaptureAccess()` —— 会弹系统对话框，而且**一个进程只会弹一次**；
//!   用户拒绝之后再调也不会再弹。所以它只应该在用户明确点了「去授权」时调用，
//!   而不是每次按快捷键都调一次。
//!
//! ## 关于 CGDisplayCreateImage 的弃用
//!
//! 它在 10.15 起被标记为过时，官方推荐 ScreenCaptureKit。但 ScreenCaptureKit 是
//! 异步流式模型（要建 SCStream、收 CMSampleBuffer），对「框选一块、截一张」这个用法
//! 是明显的过度设计。这里继续用 CG 老 API：**实测在 macOS 27 上仍然可用**。
//! 真到它失效那天再换 ScreenCaptureKit，届时只需要替换本文件。
//!
//! ## 坐标
//!
//! `CGDisplayCreateImageForRect` 要的是**该显示器本地**的坐标（点），
//! 而我们的 [`Region`] 永远是全局平面的。换算集中在
//! [`umuo_platform::capture::to_display_local`] 里，本文件只负责调用。

use core_graphics::base::{kCGBitmapByteOrder32Big, kCGImageAlphaPremultipliedLast};
use core_graphics::color_space::CGColorSpace;
use core_graphics::context::CGContext;
use core_graphics::display::CGDisplay;
use core_graphics::geometry::{CGPoint, CGRect, CGSize};

use umuo_platform::capture::{
    clip_to_display, display_at, to_display_local, CapturePermission, DisplayInfo, Region,
    ScreenCapture, ScreenImage,
};
use umuo_platform::PlatformError;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

pub struct MacScreenCapture;

impl MacScreenCapture {
    /// 某个显示器的像素倍率（像素 / 点）。
    ///
    /// 拿不到显示模式时回落 1.0：宁可少放大一次，也不要按错误的倍率生成位图——
    /// 错误的倍率会让 OCR 直接认不出字，而用户完全不知道发生了什么。
    fn scale_for(id: u32) -> f64 {
        let display = CGDisplay::new(id);
        let Some(mode) = display.display_mode() else {
            return 1.0;
        };
        let points = display.bounds().size.width;
        if points <= 0.0 {
            return 1.0;
        }
        let scale = mode.pixel_width() as f64 / points;
        if scale.is_finite() && scale > 0.0 {
            scale
        } else {
            1.0
        }
    }
}

impl ScreenCapture for MacScreenCapture {
    fn permission(&self) -> CapturePermission {
        // 只查询，绝不弹窗——按一次快捷键就弹一次系统对话框是骚扰。
        if unsafe { CGPreflightScreenCaptureAccess() } {
            CapturePermission::Granted
        } else {
            CapturePermission::Denied
        }
    }

    fn request_permission(&self) -> CapturePermission {
        let granted = unsafe { CGRequestScreenCaptureAccess() };
        if granted {
            CapturePermission::Granted
        } else {
            CapturePermission::Denied
        }
    }

    fn displays(&self) -> Vec<DisplayInfo> {
        CGDisplay::active_displays()
            .unwrap_or_default()
            .into_iter()
            .map(|id| {
                let bounds = CGDisplay::new(id).bounds();
                DisplayInfo {
                    id,
                    x: bounds.origin.x,
                    y: bounds.origin.y,
                    width: bounds.size.width,
                    height: bounds.size.height,
                    scale: Self::scale_for(id),
                }
            })
            .collect()
    }

    fn capture(&self, region: Region) -> Result<ScreenImage, PlatformError> {
        let displays = self.displays();
        // 用选区中心点决定「这是哪块屏」：选区可能横跨两块屏，
        // 而截图 API 一次只能截一块屏，中心点是最不容易出错的选择。
        let center = (
            region.x + region.width / 2.0,
            region.y + region.height / 2.0,
        );
        let display = display_at(&displays, center.0, center.1)
            .ok_or(PlatformError::Other("选区不在任何显示器范围内".to_string()))?;

        let clipped = clip_to_display(region, display)
            .ok_or(PlatformError::Other("选区与目标显示器不相交".to_string()))?;
        let local = to_display_local(clipped, display);

        let image = CGDisplay::new(display.id)
            .image_for_rect(CGRect::new(
                &CGPoint::new(local.x, local.y),
                &CGSize::new(local.width, local.height),
            ))
            .ok_or({
                // 这个分支最常见的原因就是没授权：系统会返回 nil，而不是报错。
                PlatformError::PermissionDenied {
                    capability: "屏幕录制",
                }
            })?;

        // 统一成 8 位 RGBA：直接把 CGImage 的原始字节交给 Vision 的话，
        // 得先猜它的字节序与通道顺序（不同显示器/系统版本并不一致）。
        // 用一次位图上下文重绘是格式无关的稳妥做法，成本也只是一次内存拷贝。
        let width = image.width();
        let height = image.height();
        if width == 0 || height == 0 {
            return Err(PlatformError::Other("截到的是空图".to_string()));
        }

        let mut context = CGContext::create_bitmap_context(
            None,
            width,
            height,
            8,
            width * 4,
            &CGColorSpace::create_device_rgb(),
            kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big,
        );
        context.draw_image(
            CGRect::new(
                &CGPoint::new(0.0, 0.0),
                &CGSize::new(width as f64, height as f64),
            ),
            &image,
        );

        Ok(ScreenImage {
            width,
            height,
            bytes_per_row: width * 4,
            rgba: context.data().to_vec(),
        })
    }

    fn capture_interactively(&self) -> Result<Option<ScreenImage>, PlatformError> {
        // 用系统自带的 `screencapture`：它提供原生十字光标 + 放大镜 + 多显示器支持，
        // 而且直接写出像素，我们不必处理「窗口坐标 ↔ 屏幕全局坐标」的换算。
        // 见 trait 上的说明。
        let path = std::env::temp_dir().join(format!("umuo-ocr-{}.png", std::process::id()));
        // 上一轮如果残留了同名文件，会让我们把「用户取消」误判成「截到了旧图」。
        let _ = std::fs::remove_file(&path);

        let status = std::process::Command::new("/usr/sbin/screencapture")
            // -i 交互式框选；-x 不播放快门声；-o 不附带窗口阴影
            .args(["-i", "-x", "-o"])
            .arg(&path)
            .status()
            .map_err(|e| PlatformError::Other(format!("无法启动 screencapture：{e}")))?;

        let existed = path.exists();
        if !existed {
            // 用户按 Esc 取消：进程仍返回 0，也没有写出文件。这是正常路径。
            return Ok(None);
        }

        let decoded = decode_png(&path);
        // 无论成败都要清掉临时文件：里面是用户的屏幕内容。
        let _ = std::fs::remove_file(&path);
        let _ = status;

        decoded.map(Some)
    }
}

/// 把 PNG 解成 8 位 RGBA。
///
/// 单独抽出来是为了能测：它的输入是一个文件，而「解码」这件事的正确性与屏幕无关，
/// 可以在测试里自己编码一张图再解回来。
fn decode_png(path: &std::path::Path) -> Result<ScreenImage, PlatformError> {
    let file = std::fs::File::open(path)
        .map_err(|e| PlatformError::Other(format!("读不到截图文件：{e}")))?;
    let decoder = png::Decoder::new(std::io::BufReader::new(file));
    let mut reader = decoder
        .read_info()
        .map_err(|e| PlatformError::Other(format!("截图不是合法 PNG：{e}")))?;

    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|e| PlatformError::Other(format!("解码截图失败：{e}")))?;

    // `screencapture` 写的是 RGB 或 RGBA；统一成 RGBA，让 OCR 那边只需处理一种格式。
    let rgba = match info.color_type {
        png::ColorType::Rgba => buffer[..info.buffer_size()].to_vec(),
        png::ColorType::Rgb => buffer[..info.buffer_size()]
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|rgb| [rgb[0], rgb[1], rgb[2], 255])
            .collect(),
        other => {
            return Err(PlatformError::Other(format!(
                "截图颜色格式不支持：{other:?}"
            )))
        }
    };

    let width = info.width as usize;
    let height = info.height as usize;
    if width == 0 || height == 0 {
        return Err(PlatformError::Other("截图尺寸为 0".to_string()));
    }
    // 解码器给的缓冲可能带填充，重新按紧密排布拼一遍，避免 OCR 那边按错的行距读。
    let mut packed = Vec::with_capacity(width * height * 4);
    for row in 0..height {
        let start = row * width * 4;
        packed.extend_from_slice(&rgba[start..start + width * 4]);
    }

    Ok(ScreenImage {
        width,
        height,
        bytes_per_row: width * 4,
        rgba: packed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MacOcr;
    use umuo_platform::capture::region_pixels;
    use umuo_platform::ocr::Ocr;

    #[test]
    fn decoding_a_png_round_trips_pixels() {
        // 自己编码一张图再解回来：解码的正确性与屏幕无关，可以完全离线测。
        let (width, height) = (3u32, 2u32);
        let mut pixels = Vec::new();
        for i in 0..(width * height) {
            pixels.extend_from_slice(&[(i * 10) as u8, 20, 30, 255]);
        }

        let path = std::env::temp_dir().join("umuo-decode-roundtrip.png");
        let _ = std::fs::remove_file(&path);
        {
            let file = std::fs::File::create(&path).unwrap();
            let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&pixels).unwrap();
        }

        let image = decode_png(&path).expect("自编码的 PNG 必须解得开");
        assert_eq!(
            (image.width, image.height),
            (width as usize, height as usize)
        );
        assert_eq!(image.bytes_per_row, width as usize * 4);
        assert_eq!(image.rgba, pixels, "像素必须逐字节还原");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_rgb_png_is_widened_to_rgba() {
        // screencapture 在某些显示器配置下写的是 RGB（没有 alpha 通道），
        // 直接当成 RGBA 读会整张图错位。
        let (width, height) = (2u32, 1u32);
        let rgb = vec![10u8, 20, 30, 40, 50, 60];

        let path = std::env::temp_dir().join("umuo-decode-rgb.png");
        let _ = std::fs::remove_file(&path);
        {
            let file = std::fs::File::create(&path).unwrap();
            let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&rgb).unwrap();
        }

        let image = decode_png(&path).expect("RGB 也要能解");
        assert_eq!(image.rgba, vec![10, 20, 30, 255, 40, 50, 60, 255]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_file_that_is_not_a_png_is_a_typed_error_not_a_panic() {
        let path = std::env::temp_dir().join("umuo-decode-garbage.png");
        std::fs::write(&path, b"this is definitely not a png").unwrap();
        let error = decode_png(&path).unwrap_err();
        assert!(
            matches!(error, PlatformError::Other(_)),
            "应当是带说明的错误，实际 {error:?}"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    #[ignore = "需要屏幕录制权限与真实屏幕，手动运行：cargo test -p umuo-platform-macos -- --ignored"]
    fn capture_then_ocr_works_end_to_end_on_a_real_screen() {
        let capture = MacScreenCapture;
        assert_eq!(
            capture.permission(),
            CapturePermission::Granted,
            "运行前请先授予终端/IDE「屏幕录制」权限"
        );

        let displays = capture.displays();
        assert!(!displays.is_empty(), "至少要有一块显示器");
        let display = displays[0];

        // 取屏幕左上角一小块：那里的内容不确定，但尺寸是确定的。
        let region = Region::new(display.x + 20.0, display.y + 20.0, 320.0, 120.0);
        let image = capture.capture(region).expect("截图不该失败");

        // 尺寸必须等于「点数 × 该显示器的 scale」——Retina 上这里是 2 倍。
        let (expected_w, expected_h) = region_pixels(region, display.scale);
        assert_eq!(
            (image.width, image.height),
            (expected_w, expected_h),
            "截图尺寸与 Retina 换算不一致（scale={}）",
            display.scale
        );
        assert_eq!(image.rgba.len(), image.bytes_per_row * image.height);

        // 识别本身不该报错。屏幕那一小块有没有字是不确定的，
        // 所以这里不断言「识别到了什么」，只断言识别过程是健康的。
        let result = MacOcr.recognize(&image).expect("Vision 不该报错");
        for line in &result.lines {
            assert!(
                (0.0..=1.0).contains(&line.confidence),
                "置信度超出范围：{}",
                line.confidence
            );
            assert!(!line.text.trim().is_empty(), "空行应被 from_lines 过滤掉");
        }
        println!(
            "截图 {}×{}（scale {}），识别到 {} 行",
            image.width,
            image.height,
            display.scale,
            result.lines.len()
        );
    }

    #[test]
    #[ignore = "需要真实显示器，手动运行：cargo test -p umuo-platform-macos -- --ignored"]
    fn display_geometry_matches_the_system() {
        let displays = MacScreenCapture.displays();
        assert!(!displays.is_empty());
        for display in &displays {
            assert!(display.width > 0.0 && display.height > 0.0, "{display:?}");
            assert!(
                display.scale >= 1.0 && display.scale <= 4.0,
                "像素倍率不可能是 {}",
                display.scale
            );
        }
        println!("显示器：{displays:?}");
    }
}
