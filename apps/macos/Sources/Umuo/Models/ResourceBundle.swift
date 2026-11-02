import Foundation

/// 本模块的资源包（文案表与菜单栏图标）。不直接用 `Bundle.module`：
/// SwiftPM 旧构建系统（CI 上 Xcode 26 的 `swift build`）生成的访问器只在 .app 的根目录找 `Umuo_Umuo.bundle`，
/// 找不到就退回编译时的绝对路径——放进 .app 后读的是构建目录，用户机器上直接找不到。
/// 资源包不能放 .app 根目录（签名不收），所以先找 `Contents/Resources`（bundle.sh 放在这里），再退回 `Bundle.module`
/// （裸二进制与测试走这条）。
enum ResourceBundle {
    static let bundle: Bundle = {
        if let url = Bundle.main.resourceURL?.appendingPathComponent("Umuo_Umuo.bundle"),
           let bundle = Bundle(url: url)
        {
            return bundle
        }
        return Bundle.module
    }()
}
