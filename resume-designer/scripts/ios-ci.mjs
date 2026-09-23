import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appleProject = root => join(root, 'src-tauri/gen/apple');

// Tauri 2.11.2's xcode-script requires a live parent CLI IPC server. Cloud
// starts Xcode independently, so mirror its staticlib contract using Cargo:
// --lib, tauri/custom-protocol, platform config, and the libapp.a link name.
export function cargoBuildPlan({ appRoot, outputRoot, sdkRoot, macSdkRoot, platform, configuration, arch, env: inherited }) {
  const targets = {
    'iphoneos:arm64': 'aarch64-apple-ios',
    'iphonesimulator:arm64': 'aarch64-apple-ios-sim',
    'iphonesimulator:x86_64': 'x86_64-apple-ios',
  };
  const target = targets[`${platform}:${arch}`];
  if (!target || !['debug', 'release'].includes(configuration)) throw new Error('Unsupported iOS target or configuration');
  const env = { ...inherited };
  // Xcode's global target flags also reach Cargo's macOS build scripts. Keep
  // the SDKs per target, and let rustc/Swift select their SDK from the triple.
  for (const key of ['SDKROOT', 'CFLAGS', 'CXXFLAGS', 'CPPFLAGS', 'LDFLAGS', 'CPATH', 'LIBRARY_PATH',
    'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH', 'OBJC_INCLUDE_PATH', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS',
    'FRAMEWORK_SEARCH_PATHS', 'HEADER_SEARCH_PATHS', 'GCC_PREPROCESSOR_DEFINITIONS']) delete env[key];
  for (const host of ['aarch64_apple_darwin', 'x86_64_apple_darwin']) {
    env[`CFLAGS_${host}`] = `-isysroot "${macSdkRoot}"`;
    env[`CXXFLAGS_${host}`] = `-isysroot "${macSdkRoot}"`;
    env[`OBJC_INCLUDE_PATH_${host}`] = join(macSdkRoot, 'usr/include');
  }
  const envTarget = target.replaceAll('-', '_');
  env[`CFLAGS_${envTarget}`] = `-isysroot "${sdkRoot}"`;
  env[`CXXFLAGS_${envTarget}`] = `-isysroot "${sdkRoot}"`;
  env[`OBJC_INCLUDE_PATH_${envTarget}`] = join(sdkRoot, 'usr/include');
  Object.assign(env, {
    CARGO_TARGET_DIR: join(outputRoot, 'cargo'),
    PATH: `${join(outputRoot, 'swift-bin')}:${env.PATH}`,
    IPHONEOS_DEPLOYMENT_TARGET: '26.0',
    TAURI_IOS_PROJECT_PATH: appleProject(appRoot),
    TAURI_IOS_APP_NAME: 'resume-designer',
    // iOS marketing version is independent of desktop release automation.
    TAURI_CONFIG: JSON.stringify({ version: '1.0.0' }),
  });
  return {
    args: ['build', '--locked', '--lib', '--target', target, '--features', 'tauri/custom-protocol',
      ...(configuration === 'release' ? ['--release'] : [])],
    env,
    library: join(env.CARGO_TARGET_DIR, target, configuration, 'libon_paper_lib.a'),
    destination: join(env.OP_RUST_LIB_ROOT || join(appleProject(appRoot), 'Externals'), arch, configuration, 'libapp.a'),
  };
}

export function unsignedBuildPlans(root, outputRoot, mode = 'all') {
  if (!['all', 'simulator', 'archive'].includes(mode)) throw new Error('Use all, simulator, or archive');
  const common = ['-project', join(appleProject(root), 'resume-designer.xcodeproj'),
    '-scheme', 'resume-designer_iOS', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=', 'DEVELOPMENT_TEAM=', 'OP_IOS_CI=1',
    `OP_IOS_CI_OUTPUT_DIR=${outputRoot}`, `OP_RUST_LIB_ROOT=${join(outputRoot, 'Externals')}`];
  const plans = [];
  if (mode !== 'archive') plans.push([...common, '-configuration', 'debug', '-sdk', 'iphonesimulator',
    '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', join(outputRoot, 'simulator'), 'build']);
  if (mode !== 'simulator') plans.push([...common, '-configuration', 'release', '-sdk', 'iphoneos',
    '-destination', 'generic/platform=iOS', '-derivedDataPath', join(outputRoot, 'device'),
    '-archivePath', join(outputRoot, 'On Paper.xcarchive'), 'archive']);
  return plans;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: appRoot, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

function sdkPath(sdk) {
  const result = spawnSync('xcrun', ['--sdk', sdk, '--show-sdk-path'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot locate ${sdk} SDK: ${result.stderr}`);
  return result.stdout.trim();
}

function main(command, mode) {
  if (command === 'build') {
    // Validate before running frontend or native build work.
    unsignedBuildPlans(appRoot, '/unused', mode);
    const outputRoot = process.env.OP_IOS_CI_OUTPUT_DIR
      ? resolve(process.env.OP_IOS_CI_OUTPUT_DIR) : mkdtempSync(join(tmpdir(), 'on-paper-ios-ci-'));
    console.log(`On Paper iOS build output: ${outputRoot}`);
    mkdirSync(join(appleProject(appRoot), 'assets'), { recursive: true });
    mkdirSync(join(appleProject(appRoot), 'Externals'), { recursive: true });
    run('npm', ['run', 'build']);
    for (const args of unsignedBuildPlans(appRoot, outputRoot, mode)) run('xcodebuild', args);
    return;
  }
  if (command !== 'native') throw new Error('Use build or native');
  if (!existsSync(join(appRoot, 'dist/index.html'))) throw new Error('Missing frontend: run npm run build first');
  const platform = process.env.PLATFORM_NAME;
  const outputRoot = process.env.OP_IOS_CI_OUTPUT_DIR || join(appleProject(appRoot), 'build/ci-native');
  const macSdkRoot = sdkPath('macosx');
  const sdkRoot = sdkPath(platform);
  const swift = spawnSync('xcrun', ['--find', 'swift'], { encoding: 'utf8' });
  if (swift.status !== 0) throw new Error(`Cannot locate Swift: ${swift.stderr}`);
  const shim = join(outputRoot, 'swift-bin/swift');
  mkdirSync(dirname(shim), { recursive: true });
  copyFileSync(join(appRoot, 'scripts/ios-ci-swift.sh'), shim);
  chmodSync(shim, 0o755);
  for (const arch of (process.env.ARCHS || '').trim().split(/\s+/)) {
    const plan = cargoBuildPlan({ appRoot, outputRoot, sdkRoot, macSdkRoot, platform,
      configuration: process.env.CONFIGURATION, arch, env: { ...process.env, OP_IOS_SWIFT_EXEC: swift.stdout.trim() } });
    run('cargo', plan.args, { cwd: join(appRoot, 'src-tauri'), env: plan.env });
    if (!existsSync(plan.library)) throw new Error(`Cargo did not produce ${plan.library}`);
    mkdirSync(dirname(plan.destination), { recursive: true });
    copyFileSync(plan.library, plan.destination);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv[2], process.argv[3] || 'all'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
