//! macOS-only bridge between the page and the CloudKit transport.
//!
//! The transport is `ios/OPSync.swift`, compiled into this binary unchanged
//! (see build.rs). What lives here is the desktop half of its host: the C
//! surface Swift calls into, and the two Tauri commands the page answers on.
//! Nothing in this file may construct a `CKContainer` outside the signed
//! bundle — see the link test below for why.
//!
//! macOS only. The gate is the `#[cfg(target_os = "macos")]` on this module's
//! `mod` line in lib.rs — not repeated here, where a second copy is a
//! duplicated-attribute lint that clippy -D warnings turns into an error.

#[cfg(test)]
mod link_tests {
    use std::ffi::{c_char, CStr};

    extern "C" {
        fn op_sync_link_check() -> *mut c_char;
        fn op_sync_free(p: *mut c_char);
    }

    #[test]
    fn the_swift_library_is_linked_and_callable() {
        // Never a CKContainer here: outside a signed, entitled bundle
        // `CKContainer(identifier:)` throws, and this runs under `cargo test`.
        // This proves only the static link and the C surface, both directions
        // of which the scratchpad spike already showed working.
        let p = unsafe { op_sync_link_check() };
        let s = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
        unsafe { op_sync_free(p) };
        assert_eq!(s, "op-desktop-sync:linked");
    }
}
