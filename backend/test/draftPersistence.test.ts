import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDraftPublicCaption } from '../../src/lib/aiCastExperience';
import { sceneTextForDraftEdit } from '../../src/lib/createExperience';
import {
  createManualDraftSaveSession,
  exactManualDraftText,
} from '../../src/lib/manualDraft';

const values = new Map<string, string>();
const storage: Storage = {
  get length() {
    return values.size;
  },
  clear() {
    values.clear();
  },
  getItem(key) {
    return values.get(key) ?? null;
  },
  key(index) {
    return Array.from(values.keys())[index] ?? null;
  },
  removeItem(key) {
    values.delete(key);
  },
  setItem(key, value) {
    values.set(key, value);
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: storage },
});

const { loadStudioProjects, saveStudioProject } = await import('../../src/lib/projectStorage');
const sceneText = 'She pauses beside the candlelit doorway and listens.';

saveStudioProject({
  id: 'text-only-draft-readiness-test',
  title: 'Candlelit doorway',
  prompt: sceneText,
  finalPrompt: sceneText,
  videoUrl: '',
  status: 'draft',
  provider: 'mock',
  engine: 'mock',
  characterId: 'creator-self',
  characterName: 'Sydney Spears',
  characterAvatar: null,
  isDefaultSelfCharacter: true,
  createdAt: '2026-07-27T00:00:00.000Z',
});

const [savedDraft] = loadStudioProjects();
assert.ok(savedDraft, 'The text-only draft must persist.');
assert.equal(savedDraft.status, 'draft');
assert.equal(savedDraft.videoUrl, '');
assert.equal(savedDraft.prompt, sceneText);
assert.equal(sceneTextForDraftEdit(savedDraft), sceneText);

const firstExactDraft = 'Hey! I’m so happy to be creating my first video!';
const multiSentenceDraft = 'She dances at sunset. The sky turns pink!';

assert.equal(exactManualDraftText(`  ${firstExactDraft}  `), firstExactDraft);
assert.equal(exactManualDraftText(`\n${multiSentenceDraft}\n`), multiSentenceDraft);
assert.equal(
  buildDraftPublicCaption({
    caption: 'Hey.',
    prompt: firstExactDraft,
    status: 'draft',
    videoUrl: '',
  }),
  firstExactDraft,
);
assert.equal(
  buildDraftPublicCaption({
    caption: multiSentenceDraft,
    prompt: multiSentenceDraft,
    status: 'draft',
  }),
  multiSentenceDraft,
);
assert.equal(
  buildDraftPublicCaption({
    caption: 'Use a wide camera shot.',
    prompt: 'Use a wide camera shot. Keep the ending surprising!',
    status: 'draft',
  }),
  'Use a wide camera shot. Keep the ending surprising!',
);

let createdIds = 0;
let persistCalls = 0;
let releaseFirstSave: (() => void) | undefined;
const firstSaveGate = new Promise<void>((resolve) => {
  releaseFirstSave = resolve;
});
const saveSession = createManualDraftSaveSession(null, () => {
  createdIds += 1;
  return 'stable-draft-id';
});
const firstSave = saveSession.save(async (draftId) => {
  persistCalls += 1;
  assert.equal(draftId, 'stable-draft-id');
  await firstSaveGate;
  return firstExactDraft;
});
const rapidSecondSave = await saveSession.save(async () => {
  persistCalls += 1;
  return 'should-not-run';
});
assert.deepEqual(rapidSecondSave, {
  status: 'ignored',
  draftId: 'stable-draft-id',
});
assert.equal(createdIds, 1);
assert.equal(persistCalls, 1);
releaseFirstSave?.();
assert.deepEqual(await firstSave, {
  status: 'saved',
  draftId: 'stable-draft-id',
  createdDraft: true,
  value: firstExactDraft,
});
const updateSave = await saveSession.save(async (draftId) => {
  persistCalls += 1;
  return draftId;
});
assert.deepEqual(updateSave, {
  status: 'saved',
  draftId: 'stable-draft-id',
  createdDraft: false,
  value: 'stable-draft-id',
});
assert.equal(createdIds, 1);
assert.equal(persistCalls, 2);

const existingDraftSession = createManualDraftSaveSession('existing-draft-id', () => {
  throw new Error('An existing draft must not allocate a new ID.');
});
assert.deepEqual(await existingDraftSession.save(async (draftId) => draftId), {
  status: 'saved',
  draftId: 'existing-draft-id',
  createdDraft: false,
  value: 'existing-draft-id',
});

const studioListSource = readFileSync(join(process.cwd(), 'src/components/StudioList.tsx'), 'utf8');
const createPageSource = readFileSync(join(process.cwd(), 'src/pages/CreatePage.tsx'), 'utf8');
const createVideoSource = readFileSync(join(process.cwd(), 'src/components/CreateVideo.tsx'), 'utf8');
const appStoreSource = readFileSync(join(process.cwd(), 'src/store/useAppStore.ts'), 'utf8');
assert.match(studioListSource, /sceneTextForDraftEdit\(job\)/);
assert.match(studioListSource, /buildDraftPublicCaption\(job\)/);
assert.match(studioListSource, /Continue in Create/);
assert.match(studioListSource, /draft-card-media-empty/);
assert.match(createPageSource, /initialDraftId=\{remixProject\?\.projectId \?\? null\}/);
assert.match(createVideoSource, /id: stableDraftId/);
assert.match(createVideoSource, /caption: scenePrompt/);
assert.match(createVideoSource, /initialDraftId \?\? activeDraftId/);
assert.match(createVideoSource, /setActiveDraftId\(stableDraftId\)/);
assert.doesNotMatch(createVideoSource, /caption: buildPublicCaptionFromPrompt\(scenePrompt\)/);
assert.match(appStoreSource, /activeDraftId: string \| null/);
assert.match(appStoreSource, /setActiveDraftId: \(draftId: string \| null\)/);

console.info('Draft persistence and exact scene restoration tests passed.');
