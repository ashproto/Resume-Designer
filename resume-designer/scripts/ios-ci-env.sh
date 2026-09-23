#!/bin/bash
# Sourced afresh by every Cloud hook and the Xcode Rust phase. Exports from a
# post-clone process do not carry into Xcode Cloud's later build process.
# Used by the bootstrap script that sources this file.
# shellcheck disable=SC2034
OP_IOS_NODE_VERSION=24.13.0
OP_IOS_RUST_VERSION=1.92.0
OP_IOS_APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OP_IOS_APPLE_PROJECT="$OP_IOS_APP_ROOT/src-tauri/gen/apple"
OP_IOS_TOOLS_DIR="$OP_IOS_APPLE_PROJECT/build/ci-tools"

op_ios_ci_cloud_gate() {
  local op_tag_pattern='^ios-testflight/(main|next)/([0-9a-f]{40})$'
  if [[ "${CI_XCODE_CLOUD:-}" != TRUE || ! "${CI_TAG:-}" =~ $op_tag_pattern ]]; then
    echo 'Refusing Xcode Cloud build: requires ios-testflight/main|next/<full commit SHA> tag.' >&2
    return 1
  fi
  if [[ "${BASH_REMATCH[2]}" != "${CI_COMMIT:-}" || -n "${CI_PULL_REQUEST_NUMBER:-}" ]]; then
    echo 'Refusing Xcode Cloud build: tag commit must equal CI_COMMIT and cannot be a pull request.' >&2
    return 1
  fi
  if [[ -n "${CI_GIT_REF:-}" && "$CI_GIT_REF" != "refs/tags/$CI_TAG" ]]; then
    echo 'Refusing Xcode Cloud build: CI_GIT_REF does not match the release tag.' >&2
    return 1
  fi
  if [[ ! "${CI_BUILD_NUMBER:-}" =~ ^[1-9][0-9]*$ ]]; then
    echo 'Refusing Xcode Cloud build: CI_BUILD_NUMBER must be a positive integer.' >&2
    return 1
  fi
}

op_ios_ci_use_tools() {
  export PATH="$OP_IOS_TOOLS_DIR/node/bin:$OP_IOS_TOOLS_DIR/cargo/bin:${HOME}/.cargo/bin:$PATH"
  if [[ -d "$OP_IOS_TOOLS_DIR/rustup" ]]; then
    export RUSTUP_HOME="$OP_IOS_TOOLS_DIR/rustup"
    export CARGO_HOME="$OP_IOS_TOOLS_DIR/cargo"
  fi
}

op_ios_ci_check_tools() {
  if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]]; then
    echo 'iOS CI requires Node 24; provision it before invoking the build.' >&2
    return 1
  fi
  if [[ "$(rustc --version)" != "rustc $OP_IOS_RUST_VERSION "* ]]; then
    echo "iOS CI requires Rust $OP_IOS_RUST_VERSION; provision it before invoking the build." >&2
    return 1
  fi
}
