import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const creatorSurfaceFiles = [
  'src/components/SimplifiedCreateExperience.tsx',
  'src/components/BottomNav.tsx',
  'src/components/StatusBar.tsx',
  'src/pages/InboxPage.tsx',
];

const forbiddenProductionTerms = [
  'Seedance',
  'Kling',
  'Veo',
  'Gemini',
  'Nano Banana',
  'Firefly',
  'Replicate',
  'provider payload',
  'VITE_',
  'reference count',
  'exact likeness',
  'scene anchor',
  'retry count',
  'fallback count',
  'diagnostics',
  'prompt adaptation',
  'provider readiness',
  'Auto Stage',
];

const files = await Promise.all(
  creatorSurfaceFiles.map(async (file) => ({
    file,
    source: await readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
  })),
);

for (const { file, source } of files) {
  for (const term of forbiddenProductionTerms) {
    assert.equal(
      source.toLowerCase().includes(term.toLowerCase()),
      false,
      `${term} must not appear in the standard creator surface (${file})`,
    );
  }
}

const createSurface = files.find(({ file }) => file.endsWith('SimplifiedCreateExperience.tsx'))?.source ?? '';
for (const requiredCopy of [
  'What happens?',
  'Describe the scene you want to create…',
  'Give me an idea',
  'Generate',
  'Save draft',
  'Customize',
  'Portrait',
  'Landscape',
  'Square',
  'Short',
  'Standard',
  'Auto',
  'Cinematic',
  'Social',
  'Animated',
]) {
  assert.equal(createSurface.includes(requiredCopy), true, `Missing creator-facing copy: ${requiredCopy}`);
}

assert.equal(createSurface.includes('Prompt polish'), false);
assert.equal(createSurface.includes('Story Memory'), false);
assert.equal(createSurface.includes('references ready'), false);

const bottomNav = files.find(({ file }) => file.endsWith('BottomNav.tsx'))?.source ?? '';
const primaryDestinationCount = [...bottomNav.matchAll(/\['(?:Home|Discover|Create|Drafts|Profile)',\s*'\/[^']+'\]/g)].length;
assert.equal(primaryDestinationCount, 5, 'Primary navigation must contain exactly five creator destinations.');
assert.equal(bottomNav.includes("['Inbox', '/inbox']"), false, 'Inbox must not be a primary navigation destination.');

const createVideoSource = await readFile(
  new URL('../src/components/CreateVideo.tsx', import.meta.url),
  'utf8',
);
const [appSource, homeSource, discoverSource] = await Promise.all(
  ['src/App.tsx', 'src/pages/HomePage.tsx', 'src/pages/TrendsPage.tsx'].map((file) =>
    readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
  ),
);
assert.equal(
  createVideoSource.includes('if (!internalCreateDiagnostics)'),
  true,
  'The standard Create surface must be separated from internal diagnostics.',
);
assert.equal(
  createVideoSource.includes('shouldShowInternalCreateDiagnostics'),
  true,
  'Internal diagnostics must remain available through the guarded development boundary.',
);
assert.equal(
  appSource.includes('path="/account/delete"'),
  true,
  'Account deletion safeguards must remain reachable.',
);
assert.equal(
  homeSource.includes('ContentSafetyActions') && discoverSource.includes('ContentSafetyActions'),
  true,
  'Reporting and blocking controls must remain available on shared content.',
);

console.info('Production creator-copy audit passed.');
