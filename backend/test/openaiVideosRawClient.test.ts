import assert from 'node:assert/strict';
import {
  OpenAIVideosRawClient,
  OpenAIVideosRawError,
} from '../src/services/providers/openaiVideosRawClient';

type FetchCall = {
  url: string;
  init: RequestInit;
};

const calls: FetchCall[] = [];
const fetchOk: typeof fetch = async (url, init) => {
  calls.push({ url: String(url), init: init ?? {} });
  if (String(url).endsWith('/videos/video_123/content?variant=video')) {
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });
  }
  return new Response(JSON.stringify({ id: 'char_123', object: 'video.character', status: 'ready' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const client = new OpenAIVideosRawClient({
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.test/v1',
  fetchImpl: fetchOk,
});

const character = await client.createCharacter({
  name: 'Lumora self',
  videoBuffer: Buffer.from([1, 2, 3]),
  filename: 'self.mp4',
  contentType: 'video/mp4',
});

assert.equal(character.id, 'char_123');
assert.equal(calls[0].url, 'https://api.openai.test/v1/videos/characters');
assert.equal(calls[0].init.method, 'POST');
assert.ok(calls[0].init.body instanceof FormData);
assert.equal((calls[0].init.body as FormData).get('name'), 'Lumora self');

await assert.rejects(
  () => client.createVideo({
    prompt: 'A verified self character walks in a garden.',
    model: 'sora-2',
    seconds: 4,
    size: '720x1280',
    characterId: 'char_123',
  }),
  (error) => error instanceof OpenAIVideosRawError &&
    error.category === 'unsupported_until_character_usage_mapped',
);

const content = await client.downloadVideoContent('video_123');
assert.equal(content.contentType, 'video/mp4');
assert.equal(content.buffer.length, 3);

const accessDeniedClient = new OpenAIVideosRawClient({
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.test/v1',
  fetchImpl: async () => new Response(JSON.stringify({
    error: { code: 'forbidden', message: 'Project does not have access.' },
  }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  }),
});

await assert.rejects(
  () => accessDeniedClient.createCharacter({
    name: 'Lumora self',
    videoBuffer: Buffer.from([1]),
    filename: 'self.mp4',
    contentType: 'video/mp4',
  }),
  (error) => error instanceof OpenAIVideosRawError &&
    error.category === 'openai_access_denied',
);

const missingEndpointClient = new OpenAIVideosRawClient({
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.test/v1',
  fetchImpl: async () => new Response(JSON.stringify({
    error: { code: 'not_found', message: 'Endpoint not found.' },
  }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  }),
});

await assert.rejects(
  () => missingEndpointClient.createCharacter({
    name: 'Lumora self',
    videoBuffer: Buffer.from([1]),
    filename: 'self.mp4',
    contentType: 'video/mp4',
  }),
  (error) => error instanceof OpenAIVideosRawError &&
    error.category === 'openai_character_unavailable',
);

const deprecatedClient = new OpenAIVideosRawClient({
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.test/v1',
  fetchImpl: async () => new Response(JSON.stringify({
    error: { code: 'deprecated', message: 'Videos API is deprecated.' },
  }), {
    status: 410,
    headers: { 'content-type': 'application/json' },
  }),
});

await assert.rejects(
  () => deprecatedClient.createVideo({
    prompt: 'A garden walk.',
    model: 'sora-2',
    seconds: 4,
    size: '720x1280',
  }),
  (error) => error instanceof OpenAIVideosRawError &&
    error.category === 'openai_deprecated',
);

console.log('openaiVideosRawClient unit tests passed');
