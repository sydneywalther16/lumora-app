import assert from 'node:assert/strict';
import {
  buildUnavailablePosterBackfillResult,
  classifyVideoFetchProblem,
  POSTER_BUCKET_NAME,
} from '../src/services/generatedVideoPosterService';

assert.equal(POSTER_BUCKET_NAME, 'lumora-assets');

const unavailable = buildUnavailablePosterBackfillResult({
  scannedCount: 2,
  repairedProjects: 1,
  repairedPosts: 0,
  availability: {
    available: false,
    method: 'unavailable',
    ffmpegAvailable: false,
    storageAvailable: true,
    posterBucketName: 'lumora-assets',
    posterBucketExists: true,
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
assert.deepEqual(unavailable.skippedByReason, { ffmpeg_unavailable: 2 });

assert.equal(classifyVideoFetchProblem({
  url: 'https://replicate.delivery/pbxt/old.mp4',
  status: 200,
  contentType: 'text/html',
}), 'stale_external_video_url');

assert.equal(classifyVideoFetchProblem({
  url: 'https://lumora-app-topaz.vercel.app/protected/video.mp4',
  status: 401,
  contentType: 'text/html',
}), 'protected_or_non_video_url');

assert.equal(classifyVideoFetchProblem({
  url: 'https://example.com/not-video.jpg',
  status: 200,
  contentType: 'image/jpeg',
}), 'protected_or_non_video_url');

console.log('generatedVideoPosterService unit tests passed');
