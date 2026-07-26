export type DirectorRoutingIntent =
  | 'personal_ai_cast'
  | 'text_only'
  | 'establishing_shot'
  | 'synthetic_character'
  | 'hero_shot'
  | 'extension'
  | 'first_last_frame'
  | 'still_cleanup';

export type DirectorRoute =
  | 'director_primary'
  | 'seedance_text_only'
  | 'veo_specialist'
  | 'firefly_manual';

export type DirectorRoutingDecision = {
  route: DirectorRoute;
  automatic: boolean;
  seedanceInputMode: 'text_to_video' | null;
  reason: string;
};

export function selectDirectorRoute(input: {
  intent: DirectorRoutingIntent;
  hasPersonalIdentityImage: boolean;
}): DirectorRoutingDecision {
  if (input.hasPersonalIdentityImage || input.intent === 'personal_ai_cast') {
    return {
      route: 'director_primary',
      automatic: false,
      seedanceInputMode: null,
      reason: 'Personal AI Cast uses the Director anchor and primary-video pipeline only.',
    };
  }

  if (['text_only', 'establishing_shot', 'synthetic_character'].includes(input.intent)) {
    return {
      route: 'seedance_text_only',
      automatic: false,
      seedanceInputMode: 'text_to_video',
      reason: 'Seedance is retained only for text-only, establishing, or synthetic-character shots.',
    };
  }

  if (['hero_shot', 'extension', 'first_last_frame'].includes(input.intent)) {
    return {
      route: 'veo_specialist',
      automatic: false,
      seedanceInputMode: null,
      reason: 'Veo remains an explicitly selected specialist route.',
    };
  }

  return {
    route: 'firefly_manual',
    automatic: false,
    seedanceInputMode: null,
    reason: 'Still-image cleanup is reserved for a future explicitly selected specialist route.',
  };
}

export function seedancePersonalReferenceRouteAllowed(input: {
  hasPersonalIdentityImage: boolean;
  inputMode: 'text_to_video' | 'image_to_video_first_frame' | 'multimodal_reference';
}) {
  return !input.hasPersonalIdentityImage && input.inputMode === 'text_to_video';
}
