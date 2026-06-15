fn main() {
    tauri_build::build();

    // --- bundle Typst fonts: generate an include array from fonts/*.ttf ---
    let fonts_dir = std::path::Path::new("fonts");
    let mut entries: Vec<String> = std::fs::read_dir(fonts_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("ttf"))
            .map(|p| format!("include_bytes!(r\"{}\").as_slice()", std::fs::canonicalize(&p).unwrap().display()))
            .collect())
        .unwrap_or_default();
    entries.sort();
    let generated = format!("pub static BUNDLED_FONTS: &[&[u8]] = &[\n{}\n];\n", entries.join(",\n"));
    std::fs::write(
        std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("fonts.rs"),
        generated,
    ).unwrap();
    println!("cargo:rerun-if-changed=fonts");
}
