#!/bin/bash
set -euo pipefail
op_app_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
# shellcheck source=ios-ci-env.sh
source "$op_app_root/scripts/ios-ci-env.sh"
op_ios_ci_cloud_gate
op_ios_ci_use_tools
op_ios_ci_check_tools
# Only this disposable Cloud checkout is changed. Do not run desktop version
# automation: iOS has its own marketing version and Cloud's monotonic build.
op_info="$OP_IOS_APPLE_PROJECT/resume-designer_iOS/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleShortVersionString 1.0.0' "$op_info"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $CI_BUILD_NUMBER" "$op_info"
test -f "$OP_IOS_APP_ROOT/dist/index.html"
