import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReleaseChildEnvironment,
  createNativeReleaseManifest,
  hashAssetFiles,
  loadReleaseClientConfig,
  NATIVE_RELEASE_MANIFEST,
  resetNativeBuildDirectories,
  verifyBundledClientConfig,
  verifyNativeBundle,
  verifyPortableCapacitorPackage,
  verifySyncedNativeAssets,
  writeNativeReleaseManifest,
} from '../../scripts/native-release-lib.mjs';

const fixtureUrl = 'https://fixture.supabase.co';
const fixtureKey = ['sb', 'publishable', 'fixture', 'only'].join('_');
const fixtureConfig = {
  supabaseUrl: fixtureUrl,
  supabaseAnonKey: fixtureKey,
};
const supabaseClientSource = readFileSync(
  join(process.cwd(), 'src/lib/supabase.ts'),
  'utf8',
);
const sessionBootstrapSource = readFileSync(
  join(process.cwd(), 'src/lib/bootstrapSession.ts'),
  'utf8',
);
assert.match(supabaseClientSource, /hasSupabaseConfig/);
assert.match(supabaseClientSource, /persistSession: true/);
assert.match(supabaseClientSource, /:\s*null;/);
assert.match(sessionBootstrapSource, /client\.auth\.getSession\(\)/);

assert.throws(
  () =>
    loadReleaseClientConfig({
      env: { VITE_SUPABASE_ANON_KEY: fixtureKey },
    }),
  /VITE_SUPABASE_URL/,
);
assert.throws(
  () =>
    loadReleaseClientConfig({
      env: { VITE_SUPABASE_URL: fixtureUrl },
    }),
  /VITE_SUPABASE_ANON_KEY/,
);

const childEnvironment = buildReleaseChildEnvironment(
  { PATH: '/fixture/bin' },
  fixtureConfig,
);
assert.equal(childEnvironment.VITE_SUPABASE_URL, fixtureUrl);
assert.equal(childEnvironment.VITE_SUPABASE_ANON_KEY, fixtureKey);

const root = mkdtempSync(join(tmpdir(), 'lumora-native-release-test-'));
const portablePackage = join(root, 'Package.swift');
writeFileSync(
  portablePackage,
  '.package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app")',
);
verifyPortableCapacitorPackage(portablePackage);
writeFileSync(
  portablePackage,
  '.package(name: "CapacitorApp", path: "../../../../Users/example/node_modules/@capacitor/app")',
);
assert.throws(
  () => verifyPortableCapacitorPackage(portablePackage),
  /non-portable package paths/,
);

const distDir = join(root, 'dist');
const publicDir = join(root, 'public');
mkdirSync(join(distDir, 'assets'), { recursive: true });
mkdirSync(join(publicDir, 'assets'), { recursive: true });
writeFileSync(
  join(distDir, 'assets/index-fixture.js'),
  `const u=${JSON.stringify(fixtureUrl)},k=${JSON.stringify(fixtureKey)};`,
);
writeFileSync(join(publicDir, 'assets/stale.js'), 'stale');

verifyBundledClientConfig(distDir, fixtureConfig);
assert.throws(
  () =>
    verifyBundledClientConfig(distDir, {
      ...fixtureConfig,
      supabaseAnonKey: 'different-fixture-value',
    }),
  /approved Supabase client key/,
);

resetNativeBuildDirectories({
  distDir: join(root, 'throwaway-dist'),
  publicDir,
});
assert.equal(
  readFileSync(join(distDir, 'assets/index-fixture.js'), 'utf8').includes(
    fixtureKey,
  ),
  true,
);

mkdirSync(join(publicDir, 'assets'), { recursive: true });
const manifest = createNativeReleaseManifest({
  gitCommit: 'fixture-commit',
  marketingVersion: '1.0',
  iosBuildNumber: '7',
  assetHashes: hashAssetFiles(distDir, { excludeManifest: true }),
  builtAt: '2026-07-29T00:00:00.000Z',
});
writeNativeReleaseManifest(distDir, manifest, fixtureConfig);
const serializedManifest = readFileSync(
  join(distDir, NATIVE_RELEASE_MANIFEST),
  'utf8',
);
assert.doesNotMatch(serializedManifest, new RegExp(fixtureUrl));
assert.doesNotMatch(serializedManifest, new RegExp(fixtureKey));
assert.equal(manifest.supabaseUrlPresent, true);
assert.equal(manifest.supabaseAnonKeyPresent, true);

for (const [relativePath] of Object.entries(hashAssetFiles(distDir))) {
  const source = join(distDir, relativePath);
  const destination = join(publicDir, relativePath);
  mkdirSync(join(destination, '..'), { recursive: true });
  writeFileSync(destination, readFileSync(source));
}
writeFileSync(join(publicDir, 'cordova.js'), '');
writeFileSync(join(publicDir, 'cordova_plugins.js'), '');
verifySyncedNativeAssets({ distDir, publicDir });
const verified = verifyNativeBundle({
  publicDir,
  expectedCommit: 'fixture-commit',
  expectedBuildNumber: '7',
  expectedMarketingVersion: '1.0',
});
assert.equal(verified.supabaseUrlPresent, true);
assert.equal(verified.supabaseAnonKeyPresent, true);

writeFileSync(join(publicDir, 'assets/stale.js'), 'stale');
assert.throws(
  () => verifySyncedNativeAssets({ distDir, publicDir }),
  /Stale native web assets/,
);
assert.throws(
  () =>
    verifyNativeBundle({
      publicDir,
      expectedCommit: 'fixture-commit',
      expectedBuildNumber: '7',
      expectedMarketingVersion: '1.0',
    }),
  /stale assets/,
);

const configlessPublic = join(root, 'configless-public');
mkdirSync(configlessPublic, { recursive: true });
writeFileSync(
  join(configlessPublic, NATIVE_RELEASE_MANIFEST),
  JSON.stringify({
    ...manifest,
    supabaseUrlPresent: false,
    supabaseAnonKeyPresent: false,
  }),
);
assert.throws(
  () =>
    verifyNativeBundle({
      publicDir: configlessPublic,
      expectedCommit: 'fixture-commit',
      expectedBuildNumber: '7',
      expectedMarketingVersion: '1.0',
    }),
  /missing client configuration/,
);

console.info('Native release configuration and archive guard tests passed.');
