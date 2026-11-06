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
  # PR previews use a manually dispatched tag, never Cloud's native PR trigger.
  # Request-binding tags intentionally cannot enter the signing/build pipeline.
  local op_release_pattern='^ios-testflight/(main|next)/([0-9a-f]{40})$'
  local op_preview_pattern='^ios-testflight/pr/([1-9][0-9]*)/([1-9][0-9]*)[/-]([0-9a-f]{40})$'
  local op_commit op_pr op_comment
  if [[ "${CI_XCODE_CLOUD:-}" == TRUE && "${CI_TAG:-}" =~ $op_release_pattern ]]; then
    op_commit="${BASH_REMATCH[2]}"
  elif [[ "${CI_XCODE_CLOUD:-}" == TRUE && "${CI_TAG:-}" =~ $op_preview_pattern ]]; then
    op_pr="${BASH_REMATCH[1]}"
    op_comment="${BASH_REMATCH[2]}"
    op_commit="${BASH_REMATCH[3]}"
    # Match the controller's positive safe-integer IDs without requiring Node
    # before the clean-clone hook has provisioned it. Check length before math.
    if [[ ${#op_pr} -gt 16 || ${#op_comment} -gt 16 ]] ||
      (( 10#$op_pr > 9007199254740991 || 10#$op_comment > 9007199254740991 )); then
      echo 'Refusing Xcode Cloud build: PR and owner request IDs must be positive safe integers.' >&2
      return 1
    fi
  else
    echo 'Refusing Xcode Cloud build: requires an exact main/next or PR dispatch tag.' >&2
    return 1
  fi
  if [[ "$op_commit" != "${CI_COMMIT:-}" || -n "${CI_PULL_REQUEST_NUMBER:-}" ]]; then
    echo 'Refusing Xcode Cloud build: tag commit must equal CI_COMMIT and cannot be a pull request.' >&2
    return 1
  fi
  if [[ -n "${CI_GIT_REF:-}" && "$CI_GIT_REF" != "refs/tags/$CI_TAG" ]]; then
    echo 'Refusing Xcode Cloud build: CI_GIT_REF does not match the dispatch tag.' >&2
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
