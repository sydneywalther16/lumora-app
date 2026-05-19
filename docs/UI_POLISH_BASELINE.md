# Lumora UI Polish Baseline

This baseline defines what the main creator routes should feel like after Lumora UI polish system v1.

## Target Routes

- `/onboarding`
- `/create`
- `/create?mockRateLimit=1`
- `/create?mockPaused=1`
- `/create?mockBlocked=1`
- `/drafts`
- `/studio`
- `/profile`
- `/for-you`
- Characters hub and character detail
- Continue Story entry points from Drafts, Profile, and For You

## Expected Emotional Feel

- Onboarding: warm, cinematic, encouraging, never trapping the creator.
- Create: simple director flow with one strong generation action.
- Scene Flow: cinematic beats, not debug cards.
- Drafts: a private cinematic workbench.
- Profile: TikTok/Instagram clarity with cinematic universe texture.
- For You: social discovery of cinematic worlds.
- Characters: lightweight cast management.
- Paused/cooling states: calm, saved, resumable, emotionally safe.

## Acceptable Creator States

- `Lumora is shaping your cinematic moment.`
- `Preserving Story Memory and scene flow.`
- `Render queue is cooling down.`
- `Lumora paused this scene safely.`
- `Your cinematic scenes will appear here.`
- `Your published cinematic moments will appear here.`
- `Build your reusable cinematic cast.`
- `Lumora remembered your world.`

## Never Show In Normal Creator UI

- `Prediction failed`
- `Async prediction failed`
- `ModelError`
- `E005`
- raw provider stack traces
- raw provider prediction IDs
- `generation_jobs`
- `schema`
- `Scene Executor`
- `Memory Engine`
- `moderation pipeline`
- `orchestration retry`
- provider/model names as prominent badges on Drafts or Scene Flow cards

## Shared Classes

Use these classes before adding new one-off CSS:

- `.lumora-page`
- `.lumora-section`
- `.lumora-card`
- `.lumora-card-soft`
- `.lumora-card-hero`
- `.lumora-panel`
- `.lumora-chip`
- `.lumora-status-card`
- `.lumora-empty-state`
- `.lumora-primary-action`
- `.lumora-secondary-action`
- `.lumora-quiet-action`

## Design Tokens

The token source lives in `src/styles/global.css`.

Use:
- `--lumora-space-*` for route/card spacing.
- `--lumora-radius-*` for consistent radii.
- `--lumora-shadow-*` and `--lumora-glow-*` for premium depth.
- `--lumora-gradient-*` for primary and hero accents.
- `--lumora-type-*` for page, section, card, body, and metadata scale.
- `--lumora-motion-*` for transitions.

## Screenshot Baseline

Every screenshot should pass:
- One clear primary action.
- No crowded button rows.
- No one-word wrapping.
- No raw technical copy.
- Empty states have a next action.
- Cards use consistent radii and surface depth.
- Status chips are quiet and secondary.
- Mobile bottom nav does not hide controls.

## Route Notes

`/studio` should redirect to `/drafts`; no old Studio label should appear.

Advanced details may include technical terms only when collapsed by default and intentionally opened.
