#!/bin/bash
set -euo pipefail
# Apple discovers ci_scripts next to the committed .xcodeproj. Resolve the
# app from the hook itself; Cloud invokes hooks from temporary directories.
op_app_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
exec bash "$op_app_root/scripts/ios-ci-prepare.sh"
