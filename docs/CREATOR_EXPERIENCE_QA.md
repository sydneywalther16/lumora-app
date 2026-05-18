# Lumora Creator Experience QA

Use this checklist for the emotional creator loop: first-use, Story Memory, Drafts, publishing, discovery, and cast management.

## First-Time Journey

- Open `/onboarding`.
- Confirm the flow uses creator-facing copy only: cinematic identity, cast, Story Memory, Scene Flow.
- Confirm every step has visible progress and a clear `Skip for now`.
- Confirm the Creator Identity Card appears during the reveal step.
- Confirm the Story World progress card appears before the user starts creating.

## Self Character And Cast

- Open `/profile`, then `Characters`.
- Confirm the Characters hub is list-first and self character is pinned first.
- Open self detail and confirm the Creator Identity Card appears.
- Create a non-self cast member if test data is available.
- Open a non-self cast member detail and confirm appearance, style, Story Memory, references, and delete menu work.
- Delete a non-self cast member only in a disposable test account; confirm old posts still load.

## Create First Scene

- Open `/create`.
- Confirm Create feels like directing a scene, not managing jobs.
- Confirm Story World progress and Creator Identity Card show near the top.
- Select a cast member or use self.
- Enter a simple prompt and build a storyboard.
- Confirm progress copy: saving scene references, shaping emotional pacing, preserving Story Memory.
- Confirm Story Memory shows a creator-facing micro-moment.

## Drafts Workbench

- Open `/drafts`.
- Empty state should say: `Your cinematic scenes will appear here.`
- Confirm CTA goes to Create.
- With a draft present, confirm thumbnail/poster renders.
- Open draft detail.
- Confirm `Continue Story`, `Edit scene`, `Publish`, and `Share` actions appear.
- Publish a disposable test draft.
- Confirm it disappears from Drafts and appears on Profile.

## Profile Reveal

- Open `/profile`.
- Confirm profile hero shows avatar, name, handle, bio, Likes, Followers, Characters.
- Confirm Story World and Creator Identity accents render.
- Confirm empty grid copy: `Your published cinematic moments will appear here.`
- With published posts, confirm newest-first vertical thumbnails.
- Open a profile post and confirm `Continue Story`, React, Save, and Follow actions.

## For You Discovery

- Open `/for-you`.
- Confirm sticky search bar appears.
- Confirm sections or labels: Trending story worlds, Because you follow, Recently published, Popular cast moments, Continue watching.
- Open a post and confirm `Why this?` microcopy.
- Click React, Save, Follow and confirm tap feedback.
- Click `Continue Story` and confirm Create opens with context preloaded.

## Live Create State QA

- Confirm `/create` does not show `Storyboard before rendering`, `Build storyboard`, or `Storyboard and Scene Flow` before Generate.
- Confirm the primary CTA reads `Generate Cinematic Scene` when ready.
- Confirm clicking Generate starts creator-facing progress such as `Understanding your scene...` and `Shaping cinematic beats...`.
- Confirm `View cinematic structure` appears only after Lumora starts shaping or has shaped the scene.
- Open `/create?mockRateLimit=1` in local development only.
- Enter a simple safe prompt and click Generate.
- Confirm the cooling-down card is readable at phone width.
- Confirm copy says `Render queue is cooling down.` and `Resume available in ... seconds` or `The render queue is almost ready.`
- Confirm the message does not wrap one word per line.
- Confirm `Resume render` is disabled during countdown and enabled when the cooldown ends.
- Confirm `Save draft` stays visible without crowding the message.
- Confirm repeated Generate clicks do not start duplicate renders while an active render is queued, rendering, or cooling down.
- Confirm rendering, queued, paused, moderation, reference repair, and still-checking states use creator-facing copy.
- Confirm Drafts cooling cards show `Cooling down`, `Resume render`, and `Saved safely`.
- Confirm raw provider errors, model error codes, stack traces, and payload text are not visible in normal Create/Drafts UI.
- Confirm mobile bottom nav does not cover required Create actions.
- Confirm provider/prediction messages are replaced with calm creator copy such as `This renderer paused the scene safely.`
- Confirm Scene Flow shot cards show one compact status, clamp long descriptions, and do not repeat cooldown copy inside every shot.
- Confirm `Expand scene` opens long shot descriptions smoothly and keeps the mobile layout readable.

## Safety And Failure States

- Trigger or simulate a moderation adaptation if possible.
- Confirm copy says Lumora is adapting the scene or trying a safer cinematic direction.
- Confirm no raw provider stack trace appears to normal users.
- Test an unavailable external reference image if possible.
- Confirm copy says the image link could not be safely used or references are being saved.

## Mobile Checks

- Check `/onboarding`, `/create`, `/drafts`, `/profile`, `/for-you`, and Characters on a phone-sized viewport.
- Confirm touch targets are comfortable.
- Confirm modals and sheets do not overflow.
- Confirm animations feel subtle and respect reduced motion.

## Diagnostics

- Open `/diagnostics`.
- Confirm internal diagnostics are still accessible.
- Confirm creator-facing routes do not expose raw JSON, Memory Engine, generation jobs, or orchestration language.
