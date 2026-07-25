import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBestPoster,
  getBestThumbnail,
  resolveGeneratedVideoMedia,
} from '../../src/lib/mediaThumbnail';

const videoUrl = 'https://replicate.delivery/pbxt/generated-garden.mp4';
const referenceUrl = 'https://demo.supabase.co/storage/v1/object/public/character/front.jpg';
const posterUrl = 'https://demo.supabase.co/storage/v1/object/public/generated/poster.jpg';

const videoWithReferenceThumbnail = resolveGeneratedVideoMedia({
  videoUrl,
  thumbnailUrl: referenceUrl,
  posterUrl: referenceUrl,
  referenceImageUrl: referenceUrl,
  characterAvatar: referenceUrl,
});

assert.equal(videoWithReferenceThumbnail.hasVerifiedVideo, true);
assert.equal(videoWithReferenceThumbnail.videoUrl, videoUrl);
assert.equal(videoWithReferenceThumbnail.thumbnailUrl, null);
assert.equal(videoWithReferenceThumbnail.posterUrl, null);
assert.equal(videoWithReferenceThumbnail.mainPreviewType, 'video');
assert.equal(videoWithReferenceThumbnail.thumbnailSource, 'video_output');
assert.equal(videoWithReferenceThumbnail.castBadgeUrl, referenceUrl);
assert.equal(getBestThumbnail({
  videoUrl,
  thumbnailUrl: referenceUrl,
  referenceImageUrl: referenceUrl,
}), null);
assert.equal(getBestPoster({
  videoUrl,
  posterUrl: referenceUrl,
  referenceImageUrl: referenceUrl,
}), null);

const videoWithGeneratedPoster = resolveGeneratedVideoMedia({
  videoUrl,
  posterUrl,
  referenceImageUrls: {
    frontFace: referenceUrl,
    sideAngleLeft: 'https://demo.supabase.co/storage/v1/object/public/character/side.jpg',
  },
});

assert.equal(videoWithGeneratedPoster.mainPreviewType, 'poster');
assert.equal(videoWithGeneratedPoster.thumbnailSource, 'generated_poster');
assert.equal(videoWithGeneratedPoster.posterUrl, posterUrl);
assert.equal(getBestThumbnail({ videoUrl, posterUrl, referenceImageUrl: referenceUrl }), posterUrl);

const videoWithGeneratedThumbnailOnly = resolveGeneratedVideoMedia({
  videoUrl,
  posterUrl: referenceUrl,
  thumbnailUrl: posterUrl,
  thumbnailSource: 'generated_poster',
  referenceImageUrl: referenceUrl,
});

assert.equal(videoWithGeneratedThumbnailOnly.mainPreviewType, 'poster');
assert.equal(videoWithGeneratedThumbnailOnly.thumbnailSource, 'generated_poster');
assert.equal(videoWithGeneratedThumbnailOnly.posterUrl, posterUrl);
assert.equal(videoWithGeneratedThumbnailOnly.thumbnailUrl, posterUrl);

const videoWithUnsetReferenceThumbnail = resolveGeneratedVideoMedia({
  videoUrl,
  thumbnailUrl: referenceUrl,
  thumbnailSource: 'unset',
  characterAvatar: referenceUrl,
});

assert.equal(videoWithUnsetReferenceThumbnail.mainPreviewType, 'video');
assert.equal(videoWithUnsetReferenceThumbnail.thumbnailUrl, null);
assert.equal(videoWithUnsetReferenceThumbnail.castBadgeUrl, referenceUrl);

const imageOnlyPost = resolveGeneratedVideoMedia({
  imageUrl: posterUrl,
  characterAvatar: referenceUrl,
});

assert.equal(imageOnlyPost.hasVerifiedVideo, false);
assert.equal(imageOnlyPost.mainPreviewType, 'poster');
assert.equal(imageOnlyPost.thumbnailUrl, posterUrl);

const noOutputReferenceOnly = resolveGeneratedVideoMedia({
  characterAvatar: referenceUrl,
});

assert.equal(noOutputReferenceOnly.hasVerifiedVideo, false);
assert.equal(noOutputReferenceOnly.mainPreviewType, 'placeholder');
assert.equal(noOutputReferenceOnly.thumbnailSource, 'character_badge_only');
assert.equal(noOutputReferenceOnly.thumbnailUrl, null);
assert.equal(noOutputReferenceOnly.castBadgeUrl, referenceUrl);

const explicitlyAssociatedCastAvatar = 'https://demo.supabase.co/storage/v1/object/public/character/associated-cast.jpg';
const historicalMismatchedReference = resolveGeneratedVideoMedia({
  videoUrl,
  characterAvatar: explicitlyAssociatedCastAvatar,
  referenceImageUrl: referenceUrl,
});
assert.equal(historicalMismatchedReference.castBadgeUrl, explicitlyAssociatedCastAvatar);

const previewSource = readFileSync(join(process.cwd(), 'src/components/GeneratedVideoPreview.tsx'), 'utf8');
const characterHubSource = readFileSync(join(process.cwd(), 'src/components/CharacterHub.tsx'), 'utf8');
assert.match(previewSource, /lumora-media-fallback-mark/);
assert.match(previewSource, /setCastBadgeFailed\(true\)/);
assert.match(characterHubSource, /setFailedThumbnail\(thumbnail\)/);

console.log('generatedMedia unit tests passed');
