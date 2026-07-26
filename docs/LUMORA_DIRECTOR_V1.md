# Lumora Director v1 implementation report

Status: local implementation and dry-run validation only. The Director media routes are not deployed or enabled for paid generation.

## Architecture

1. The existing Creative Brain produces the reasoning plan. Director maps it into strict JSON with scene, cast, wardrobe, environment, lighting, action, camera, continuity, public caption, synthetic disclosure, and at most three shots.
2. The scene-anchor adapter uses the official `@google/genai` SDK and `gemini-3.1-flash-image`. It accepts exactly one confirmed user-owned Front face image and asks for a cinematic synthetic portrayal.
3. The primary-video adapter uses `gemini-omni-flash-preview` with the generated anchor and one planned shot. It prepares one 3–5 second, 720p, silent candidate request using image-to-video task configuration.
4. The evaluator returns structured identity, adherence, motion, anatomy, wardrobe, artifact, playability, overall, and safe-failure results.
5. One localized conversational repair can be prepared only when the output is playable and acceptable, one issue is repairable, and a separate recorded repair budget decision exists.
6. The FFmpeg assembly plan supports controlled-path trimming, up to three joined shots, fades, audio normalization, captions, MP4 output, and poster extraction on the server.
7. Specialist routes are explicit and non-automatic: Veo for hero/extension/frame-control work, Seedance for text-only or non-personal synthetic work, and a reserved Firefly still-image route.

## Safety and cost controls

- Default budget: one anchor, one primary video, no fallback video, and no repair.
- Execution adapters reject paid work without a matching recorded user or plan-allowance decision.
- Provider requests, retries, fallbacks, and repairs are independently counted.
- Personal AI Cast image requests to Seedance are rejected before provider execution. Scene text remains preserved.
- The public caption and synthetic disclosure are separate from provider prompts and continuity instructions.
- The user-facing progress states contain no provider names, payloads, or raw API errors.
- No environment variable, credential, or secret file is changed by this implementation.

## Compatibility

The legacy Veo adapter and deprecated `@google/generative-ai` dependency remain in place for compatibility. All new Google generative-media work uses `@google/genai`. Migration or removal of the legacy provider should happen only after an explicitly authorized canary and compatibility review.

The legacy Veo audit found a text-only prompt, an older dynamically discovered video-model shape, ten fixed two-second operation polls, URL extraction through the shared parser, persistence only after the provider returns, and no provider-local cost event. Director v1 instead uses typed Interactions API payloads, bounded media-file polling, an injected controlled-storage persistence contract, and independent request/retry/fallback/repair plus cost-outcome events. `GOOGLE_API_KEY` remains server-only and optional; it is never copied into payload previews or client code.

Official implementation references:

- [Google image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini Omni Flash](https://ai.google.dev/gemini-api/docs/omni)
- [Google Gen AI JavaScript SDK](https://googleapis.github.io/js-genai/)

## Deployment gate

Before enabling a real Omni Flash canary, an operator must record one explicit cost authorization for the anchor and primary video requests, configure the already-supported server-side Google credential outside source control, and enable the Director route for that single canary. Deployment is intentionally outside this change.
