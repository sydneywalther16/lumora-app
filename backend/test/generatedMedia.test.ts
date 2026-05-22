import assert from 'node:assert/strict';
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

console.log('generatedMedia unit tests passed');
