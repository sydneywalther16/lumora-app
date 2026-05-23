import assert from 'node:assert/strict';
import { buildUnavailablePosterBackfillResult } from '../src/services/generatedVideoPosterService';

const unavailable = buildUnavailablePosterBackfillResult({
  scannedCount: 2,
  repairedProjects: 1,
  repairedPosts: 0,
  availability: {
    available: false,
    method: 'unavailable',
    ffmpegAvailable: false,
    storageAvailable: true,
    reason: 'ffmpeg_unavailable',
  },
});

assert.equal(unavailable.ok, true);
assert.equal(unavailable.posterGenerationAvailable, false);
assert.equal(unavailable.scannedCount, 2);
assert.equal(unavailable.generatedCount, 0);
assert.equal(unavailable.skippedCount, 2);
assert.equal(unavailable.failedCount, 0);
assert.equal(unavailable.repairedProjects, 1);
assert.equal(unavailable.availability.reason, 'ffmpeg_unavailable');

console.log('generatedVideoPosterService unit tests passed');
