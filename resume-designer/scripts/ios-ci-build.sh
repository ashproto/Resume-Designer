#!/bin/bash
set -euo pipefail
# shellcheck source=ios-ci-env.sh
source "$(dirname "$0")/ios-ci-env.sh"
op_ios_ci_use_tools
op_ios_ci_check_tools
exec node "$OP_IOS_APP_ROOT/scripts/ios-ci.mjs" build "${1:-all}"
