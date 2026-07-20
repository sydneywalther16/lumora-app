# Lumora store release metadata

This file is the working source for the first iOS and Android listings. Do not add the public support address to a store listing until an inbound delivery test succeeds and the inbox is actively monitored.

## Shared identity

- App name: Lumora
- Bundle ID / Android application ID: `com.lumoracreator.app`
- Primary category: Photo & Video
- Secondary iOS category: Social Networking
- Suggested age floor: 13+; complete each store's current rating questionnaire rather than copying this suggestion as a final rating

## Public URLs

Use the Vercel production URLs below until `lumoracreator.com` is attached to that same production project and passes HTTPS checks.

- Privacy policy: `https://lumora-app-topaz.vercel.app/privacy`
- Terms: `https://lumora-app-topaz.vercel.app/terms`
- Community guidelines: `https://lumora-app-topaz.vercel.app/community-guidelines`
- Support: `https://lumora-app-topaz.vercel.app/support`
- Account deletion / privacy choices: `https://lumora-app-topaz.vercel.app/account/delete`

## Apple App Store copy

- Subtitle: AI Cast Video Studio
- Promotional text: Create reusable AI cast characters, generate cinematic video scenes, and publish story worlds with built-in safety controls.
- Keywords: `ai video,character,creator,story,cinematic,avatar,scene,generative,cast,studio`

### Description

Lumora is an AI Cast Studio for creating reusable characters and turning ideas into cinematic video scenes.

Build your cast, shape a scene, generate a video, and keep the best moments organized in one creator workspace. Story Memory helps recurring characters and worlds stay connected as you continue creating.

With Lumora you can:

- Create and manage reusable AI Cast characters
- Add private reference media for consistent creative direction
- Generate cinematic scenes from your prompts
- Save drafts and continue story ideas over time
- Review every result before publishing
- Publish AI-generated cast videos to public discovery feeds
- Report public content and block creators
- Permanently delete your account and associated content from inside the app

Your drafts and private reference media are not public. Only content you choose to publish appears in public discovery.

AI results can be unexpected. Review each result before using or publishing it, and only use media and likenesses you have permission to use.

## Google Play copy

- Short description: Create reusable AI cast characters and cinematic generated video scenes.

### Full description

Lumora is an AI Cast Studio for reusable characters, cinematic generated scenes, and connected story worlds.

Create your cast, describe a scene, generate a video, and organize your strongest moments in a focused creator workspace. Keep drafts private while you build, then review and publish the generated videos you choose.

FEATURES

- Reusable AI Cast characters
- Private reference media and creator controls
- Prompt-driven cinematic scene generation
- Drafts and Story Memory for continuing ideas
- Public discovery for published AI-generated cast videos
- Reporting and creator blocking on public content
- In-app account and associated-data deletion

Lumora does not publish raw private reference media. You control whether a completed generated video remains private or is published.

AI results can be inaccurate or unexpected. Review all results, follow the Community Guidelines, and only use source media and likenesses you are authorized to use.

## Privacy disclosure working map

Final App Privacy and Google Play Data safety answers must be checked against the production build and each contracted provider before submission.

| Data | Why Lumora uses it | Linked to account | Notes for final form |
| --- | --- | --- | --- |
| Email address and user ID | Authentication, account management, security | Yes | Collected |
| Display name, username, avatar, bio | Creator profile and publishing | Yes | Collected; public only when the user publishes/profile is shown |
| Prompts, projects, drafts, characters | App functionality and AI generation | Yes | Collected |
| Reference photos and videos | User-requested character and scene creation | Yes | Collected; private storage; processed by service providers as needed |
| Voice samples | User-requested character features | Yes | Collected when provided; private storage |
| Generated images and videos | App functionality, drafts, publishing | Yes | Collected |
| Published posts and captions | Public social functionality | Yes | User content |
| Reports and blocks | Safety, abuse prevention, enforcement | Yes, with reporter ID removed on account deletion where possible | Collected |
| Product interactions and creator events | Reliability and product functionality | Yes | Confirm exact production event retention before final form |
| Subscription status and purchase history | Entitlements and account support | Yes | Payment card details are handled by the applicable store/provider |
| Device and diagnostic data | Security and reliability | Potentially | Confirm exact live logging/diagnostic fields before final form |

Lumora does not use the advertising identifier and does not declare cross-app tracking unless the production build changes.

## Submission blockers

- Verify and actively monitor the public support address before adding it as published contact information.
- Publish the current legal, safety, support, and account-deletion routes to the production Vercel project.
- Attach `lumoracreator.com` and `www.lumoracreator.com` to that production project before changing metadata URLs to the custom domain.
- Create and securely store an Android upload key; never commit the keystore or its passwords.
- Complete Apple signing/enrollment and build with stable Xcode 26.
- Complete Play Console identity/device verification and any required closed test for the account.
