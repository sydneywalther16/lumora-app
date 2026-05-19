# Lumora UI Polish Audit

This audit is the practical baseline for Lumora UI polish system v1. It focuses on screens and components that should feel like one premium cinematic creator product, while keeping diagnostics and developer details behind advanced/internal views.

## Shared System

Files adjusted:
- `src/styles/global.css`
- `src/components/CreatorIdentityCard.tsx`
- `src/components/StoryWorldProgress.tsx`

Recommended pattern:
- Use `.lumora-page` for route-level vertical rhythm.
- Use `.lumora-card`, `.lumora-card-soft`, and `.lumora-card-hero` for primary surfaces.
- Use `.lumora-status-card` for render, paused, cooling, reference repair, and saved states.
- Use `.lumora-empty-state` for empty states with a headline, one sentence, and one direct action.
- Use `.lumora-primary-action`, `.lumora-secondary-action`, and `.lumora-quiet-action` to preserve button hierarchy.

## `/onboarding`

Issues found:
- Visual hierarchy was strong, but copy still referenced storyboard as a manual workflow.
- The onboarding card had its own premium styling but was not connected to the shared card system.
- Mobile rhythm depended on route-specific spacing.

Fixes applied:
- Removed explicit storyboard wording and replaced it with cinematic story flow.
- Added shared `.lumora-card` styling to the onboarding card/page.
- Kept skip behavior visible and creator-friendly.

Remaining QA:
- Verify the route does not mention jobs, providers, schemas, or orchestration.
- Confirm progress dots and buttons stay readable on narrow mobile.

## `/create`

Issues found:
- Create had strong premium states, but route surfaces still mixed `headline-card`, `editor-card`, and one-off inline spacing.
- Characters helper copy was longer than needed.
- Some cast/reference labels used old identity/reference language.
- Advanced renderer details can still expose provider names, but they are behind a collapsed advanced section.

Fixes applied:
- Added `.lumora-page`, `.lumora-card-hero`, and `.lumora-card-soft` to top Create surfaces.
- Tightened character management copy to a single creator-facing sentence.
- Replaced old reference labels with scene/cast language.
- Added shared CSS overrides for the generate stack, cast summary, reference summary, Story Memory, render state cards, and action rows.

Recommended next refinements:
- Keep raw technical data out of normal Create cards; use only the existing advanced details toggle.
- Continue reducing inline styles in `src/components/CreateVideo.tsx` into reusable classes.
- Keep Generate, Try this take, Continue Story, and Publish as the only visually dominant actions.

## Scene Flow / Cinematic Structure

Issues found:
- Scene Flow cards were readable but still dense on mobile.
- Shot status chips competed with titles.
- Long descriptions could make cards feel like debug notes.

Fixes applied:
- Increased padding and line-height.
- Clamped shot descriptions to 3 lines by default.
- Softened status badge prominence.
- Preserved Expand scene behavior for longer beats.
- Reused shared card shadows and radii.

Recommended next refinements:
- Replace camera metadata pills with a single quiet metadata line if density returns.
- Keep provider/model names hidden from shot cards.

## `/drafts`

Issues found:
- Draft cards were visually improved but action rows could still crowd on mobile.
- Provider labels were still visible on some cards.
- Empty state was close to target but not on the shared empty-state system.

Fixes applied:
- Added `.lumora-card` and `.lumora-empty-state`.
- Hid provider/model detail from normal Draft cards.
- Added a `.draft-action-row` layout that stacks on mobile.
- Made Publish and active resumable actions visually stronger.

Recommended next refinements:
- Move remaining inline media sizing into `.draft-card-media`.
- Confirm paused/rate-limited drafts never show as scary failures.

## `/studio` Redirect

Issues found:
- Route already redirects to `/drafts`.
- QA should still verify no old Studio UI label appears.

Fixes applied:
- No routing change needed.
- Drafts page title remains creator-facing.

Recommended next refinements:
- Keep docs and support copy using Drafts, not Studio.

## `/profile`

Issues found:
- Profile was already close to social/creator direction but had several old self labels.
- Profile hero and grid used one-off card styling.
- Empty grid state was not on the shared empty-state class.

Fixes applied:
- Added `.lumora-page`, `.lumora-card-hero`, `.lumora-card-soft`, and `.lumora-empty-state`.
- Replaced `Created as self` with `Cinematic self`.
- Added shared action hierarchy classes to Edit profile and Characters.

Recommended next refinements:
- Gradually move inline hero/avatar/grid styles into profile-specific classes.
- Keep public profile focused on published moments only.

## `/for-you`

Issues found:
- Discovery grid had a strong direction but topbar/card classes were route-specific.
- Empty/no-results card was not on the shared empty-state system.
- Modal did not use shared modal animation classes.

Fixes applied:
- Added `.lumora-page`, `.lumora-card-hero`, and `.lumora-card` to For You surfaces.
- Added shared modal animation classes to the preview modal.
- Added `.lumora-empty-state` to no-results.
- Standardized grid gap through CSS.

Recommended next refinements:
- Keep section labels short: Trending story worlds, Recently published, Popular cast moments, Continue watching.
- Avoid social button clutter as more social actions are added.

## Characters Hub

Issues found:
- Hub layout was list-first and strong, but panel/card styling was still isolated.
- Copy still used identity/profile language in a few places.
- Empty state was not standardized.

Fixes applied:
- Added `.lumora-panel` to the Characters dialog.
- Replaced reusable identity copy with cast member/cinematic self language.
- Added shared card styling to loading and empty states.
- Renamed quick stat `adaptations` to `style notes`.

Recommended next refinements:
- Keep the list screen to thumbnail, name, and Self badge only.
- Keep reference status chips compact.
- Keep delete flow calm and non-self only.

## Character Detail

Issues found:
- Detail page had good accordion structure but separate visual styling.
- Reference cards needed stronger consistency with the shared card language.
- Some cinematic safety notes could feel technical if values are verbose.

Fixes applied:
- Standardized hero, accordion, reference rows, and modal panel radii/shadows through shared CSS.
- Renamed visible style memory labels away from fallback/rendering terminology.

Recommended next refinements:
- Keep technical provider paths out of normal detail summaries.
- Use Advanced details only if raw style preferences need to be inspected.

## Continue Story Flow

Issues found:
- Continue Story is present in Drafts, Profile, and For You, but visual priority varies by surface.
- Transition into Create is functional, but not yet a dedicated animated journey.

Fixes applied:
- Button hierarchy now treats Continue Story as a primary creator loop where possible.
- Story Memory moments already reinforce continuity after opening posts/drafts.

Recommended next refinements:
- Add a dedicated transition note on Create: `Lumora remembered your world.`
- Confirm Create preloads cast, style, and prompt context for every entry point.

## Paused / Blocked / Rate-Limited States

Issues found:
- Previous pass fixed duplicate paused cards, but state cards still needed shared spacing and mobile rules.
- Rate-limit and paused actions could squeeze on narrow screens.

Fixes applied:
- Added shared card spacing, mobile stacking, and calm status layout.
- Preserved creator-facing copy and kept raw provider errors hidden.
- Added mobile button stacking for state/action rows.

Recommended next refinements:
- Keep `/create?mockRateLimit=1`, `/create?mockPaused=1`, and `/create?mockBlocked=1` as visual QA routes.
- Confirm no provider raw errors appear outside diagnostics.

## Empty States

Issues found:
- Empty states were implemented screen by screen with inconsistent padding and action weight.
- Some older empty states still looked like regular list cards.

Fixes applied:
- Introduced `.lumora-empty-state`.
- Applied to Drafts, Profile grid, For You no-results, Characters empty, and Home empty cards.

Recommended next refinements:
- Every new empty state should include one headline, one short explanation, and one direct action.
- Avoid placeholder-only or status-only empty states.

## Button Hierarchy

Issues found:
- Multiple rows had equal-weight buttons.
- Draft actions were the most crowded.

Fixes applied:
- Added shared action classes and global hover/focus rules.
- Added mobile-first `.draft-action-row`.
- Promoted Publish and resumable render actions where they matter.

Recommended next refinements:
- Do not place more than one strong action in a narrow row unless the actions are mutually critical.
- Prefer quiet actions for Details, Save draft, Cancel, and Close.

## Typography

Issues found:
- Headings, metadata, and badges were sometimes too close in weight.
- Long card copy risked crowding mobile.

Fixes applied:
- Added typography tokens and card-level line-height/clamp rules.
- Reduced Scene Flow description density.
- Preserved compact badge text scale.

Recommended next refinements:
- Avoid paragraphs longer than one sentence inside cards.
- Keep metadata softer than card titles and creator actions.

## Mobile QA Priorities

Check:
- No horizontal overflow.
- No one-word-per-line copy.
- No squeezed action rows.
- Scene Flow descriptions clamp correctly.
- Draft action buttons stack cleanly.
- Character hub opens as a bottom sheet.
- Bottom nav does not cover primary actions.

## Technical Text Boundary

Allowed in diagnostics or collapsed advanced details:
- provider
- prediction
- schema
- fallback
- raw status enum
- render job ids
- provider model names

Not allowed in normal creator UI:
- raw provider error text
- ModelError or E005
- prediction failed
- generation_jobs
- Memory Engine
- Scene Executor
- moderation pipeline
- orchestration retry
