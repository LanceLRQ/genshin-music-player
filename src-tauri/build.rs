fn main() {
    tauri_build::build();
    embed_manifest_into_tests();
}

/// Windows 测试二进制需要 Common-Controls v6 清单。
///
/// tauri-build 经 tauri-winres / embed-resource 把带 Common-Controls v6 依赖的
/// 应用清单只链接进 bin 目标（embed-resource 发出的是 `rustc-link-arg-bins`）。
/// 测试二进制拿不到清单时，加载器给进程绑定 comctl32 v5.82（system32 的副本
/// 也没有该导出），而 muda / tauri-runtime-wry 的 `common-controls-v6` 特性会
/// 以名字导入仅 v6 才有的 `TaskDialogIndirect`，进程加载即报
/// STATUS_ENTRYPOINT_NOT_FOUND（0xC0000139），表现为 `cargo test` 里用到
/// MockRuntime 的测试直接崩载。这里给测试目标补嵌同一份依赖声明。
fn embed_manifest_into_tests() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let manifest = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
</assembly>
"#;
    let out_dir = std::env::var("OUT_DIR").expect("build 脚本应有 OUT_DIR");
    let path = std::path::Path::new(&out_dir).join("tests-common-controls.manifest");
    std::fs::write(&path, manifest).expect("应能写出测试用应用清单");
    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
        path.display()
    );
}
