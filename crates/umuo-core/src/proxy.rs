//! 网络代理（PRD §8：支持系统代理、自定义 HTTP / SOCKS5 代理）。
//!
//! 分成两层：
//!
//! 1. **解析**（这里）：把用户填的模式与地址变成明确的意图，或者一条能看懂的错误。
//!    纯函数，可测——"地址填错了"该在设置页当场说，而不是等第一次翻译失败。
//! 2. **应用**（调用方）：把意图落到 `reqwest::Client` 上。构建客户端是有副作用的，
//!    所以它不在内核里做纯函数测试，而是由外壳在启动时组装一次。

/// 代理的三种意图。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProxyChoice {
    /// 跟随系统（macOS 的系统代理设置）。
    System,
    /// 直连，不走任何代理——包括系统代理。
    Direct,
    /// 用户指定的代理地址。
    Custom(String),
}

/// 支持的代理协议。**只看 scheme**：填了别的说明用户想要的不是代理。
const SUPPORTED: &[&str] = &["http://", "https://", "socks5://", "socks5h://"];

/// 解析设置里的代理配置。
///
/// `mode` 认不出来的值当作「跟随系统」——手改配置或旧版本写进来的值，
/// 不该让网络直接断掉（那是最难查的一类问题）。
pub fn parse_proxy(mode: &str, url: &str) -> Result<ProxyChoice, String> {
    match mode.trim() {
        "none" => Ok(ProxyChoice::Direct),
        "custom" => {
            let candidate = url.trim();
            if candidate.is_empty() {
                return Err("选了自定义代理，但地址是空的。".to_string());
            }
            if !SUPPORTED.iter().any(|scheme| candidate.starts_with(scheme)) {
                return Err(format!(
                    "代理地址要以 {} 开头（当前填的是「{}」）。",
                    SUPPORTED.join(" / "),
                    redact_proxy(candidate)
                ));
            }
            Ok(ProxyChoice::Custom(candidate.to_string()))
        }
        // 含 "system"、空串、以及任何认不出来的值。
        _ => Ok(ProxyChoice::System),
    }
}

/// 代理地址进错误提示或日志前去掉 `user:pass@`。
///
/// 少了协议头的地址（`alice:pw@host:1080`）也要遮：[`crate::error::redact_secrets`]
/// 只认 `://` 之后的凭据，这里先把最后一个 `@` 之前的部分整个换掉。
pub fn redact_proxy(url: &str) -> String {
    let authority_end = url
        .find("://")
        .map(|i| i + 3)
        .and_then(|start| url[start..].find(['/', '?', '#']).map(|end| start + end))
        .unwrap_or(url.len());
    let shown = match url[..authority_end].rfind('@') {
        Some(at) => {
            let scheme_end = url.find("://").map(|i| i + 3).unwrap_or(0);
            format!("{}[REDACTED]@{}", &url[..scheme_end], &url[at + 1..])
        }
        None => url.to_string(),
    };
    crate::error::redact_secrets(&shown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_and_unknown_values_follow_the_system() {
        // 认不出来的值必须回落到一个**能用**的状态：手改配置不该让网络断掉，
        // 而"网络忽然不通"是最难查的一类问题。
        assert_eq!(parse_proxy("system", "").unwrap(), ProxyChoice::System);
        assert_eq!(parse_proxy("", "").unwrap(), ProxyChoice::System);
        assert_eq!(
            parse_proxy("klingon", "socks5://x:1").unwrap(),
            ProxyChoice::System
        );
    }

    #[test]
    fn direct_never_uses_a_proxy_even_a_system_one() {
        // 「直连」的语义是**连系统代理也不用**，否则公司网络里就绕不开那个代理。
        assert_eq!(parse_proxy("none", "").unwrap(), ProxyChoice::Direct);
        assert_eq!(
            parse_proxy("none", "socks5://127.0.0.1:1080").unwrap(),
            ProxyChoice::Direct,
            "选了直连就忽略地址"
        );
    }

    #[test]
    fn custom_accepts_the_four_supported_schemes() {
        for url in [
            "http://127.0.0.1:8080",
            "https://proxy.example:8443",
            "socks5://127.0.0.1:1080",
            "socks5h://127.0.0.1:1080",
        ] {
            assert_eq!(
                parse_proxy("custom", url).unwrap(),
                ProxyChoice::Custom(url.to_string()),
                "{url} 应当被接受"
            );
        }
    }

    #[test]
    fn custom_trims_surrounding_whitespace() {
        assert_eq!(
            parse_proxy("custom", "  socks5://127.0.0.1:1080  ").unwrap(),
            ProxyChoice::Custom("socks5://127.0.0.1:1080".to_string())
        );
    }

    #[test]
    fn custom_without_an_address_is_refused_with_a_readable_message() {
        let error = parse_proxy("custom", "   ").unwrap_err();
        assert!(error.contains("空的"), "错误要说清是什么问题：{error}");
    }

    #[test]
    fn a_wrong_scheme_is_refused_and_the_message_lists_what_is_supported() {
        // 用户常填的是 `127.0.0.1:1080`（少了协议头）——那条必须给出下一步。
        let error = parse_proxy("custom", "127.0.0.1:1080").unwrap_err();
        assert!(
            error.contains("socks5://"),
            "错误里要列出可用的协议：{error}"
        );
    }

    #[test]
    fn redacting_a_proxy_keeps_the_scheme_and_host_but_not_the_credentials() {
        assert_eq!(
            redact_proxy("socks5://alice:s3cret@proxy.example:1080"),
            "socks5://[REDACTED]@proxy.example:1080"
        );
        assert_eq!(
            redact_proxy("http://proxy.example:8080"),
            "http://proxy.example:8080"
        );
    }

    #[test]
    fn a_refused_address_does_not_echo_its_credentials() {
        // 这条错误会进设置页与启动日志：代理地址里的用户名密码不能跟着出去。
        let error = parse_proxy("custom", "alice:s3cret@proxy.example:1080").unwrap_err();
        assert!(!error.contains("s3cret"), "{error}");
        assert!(!error.contains("alice"), "{error}");
    }
}
