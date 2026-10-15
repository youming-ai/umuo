//! 屏幕捕获（PRD §5.5 截图 OCR 的前半段）。
//!
//! 坐标系这件事必须说清楚，否则多显示器与 Retina 上一定出错：
//!
//! - **点（point）**：逻辑坐标。鼠标事件、窗口位置、`CGDisplay` 的 bounds 都用它。
//!   多显示器时所有显示器的点坐标拼在**同一个全局平面**上，副屏在主屏左侧时 x 为负。
//! - **像素（pixel）**：位图坐标。同一块区域在 Retina 上是点数的 2 倍。
//!
//! 本模块对外只用**点**，只有在真正取位图时才按显示器的 `scale` 换算成像素。
//! 界面层（框选浮层）拿到的也是点，所以两边不需要各自记得换算规则。

use serde::{Deserialize, Serialize};

use crate::error::PlatformError;

/// 屏幕上的一块矩形，单位是**点**，坐标是全局平面上的位置。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Region {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// 面积足够大到值得去截一次图吗。
    ///
    /// 用户手抖点一下会产生 2×2 的选区；拿去截图 + OCR 只会得到一片噪声，
    /// 还会白花一次识别时间。
    pub fn is_meaningful(&self) -> bool {
        self.width >= 8.0 && self.height >= 8.0
    }

    pub fn right(&self) -> f64 {
        self.x + self.width
    }

    pub fn bottom(&self) -> f64 {
        self.y + self.height
    }
}

/// 一个显示器的几何信息。坐标同样是全局平面上的点。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// 像素 / 点。Retina 是 2.0，普通屏是 1.0。
    pub scale: f64,
}

/// 一次捕获到的位图。8 位 RGBA、非预乘、行主序。
#[derive(Debug, Clone, PartialEq)]
pub struct ScreenImage {
    pub width: usize,
    pub height: usize,
    pub bytes_per_row: usize,
    pub rgba: Vec<u8>,
}

/// 屏幕录制权限（PRD §5.5 要求首次使用时引导授权）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapturePermission {
    Granted,
    /// 没授权——但不能替用户决定，所以他什么都没说之前不要反复弹窗。
    Denied,
}

pub trait ScreenCapture: Send + Sync {
    /// 当前是否已授权。**不要**在这里触发系统弹窗。
    fn permission(&self) -> CapturePermission;

    /// 主动请求授权（会弹系统对话框）。只有在用户明确点了「授权」时才调用。
    fn request_permission(&self) -> CapturePermission;

    /// 所有显示器，按系统给的顺序。
    fn displays(&self) -> Vec<DisplayInfo>;

    /// 截取全局坐标下的一块区域（点）。返回的位图按目标显示器的 scale 放大。
    fn capture(&self, region: Region) -> Result<ScreenImage, PlatformError>;

    /// 交给系统自带的框选 UI 去选一块区域，返回它的像素。
    ///
    /// 返回 `Ok(None)` 表示**用户取消了**——这与「出错」必须分开：
    /// 取消是正常操作，不该弹错误提示。
    ///
    /// 为什么用系统框选而不是自绘浮层：自绘浮层需要把「窗口坐标」与「屏幕全局坐标」
    /// 对齐，两套坐标系在 macOS 上的原点约定并不一致，弄错就会截到别的地方——
    /// 而这类错误在没有真人盯着屏幕的情况下几乎无法验证。系统框选由系统自己完成
    /// 选区到像素的映射，把这块风险整个消掉。自绘浮层（以及依赖选区位置的「覆盖模式」）
    /// 列为后续项。
    fn capture_interactively(&self) -> Result<Option<ScreenImage>, PlatformError>;
}

/// 把拖拽的起点与终点规范化成矩形。
///
/// 用户从右下往左上拖是**完全正常**的操作，直接拿 (start, end) 当 (x, y, w, h)
/// 会得到一个负宽度的矩形，截图时要么报错要么截到别的地方。
pub fn normalize_drag(start: (f64, f64), end: (f64, f64)) -> Region {
    Region {
        x: start.0.min(end.0),
        y: start.1.min(end.1),
        width: (end.0 - start.0).abs(),
        height: (end.1 - start.1).abs(),
    }
}

/// 某个点落在哪个显示器上。多显示器时用它决定「这一拖是从哪块屏开始的」。
pub fn display_at(displays: &[DisplayInfo], x: f64, y: f64) -> Option<&DisplayInfo> {
    displays
        .iter()
        .find(|d| x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height)
}

/// 把全局矩形裁剪到某个显示器范围内。
///
/// 返回 `None` 表示两者**完全不相交**——这不是错误，是「用户拖的是另一块屏」。
/// 裁剪是必需的：`CGDisplayCreateImageForRect` 只接受该显示器本地坐标，
/// 越界的部分在不同的系统版本上行为不一致（有的裁掉、有的返回 nil）。
pub fn clip_to_display(region: Region, display: &DisplayInfo) -> Option<Region> {
    let left = region.x.max(display.x);
    let top = region.y.max(display.y);
    let right = region.right().min(display.x + display.width);
    let bottom = region.bottom().min(display.y + display.height);

    if right <= left || bottom <= top {
        return None;
    }
    Some(Region::new(left, top, right - left, bottom - top))
}

/// 全局点坐标 → 该显示器的本地点坐标（`CGDisplayCreateImageForRect` 要的是这个）。
pub fn to_display_local(region: Region, display: &DisplayInfo) -> Region {
    Region::new(
        region.x - display.x,
        region.y - display.y,
        region.width,
        region.height,
    )
}

/// 点 → 像素。向上取整：少一个像素就可能把最后一列字切掉半边。
pub fn region_pixels(region: Region, scale: f64) -> (usize, usize) {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    (
        (region.width * scale).ceil().max(1.0) as usize,
        (region.height * scale).ceil().max(1.0) as usize,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(id: u32, x: f64, y: f64, w: f64, h: f64, scale: f64) -> DisplayInfo {
        DisplayInfo {
            id,
            x,
            y,
            width: w,
            height: h,
            scale,
        }
    }

    #[test]
    fn dragging_in_any_direction_yields_the_same_rect() {
        // 从右下往左上拖是完全正常的操作；不规范化会得到负宽度。
        let a = normalize_drag((100.0, 200.0), (300.0, 400.0));
        let b = normalize_drag((300.0, 400.0), (100.0, 200.0));
        assert_eq!(a, b);
        assert_eq!(a, Region::new(100.0, 200.0, 200.0, 200.0));
        assert!(a.width > 0.0 && a.height > 0.0);
    }

    #[test]
    fn a_tiny_selection_is_not_worth_capturing() {
        // 手抖点一下会产生 2×2 的选区，截出来只有噪声，还要白跑一次 OCR。
        assert!(!normalize_drag((10.0, 10.0), (12.0, 12.0)).is_meaningful());
        assert!(normalize_drag((10.0, 10.0), (60.0, 40.0)).is_meaningful());
    }

    #[test]
    fn a_region_is_clipped_to_the_display_it_lands_on() {
        let second = display(2, 1440.0, 0.0, 1920.0, 1080.0, 2.0);
        // 用户从主屏拖过了副屏的边界。
        let clipped = clip_to_display(Region::new(1400.0, 100.0, 200.0, 200.0), &second).unwrap();
        assert_eq!(clipped, Region::new(1440.0, 100.0, 160.0, 200.0));
    }

    #[test]
    fn a_region_entirely_on_another_display_clips_to_nothing() {
        // 这不是错误，是「用户拖的是另一块屏」。
        let second = display(2, 1440.0, 0.0, 1920.0, 1080.0, 2.0);
        assert!(clip_to_display(Region::new(0.0, 0.0, 100.0, 100.0), &second).is_none());
    }

    #[test]
    fn display_local_coordinates_subtract_the_display_origin() {
        // 副屏在主屏左侧时，全局 x 是负数——这是最容易出错的一格。
        let left_display = display(1, -1920.0, 0.0, 1920.0, 1080.0, 1.0);
        let local = to_display_local(Region::new(-1800.0, 50.0, 100.0, 100.0), &left_display);
        assert_eq!(local, Region::new(120.0, 50.0, 100.0, 100.0));
    }

    #[test]
    fn pixels_scale_with_retina_and_round_up() {
        assert_eq!(
            region_pixels(Region::new(0.0, 0.0, 700.0, 200.0), 2.0),
            (1400, 400)
        );
        assert_eq!(
            region_pixels(Region::new(0.0, 0.0, 700.0, 200.0), 1.0),
            (700, 200)
        );
        // 向上取整：切掉半个像素就可能把最后一列字切掉一半。
        assert_eq!(
            region_pixels(Region::new(0.0, 0.0, 10.3, 10.1), 2.0),
            (21, 21)
        );
    }

    #[test]
    fn a_broken_scale_never_produces_a_zero_sized_bitmap() {
        // scale 为 0 / NaN / 负数时若直接相乘，会得到 0×0 的位图，
        // 再往后就是 OCR 拿到空图、用户看到「没识别到文字」却不知道原因。
        for bad in [0.0, -1.0, f64::NAN] {
            let (w, h) = region_pixels(Region::new(0.0, 0.0, 100.0, 50.0), bad);
            assert!(w >= 1 && h >= 1, "scale={bad} 得到了 {w}×{h}");
        }
    }

    #[test]
    fn display_lookup_finds_the_display_under_a_point() {
        let displays = vec![
            display(1, 0.0, 0.0, 1440.0, 900.0, 2.0),
            display(2, 1440.0, 0.0, 1920.0, 1080.0, 1.0),
        ];
        assert_eq!(display_at(&displays, 100.0, 100.0).unwrap().id, 1);
        assert_eq!(display_at(&displays, 1500.0, 100.0).unwrap().id, 2);
        // 右边界是开区间：1440 属于第二块屏，不是第一块。
        assert_eq!(display_at(&displays, 1440.0, 0.0).unwrap().id, 2);
        assert!(display_at(&displays, 5000.0, 5000.0).is_none());
    }
}
