import Foundation

/// 开机自启：在 `~/Library/LaunchAgents/app.umuo.desktop.plist` 放一个 LaunchAgent。
///
/// **与旧版客户端同一个文件、同一个 Label**：老用户升级后开关的状态照旧，关掉也删的是同一个文件，
/// 不会留下一个指向旧程序、再也关不掉的登录项。没用 `SMAppService`：它只认打包好的 .app 自己的登录项，
/// 读不到旧版写的这个 LaunchAgent，升级后开关会显示成「关」、而旧的那个照样在每次登录时把旧版拉起来。
///
/// 「开着」以磁盘为准：plist 在、而且里面指向的程序还在——程序被删了（或换了位置）就算关，界面不会撒谎。
/// `home` 由调用方给：测试指向临时目录，不碰真实的 LaunchAgents。
enum Autostart {
    static let label = "app.umuo.desktop"

    static func plistURL(home: URL) -> URL {
        home.appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }

    /// RunAtLoad：登录时启动。KeepAlive 刻意不开——用户主动退出客户端之后，系统不该把它拉回来。
    static func plist(program: String) -> String {
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>Label</key>
          <string>\(label)</string>
          <key>ProgramArguments</key>
          <array>
            <string>\(escape(program))</string>
          </array>
          <key>RunAtLoad</key>
          <true/>
          <key>ProcessType</key>
          <string>Interactive</string>
        </dict>
        </plist>

        """
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func unescape(_ text: String) -> String {
        text.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&amp;", with: "&")
    }

    /// plist 里登记的程序路径（只认 `ProgramArguments` 的第一个 `<string>`）。
    static func program(inPlist plist: String) -> String? {
        guard let key = plist.range(of: "<key>ProgramArguments</key>") else { return nil }
        let after = plist[key.upperBound...]
        guard let open = after.range(of: "<string>"),
              let close = after[open.upperBound...].range(of: "</string>")
        else { return nil }
        return unescape(String(after[open.upperBound ..< close.lowerBound]))
    }

    /// 从磁盘映像或系统隔离目录运行时拒绝：登录项会指向一个下次登录时已经不存在的路径。原因直接说清楚怎么办。
    static func checkLaunchPath(_ program: String) -> UserText? {
        let temporary = program.hasPrefix("/Volumes/") || program.split(separator: "/").contains("AppTranslocation")
        return temporary ? UserText("autostart.temporaryLocation") : nil
    }

    static func isEnabled(home: URL) -> Bool {
        guard let text = try? String(contentsOf: plistURL(home: home), encoding: .utf8),
              let program = program(inPlist: text)
        else { return false }
        return FileManager.default.fileExists(atPath: program)
    }

    /// 打开 / 关闭，返回**实际生效**的状态（以磁盘为准）。失败抛出给人看的原因。关掉一个本来就关着的不算错。
    static func setEnabled(_ enabled: Bool, home: URL, program: String) throws -> Bool {
        let url = plistURL(home: home)
        if enabled {
            if let refusal = checkLaunchPath(program) { throw Failure(text: refusal) }
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try plist(program: program).write(to: url, atomically: true, encoding: .utf8)
            } catch {
                throw Failure(text: UserText("autostart.writeFailed", ["reason": error.localizedDescription]))
            }
        } else if FileManager.default.fileExists(atPath: url.path) {
            do { try FileManager.default.removeItem(at: url) } catch {
                throw Failure(text: UserText("autostart.writeFailed", ["reason": error.localizedDescription]))
            }
        }
        return isEnabled(home: home)
    }

    struct Failure: UserFacingError {
        let text: UserText
    }
}
