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
- Confirm `Continue story`, `Remix This`, `Post`, and `Share` actions appear.
- Publish a disposable test draft.
- Confirm it disappears from Drafts and appears on Profile.

## Profile Reveal

- Open `/profile`.
- Confirm profile hero shows avatar, name, handle, bio, Likes, Followers, Characters.
- Confirm Story World and Creator Identity accents render.
- Confirm empty grid copy: `Your published cinematic moments will appear here.`
- With published posts, confirm newest-first vertical thumbnails.
- Open a profile post and confirm `Continue story`, React, Save, and Follow actions.

## For You Discovery

- Open `/for-you`.
- Confirm sticky search bar appears.
- Confirm sections or labels: Trending cinematic stories, Because you follow, Recently published, Popular cast moments, Continue watching.
- Open a post and confirm `Why this?` microcopy.
- Click React, Save, Follow and confirm tap feedback.
- Click `Continue story` and confirm Create opens with context preloaded.

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
