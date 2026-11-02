//! 每个窗口「当前那一次请求」的登记处：请求 id 与取消标志。
//!
//! 按窗口标签（浮窗 / 撰写窗）各登记一个，而不是所有翻译共用一个取消标志：
//! 共用时一个窗口里按 Esc 会把另一个窗口的翻译一起停掉，两路流的增量还会交错拼进同一个窗口。
//!
//! - **新请求开始时取消同一个窗口的旧请求**——旧流不会再继续计费、也不会再往窗口里写。
//! - **取消只作用于发起它的那个窗口**。
//! - id 全局单调递增（不按窗口分开计数），Swift 据此区分「我正在显示的那次」
//!   「已经被顶掉的旧请求」和「还没 start 就失败的新请求」。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// 一次请求的凭据：事件里带的 id，以及传输层轮询的取消标志。
#[derive(Clone, Debug)]
pub struct Ticket {
    pub id: u64,
    pub cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Requests {
    /// 上一个发出的 id。从 0 起步，第一个请求拿到 1——Swift 的初始状态用 0 表示「还没有请求」。
    /// 只在持有 `current` 锁时递增。
    last_id: AtomicU64,
    current: Mutex<HashMap<String, Ticket>>,
}

impl Requests {
    /// 为 `surface` 窗口开始一次新请求：取消它的上一次请求，登记并返回新的凭据。
    pub fn begin(&self, surface: &str) -> Ticket {
        // id 在登记锁里分配：分配与登记是一个原子步骤，后拿到 id 的一定后登记，
        // 不会出现小 id 的旧请求晚一步登记、把刚登记的新请求取消掉。
        let mut current = self.current.lock().expect("请求登记锁不应中毒");
        let ticket = Ticket {
            id: self.last_id.fetch_add(1, Ordering::Relaxed) + 1,
            cancel: Arc::new(AtomicBool::new(false)),
        };
        if let Some(old) = current.insert(surface.to_string(), ticket.clone()) {
            old.cancel.store(true, Ordering::Relaxed);
        }
        ticket
    }

    /// 取回 `surface` 窗口**仍是当前那一次**的凭据：id 对不上（已被更新的请求顶掉）就是 None。
    ///
    /// 划词入口按下快捷键时就登记（取词失败也要用这张凭据报错），取词成功后用同一张凭据开跑，
    /// 而不是再登记一张——否则慢的那次取词后登记、拿到更大的 id，旧选区的译文反而赢过新的。
    pub fn ticket(&self, surface: &str, id: u64) -> Option<Ticket> {
        let current = self.current.lock().expect("请求登记锁不应中毒");
        current
            .get(surface)
            .filter(|ticket| ticket.id == id)
            .cloned()
    }

    /// 取消 `surface` 窗口当前的请求（用户在那个窗口里按了 Esc）。别的窗口不受影响。
    pub fn cancel(&self, surface: &str) {
        let current = self.current.lock().expect("请求登记锁不应中毒");
        if let Some(ticket) = current.get(surface) {
            ticket.cancel.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cancelled(ticket: &Ticket) -> bool {
        ticket.cancel.load(Ordering::Relaxed)
    }

    #[test]
    fn ids_start_at_one_and_strictly_increase_across_surfaces() {
        let requests = Requests::default();
        let a = requests.begin("panel");
        let b = requests.begin("compose");
        let c = requests.begin("panel");
        assert_eq!(a.id, 1, "前端用 0 表示「还没有请求」，第一个 id 不能是 0");
        assert!(a.id < b.id && b.id < c.id);
    }

    #[test]
    fn new_request_cancels_the_previous_one_on_the_same_surface_only() {
        let requests = Requests::default();
        let panel_old = requests.begin("panel");
        let compose = requests.begin("compose");
        let panel_new = requests.begin("panel");
        assert!(cancelled(&panel_old), "同一窗口的旧请求要被顶掉");
        assert!(!cancelled(&panel_new));
        assert!(!cancelled(&compose), "别的窗口的请求不受影响");
    }

    #[test]
    fn cancel_only_touches_the_requesting_surface() {
        let requests = Requests::default();
        let panel = requests.begin("panel");
        let compose = requests.begin("compose");
        requests.cancel("compose");
        assert!(cancelled(&compose));
        assert!(!cancelled(&panel), "输入窗按 Esc 不该停掉浮窗的翻译");
    }

    #[test]
    fn a_ticket_is_only_handed_back_while_it_is_still_current() {
        let requests = Requests::default();
        let first = requests.begin("panel");
        let again = requests.ticket("panel", first.id).expect("还是当前那一次");
        assert!(
            Arc::ptr_eq(&again.cancel, &first.cancel),
            "同一张凭据，取消标志共用"
        );
        let second = requests.begin("panel");
        assert!(
            requests.ticket("panel", first.id).is_none(),
            "被顶掉的旧请求不能再开跑"
        );
        assert_eq!(
            requests.ticket("panel", second.id).map(|t| t.id),
            Some(second.id)
        );
        assert!(
            requests.ticket("compose", second.id).is_none(),
            "别的窗口不认这张凭据"
        );
    }

    #[test]
    fn concurrent_begins_leave_the_newest_id_as_the_current_request() {
        // id 必须在登记锁里分配：否则拿到小 id 的线程可能后登记，
        // 把更新的请求取消掉、自己（旧 id）反而成了当前请求。
        for _ in 0..200 {
            let requests = Arc::new(Requests::default());
            let barrier = Arc::new(std::sync::Barrier::new(8));
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    let (requests, barrier) = (requests.clone(), barrier.clone());
                    std::thread::spawn(move || {
                        barrier.wait();
                        (0..50).map(|_| requests.begin("panel")).collect::<Vec<_>>()
                    })
                })
                .collect();
            let tickets: Vec<Ticket> = handles
                .into_iter()
                .flat_map(|handle| handle.join().unwrap())
                .collect();
            let newest = tickets.iter().map(|t| t.id).max().unwrap();
            assert!(
                requests.ticket("panel", newest).is_some(),
                "id 最大的请求必须是当前请求"
            );
            let alive: Vec<u64> = tickets
                .iter()
                .filter(|t| !cancelled(t))
                .map(|t| t.id)
                .collect();
            assert_eq!(alive, vec![newest], "只有最新的请求没被取消");
        }
    }

    #[test]
    fn cancel_without_a_request_is_a_no_op() {
        let requests = Requests::default();
        requests.cancel("panel");
        let ticket = requests.begin("panel");
        assert!(
            !cancelled(&ticket),
            "空窗口上的取消不能预先作用到下一次请求上"
        );
    }
}
