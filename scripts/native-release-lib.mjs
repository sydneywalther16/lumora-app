import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as parseEnv } from 'dotenv';

export const NATIVE_RELEASE_MANIFEST = 'native-release-manifest.json';
export const REQUIRED_NATIVE_CLIENT_CONFIG = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
];
export const CAPACITOR_GENERATED_WEB_FILES = new Set([
  'cordova.js',
  'cordova_plugins.js',
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const toPosixPath = (value) => value.split(sep).join('/');

function listFiles(rootDir) {
  if (!existsSync(rootDir)) return [];

  return readdirSync(rootDir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = join(rootDir, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    })
    .sort();
}

function pathIsInside(parentPath, candidatePath) {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

function requireNonEmptyClientConfig(source) {
  const missing = REQUIRED_NATIVE_CLIENT_CONFIG.filter(
    (name) => typeof source[name] !== 'string' || source[name].trim() === '',
  );

  if (missing.length > 0) {
    throw new Error(
      `Native release client configuration is unavailable: ${missing.join(', ')}`,
    );
  }

  return {
    supabaseUrl: source.VITE_SUPABASE_URL,
    supabaseAnonKey: source.VITE_SUPABASE_ANON_KEY,
  };
}

export function loadReleaseClientConfig({
  env = process.env,
  envFilePath,
  repoRoot = process.cwd(),
} = {}) {
  if (!envFilePath) {
    return requireNonEmptyClientConfig(env);
  }

  const resolvedEnvFile = isAbsolute(envFilePath)
    ? resolve(envFilePath)
    : resolve(process.cwd(), envFilePath);

  if (pathIsInside(repoRoot, resolvedEnvFile)) {
    throw new Error(
      'The native release environment file must remain outside the Git worktree.',
    );
  }
  if (!existsSync(resolvedEnvFile) || !statSync(resolvedEnvFile).isFile()) {
    throw new Error('The approved native release environment file was not found.');
  }

  return requireNonEmptyClientConfig(
    parseEnv(readFileSync(resolvedEnvFile, 'utf8')),
  );
}

export function buildReleaseChildEnvironment(baseEnv, clientConfig) {
  return {
    ...baseEnv,
    VITE_SUPABASE_URL: clientConfig.supabaseUrl,
    VITE_SUPABASE_ANON_KEY: clientConfig.supabaseAnonKey,
  };
}

export function resetNativeBuildDirectories({ distDir, publicDir }) {
  rmSync(distDir, { force: true, recursive: true });
  rmSync(publicDir, { force: true, recursive: true });
}

export function hashAssetFiles(rootDir, { excludeManifest = false } = {}) {
  return Object.fromEntries(
    listFiles(rootDir)
      .map((filePath) => toPosixPath(relative(rootDir, filePath)))
      .filter(
        (relativePath) =>
          !excludeManifest || relativePath !== NATIVE_RELEASE_MANIFEST,
      )
      .map((relativePath) => [
        relativePath,
        sha256(readFileSync(join(rootDir, relativePath))),
      ]),
  );
}

export function verifyBundledClientConfig(rootDir, clientConfig) {
  const compiledJavaScript = listFiles(rootDir)
    .filter((filePath) => filePath.endsWith('.js'))
    .map((filePath) => readFileSync(filePath, 'utf8'))
    .join('\n');

  if (!compiledJavaScript.includes(clientConfig.supabaseUrl)) {
    throw new Error(
      'The production build does not contain the approved Supabase URL.',
    );
  }
  if (!compiledJavaScript.includes(clientConfig.supabaseAnonKey)) {
    throw new Error(
      'The production build does not contain the approved Supabase client key.',
    );
  }

  return {
    supabaseUrlPresent: true,
    supabaseAnonKeyPresent: true,
  };
}

export function readXcodeVersions(projectFile) {
  const projectSource = readFileSync(projectFile, 'utf8');
  const valuesFor = (setting) => [
    ...projectSource.matchAll(new RegExp(`${setting} = ([^;]+);`, 'g')),
  ].map((match) => match[1].trim().replace(/^"|"$/g, ''));
  const uniqueBuildNumbers = [...new Set(valuesFor('CURRENT_PROJECT_VERSION'))];
  const uniqueMarketingVersions = [...new Set(valuesFor('MARKETING_VERSION'))];

  if (uniqueBuildNumbers.length !== 1 || uniqueMarketingVersions.length !== 1) {
    throw new Error(
      'Xcode Debug and Release versions must agree before a native release.',
    );
  }

  return {
    iosBuildNumber: uniqueBuildNumbers[0],
    marketingVersion: uniqueMarketingVersions[0],
  };
}

export function readGitCommit(repoRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error('Unable to resolve the native release source commit.');
  }
  return result.stdout.trim();
}

export function assertCleanTrackedWorktree(repoRoot) {
  const result = spawnSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0 || result.stdout.trim() !== '') {
    throw new Error(
      'Commit tracked source changes before creating native release assets.',
    );
  }
}

export function verifyPortableCapacitorPackage(packageFile) {
  const packageSource = readFileSync(packageFile, 'utf8');
  const localPackagePaths = [
    ...packageSource.matchAll(/\.package\(name: "[^"]+", path: "([^"]+)"\)/g),
  ].map((match) => match[1]);

  if (
    localPackagePaths.length === 0 ||
    localPackagePaths.some(
      (packagePath) => !packagePath.startsWith('../../../node_modules/'),
    )
  ) {
    throw new Error(
      'Capacitor generated non-portable package paths; use worktree-local dependencies.',
    );
  }
}

export function createNativeReleaseManifest({
  gitCommit,
  marketingVersion,
  iosBuildNumber,
  assetHashes,
  builtAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: 1,
    gitCommit,
    marketingVersion,
    iosBuildNumber,
    builtAt,
    supabaseUrlPresent: true,
    supabaseAnonKeyPresent: true,
    assetHashes,
  };
}

export function writeNativeReleaseManifest(distDir, manifest, clientConfig) {
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

  if (
    serialized.includes(clientConfig.supabaseUrl) ||
    serialized.includes(clientConfig.supabaseAnonKey)
  ) {
    throw new Error('Native release manifest must not contain client values.');
  }

  writeFileSync(join(distDir, NATIVE_RELEASE_MANIFEST), serialized, {
    mode: 0o644,
  });
}

export function verifySyncedNativeAssets({ distDir, publicDir }) {
  const distHashes = hashAssetFiles(distDir);
  const publicHashes = hashAssetFiles(publicDir);

  for (const [relativePath, expectedHash] of Object.entries(distHashes)) {
    if (publicHashes[relativePath] !== expectedHash) {
      throw new Error(
        `Capacitor did not copy the current production asset: ${relativePath}`,
      );
    }
  }

  const unexpectedFiles = Object.keys(publicHashes).filter(
    (relativePath) =>
      !(relativePath in distHashes) &&
      !CAPACITOR_GENERATED_WEB_FILES.has(relativePath),
  );
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Stale native web assets remain after Capacitor sync: ${unexpectedFiles.join(', ')}`,
    );
  }

  return {
    distAssetCount: Object.keys(distHashes).length,
    publicAssetCount: Object.keys(publicHashes).length,
  };
}

function readNativeManifest(publicDir) {
  const manifestPath = join(publicDir, NATIVE_RELEASE_MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new Error('Native release manifest is missing.');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest.supabaseUrlPresent !== true ||
    manifest.supabaseAnonKeyPresent !== true
  ) {
    throw new Error('Native release manifest reports missing client configuration.');
  }
  if (
    typeof manifest.assetHashes !== 'object' ||
    manifest.assetHashes === null ||
    Array.isArray(manifest.assetHashes)
  ) {
    throw new Error('Native release manifest does not contain asset hashes.');
  }

  return manifest;
}

export function verifyNativeBundle({
  publicDir,
  expectedCommit,
  expectedBuildNumber,
  expectedMarketingVersion,
}) {
  const manifest = readNativeManifest(publicDir);

  if (manifest.gitCommit !== expectedCommit) {
    throw new Error('Native release manifest source commit is stale.');
  }
  if (String(manifest.iosBuildNumber) !== String(expectedBuildNumber)) {
    throw new Error('Native release manifest build number does not match Xcode.');
  }
  if (String(manifest.marketingVersion) !== String(expectedMarketingVersion)) {
    throw new Error(
      'Native release manifest marketing version does not match Xcode.',
    );
  }

  const publicHashes = hashAssetFiles(publicDir);
  for (const [relativePath, expectedHash] of Object.entries(
    manifest.assetHashes,
  )) {
    if (publicHashes[relativePath] !== expectedHash) {
      throw new Error(`Native release asset hash mismatch: ${relativePath}`);
    }
  }

  const allowedFiles = new Set([
    ...Object.keys(manifest.assetHashes),
    NATIVE_RELEASE_MANIFEST,
    ...CAPACITOR_GENERATED_WEB_FILES,
  ]);
  const unexpectedFiles = Object.keys(publicHashes).filter(
    (relativePath) => !allowedFiles.has(relativePath),
  );
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Native bundle contains stale assets: ${unexpectedFiles.join(', ')}`,
    );
  }

  const compiledJavaScript = listFiles(publicDir)
    .filter((filePath) => filePath.endsWith('.js'))
    .map((filePath) => readFileSync(filePath, 'utf8'))
    .join('\n');
  const hasSupabaseUrl =
    /https:\/\/[A-Za-z0-9.-]+\.supabase\.co/.test(compiledJavaScript);
  const hasSupabaseClientKey =
    /sb_publishable_[A-Za-z0-9_-]+/.test(compiledJavaScript) ||
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
      compiledJavaScript,
    );
  if (!hasSupabaseUrl || !hasSupabaseClientKey) {
    throw new Error('Native bundle is missing compiled Supabase client configuration.');
  }

  return {
    gitCommit: manifest.gitCommit,
    marketingVersion: manifest.marketingVersion,
    iosBuildNumber: manifest.iosBuildNumber,
    supabaseUrlPresent: true,
    supabaseAnonKeyPresent: true,
    assetCount: Object.keys(manifest.assetHashes).length,
    manifestHash: sha256(
      readFileSync(join(publicDir, NATIVE_RELEASE_MANIFEST)),
    ),
  };
}

export function runCheckedCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed.`);
  }
}
