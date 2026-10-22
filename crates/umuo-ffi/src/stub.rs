//! `--selftest` 用的本地 SSE 桩：不连真实供应商，也能把 Engine → 传输 → 事件 → Swift 整条链路跑一遍。
//!
//! 放在 Rust 里而不是 Swift 里：几十行阻塞式 socket 就够，Swift 端只要拿到地址。
//! 不按 feature 隔开——debug 与 release 的绑定必须一致，否则 release 下 `SelfTest.swift` 编不过。
//! 它只监听 127.0.0.1，进程里不调用就什么都不做。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

/// 起一个只监听 127.0.0.1 的 OpenAI 协议流式桩，返回它的地址（`http://127.0.0.1:端口`）。
///
/// 每个请求都回同一段流：先等 `delay_ms`，再逐段发 `deltas`（段间隔 `gap_ms`），最后发结束信号。
/// 路径不看：任何供应商的地址指到这里都行。桩随进程退出，selftest 用完不必关。
#[uniffi::export]
pub fn selftest_sse_stub(deltas: Vec<String>, delay_ms: u64, gap_ms: u64) -> Option<String> {
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    let base = format!("http://{}", listener.local_addr().ok()?);
    thread::spawn(move || {
        for socket in listener.incoming().flatten() {
            let deltas = deltas.clone();
            thread::spawn(move || serve(socket, &deltas, delay_ms, gap_ms));
        }
    });
    Some(base)
}

fn serve(mut socket: TcpStream, deltas: &[String], delay_ms: u64, gap_ms: u64) {
    // 读完整个请求再回应：没读完就回写并关闭，macOS 会发 RST，客户端看到的是连接错误。
    if read_request(&mut socket).is_none() {
        return;
    }
    thread::sleep(Duration::from_millis(delay_ms));
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
    if socket.write_all(head.as_bytes()).is_err() {
        return;
    }
    for (i, delta) in deltas.iter().enumerate() {
        if i > 0 {
            thread::sleep(Duration::from_millis(gap_ms));
        }
        let event = serde_json::json!({ "choices": [{ "delta": { "content": delta } }] });
        // 客户端取消后会断开，写失败就停
        if socket
            .write_all(format!("data: {event}\n\n").as_bytes())
            .is_err()
        {
            return;
        }
        let _ = socket.flush();
    }
    let stop = serde_json::json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] });
    let _ = socket.write_all(format!("data: {stop}\n\ndata: [DONE]\n\n").as_bytes());
    let _ = socket.shutdown(std::net::Shutdown::Both);
}

/// 读请求头与 `Content-Length` 指定的请求体。
fn read_request(socket: &mut TcpStream) -> Option<()> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        let n = socket.read(&mut chunk).ok().filter(|&n| n > 0)?;
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_ascii_lowercase();
    let length: usize = head
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(0);
    while buf.len() < header_end + length {
        let n = socket.read(&mut chunk).ok().filter(|&n| n > 0)?;
        buf.extend_from_slice(&chunk[..n]);
    }
    Some(())
}
