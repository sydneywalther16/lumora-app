import assert from 'node:assert/strict';
import {
  extractProviderVideoUrl,
  parseProviderVideoOutput,
} from '../src/services/providerOutputParser';

assert.equal(
  extractProviderVideoUrl('https://replicate.delivery/pbxt/render.mp4'),
  'https://replicate.delivery/pbxt/render.mp4',
);

assert.equal(
  extractProviderVideoUrl([
    'https://replicate.delivery/pbxt/frame.jpg',
    'https://replicate.delivery/pbxt/render.webm',
  ]),
  'https://replicate.delivery/pbxt/render.webm',
);

assert.equal(
  extractProviderVideoUrl({
    output: {
      files: [
        { url: 'https://cdn.example.com/generated/final.mov?token=abc' },
      ],
    },
  }),
  'https://cdn.example.com/generated/final.mov?token=abc',
);

assert.equal(
  extractProviderVideoUrl({
    nested: {
      result: {
        video_url: 'https://cdn.example.com/generated/final.mp4',
      },
    },
  }),
  'https://cdn.example.com/generated/final.mp4',
);

const falTopLevelVideo = parseProviderVideoOutput({
  video: {
    content_type: 'video/mp4',
    file_name: 'output.mp4',
    file_size: 13048086,
    url: 'https://fal.media/files/generated-output',
  },
});
assert.equal(falTopLevelVideo.ok, true);
assert.equal(falTopLevelVideo.videoUrl, 'https://fal.media/files/generated-output');
assert.equal(falTopLevelVideo.sourcePath, '$.video.url');

const contentTypedTopLevelUrl = parseProviderVideoOutput({
  content_type: 'video/mp4',
  file_name: 'output.mp4',
  url: 'https://fal.media/files/generated-output',
});
assert.equal(contentTypedTopLevelUrl.ok, true);
assert.equal(contentTypedTopLevelUrl.videoUrl, 'https://fal.media/files/generated-output');

assert.deepEqual(parseProviderVideoOutput(null), {
  ok: false,
  category: 'output_missing',
  videoUrl: null,
  sourcePath: '$',
  reason: 'Provider output was empty.',
});

assert.equal(parseProviderVideoOutput({ url: 'https://cdn.example.com/generated/final.jpg' }).ok, false);
assert.equal(parseProviderVideoOutput({ url: 'https://cdn.example.com/generated/final.jpg' }).category, 'image_output');
assert.equal(parseProviderVideoOutput('/demo-video.mp4').ok, false);
assert.equal(parseProviderVideoOutput('/demo-video.mp4').category, 'non_video_output');

const logOnly = parseProviderVideoOutput({
  logs: 'https://cdn.example.com/generated/final.mp4',
  error: 'model failed',
});
assert.equal(logOnly.ok, false);
assert.equal(logOnly.category, 'unsupported_output_shape');

const unsupported = parseProviderVideoOutput({ output: { width: 1024, height: 576 } });
assert.equal(unsupported.ok, false);
assert.equal(unsupported.category, 'unsupported_output_shape');

console.log('providerOutputParser unit tests passed');
