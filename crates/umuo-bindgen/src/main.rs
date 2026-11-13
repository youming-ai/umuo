//! 生成 Swift 绑定：`cargo run -p umuo-bindgen --bin uniffi-bindgen -- generate --library … --language swift`。
//! 由 `apps/macos/scripts/build-core.sh` 调用；本 crate 不被任何库依赖，不进 umuo.app。
fn main() {
    uniffi::uniffi_bindgen_main()
}
