#!/bin/bash
# Xcode Cloud clean-clone dependencies. No sudo, signing identities or secrets.
set -euo pipefail
# shellcheck source=ios-ci-env.sh
source "$(dirname "$0")/ios-ci-env.sh"
op_ios_ci_cloud_gate
mkdir -p "$OP_IOS_TOOLS_DIR" "$OP_IOS_APPLE_PROJECT/assets" "$OP_IOS_APPLE_PROJECT/Externals"

case "$(uname -m)" in
  arm64) op_node_arch=arm64; op_node_sha=d595961e563fcae057d4a0fb992f175a54d97fcc4a14dc2d474d92ddeea3b9f8 ;;
  x86_64) op_node_arch=x64; op_node_sha=6f03c1b48ddbe1b129a6f8038be08e0899f05f17185b4d3e4350180ab669a7f3 ;;
  *) echo 'Unsupported macOS build host' >&2; exit 1 ;;
esac
if [[ ! -x "$OP_IOS_TOOLS_DIR/node/bin/node" ]]; then
  op_node_archive="node-v$OP_IOS_NODE_VERSION-darwin-$op_node_arch.tar.gz"
  curl --fail --location --retry 3 "https://nodejs.org/download/release/v$OP_IOS_NODE_VERSION/$op_node_archive" -o "$OP_IOS_TOOLS_DIR/$op_node_archive"
  (cd "$OP_IOS_TOOLS_DIR" && printf '%s  %s\n' "$op_node_sha" "$op_node_archive" | shasum -a 256 -c -)
  tar -xzf "$OP_IOS_TOOLS_DIR/$op_node_archive" -C "$OP_IOS_TOOLS_DIR"
  mv "$OP_IOS_TOOLS_DIR/node-v$OP_IOS_NODE_VERSION-darwin-$op_node_arch" "$OP_IOS_TOOLS_DIR/node"
fi
export RUSTUP_HOME="$OP_IOS_TOOLS_DIR/rustup"
export CARGO_HOME="$OP_IOS_TOOLS_DIR/cargo"
op_ios_ci_use_tools
if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
  curl --fail --location --retry 3 https://sh.rustup.rs -o "$OP_IOS_TOOLS_DIR/rustup-init.sh"
  sh "$OP_IOS_TOOLS_DIR/rustup-init.sh" -y --no-modify-path --profile minimal --default-toolchain "$OP_IOS_RUST_VERSION"
fi
rustup toolchain install "$OP_IOS_RUST_VERSION" --profile minimal
rustup default "$OP_IOS_RUST_VERSION"
rustup target add --toolchain "$OP_IOS_RUST_VERSION" aarch64-apple-ios aarch64-apple-ios-sim
op_ios_ci_check_tools
cd "$OP_IOS_APP_ROOT"
npm ci
npm run build
