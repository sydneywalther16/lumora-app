import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  CREATOR_SELF_CHARACTER_ID,
  cleanupCreatorSelfMetadata,
  getStoredCharacters,
  saveCreatorSelfCharacter,
} from '../lib/characterStorage';
import {
  loadCastInProjects,
  loadDrafts,
  loadLumoraProfile,
  loadProfilePosts,
  saveLumoraProfile,
  type LumoraProfile,
} from '../lib/profileStorage';
import type { CharacterProfile, CreatorSelfStylePreferences, LumoraPost } from '../lib/api';
import type { StudioProject } from '../lib/projectStorage';

type Draft = { id: string; title: string; prompt: string; createdAt: string };

type CreatorSelfFeatures = {
  hairColorStyle: string;
  eyeColor: string;
  skinTone: string;
  bodyBuild: string;
  signatureMakeup: string;
  distinctiveFeatures: string;
};

type SelfCharacterForm = {
  frontFace: string;
  frontFaceName: string;
  leftAngle: string;
  leftAngleName: string;
  rightAngle: string;
  rightAngleName: string;
  selfieVideoName: string;
  selfieVideoUrl: string | null;
  voiceSampleName: string;
  voiceSampleUrl: string | null;
  voiceSampleNumbers: string;
  voiceSampleConsent: boolean;
  selfCaptureNumbers: string;
  selfCaptureConsent: boolean;
  selfCaptureCompleted: boolean;
  features: CreatorSelfFeatures;
  style: Required<CreatorSelfStylePreferences>;
};

type SelfCharacterEditorDraft = SelfCharacterForm &
  Partial<CreatorSelfFeatures> &
  Partial<CreatorSelfStylePreferences> & {
  autosavedAt?: string;
  creatorSelfFeatures?: CreatorSelfFeatures;
  creatorSelfStylePreferences?: Required<CreatorSelfStylePreferences>;
};

type ReferencePhotoField = 'frontFace' | 'leftAngle' | 'rightAngle';
type ReferencePhotoNameField = 'frontFaceName' | 'leftAngleName' | 'rightAngleName';
type SelfCharacterFormSource = Partial<Omit<SelfCharacterForm, 'features' | 'style'>> & {
  features?: Partial<CreatorSelfFeatures>;
  style?: Partial<CreatorSelfStylePreferences>;
};

const SELF_VOICE_SAMPLE_SCRIPT =
  'Today I am creating my Lumora self character. My voice should sound natural, expressive, and accurate.';
const SELF_CHARACTER_EDITOR_DRAFT_KEY = 'lumora_self_character_editor_draft';

const referencePhotoNameFields: Record<ReferencePhotoField, ReferencePhotoNameField> = {
  frontFace: 'frontFaceName',
  leftAngle: 'leftAngleName',
  rightAngle: 'rightAngleName',
};

const emptyCreatorSelfFeatures: CreatorSelfFeatures = {
  hairColorStyle: '',
  eyeColor: '',
  skinTone: '',
  bodyBuild: '',
  signatureMakeup: '',
  distinctiveFeatures: '',
};

const emptyCreatorSelfStylePreferences: Required<CreatorSelfStylePreferences> = {
  everydayStyle: '',
  glamStyle: '',
  videoWardrobe: '',
  colorsToFavor: '',
  colorsToAvoid: '',
};

const creatorSelfFeatureFields: Array<{
  key: keyof CreatorSelfFeatures;
  label: string;
  placeholder: string;
}> = [
  { key: 'hairColorStyle', label: 'Hair color/style', placeholder: 'Dark brown waves, copper bob, shaved blonde fade' },
  { key: 'eyeColor', label: 'Eye color', placeholder: 'Brown, hazel, green' },
  { key: 'skinTone', label: 'Skin tone', placeholder: 'Warm medium, deep cool, fair neutral' },
  { key: 'bodyBuild', label: 'Body/build', placeholder: 'Petite, athletic, curvy, tall' },
  { key: 'signatureMakeup', label: 'Signature makeup', placeholder: 'Soft glam, winged liner, bare skin' },
  { key: 'distinctiveFeatures', label: 'Distinctive features', placeholder: 'Freckles, beauty mark, glasses, tattoos' },
];

const creatorSelfStyleFields: Array<{
  key: keyof CreatorSelfStylePreferences;
  label: string;
  placeholder: string;
  helper?: string;
}> = [
  {
    key: 'everydayStyle',
    label: 'Everyday style',
    placeholder: 'Optional - describe your typical on-camera outfits',
  },
  {
    key: 'glamStyle',
    label: 'Glam style',
    placeholder: 'Optional - describe your polished or editorial look',
  },
  {
    key: 'videoWardrobe',
    label: 'Preferred / Dream Wardrobe',
    placeholder: 'Silk dresses, tailored suits, oversized streetwear, vintage glam...',
    helper: 'Optional - describe the outfits you would love to wear or be known for in your content.',
  },
  {
    key: 'colorsToFavor',
    label: 'Colors to favor',
    placeholder: 'Optional - list colors that suit your on-camera style',
  },
  {
    key: 'colorsToAvoid',
    label: 'Colors/items to avoid',
    placeholder: 'Optional - list colors or items to avoid',
  },
];

function formatPostedDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatSelfVoiceSamplePrompt(numbers: string | null | undefined) {
  return `${numbers || '742 913 608'}. ${SELF_VOICE_SAMPLE_SCRIPT}`;
}

function generateSelfCaptureNumbers() {
  return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(' ');
}

function generateSelfVoiceSampleNumbers() {
  return Array.from({ length: 3 }, () => Math.floor(100 + Math.random() * 900)).join(' ');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Unable to read media file.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read media file.'));
    reader.readAsDataURL(file);
  });
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function readObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstString(...values: Array<string | null | undefined>): string {
  return values.find((value) => typeof value === 'string' && value.length > 0) ?? '';
}

function firstNullableString(...values: Array<string | null | undefined>): string | null {
  return firstString(...values) || null;
}

function findCreatorSelfCharacter(characters: CharacterProfile[]): CharacterProfile | null {
  return characters.find(
    (character) => character.id === CREATOR_SELF_CHARACTER_ID || character.isCreatorSelf === true
  ) ?? null;
}

function pickStringFields<T extends string>(record: Record<string, string>, keys: readonly T[]): Partial<Record<T, string>> {
  return Object.fromEntries(
    keys
      .map((key) => [key, record[key]] as const)
      .filter((entry): entry is readonly [T, string] => typeof entry[1] === 'string')
  ) as Partial<Record<T, string>>;
}

function compactStringRecord<T extends Record<string, string | undefined>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [key, value?.trim() ?? ''])
      .filter(([, value]) => value)
  ) as Partial<T>;
}

function getCreatorSelfFormValues(character: CharacterProfile | null): {
  features: CreatorSelfFeatures;
  style: Required<CreatorSelfStylePreferences>;
} {
  const stylePreferences = character?.stylePreferences ?? {};
  const flatStylePreferences = readStringRecord(stylePreferences);
  const featureKeys = creatorSelfFeatureFields.map((field) => field.key);
  const styleKeys = creatorSelfStyleFields.map((field) => field.key);
  const storedFeatures = {
    ...pickStringFields(flatStylePreferences, featureKeys),
    ...readStringRecord(stylePreferences.creatorSelfFeatures),
    ...readStringRecord(character?.creatorSelfFeatures),
  };
  const storedStyleRecord = {
    ...pickStringFields(flatStylePreferences, styleKeys),
    ...readStringRecord(stylePreferences.creatorSelfStylePreferences),
    ...readStringRecord(character?.creatorSelfStylePreferences),
  };
  const storedStyle = storedStyleRecord as Record<string, string>;
  const legacyColorsToAvoid = storedStyle.colorsToAvoid ?? storedStyle.colorsItemsToAvoid;

  return {
    features: { ...emptyCreatorSelfFeatures, ...storedFeatures },
    style: {
      ...emptyCreatorSelfStylePreferences,
      ...storedStyle,
      colorsToAvoid: legacyColorsToAvoid ?? '',
    },
  };
}

function parseSelfCharacterEditorDraft(value: unknown): SelfCharacterEditorDraft | null {
  const record = readObjectRecord(value);
  if (Object.keys(record).length === 0) return null;

  const featureKeys = creatorSelfFeatureFields.map((field) => field.key);
  const styleKeys = creatorSelfStyleFields.map((field) => field.key);
  const flatRecord = readStringRecord(record);
  const featureRecord = {
    ...pickStringFields(flatRecord, featureKeys),
    ...readStringRecord(record.features),
    ...readStringRecord(record.creatorSelfFeatures),
  };
  const styleRecord = {
    ...pickStringFields(flatRecord, styleKeys),
    ...readStringRecord(record.style),
    ...readStringRecord(record.creatorSelfStylePreferences),
  } as Record<string, string>;
  const legacyColorsToAvoid = styleRecord.colorsToAvoid ?? styleRecord.colorsItemsToAvoid;
  const features = {
    ...emptyCreatorSelfFeatures,
    ...pickStringFields(featureRecord, featureKeys),
  };
  const style = {
    ...emptyCreatorSelfStylePreferences,
    ...pickStringFields(styleRecord, styleKeys),
    colorsToAvoid: legacyColorsToAvoid ?? '',
  };

  return {
    frontFace: readString(record.frontFace),
    frontFaceName: readString(record.frontFaceName),
    leftAngle: readString(record.leftAngle),
    leftAngleName: readString(record.leftAngleName),
    rightAngle: readString(record.rightAngle),
    rightAngleName: readString(record.rightAngleName),
    selfieVideoName: readString(record.selfieVideoName),
    selfieVideoUrl: firstNullableString(readString(record.selfieVideoUrl)),
    voiceSampleName: readString(record.voiceSampleName),
    voiceSampleUrl: firstNullableString(readString(record.voiceSampleUrl)),
    voiceSampleNumbers: readString(record.voiceSampleNumbers),
    voiceSampleConsent: record.voiceSampleConsent === true,
    selfCaptureNumbers: readString(record.selfCaptureNumbers),
    selfCaptureConsent: record.selfCaptureConsent === true,
    selfCaptureCompleted: record.selfCaptureCompleted === true,
    features,
    style,
    creatorSelfFeatures: features,
    creatorSelfStylePreferences: style,
    ...features,
    ...style,
    autosavedAt: readString(record.autosavedAt) || undefined,
  };
}

function loadSelfCharacterEditorDraft(): SelfCharacterEditorDraft | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(SELF_CHARACTER_EDITOR_DRAFT_KEY);
    if (!raw) return null;
    return parseSelfCharacterEditorDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

function createSelfCharacterEditorDraft(form: SelfCharacterForm): SelfCharacterEditorDraft {
  const features = { ...emptyCreatorSelfFeatures, ...form.features };
  const style = { ...emptyCreatorSelfStylePreferences, ...form.style };

  return {
    frontFace: form.frontFace,
    frontFaceName: form.frontFaceName,
    leftAngle: form.leftAngle,
    leftAngleName: form.leftAngleName,
    rightAngle: form.rightAngle,
    rightAngleName: form.rightAngleName,
    selfieVideoName: form.selfieVideoName,
    selfieVideoUrl: form.selfieVideoUrl,
    voiceSampleName: form.voiceSampleName,
    voiceSampleUrl: form.voiceSampleUrl,
    voiceSampleNumbers: form.voiceSampleNumbers,
    voiceSampleConsent: form.voiceSampleConsent,
    selfCaptureNumbers: form.selfCaptureNumbers,
    selfCaptureConsent: form.selfCaptureConsent,
    selfCaptureCompleted: form.selfCaptureCompleted,
    features,
    style,
    creatorSelfFeatures: features,
    creatorSelfStylePreferences: style,
    ...features,
    ...style,
    autosavedAt: new Date().toISOString(),
  };
}

/**
 * Clean media URLs from draft values before storing.
 * Removes base64 data URLs to avoid localStorage quota issues.
 */
function cleanMediaFromDraft(draft: SelfCharacterEditorDraft): SelfCharacterEditorDraft {
  const cleanMediaUrl = (value?: string | null): string | null => {
    if (!value) return null;
    if (typeof value !== 'string') return null;
    if (value.startsWith('data:')) {
      return null;
    }
    return value;
  };

  return {
    ...draft,
    frontFace: cleanMediaUrl(draft.frontFace) || '',
    leftAngle: cleanMediaUrl(draft.leftAngle) || '',
    rightAngle: cleanMediaUrl(draft.rightAngle) || '',
    selfieVideoUrl: cleanMediaUrl(draft.selfieVideoUrl),
    voiceSampleUrl: cleanMediaUrl(draft.voiceSampleUrl),
  };
}

function saveSelfCharacterEditorDraft(form: SelfCharacterForm): SelfCharacterEditorDraft | null {
  if (typeof window === 'undefined') return null;

  const draft = createSelfCharacterEditorDraft(form);
  const cleanedDraft = cleanMediaFromDraft(draft);

  try {
    localStorage.setItem(SELF_CHARACTER_EDITOR_DRAFT_KEY, JSON.stringify(cleanedDraft));
    console.log('AUTOSAVED SELF CHARACTER DRAFT (media cleaned)', cleanedDraft);
    return cleanedDraft;
  } catch (error) {
    console.error('FAILED TO AUTOSAVE DRAFT:', error);
    return null;
  }
}

function getCharacterEditorDraft(character: CharacterProfile | null): SelfCharacterEditorDraft | null {
  return parseSelfCharacterEditorDraft(readObjectRecord(character?.stylePreferences).creatorSelfEditorDraft);
}

function getProfileEditorDraft(profile: LumoraProfile): SelfCharacterEditorDraft | null {
  return parseSelfCharacterEditorDraft(readObjectRecord(profile).selfCharacterEditorDraft);
}

function buildCreatorSelfCharacterSource(character: CharacterProfile | null): SelfCharacterFormSource {
  if (!character) return {};

  const editorDraft = getCharacterEditorDraft(character);
  const formValues = getCreatorSelfFormValues(character);
  const stylePreferences = readObjectRecord(character.stylePreferences);
  const compactFeatures = compactStringRecord(formValues.features);
  const compactStyle = compactStringRecord(formValues.style);

  return {
    ...editorDraft,
    frontFace: firstString(character.referenceImageUrls.frontFace, editorDraft?.frontFace),
    frontFaceName: firstString(editorDraft?.frontFaceName, character.referenceImageUrls.frontFace ? 'Saved front photo' : ''),
    leftAngle: firstString(character.referenceImageUrls.leftAngle, editorDraft?.leftAngle),
    leftAngleName: firstString(editorDraft?.leftAngleName, character.referenceImageUrls.leftAngle ? 'Saved left angle photo' : ''),
    rightAngle: firstString(character.referenceImageUrls.rightAngle, editorDraft?.rightAngle),
    rightAngleName: firstString(editorDraft?.rightAngleName, character.referenceImageUrls.rightAngle ? 'Saved right angle photo' : ''),
    selfieVideoName: firstString(editorDraft?.selfieVideoName, character.sourceCaptureVideoUrl ? 'Saved selfie video' : ''),
    selfieVideoUrl: firstNullableString(character.sourceCaptureVideoUrl, editorDraft?.selfieVideoUrl),
    voiceSampleName: firstString(
      character.voiceSampleName,
      editorDraft?.voiceSampleName,
      character.voiceSampleUrl ? 'Saved voice sample' : '',
    ),
    voiceSampleUrl: firstNullableString(character.voiceSampleUrl, editorDraft?.voiceSampleUrl),
    voiceSampleNumbers: firstString(character.voiceSampleNumbers, editorDraft?.voiceSampleNumbers),
    voiceSampleConsent: stylePreferences.selfVoiceSampleConsent === true || editorDraft?.voiceSampleConsent === true,
    selfCaptureNumbers: editorDraft?.selfCaptureNumbers,
    selfCaptureConsent: editorDraft?.selfCaptureConsent,
    selfCaptureCompleted: editorDraft?.selfCaptureCompleted,
    features: {
      ...(editorDraft?.features ?? {}),
      ...compactFeatures,
    },
    style: {
      ...(editorDraft?.style ?? {}),
      ...compactStyle,
    },
  };
}

function buildProfileSelfCharacterSource(profile: LumoraProfile): SelfCharacterFormSource {
  const profileRecord = readObjectRecord(profile);
  const editorDraft = getProfileEditorDraft(profile);
  const referenceImageUrls = readObjectRecord(profileRecord.selfReferenceImageUrls);
  const referencePhotoNames = readObjectRecord(profileRecord.selfReferencePhotoNames);
  const profileFeatures = compactStringRecord({
    ...readStringRecord(profileRecord.creatorSelfFeatures),
    ...readStringRecord(profileRecord.selfCharacterFeatures),
  });
  const profileStyleRecord = {
    ...readStringRecord(profileRecord.creatorSelfStylePreferences),
    ...readStringRecord(profileRecord.selfCharacterStylePreferences),
  };
  const profileStyle = compactStringRecord({
    ...pickStringFields(profileStyleRecord, creatorSelfStyleFields.map((field) => field.key)),
    colorsToAvoid: profileStyleRecord.colorsToAvoid ?? profileStyleRecord.colorsItemsToAvoid,
  });

  return {
    ...editorDraft,
    frontFace: firstString(readString(referenceImageUrls.frontFace), profile.defaultSelfCharacterAvatar, profile.avatar, editorDraft?.frontFace),
    frontFaceName: firstString(readString(referencePhotoNames.frontFace), editorDraft?.frontFaceName),
    leftAngle: firstString(readString(referenceImageUrls.leftAngle), editorDraft?.leftAngle),
    leftAngleName: firstString(readString(referencePhotoNames.leftAngle), editorDraft?.leftAngleName),
    rightAngle: firstString(readString(referenceImageUrls.rightAngle), editorDraft?.rightAngle),
    rightAngleName: firstString(readString(referencePhotoNames.rightAngle), editorDraft?.rightAngleName),
    selfieVideoName: firstString(profile.selfCaptureVideoName, editorDraft?.selfieVideoName),
    selfieVideoUrl: firstNullableString(profile.selfCaptureVideoUrl, editorDraft?.selfieVideoUrl),
    voiceSampleName: firstString(profile.selfVoiceSampleName, editorDraft?.voiceSampleName),
    voiceSampleUrl: firstNullableString(profile.selfVoiceSampleUrl, editorDraft?.voiceSampleUrl),
    voiceSampleNumbers: firstString(profile.selfVoiceSampleNumbers, editorDraft?.voiceSampleNumbers),
    voiceSampleConsent: Boolean(profile.selfVoiceSampleConsent) || editorDraft?.voiceSampleConsent === true,
    selfCaptureNumbers: firstString(profile.selfCaptureNumbers, editorDraft?.selfCaptureNumbers),
    selfCaptureConsent: Boolean(profile.selfCaptureConsent) || editorDraft?.selfCaptureConsent === true,
    selfCaptureCompleted: Boolean(profile.selfCaptureCompleted) || editorDraft?.selfCaptureCompleted === true,
    features: {
      ...(editorDraft?.features ?? {}),
      ...profileFeatures,
    },
    style: {
      ...(editorDraft?.style ?? {}),
      ...profileStyle,
    },
  };
}

function mergeSelfCharacterFormSources(...sources: SelfCharacterFormSource[]): SelfCharacterForm {
  const defaults = buildBlankSelfCharacterForm();
  const featureKeys = creatorSelfFeatureFields.map((field) => field.key);
  const styleKeys = creatorSelfStyleFields.map((field) => field.key);

  const findStringField = (field: keyof Omit<SelfCharacterForm, 'features' | 'style'>) =>
    firstString(...sources.map((source) => readString(source[field])));
  const findNullableStringField = (field: keyof Omit<SelfCharacterForm, 'features' | 'style'>) =>
    firstNullableString(...sources.map((source) => readString(source[field])));
  const findBooleanField = (field: keyof Omit<SelfCharacterForm, 'features' | 'style'>) =>
    sources.some((source) => source[field] === true);

  return {
    frontFace: findStringField('frontFace'),
    frontFaceName: findStringField('frontFaceName'),
    leftAngle: findStringField('leftAngle'),
    leftAngleName: findStringField('leftAngleName'),
    rightAngle: findStringField('rightAngle'),
    rightAngleName: findStringField('rightAngleName'),
    selfieVideoName: findStringField('selfieVideoName'),
    selfieVideoUrl: findNullableStringField('selfieVideoUrl'),
    voiceSampleName: findStringField('voiceSampleName'),
    voiceSampleUrl: findNullableStringField('voiceSampleUrl'),
    voiceSampleNumbers: findStringField('voiceSampleNumbers') || defaults.voiceSampleNumbers,
    voiceSampleConsent: findBooleanField('voiceSampleConsent'),
    selfCaptureNumbers: findStringField('selfCaptureNumbers') || defaults.selfCaptureNumbers,
    selfCaptureConsent: findBooleanField('selfCaptureConsent'),
    selfCaptureCompleted: findBooleanField('selfCaptureCompleted'),
    features: {
      ...emptyCreatorSelfFeatures,
      ...Object.fromEntries(
        featureKeys.map((key) => [key, firstString(...sources.map((source) => source.features?.[key]))])
      ),
    },
    style: {
      ...emptyCreatorSelfStylePreferences,
      ...Object.fromEntries(
        styleKeys.map((key) => [key, firstString(...sources.map((source) => source.style?.[key]))])
      ),
    },
  };
}

function hasSavedSelfDetails(form: SelfCharacterForm) {
  return [...Object.values(form.features), ...Object.values(form.style)].some((value) => value.trim().length > 0);
}

function buildSelfCharacterEditorState(
  profile: LumoraProfile,
  character: CharacterProfile | null,
  localDraft: SelfCharacterEditorDraft | null,
): SelfCharacterForm {
  const characterSource = buildCreatorSelfCharacterSource(character);
  const profileSource = buildProfileSelfCharacterSource(profile);
  const localDraftSource = localDraft ?? {};

  return mergeSelfCharacterFormSources(characterSource, profileSource, localDraftSource);
}

function buildSelfCharacterForm(profile: LumoraProfile, character: CharacterProfile | null): SelfCharacterForm {
  return buildSelfCharacterEditorState(profile, character, null);
}

function buildBlankSelfCharacterForm(): SelfCharacterForm {
  return {
    frontFace: '',
    frontFaceName: '',
    leftAngle: '',
    leftAngleName: '',
    rightAngle: '',
    rightAngleName: '',
    selfieVideoName: '',
    selfieVideoUrl: null,
    voiceSampleName: '',
    voiceSampleUrl: null,
    voiceSampleNumbers: generateSelfVoiceSampleNumbers(),
    voiceSampleConsent: false,
    selfCaptureNumbers: generateSelfCaptureNumbers(),
    selfCaptureConsent: false,
    selfCaptureCompleted: false,
    features: { ...emptyCreatorSelfFeatures },
    style: { ...emptyCreatorSelfStylePreferences },
  };
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="list-stack" style={{ marginTop: '22px' }}>
      <div className="headline-card compact" style={{ padding: '22px', borderRadius: '30px' }}>
        <span className="eyebrow">{title}</span>
      </div>
      {children}
    </section>
  );
}

function ProfileTextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label className="field-group">
      <span className="eyebrow">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          rows={4}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function ImagePreview({ src, fallback }: { src?: string | null; fallback: string }) {
  return src ? (
    <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  ) : (
    <span style={{ color: '#d3cdf3', fontSize: '1rem' }}>{fallback}</span>
  );
}

function PostCard({ post }: { post: LumoraPost }) {
  const title = post.title || post.caption || 'Untitled post';
  const videoUrl = post.videoUrl || post.imageUrl || '/demo-video.mp4';
  const authorName = post.creatorName || post.displayName || 'Lumora Creator';
  const authorUsername = post.creatorUsername || post.username || 'lumora.creator';
  const authorAvatar = post.creatorAvatar || post.avatar;
  const characterLabel = post.isDefaultSelfCharacter
    ? 'Created as self'
    : post.characterName
      ? `Featuring ${post.characterName}`
      : null;

  return (
    <article className="list-card" style={{ borderRadius: '28px', overflow: 'hidden', background: 'rgba(20,16,24,0.9)' }}>
      <div style={{ padding: '18px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: '0 0 auto',
          }}
        >
          <ImagePreview src={authorAvatar} fallback="U" />
        </div>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block' }}>{authorName}</strong>
          <span className="muted">@{authorUsername}</span>
          {characterLabel ? (
            <span className="tiny-pill" style={{ marginTop: '8px', display: 'inline-block', background: '#3f2f5f' }}>
              {characterLabel}
            </span>
          ) : null}
        </div>
      </div>
      <video
        src={videoUrl}
        controls
        muted
        loop
        playsInline
        style={{ width: '100%', height: '240px', objectFit: 'cover', display: 'block', background: '#000' }}
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
      <div style={{ padding: '18px' }}>
        <h3>{title}</h3>
        <p className="muted" style={{ marginTop: '10px' }}>
          {post.prompt || 'No prompt available'}
        </p>
        <p className="muted" style={{ marginTop: '8px', fontSize: '0.95rem' }}>
          Posted {formatPostedDate(post.createdAt)}
        </p>
      </div>
    </article>
  );
}

function ProjectCard({ project }: { project: StudioProject }) {
  const characterLabel = project.isDefaultSelfCharacter
    ? 'Created as self'
    : project.characterName
      ? `Character: ${project.characterName}`
      : 'No character selected';

  return (
    <article className="list-card" style={{ borderRadius: '28px', background: 'rgba(20,16,24,0.9)', padding: '18px' }}>
      <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{project.prompt || 'Cast Video'}</h3>
          <p className="muted" style={{ marginTop: '10px' }}>
            {characterLabel} - {project.provider.toUpperCase()}
          </p>
        </div>
        <span className="tiny-pill" style={{ background: '#2a1f3d' }}>
          {project.status}
        </span>
      </div>
      <video
        src={project.videoUrl}
        controls
        muted
        loop
        playsInline
        style={{ width: '100%', borderRadius: '20px', objectFit: 'cover', background: '#000', marginTop: '14px' }}
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
    </article>
  );
}

function DraftCard({ draft }: { draft: Draft }) {
  return (
    <article className="list-card" style={{ borderRadius: '28px', background: 'rgba(20,16,24,0.9)', padding: '18px' }}>
      <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{draft.title || 'Draft concept'}</h3>
          <p className="muted" style={{ marginTop: '10px' }}>
            {draft.prompt || 'Draft prompt not available'}
          </p>
        </div>
        <span className="tiny-pill status-drafting">Draft</span>
      </div>
      <p className="muted" style={{ marginTop: '14px' }}>
        Saved {formatPostedDate(draft.createdAt)}
      </p>
    </article>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<LumoraProfile>(() => loadLumoraProfile());
  const [profileDraft, setProfileDraft] = useState<LumoraProfile>(() => loadLumoraProfile());
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [posts, setPosts] = useState<LumoraPost[]>([]);
  const [castIn, setCastIn] = useState<StudioProject[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingSelfCharacter, setEditingSelfCharacter] = useState(false);
  const [selfForm, setSelfForm] = useState<SelfCharacterForm>(() => buildSelfCharacterForm(loadLumoraProfile(), null));
  const [captureChecklist, setCaptureChecklist] = useState({
    readNumbers: false,
    faceForward: false,
    turnLeft: false,
    turnRight: false,
    tiltUp: false,
  });
  const [showSelfCaptureRedo, setShowSelfCaptureRedo] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [selfCharacterStatus, setSelfCharacterStatus] = useState<string | null>(null);
  const [loadedSavedSelfDetails, setLoadedSavedSelfDetails] = useState(false);
  const selfCharacterEditorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    refreshProfileData();
  }, []);

  useEffect(() => {
    if (!editingSelfCharacter) return;
    saveSelfCharacterEditorDraft(selfForm);
  }, [editingSelfCharacter, selfForm]);

  function refreshProfileData() {
    const loadedProfile = loadLumoraProfile();
    cleanupCreatorSelfMetadata(loadedProfile);
    const loadedCharacters = getStoredCharacters();
    const loadedCreatorSelf = findCreatorSelfCharacter(loadedCharacters);
    const localDraft = loadSelfCharacterEditorDraft();

    console.log('=== refreshProfileData ===');
    console.log('LOADED CREATOR SELF FROM lumora_characters', loadedCreatorSelf?.id ?? 'NOT FOUND', loadedCreatorSelf?.name ?? '');
    console.log('lumoraCharactersCount:', loadedCharacters.length);
    console.log('draftExists:', Boolean(localDraft));
    console.log('creatorSelfLoaded:', loadedCreatorSelf ? 'yes' : 'no');
    console.log('creatorSelfId:', loadedCreatorSelf?.id ?? 'none');

    setProfile(loadedProfile);
    setProfileDraft(loadedProfile);
    setCharacters(loadedCharacters);
    setPosts(loadProfilePosts());
    setCastIn(loadCastInProjects());
    setDrafts(loadDrafts());
  }

  const creatorSelfCharacter = findCreatorSelfCharacter(characters);
  const fictionalCharacterCount = characters.filter(
    (character) => character.id !== CREATOR_SELF_CHARACTER_ID && character.isCreatorSelf !== true
  ).length;
  const selfCharacterFormTitle = creatorSelfCharacter ? 'Edit self character' : 'Create self character';
  const selfCharacterActionLabel = creatorSelfCharacter ? 'Save self character' : 'Create self character';
  const creatorSelfLoadedLabel = creatorSelfCharacter ? 'yes' : 'no';
  const creatorSelfIdLabel = creatorSelfCharacter?.id ?? 'none';
  const lumoraCharactersCount = characters.length;
  const localDraft = loadSelfCharacterEditorDraft();
  const draftExistsLabel = localDraft ? 'yes' : 'no';

  function openProfileEditor() {
    setProfileDraft(profile);
    setSaveMessage(null);
    setEditingProfile(true);
  }

  function openSelfCharacterEditor() {
    const latestProfile = loadLumoraProfile();
    const latestSelfCharacter = findCreatorSelfCharacter(getStoredCharacters());
    const localDraft = loadSelfCharacterEditorDraft();
    const initialSelfForm = buildSelfCharacterEditorState(latestProfile, latestSelfCharacter, localDraft);

    console.log('OPEN SELF EDITOR creatorSelf:', latestSelfCharacter);
    console.log('SELF EDITOR INITIAL STATE:', initialSelfForm);
    console.log('LOADED SELF CHARACTER EDITOR STATE', initialSelfForm);

    setSelfForm(initialSelfForm);
    setLoadedSavedSelfDetails(hasSavedSelfDetails(initialSelfForm));
    setCaptureChecklist({
      readNumbers: Boolean(initialSelfForm.selfCaptureCompleted),
      faceForward: Boolean(initialSelfForm.selfCaptureCompleted),
      turnLeft: Boolean(initialSelfForm.selfCaptureCompleted),
      turnRight: Boolean(initialSelfForm.selfCaptureCompleted),
      tiltUp: Boolean(initialSelfForm.selfCaptureCompleted),
    });
    setShowSelfCaptureRedo(false);
    setSelfCharacterStatus(null);
    setEditingProfile(false);
    setEditingSelfCharacter(true);
    window.requestAnimationFrame(() => {
      selfCharacterEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function handleProfileAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const avatar = await readFileAsDataUrl(file);
    setProfileDraft((current) => ({ ...current, avatar }));
  }

  function handleSaveProfile() {
    const nextProfile: LumoraProfile = {
      ...profileDraft,
      displayName: profileDraft.displayName.trim() || 'Creator',
      username: profileDraft.username.trim() || 'lumora.creator',
      bio: profileDraft.bio,
      defaultSelfCharacterName: creatorSelfCharacter
        ? profileDraft.displayName.trim() || 'Creator'
        : profileDraft.defaultSelfCharacterName ?? null,
    };

    saveLumoraProfile(nextProfile);
    cleanupCreatorSelfMetadata(nextProfile);
    setProfile(nextProfile);
    setProfileDraft(nextProfile);
    setCharacters(getStoredCharacters());
    setSaveMessage('Profile saved.');
    setEditingProfile(false);
  }

  async function handleSelfImageUpload(
    event: ChangeEvent<HTMLInputElement>,
    field: ReferencePhotoField,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    const nameField = referencePhotoNameFields[field];
    setSelfForm((current) => ({ ...current, [field]: dataUrl, [nameField]: file.name }));
  }

  async function handleSelfVideoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    setSelfForm((current) => ({
      ...current,
      selfieVideoName: file.name,
      selfieVideoUrl: dataUrl,
      selfCaptureCompleted: Boolean(current.selfCaptureConsent),
    }));
  }

  async function handleVoiceSampleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    setSelfForm((current) => ({
      ...current,
      voiceSampleName: file.name,
      voiceSampleUrl: dataUrl,
      voiceSampleNumbers: current.voiceSampleNumbers || generateSelfVoiceSampleNumbers(),
    }));
  }

  function handleStartSelfCapture() {
    setShowSelfCaptureRedo(true);
    setCaptureChecklist({
      readNumbers: false,
      faceForward: false,
      turnLeft: false,
      turnRight: false,
      tiltUp: false,
    });
    setSelfForm((current) => ({
      ...current,
      selfCaptureNumbers: generateSelfCaptureNumbers(),
      selfCaptureCompleted: false,
    }));
  }

  function handleSelfCaptureConsent(checked: boolean) {
    setSelfForm((current) => ({
      ...current,
      selfCaptureConsent: checked,
      selfCaptureCompleted: Boolean(checked && current.selfieVideoUrl),
    }));
  }

  function handleCaptureChecklistChange(name: keyof typeof captureChecklist, checked: boolean) {
    const nextChecklist = { ...captureChecklist, [name]: checked };
    const checklistComplete = Object.values(nextChecklist).every(Boolean);

    setCaptureChecklist(nextChecklist);
    setSelfForm((current) => ({
      ...current,
      selfCaptureCompleted: Boolean(current.selfCaptureConsent && (current.selfieVideoUrl || checklistComplete)),
    }));
  }

  function updateSelfFeature(name: keyof CreatorSelfFeatures, value: string) {
    setSelfForm((current) => ({
      ...current,
      features: { ...current.features, [name]: value },
    }));
  }

  function updateSelfStyle(name: keyof CreatorSelfStylePreferences, value: string) {
    setSelfForm((current) => ({
      ...current,
      style: { ...current.style, [name]: value },
    }));
  }

  function handleSaveSelfCharacter() {
    if (!selfForm.frontFace || !selfForm.leftAngle || !selfForm.rightAngle) {
      setSelfCharacterStatus('Add front, left, and right photos to save your self character.');
      return;
    }

    const compactFeatures = compactStringRecord(selfForm.features);
    const compactStyle = compactStringRecord(selfForm.style);
    const finalEditorDraft = saveSelfCharacterEditorDraft(selfForm) ?? createSelfCharacterEditorDraft(selfForm);
    const displayName = profile.displayName.trim() || 'Creator';
    
    try {
      // Save to character storage
      console.log('[handleSaveSelfCharacter] Starting save...');
      const selfCharacter = saveCreatorSelfCharacter({
        name: displayName,
        referenceImageUrls: {
          frontFace: selfForm.frontFace,
          leftAngle: selfForm.leftAngle,
          rightAngle: selfForm.rightAngle,
        },
        sourceCaptureVideoUrl: selfForm.selfieVideoUrl,
        voiceSampleUrl: selfForm.voiceSampleUrl,
        voiceSampleName: selfForm.voiceSampleName || null,
        voiceSampleNumbers: selfForm.voiceSampleNumbers || null,
        stylePreferences: {
          creatorSelfFeatures: compactFeatures,
          creatorSelfStylePreferences: compactStyle,
          creatorSelfEditorDraft: finalEditorDraft,
          selfCaptureNumbers: selfForm.selfCaptureNumbers || null,
          selfCaptureConsent: selfForm.selfCaptureConsent,
          selfCaptureCompleted: selfForm.selfCaptureCompleted,
          selfVoiceSampleConsent: Boolean(selfForm.voiceSampleConsent),
        },
        creatorSelfFeatures: compactFeatures,
        creatorSelfStylePreferences: compactStyle,
      });

      console.log('[handleSaveSelfCharacter] Character save succeeded');

      // Save profile with self character metadata
      const nextProfile: LumoraProfile = {
        ...profile,
        defaultSelfCharacterId: CREATOR_SELF_CHARACTER_ID,
        defaultSelfCharacterName: displayName,
        defaultSelfCharacterAvatar: profile.avatar || selfForm.frontFace,
        selfReferenceImageUrls: {
          frontFace: selfForm.frontFace || null,
          leftAngle: selfForm.leftAngle || null,
          rightAngle: selfForm.rightAngle || null,
        },
        selfReferencePhotoNames: {
          frontFace: selfForm.frontFaceName || null,
          leftAngle: selfForm.leftAngleName || null,
          rightAngle: selfForm.rightAngleName || null,
        },
        selfCaptureVideoName: selfForm.selfieVideoName || null,
        selfCaptureVideoUrl: selfForm.selfieVideoUrl,
        selfCaptureNumbers: selfForm.selfCaptureNumbers || null,
        selfCaptureConsent: selfForm.selfCaptureConsent,
        selfCaptureCompleted: selfForm.selfCaptureCompleted,
        selfCaptureCapturedAt: selfForm.selfieVideoUrl ? new Date().toISOString() : profile.selfCaptureCapturedAt ?? null,
        selfVoiceSampleName: selfForm.voiceSampleName || null,
        selfVoiceSampleUrl: selfForm.voiceSampleUrl,
        selfVoiceSampleNumbers: selfForm.voiceSampleNumbers || null,
        selfVoiceSampleCapturedAt: selfForm.voiceSampleUrl ? new Date().toISOString() : profile.selfVoiceSampleCapturedAt ?? null,
        selfVoiceSampleConsent: selfForm.voiceSampleConsent,
        creatorSelfFeatures: compactFeatures,
        creatorSelfStylePreferences: compactStyle,
        selfCharacterFeatures: compactFeatures,
        selfCharacterStylePreferences: compactStyle,
        selfCharacterEditorDraft: finalEditorDraft,
      };

      saveLumoraProfile(nextProfile);
      console.log('[handleSaveSelfCharacter] Profile save succeeded');

      // Verify that creator-self was actually saved to localStorage
      const verificationCharacters = getStoredCharacters();
      const verifiedCreatorSelf = findCreatorSelfCharacter(verificationCharacters);
      
      if (verifiedCreatorSelf && verifiedCreatorSelf.id === CREATOR_SELF_CHARACTER_ID) {
        // SUCCESS: Creator-self persisted to localStorage
        console.log('[handleSaveSelfCharacter] ✓ VERIFIED: creator-self saved to localStorage');
        
        // Update React state from localStorage to ensure consistency
        setProfile(nextProfile);
        setProfileDraft(nextProfile);
        setCharacters(verificationCharacters);
        setLoadedSavedSelfDetails(hasSavedSelfDetails(selfForm));
        
        setSaveMessage('Self character saved and verified.');
        setSelfCharacterStatus(null);
        setEditingSelfCharacter(false);
      } else {
        // FAILURE: Creator-self did not persist
        console.error('[handleSaveSelfCharacter] ✗ VERIFICATION FAILED: creator-self not found in localStorage after save');
        console.log('[handleSaveSelfCharacter] Stored characters:', verificationCharacters.map(c => ({ id: c.id, name: c.name })));
        
        setSelfCharacterStatus('Save failed. Your draft is still autosaved.');
        setSaveMessage(null);
        // Keep editingSelfCharacter = true so user stays in editor
      }
    } catch (error) {
      console.error('[handleSaveSelfCharacter] ✗ Save error:', error);
      setSelfCharacterStatus(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}. Your draft is still autosaved.`);
      setSaveMessage(null);
      // Keep editingSelfCharacter = true so user stays in editor
    }
  }

  const showSelfCaptureControls = !selfForm.selfCaptureCompleted || showSelfCaptureRedo;

  return (
    <div className="page" style={{ paddingBottom: '40px' }}>
      <section className="list-card" style={{ borderRadius: '30px', padding: '22px', background: 'rgba(20,16,24,0.95)' }}>
        <div style={{ display: 'grid', gap: '18px', justifyItems: 'center', textAlign: 'center' }}>
          <div
            style={{
              width: '108px',
              height: '108px',
              borderRadius: '34px',
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ImagePreview src={profile.avatar} fallback={profile.displayName.charAt(0).toUpperCase() || 'L'} />
          </div>

          <div style={{ minWidth: 0 }}>
            <span className="eyebrow">creator profile</span>
            <h1 style={{ marginTop: '8px' }}>{profile.displayName}</h1>
            <p className="muted" style={{ marginTop: '4px' }}>
              @{profile.username}
            </p>
            {profile.bio ? (
              <p style={{ margin: '12px auto 0', lineHeight: 1.5, maxWidth: '28rem' }}>{profile.bio}</p>
            ) : null}
          </div>

          <div className="stats-row" style={{ width: '100%', justifyContent: 'center', gap: '14px' }}>
            <span>{posts.length} posts</span>
            <span>{fictionalCharacterCount} characters</span>
            <span>{drafts.length} drafts</span>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="primary-btn" onClick={openProfileEditor}>
              Edit profile
            </button>
            <button type="button" className="ghost-btn" onClick={openSelfCharacterEditor}>
              {creatorSelfCharacter ? 'Edit self character' : 'Create self character'}
            </button>
          </div>

          {saveMessage ? <p style={{ color: '#8bc34a', margin: 0 }}>{saveMessage}</p> : null}
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            creatorSelfLoaded: {creatorSelfLoadedLabel} · creatorSelfId: {creatorSelfIdLabel} · lumoraCharactersCount: {lumoraCharactersCount} · draftExists: {draftExistsLabel}
          </p>
        </div>
      </section>

      {editingProfile ? (
        <section className="headline-card compact" style={{ marginTop: '18px', padding: '22px', borderRadius: '30px' }}>
          <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start' }}>
            <div>
              <span className="eyebrow">edit profile</span>
              <h2 style={{ marginTop: '8px' }}>Profile details</h2>
            </div>
            <button type="button" className="text-btn" onClick={() => setEditingProfile(false)}>
              Close
            </button>
          </div>

          <div style={{ marginTop: '18px', display: 'grid', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: '78px',
                  height: '78px',
                  borderRadius: '24px',
                  overflow: 'hidden',
                  background: 'rgba(255,255,255,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ImagePreview src={profileDraft.avatar} fallback="Avatar" />
              </div>
              <label className="ghost-btn" style={{ padding: '10px 16px' }}>
                Upload avatar
                <input type="file" accept="image/*" onChange={handleProfileAvatarUpload} style={{ display: 'none' }} />
              </label>
            </div>

            <ProfileTextField
              label="Display name"
              value={profileDraft.displayName}
              placeholder="Your creator name"
              onChange={(value) => setProfileDraft((current) => ({ ...current, displayName: value }))}
            />
            <ProfileTextField
              label="Username"
              value={profileDraft.username}
              placeholder="lumora.creator"
              onChange={(value) => setProfileDraft((current) => ({ ...current, username: value }))}
            />
            <ProfileTextField
              label="Bio"
              value={profileDraft.bio}
              placeholder="Write a short creator bio"
              multiline
              onChange={(value) => setProfileDraft((current) => ({ ...current, bio: value }))}
            />

            <button type="button" className="primary-btn full-width" onClick={handleSaveProfile}>
              Save profile
            </button>
          </div>
        </section>
      ) : null}

      {editingSelfCharacter ? (
        <section
          ref={selfCharacterEditorRef}
          className="headline-card compact"
          style={{ marginTop: '18px', padding: '22px', borderRadius: '30px' }}
        >
          <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start' }}>
            <div>
              <span className="eyebrow">creator self</span>
              <h2 style={{ marginTop: '8px' }}>{selfCharacterFormTitle}</h2>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" className="text-btn" onClick={() => setEditingSelfCharacter(false)}>
                Cancel
              </button>
              <button type="button" className="text-btn" onClick={() => setEditingSelfCharacter(false)}>
                Close
              </button>
            </div>
          </div>

          <div style={{ marginTop: '18px', display: 'grid', gap: '18px' }}>
            <div>
              <strong>Reference photos</strong>
              <p className="muted" style={{ marginTop: '8px' }}>
                Front, left, and right photos are required for your self character.
              </p>
            </div>

            <div className="reference-grid" style={{ gap: '12px' }}>
              {([
                ['frontFace', 'Front photo'],
                ['leftAngle', 'Left angle'],
                ['rightAngle', 'Right angle'],
              ] as const).map(([field, label]) => (
                <label className="reference-upload" key={field}>
                  <span>{label}</span>
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      borderRadius: '16px',
                      overflow: 'hidden',
                      background: 'rgba(255,255,255,0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '8px 0',
                    }}
                  >
                    <ImagePreview src={selfForm[field]} fallback="Required" />
                  </div>
                  <strong>{selfForm[field] ? 'Saved' : 'Required'}</strong>
                  <span className="muted">
                    {selfForm[referencePhotoNameFields[field]] ||
                      (selfForm[field] ? 'Saved reference photo' : 'No file selected')}
                  </span>
                  <input type="file" accept="image/*" onChange={(event) => void handleSelfImageUpload(event, field)} />
                </label>
              ))}
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <strong>Self capture</strong>
              {showSelfCaptureControls ? (
                <>
                  <button type="button" className="ghost-btn" onClick={handleStartSelfCapture}>
                    Start self capture
                  </button>
                  <div style={{ padding: '16px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                    <strong>Read the numbers shown on screen:</strong>
                    <div style={{ marginTop: '10px', fontSize: '1.35rem', letterSpacing: '0.25em' }}>
                      {selfForm.selfCaptureNumbers}
                    </div>
                  </div>
                  <label className="field-group">
                    <span className="eyebrow">Selfie video</span>
                    <input type="file" accept="video/*" onChange={(event) => void handleSelfVideoUpload(event)} />
                    <span className="muted">{selfForm.selfieVideoName || 'Upload or record a selfie video'}</span>
                  </label>
                  <div style={{ display: 'grid', gap: '12px' }}>
                    <div>
                      <strong>Capture instructions</strong>
                      <p className="muted" style={{ marginTop: '8px' }}>
                        Read the numbers shown on screen, then slowly turn your head left, right, and up.
                      </p>
                    </div>
                    {([
                      ['readNumbers', 'Read the numbers out loud'],
                      ['faceForward', 'Face forward'],
                      ['turnLeft', 'Turn head left'],
                      ['turnRight', 'Turn head right'],
                      ['tiltUp', 'Tilt head up'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="consent-row">
                        <input
                          type="checkbox"
                          checked={captureChecklist[key]}
                          onChange={(event) => handleCaptureChecklistChange(key, event.target.checked)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <label className="consent-row">
                    <input
                      type="checkbox"
                      checked={selfForm.selfCaptureConsent}
                      onChange={(event) => handleSelfCaptureConsent(event.target.checked)}
                    />
                    <span>I confirm this is me and I consent to using this video to create my self character.</span>
                  </label>
                </>
              ) : (
                <div style={{ display: 'grid', gap: '12px', padding: '16px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                  <div>
                    <strong>Self capture complete</strong>
                    <p className="muted" style={{ marginTop: '8px' }}>
                      Your selfie video and consent are saved.
                    </p>
                  </div>
                  <button type="button" className="ghost-btn" onClick={() => setShowSelfCaptureRedo(true)}>
                    Redo self capture
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <strong>Voice sample</strong>
              <button
                type="button"
                className="ghost-btn"
                onClick={() =>
                  setSelfForm((current) => ({
                    ...current,
                    voiceSampleNumbers: generateSelfVoiceSampleNumbers(),
                  }))
                }
              >
                Generate voice prompt
              </button>
              <div style={{ padding: '16px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                <strong>Voice sample prompt</strong>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  {formatSelfVoiceSamplePrompt(selfForm.voiceSampleNumbers)}
                </p>
              </div>
              <label className="field-group">
                <span className="eyebrow">Voice sample</span>
                <input type="file" accept="audio/*" onChange={(event) => void handleVoiceSampleUpload(event)} />
                <span className="muted">{selfForm.voiceSampleName || 'Optional voice sample upload'}</span>
              </label>
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={selfForm.voiceSampleConsent}
                  onChange={(event) =>
                    setSelfForm((current) => ({ ...current, voiceSampleConsent: event.target.checked }))
                  }
                />
                <span>I confirm this is my own voice and I consent to using it for my self character.</span>
              </label>
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <div>
                <strong>Character Features</strong>
                <p className="muted" style={{ marginTop: '4px' }}>(optional)</p>
              </div>
              {creatorSelfFeatureFields.map((field) => (
                <ProfileTextField
                  key={field.key}
                  label={field.label}
                  value={selfForm.features[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(value) => updateSelfFeature(field.key, value)}
                />
              ))}
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <div>
                <strong>Fashion / Style</strong>
                <p className="muted" style={{ marginTop: '4px' }}>(optional)</p>
              </div>
              {creatorSelfStyleFields.map((field) => (
                <label key={field.key} className="field-group">
                  <span className="eyebrow">{field.label}</span>
                  {field.helper ? (
                    <span className="muted" style={{ display: 'block', marginTop: '6px' }}>
                      {field.helper}
                    </span>
                  ) : null}
                  <input
                    type="text"
                    value={selfForm.style[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(event) => updateSelfStyle(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>

            <p className="muted" style={{ margin: 0 }}>
              Save changes to your self character photos, voice, features, and style.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Draft autosaved locally
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Loaded saved details: {loadedSavedSelfDetails ? 'yes' : 'no'}
            </p>
            <button type="button" className="primary-btn full-width" onClick={handleSaveSelfCharacter}>
              {selfCharacterActionLabel}
            </button>
            {selfCharacterStatus ? <p className="muted">{selfCharacterStatus}</p> : null}
          </div>
        </section>
      ) : null}

      {creatorSelfCharacter ? (
        <section className="list-card" style={{ marginTop: '18px', borderRadius: '28px', padding: '18px', background: 'rgba(20,16,24,0.9)' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '22px',
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 auto',
              }}
            >
              <ImagePreview src={creatorSelfCharacter.referenceImageUrls.frontFace} fallback="Self" />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: 'block' }}>{creatorSelfCharacter.name}</strong>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                Default self character
              </p>
            </div>
            <span className="tiny-pill" style={{ background: '#2a1f3d' }}>
              Ready
            </span>
          </div>
        </section>
      ) : null}

      <SectionCard title="Published videos">
        {posts.length ? (
          <div className="list-stack">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        ) : (
          <article className="list-card" style={{ borderRadius: '28px', padding: '18px' }}>
            <h3>No posts yet</h3>
            <p className="muted">Create and post a video from Studio to see it appear here.</p>
          </article>
        )}
      </SectionCard>

      <SectionCard title="Cast In">
        {castIn.length ? (
          <div className="list-stack">
            {castIn.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <article className="list-card" style={{ borderRadius: '28px', padding: '18px' }}>
            <h3>No cast videos yet</h3>
            <p className="muted">Any completed project with a character selected will show up here.</p>
          </article>
        )}
      </SectionCard>

      <SectionCard title="Drafts">
        <p className="muted" style={{ marginBottom: '14px' }}>
          Only you can see drafts.
        </p>
        {drafts.length ? (
          <div className="list-stack">
            {drafts.map((draft) => (
              <DraftCard key={draft.id} draft={draft} />
            ))}
          </div>
        ) : (
          <article className="list-card" style={{ borderRadius: '28px', padding: '18px' }}>
            <h3>No drafts yet</h3>
            <p className="muted">Save a concept in Create or Studio and it will be available here.</p>
          </article>
        )}
      </SectionCard>
    </div>
  );
}
