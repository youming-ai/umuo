import Foundation
import Observation

/// 设置的「改了就存」队列，`settings-queue.ts` 的移植。四条规则，各自防一种真实会出的坏状态：
///
/// 1. **逐个保存、不并发**：两次保存同时在路上时，后发先至会让旧值覆盖新值。
/// 2. **每次只提交自己的改动，叠在「后端此刻的值」之上**（`save` 负责现读现写，即 `applySettingsPatch`）：
///    设置窗开着的时候，浮窗、撰写窗也会写设置（例如按 App 记住的目标语言），拿窗口里的旧快照整份写回会抹掉它们。
/// 3. **失败就把这几个字段退回存好的值**，错误交给调用方显示在那一行；只退回「这次提交仍是最新一次改它」的字段——
///    同一个字段后面又改过的话，失败的旧提交不能把新值冲掉。
/// 4. **空闲时可以整体刷新**（窗口重新获得焦点时），让界面跟上别处写进来的值。
///
/// `commit` 的同步部分（显示新值、记序号）在**调用当下**做完，再返回保存任务——与 TS 的 Promise 一样，
/// 连着提交两次时序号一定按调用顺序排。`save` 在 MainActor 上被调用：正式代码里它要把
/// `Engine.applySettingsPatch` 放进 `Task.detached` 再等结果，**不在主线程上调 Engine**（ARCHITECTURE §2.3）。
@MainActor @Observable
final class SettingsQueue<Value: Sendable & Equatable> {
    typealias Values = [String: Value]
    /// 把这次的改动叠在后端最新值上保存，返回规范化后的完整设置。
    typealias Save = @MainActor (Values) async throws -> Values

    /// 当前界面上应显示的值（含尚在保存中的改动）。
    private(set) var current: Values
    private var saved: Values
    private var pending = 0
    private var chain: Task<Void, Never>?
    /// 每个字段最近一次提交的序号：失败回滚时只退回仍由这次提交「拥有」的字段。
    private var latest: [String: Int] = [:]
    private var sequence = 0
    private let save: Save
    /// 每次界面值变化时调用（测试用它记录界面经历过的每一个状态）。
    var onChange: ((Values) -> Void)?

    init(initial: Values, save: @escaping Save) {
        current = initial
        saved = initial
        self.save = save
    }

    private func show(_ next: Values) {
        current = next
        onChange?(next)
    }

    /// 提交一次改动。返回的任务在这次保存落定时结束，失败时抛出保存的错误（界面显示在那一行）。
    @discardableResult
    func commit(_ patch: Values) -> Task<Void, Error> {
        show(current.merging(patch) { _, new in new })
        pending += 1
        sequence += 1
        let mine = sequence
        for key in patch.keys { latest[key] = mine }
        let previous = chain
        let run = Task { @MainActor in
            await previous?.value
            do {
                saved = try await save(patch)
            } catch {
                var reverted = current
                for key in patch.keys where latest[key] == mine { reverted[key] = saved[key] }
                show(reverted)
                pending -= 1
                throw error
            }
            pending -= 1
            if pending == 0 { show(saved) }
        }
        chain = Task { _ = await run.result }
        return run
    }

    /// 没有保存在路上时，用后端的最新值替换界面；有的话忽略（落定后自然会同步）。
    func refresh(_ latest: Values) {
        guard pending == 0 else { return }
        saved = latest
        show(latest)
    }
}
