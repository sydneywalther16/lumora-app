import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertCleanTrackedWorktree,
  buildReleaseChildEnvironment,
  createNativeReleaseManifest,
  hashAssetFiles,
  loadReleaseClientConfig,
  readGitCommit,
  readXcodeVersions,
  resetNativeBuildDirectories,
  runCheckedCommand,
  verifyBundledClientConfig,
  verifyNativeBundle,
  verifyPortableCapacitorPackage,
  verifySyncedNativeAssets,
  writeNativeReleaseManifest,
} from './native-release-lib.mjs';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (!args[index + 1]) throw new Error(`${flag} requires a value.`);
  return args[index + 1];
}

export async function runNativeReleaseSync({
  args = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const repoRoot = resolve(valueAfter(args, '--repo-root') || cwd);
  const envFilePath = valueAfter(args, '--env-file');
  const allowDirty = args.includes('--allow-dirty');
  const distDir = join(repoRoot, 'dist');
  const publicDir = join(repoRoot, 'ios/App/App/public');
  const xcodeProject = join(repoRoot, 'ios/App/App.xcodeproj/project.pbxproj');

  const clientConfig = loadReleaseClientConfig({
    env,
    envFilePath,
    repoRoot,
  });
  if (!allowDirty) assertCleanTrackedWorktree(repoRoot);

  const childEnv = buildReleaseChildEnvironment(env, clientConfig);
  const versions = readXcodeVersions(xcodeProject);
  const gitCommit = readGitCommit(repoRoot);

  console.info(
    'Native release configuration present: Supabase URL=true, client key=true.',
  );
  resetNativeBuildDirectories({ distDir, publicDir });
  runCheckedCommand('npm', ['run', 'build', '--', '--mode', 'production'], {
    cwd: repoRoot,
    env: childEnv,
  });

  verifyBundledClientConfig(distDir, clientConfig);
  const manifest = createNativeReleaseManifest({
    gitCommit,
    marketingVersion: versions.marketingVersion,
    iosBuildNumber: versions.iosBuildNumber,
    assetHashes: hashAssetFiles(distDir, { excludeManifest: true }),
  });
  writeNativeReleaseManifest(distDir, manifest, clientConfig);

  runCheckedCommand('npx', ['cap', 'sync', 'ios'], {
    cwd: repoRoot,
    env: childEnv,
  });
  verifyPortableCapacitorPackage(
    join(repoRoot, 'ios/App/CapApp-SPM/Package.swift'),
  );
  if (!allowDirty) assertCleanTrackedWorktree(repoRoot);
  const syncResult = verifySyncedNativeAssets({ distDir, publicDir });
  const verification = verifyNativeBundle({
    publicDir,
    expectedCommit: gitCommit,
    expectedBuildNumber: versions.iosBuildNumber,
    expectedMarketingVersion: versions.marketingVersion,
  });

  console.info(
    JSON.stringify({
      status: 'native-release-assets-ready',
      gitCommit: verification.gitCommit,
      marketingVersion: verification.marketingVersion,
      iosBuildNumber: verification.iosBuildNumber,
      supabaseUrlPresent: verification.supabaseUrlPresent,
      supabaseAnonKeyPresent: verification.supabaseAnonKeyPresent,
      manifestHash: verification.manifestHash,
      distAssetCount: syncResult.distAssetCount,
      publicAssetCount: syncResult.publicAssetCount,
    }),
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runNativeReleaseSync().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
