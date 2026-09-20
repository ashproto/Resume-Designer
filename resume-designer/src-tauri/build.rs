use std::{env, path::PathBuf, process::Command};

fn main() {
    tauri_build::build();
    // Gated on the TARGET, read at run time. `#[cfg(target_os)]` in a build
    // script is evaluated against the HOST the script itself is compiled for,
    // so a cfg gate here still ran this for a Windows cross-build on a Mac and
    // emitted `framework=` lines cargo rejects for that target. Found by the
    // Windows cross-check this repo requires; kept as a comment so it is not
    // "simplified" back.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        link_swift_sync();
    }
}

// macOS ONLY. There is no CloudKit on Windows or Linux, and nothing below runs
// there: every `cargo:` line is emitted only inside this function, which is
// only called for a macOS target. `cargo check --target x86_64-pc-windows-gnu`
// proves it.
fn link_swift_sync() {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    let target = format!("{}-apple-macos14.4", if arch == "aarch64" { "arm64" } else { "x86_64" });

    // OPSync.swift is READ from ios/, never copied: one transport, two hosts.
    let sources = ["ios/OPSync.swift", "macos/DesktopSyncHost.swift"];
    let status = Command::new("swiftc")
        .args(["-emit-library", "-static", "-parse-as-library", "-O",
               "-target", &target, "-module-name", "OPDesktopSync", "-o"])
        .arg(out.join("libOPDesktopSync.a"))
        .args(sources)
        .status()
        .expect("swiftc not found — Xcode command line tools are required for the macOS build");
    assert!(status.success(), "swiftc failed compiling the sync transport");

    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=OPDesktopSync");

    // The Swift runtime ships with macOS 14+, so nothing is embedded — but the
    // LINK still needs the toolchain's and the SDK's search paths, and the
    // binary needs the rpath to find the OS copies at load.
    let sdk = cmd("xcrun", &["--sdk", "macosx", "--show-sdk-path"]);
    let swiftc = PathBuf::from(cmd("xcrun", &["--find", "swiftc"]));
    let toolchain_lib = swiftc.parent().unwrap().parent().unwrap().join("lib/swift/macosx");
    println!("cargo:rustc-link-search=native={}", toolchain_lib.display());
    println!("cargo:rustc-link-search=native={}/usr/lib/swift", sdk);
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    // NOT swiftrt.o: it does not exist in this Xcode and dyld registers Swift
    // metadata itself. Adding it fails the link on a missing file.
    for f in ["CloudKit", "Foundation"] {
        println!("cargo:rustc-link-lib=framework={f}");
    }
    for s in sources {
        println!("cargo:rerun-if-changed={s}");
    }
}

fn cmd(bin: &str, args: &[&str]) -> String {
    let out = Command::new(bin).args(args).output().expect(bin);
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}
