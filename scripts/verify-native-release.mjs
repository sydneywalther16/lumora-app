import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readGitCommit,
  readXcodeVersions,
  verifyNativeBundle,
} from './native-release-lib.mjs';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (!args[index + 1]) throw new Error(`${flag} requires a value.`);
  return args[index + 1];
}

export function verifyNativeReleaseFromArgs(
  args = process.argv.slice(2),
  cwd = process.cwd(),
) {
  const repoRoot = resolve(valueAfter(args, '--repo-root') || cwd);
  const archivePath = valueAfter(args, '--archive');
  const explicitPublicDir = valueAfter(args, '--public-dir');
  const publicDir = explicitPublicDir
    ? resolve(explicitPublicDir)
    : archivePath
      ? join(
          resolve(archivePath),
          'Products/Applications/App.app/public',
        )
      : join(repoRoot, 'ios/App/App/public');
  const versions = readXcodeVersions(
    join(repoRoot, 'ios/App/App.xcodeproj/project.pbxproj'),
  );
  const expectedCommit =
    valueAfter(args, '--expected-commit') || readGitCommit(repoRoot);
  const expectedBuildNumber =
    valueAfter(args, '--expected-build-number') || versions.iosBuildNumber;
  const expectedMarketingVersion =
    valueAfter(args, '--expected-marketing-version') ||
    versions.marketingVersion;

  return verifyNativeBundle({
    publicDir,
    expectedCommit,
    expectedBuildNumber,
    expectedMarketingVersion,
  });
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  try {
    const result = verifyNativeReleaseFromArgs();
    console.info(JSON.stringify({ status: 'native-release-verified', ...result }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
