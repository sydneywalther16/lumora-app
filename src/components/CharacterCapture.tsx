import { useState } from 'react';
import { type PrivacySetting, type ReferenceImageUrls } from '../lib/api';
import { saveLocalCharacter } from '../lib/characterStorage';
import {
  saveSupabaseCharacter,
  uploadCharacterReferencePhoto,
  uploadLumoraMedia,
} from '../lib/supabaseAppData';
import { useSession } from '../hooks/useSession';

type CharacterCaptureProps = {
  onCreated?: () => void;
};

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
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

function compactPreferences(preferences: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(preferences)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value),
  );
}

export default function CharacterCapture({ onCreated }: CharacterCaptureProps) {
  const { user, session, loading, configured } = useSession();
  const authUser = session?.user ?? user;
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<PrivacySetting>('private');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [characterVibe, setCharacterVibe] = useState('');
  const [fashionStyle, setFashionStyle] = useState('');
  const [voicePersonality, setVoicePersonality] = useState('');
  const [frontFace, setFrontFace] = useState<File | null>(null);
  const [leftAngle, setLeftAngle] = useState<File | null>(null);
  const [rightAngle, setRightAngle] = useState<File | null>(null);
  const [selfieVideo, setSelfieVideo] = useState<File | null>(null);
  const [voiceSample, setVoiceSample] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) {
      setStatus('Add a character name before saving.');
      return;
    }

    if (!consentConfirmed) {
      setStatus('Confirm I am uploading myself or I have explicit permission to create this character.');
      return;
    }

    if (!frontFace || !leftAngle || !rightAngle) {
      setStatus('Add front, left, and right reference images.');
      return;
    }

    if (configured && loading && !authUser) {
      setStatus('Checking your account session. Try again in a moment.');
      return;
    }

    setBusy(true);
    setStatus('Saving character...');

    try {
      const stylePreferences = compactPreferences({
        characterVibe,
        fashionStyle,
        voicePersonality,
      });

      if (authUser) {
        const [frontUpload, leftUpload, rightUpload] = await Promise.all([
          uploadCharacterReferencePhoto({
            userId: authUser.id,
            file: frontFace,
            slot: 'frontFace',
            usage: 'character-front-reference',
          }),
          uploadCharacterReferencePhoto({
            userId: authUser.id,
            file: leftAngle,
            slot: 'leftAngle',
            usage: 'character-left-reference',
          }),
          uploadCharacterReferencePhoto({
            userId: authUser.id,
            file: rightAngle,
            slot: 'rightAngle',
            usage: 'character-right-reference',
          }),
        ]);

        const videoUpload = selfieVideo
          ? await uploadLumoraMedia({
              userId: authUser.id,
              bucket: 'self-capture-videos',
              file: selfieVideo,
              folder: 'fictional/capture',
              usage: 'character-capture-video',
            })
          : null;
        const voiceUpload = voiceSample
          ? await uploadLumoraMedia({
              userId: authUser.id,
              bucket: 'voice-samples',
              file: voiceSample,
              folder: 'fictional/voice',
              usage: 'character-voice-sample',
            })
          : null;

        await saveSupabaseCharacter({
          userId: authUser.id,
          name: name.trim(),
          consentConfirmed,
          visibility,
          stylePreferences,
          referenceImageUrls: {
            frontFace: frontUpload.url,
            frontFaceUrl: frontUpload.url,
            frontFacePath: frontUpload.objectPath,
            leftAngle: leftUpload.url,
            leftAngleUrl: leftUpload.url,
            leftAnglePath: leftUpload.objectPath,
            rightAngle: rightUpload.url,
            rightAngleUrl: rightUpload.url,
            rightAnglePath: rightUpload.objectPath,
            expressive: null,
          },
          referencePhotoNames: {
            frontFace: frontUpload.fileName,
            leftAngle: leftUpload.fileName,
            rightAngle: rightUpload.fileName,
          },
          sourceCaptureVideoUrl: videoUpload?.url ?? null,
          sourceCaptureVideoName: videoUpload?.fileName ?? null,
          voiceSampleUrl: voiceUpload?.url ?? null,
          voiceSampleName: voiceUpload?.fileName ?? null,
        });
      } else {
        const referenceImageUrls: ReferenceImageUrls = {
          frontFace: await readFileAsDataUrl(frontFace),
          leftAngle: await readFileAsDataUrl(leftAngle),
          rightAngle: await readFileAsDataUrl(rightAngle),
          expressive: null,
        };

        const sourceCaptureVideoUrl = selfieVideo ? await readFileAsDataUrl(selfieVideo) : null;
        const voiceSampleUrl = voiceSample ? await readFileAsDataUrl(voiceSample) : null;

        saveLocalCharacter({
          name: name.trim(),
          consentConfirmed,
          visibility,
          stylePreferences,
          referenceImageUrls,
          sourceCaptureVideoUrl,
          voiceSampleUrl,
        });
      }

      setName('');
      setVisibility('private');
      setConsentConfirmed(false);
      setCharacterVibe('');
      setFashionStyle('');
      setVoicePersonality('');
      setFrontFace(null);
      setLeftAngle(null);
      setRightAngle(null);
      setSelfieVideo(null);
      setVoiceSample(null);
      setStatus(authUser ? 'Character saved to your account.' : 'Character saved locally.');
      onCreated?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save character.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="editor-card character-capture">
      <div>
        <span className="eyebrow">capture</span>
        <h3>Character capture</h3>
      </div>

      <label className="field-block">
        <span>Character name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nova Velvet" />
      </label>

      <div className="reference-grid">
        <label className="reference-upload">
          <span>Front face</span>
          <strong>{frontFace ? 'Uploaded / Ready' : 'Required'}</strong>
          <span className="muted">{frontFace?.name ?? 'No file selected'}</span>
          <input type="file" accept="image/*" onChange={(event) => setFrontFace(event.target.files?.[0] ?? null)} />
        </label>
        <label className="reference-upload">
          <span>Left angle</span>
          <strong>{leftAngle ? 'Uploaded / Ready' : 'Required'}</strong>
          <span className="muted">{leftAngle?.name ?? 'No file selected'}</span>
          <input type="file" accept="image/*" onChange={(event) => setLeftAngle(event.target.files?.[0] ?? null)} />
        </label>
        <label className="reference-upload">
          <span>Right angle</span>
          <strong>{rightAngle ? 'Uploaded / Ready' : 'Required'}</strong>
          <span className="muted">{rightAngle?.name ?? 'No file selected'}</span>
          <input type="file" accept="image/*" onChange={(event) => setRightAngle(event.target.files?.[0] ?? null)} />
        </label>
      </div>

      <label className="field-block">
        <span>Selfie video</span>
        <input type="file" accept="video/*" onChange={(event) => setSelfieVideo(event.target.files?.[0] ?? null)} />
      </label>

      <label className="field-block">
        <span>Voice sample</span>
        <input type="file" accept="audio/*" onChange={(event) => setVoiceSample(event.target.files?.[0] ?? null)} />
      </label>

      <label className="field-block">
        <span>Character vibe</span>
        <input value={characterVibe} onChange={(event) => setCharacterVibe(event.target.value)} placeholder="Moody cyber muse" />
      </label>

      <label className="field-block">
        <span>Fashion style</span>
        <input value={fashionStyle} onChange={(event) => setFashionStyle(event.target.value)} placeholder="Neon street couture" />
      </label>

      <label className="field-block">
        <span>Voice / personality notes</span>
        <textarea
          value={voicePersonality}
          onChange={(event) => setVoicePersonality(event.target.value)}
          rows={4}
          placeholder="Warm, confident, and quick-witted" 
        />
      </label>

      <label className="field-block">
        <span>Visibility</span>
        <select value={visibility} onChange={(event) => setVisibility(event.target.value as PrivacySetting)}>
          <option value="private">Private</option>
          <option value="approved_only">Approved only</option>
          <option value="public">Public</option>
        </select>
      </label>

      <label className="consent-row">
        <input
          type="checkbox"
          checked={consentConfirmed}
          onChange={(event) => setConsentConfirmed(event.target.checked)}
        />
        <span>I confirm I am uploading myself or I have explicit permission to create this character.</span>
      </label>

      <button type="button" className="primary-btn full-width" onClick={handleSubmit} disabled={busy}>
        {busy ? 'Saving...' : 'Save character'}
      </button>

      {status ? <p className="muted">{status}</p> : null}
    </section>
  );
}
