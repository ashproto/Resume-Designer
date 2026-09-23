#!/bin/bash
set -euo pipefail
# swift-rs 1.0.7 supplies its iOS triple via -Xswiftc and expects the native
# engine's output layout. Xcode 27 defaults to SwiftBuild, which appends a
# macOS triple after those arguments. Scope compatibility to Cargo's child
# process; never replace the installed Swift tool or alter other commands.
if [[ "${1:-}" == build ]]; then
  shift
  exec "${OP_IOS_SWIFT_EXEC:?}" build --build-system native "$@"
fi
exec "${OP_IOS_SWIFT_EXEC:?}" "$@"
