# Grok Imagine AI Cast route research

Audited: 2026-08-01. This is a no-generation architecture note. It adds no xAI client, key, endpoint, deployment, paid authorization, or automatic fallback.

## Officially documented capabilities

### `grok-imagine-image-quality`

- Text-to-image and JSON image editing are documented. Image edits accept a public HTTPS URL, base64 data URI, or private Files API `file_id`.
- Multi-image editing accepts at most three source images. Sources can mix URL, base64, and `file_id` forms.
- Supported documented aspect ratios are `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `2:1`, `1:2`, `19.5:9`, `9:19.5`, `20:9`, `9:20`, and `auto`.
- Output is 1K or 2K. Current official list pricing is $0.01 per input image plus $0.05 per 1K output or $0.07 per 2K output.
- The published Imagine limit is 5 requests per second for all spend tiers. The console remains the authority for account-specific capacity.

### `grok-imagine-video`

- The documented modes are text-to-video, image-to-video, reference-to-video, video edit, and video extension.
- Reference-to-video accepts up to seven images and up to ten seconds of output. It cannot be combined with image-to-video or editing in one request.
- Generation supports 480p and 720p and up to fifteen seconds. Reference images may be URL, base64, or private `file_id` inputs.
- Video editing accepts one MP4 source no longer than 8.7 seconds. It inherits duration and aspect ratio and caps output at 720p.
- Video extension accepts a 2-15 second MP4 source and adds 2-10 seconds. It inherits aspect ratio and resolution and caps output at 720p.
- Current official list pricing is $0.002 per image input, $0.01 per input-video second, $0.05 per 480p output second, and $0.07 per 720p output second.
- The REST flow is asynchronous: create returns `request_id`; polling returns `pending`, `done`, `failed`, or `expired`. Generated URLs are ephemeral unless the output is persisted.
- The published Imagine limit is 10 requests per second for all spend tiers. The docs do not publish RPD limits. The console remains the authority for account-specific capacity.
- The current docs do not expose a supported audio-generation switch or a documented “no audio” request field. Lumora therefore does not invent one in the scaffold; audio behavior must be verified in a separately authorized canary before enabling this route.

### `grok-imagine-video-1.5`

- This model is documented for image-to-video only; it does not support text-to-video or multi-reference/reference-to-video.
- It accepts one image source and supports 480p, 720p, and 1080p.
- Current official list pricing is $0.01 per input image plus $0.08/$0.14/$0.25 per output second at 480p/720p/1080p.
- It is appropriate to evaluate as a premium one-source hero-shot route, not as the first multi-reference likeness route.

### Files API and persistence

- Files are private by default and can be reused by `file_id` without public URLs or repeated uploads.
- Inputs must be fully uploaded and have the correct media type: PNG/JPEG/WebP for images and MP4 for videos.
- Files are permanent by default or can use `expires_after` from one hour to thirty days. Stored Imagine outputs return a stable `file_output.file_id` when `storage_options` is used.
- Public URLs are optional, separately revocable, and capped. This scaffold never requests them.
- Delete invalidates the private file ID and any public URL. Lumora must also delete its own controlled copy and database binding when the user deletes the source AI Cast or generated asset.
- Files storage and downloads have separate usage pricing, so provider storage must be short-lived and measured. The scaffold proposes seven-day private TTLs and immediate copy to Lumora-controlled storage.

There is no documented `createCharacter`, reusable provider character object, likeness fine-tune, or character-training primitive in the audited Imagine or Files APIs. Lumora must treat references and canonical plates as ordinary private media inputs, not promise undocumented identity persistence.

## Three explicit routes

### A. Direct multi-reference video — Test

One `grok-imagine-video` reference-to-video request uses 1-7 same-identity private images. It skips the Google scene anchor and is the lowest-stage-count likeness experiment. At four seconds/480p, three references project to $0.206 at the audited rates.

### B. Canonical character plate — Standard

One `grok-imagine-image-quality` edit combines 1-3 same-identity inputs into a private 1K plate; one `grok-imagine-video` request then uses that plate. This costs an extra paid stage but gives Lumora a single canonical composition to inspect and persist. At four seconds/720p with three sources, it projects to $0.362.

### C. Premium hero shot — Premium

One `grok-imagine-video-1.5` image-to-video request animates exactly one approved canonical source. It is not a multi-reference route. At four seconds/1080p, it projects to $1.01.

Routing is always explicit. One initial provider is selected before any paid operation. Rate limits, moderation, parsing failures, or provider errors stop the attempt; they never trigger an automatic paid fallback, retry, repair, or alternate provider.

## Safety and privacy contract

- Only user-owned or explicitly licensed references for a confirmed adult are accepted.
- Child or child-like identity use, non-consensual sexualized use, celebrity/public-figure imitation, scraped identity media, watermarked third-party inputs, and mixed human identities are rejected before a provider payload is prepared.
- Every private provider file is bound server-side to the authenticated Lumora user. Provider file IDs never enter client responses, public captions, UI copy, analytics, or logs.
- Outputs remain private, are copied promptly to Lumora-controlled storage, and retain the exact public caption plus `Synthetic portrayal` disclosure. Existing report/block controls continue to apply to any later published content.
- Deleting the AI Cast, a generated asset, or the account queues provider URL revocation, provider file deletion, Lumora storage deletion, and database-binding removal. A provider cleanup failure is retryable as cleanup only; it must never regenerate media.
- Diagnostics report only route, counts, state, timing, moderation category, and costs. Prompts, references, file IDs, signed URLs, bytes, credentials, and provider payloads are redacted.

## Comparison harness and future canaries

The dry comparison harness records projected cost, input count, paid stages, expected response flow, persistence plan, and identity-guidance style for the current Google route and Grok routes A/B/C. It performs no provider call.

Any live comparison requires separate future authorization per route and a new idempotency key. Suggested order:

1. Route A with one clean Front reference, four seconds, portrait, 480p, one request, no retry/fallback/repair.
2. Route B only if Route A identity or composition is insufficient; one plate plus one four-second 720p video.
3. Route C only after a canonical plate is approved; one four-second 1080p hero video.

Compare likeness, motion, lighting, continuity, moderation outcome, persistence, latency, posted cost, and parsing reliability. Never cascade from one route into another automatically.

## Official sources

- https://docs.x.ai/developers/model-capabilities/imagine
- https://docs.x.ai/developers/model-capabilities/images/generation
- https://docs.x.ai/developers/model-capabilities/images/editing
- https://docs.x.ai/developers/model-capabilities/images/multi-image-editing
- https://docs.x.ai/developers/model-capabilities/video/generation
- https://docs.x.ai/developers/model-capabilities/video/reference-to-video
- https://docs.x.ai/developers/model-capabilities/video/image-to-video
- https://docs.x.ai/developers/model-capabilities/video/editing
- https://docs.x.ai/developers/model-capabilities/video/extension
- https://docs.x.ai/developers/models/grok-imagine-image-quality
- https://docs.x.ai/developers/models/grok-imagine-video
- https://docs.x.ai/developers/models/grok-imagine-video-1.5
- https://docs.x.ai/developers/model-capabilities/imagine/files
- https://docs.x.ai/developers/model-capabilities/imagine/files/inputs
- https://docs.x.ai/developers/model-capabilities/imagine/files/outputs
- https://docs.x.ai/developers/files/managing-files
- https://docs.x.ai/developers/files/public-urls
- https://docs.x.ai/developers/pricing
- https://docs.x.ai/developers/rate-limits
- https://docs.x.ai/developers/cost-tracking
