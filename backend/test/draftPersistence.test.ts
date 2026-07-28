import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sceneTextForDraftEdit } from '../../src/lib/createExperience';

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

const studioListSource = readFileSync(join(process.cwd(), 'src/components/StudioList.tsx'), 'utf8');
assert.match(studioListSource, /sceneTextForDraftEdit\(job\)/);
assert.match(studioListSource, /Continue in Create/);
assert.match(studioListSource, /draft-card-media-empty/);

console.info('Draft persistence and exact scene restoration tests passed.');
