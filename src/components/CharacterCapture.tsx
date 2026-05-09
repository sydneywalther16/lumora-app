import { useEffect, useState } from 'react';
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

function LocalReferencePreview({
  file,
  fallback,
  label,
}: {
  file: File | null;
  fallback: string;
  label: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const resolvedUrl = previewUrl;
  console.log('REFERENCE OBJECT:', file);
  console.log('RESOLVED URL:', resolvedUrl);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt={label}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          onLoad={() => console.log('LOADED PREVIEW:', resolvedUrl)}
          onError={() => {
            console.error('FAILED PREVIEW:', resolvedUrl);
            console.error('FAILED PREVIEW URL:', resolvedUrl);
          }}
        />
      ) : (
        <span style={{ color: '#d3cdf3', fontSize: '0.95rem', padding: '8px', textAlign: 'center' }}>
          {fallback}
        </span>
      )}
    </div>
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
  const [fullBody, setFullBody] = useState<File | null>(null);
  const [selfieVideo, setSelfieVideo] = useState<File | null>(null);
  const [selfieVideo2, setSelfieVideo2] = useState<File | null>(null);
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
        const fullBodyUpload = fullBody
          ? await uploadCharacterReferencePhoto({
              userId: authUser.id,
              file: fullBody,
              slot: 'fullBody',
              usage: 'character-full-body-reference',
            })
          : null;

        const videoUpload = selfieVideo
          ? await uploadLumoraMedia({
              userId: authUser.id,
              bucket: 'self-capture-videos',
              file: selfieVideo,
              folder: 'fictional/capture',
              usage: 'character-capture-video',
            })
          : null;
        const videoUpload2 = selfieVideo2
          ? await uploadLumoraMedia({
              userId: authUser.id,
              bucket: 'self-capture-videos',
              file: selfieVideo2,
              folder: 'fictional/capture',
              usage: 'character-capture-video-2',
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
          stylePreferences: {
            ...stylePreferences,
            videoReferenceUrl2: videoUpload2?.url ?? '',
            videoReferencePath2: videoUpload2?.objectPath ?? '',
          },
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
            fullBody: fullBodyUpload?.url ?? null,
            fullBodyUrl: fullBodyUpload?.url ?? null,
            fullBodyPath: fullBodyUpload?.objectPath ?? null,
            expressive: null,
          },
          referencePhotoNames: {
            frontFace: frontUpload.fileName,
            leftAngle: leftUpload.fileName,
            rightAngle: rightUpload.fileName,
            fullBody: fullBodyUpload?.fileName ?? null,
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
          fullBody: fullBody ? await readFileAsDataUrl(fullBody) : null,
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
      setFullBody(null);
      setSelfieVideo(null);
      setSelfieVideo2(null);
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
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Build a reusable photorealistic character from your reference photos and videos.
        </p>
      </div>

      <label className="field-block">
        <span>Character name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nova Velvet" />
      </label>

      <div className="reference-grid">
        <label className="reference-upload">
          <span>Front face</span>
          <div style={{
            width: '100%',
            aspectRatio: '1',
            borderRadius: '16px',
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '8px 0',
          }}>
            <LocalReferencePreview file={frontFace} fallback="Required" label="Front reference" />
          </div>
          <strong>{frontFace ? 'Uploaded / Ready' : 'Required'}</strong>
          <span className="muted">{frontFace?.name ?? 'No file selected'}</span>
          <input type="file" accept="image/*" onChange={(event) => setFrontFace(event.target.files?.[0] ?? null)} />
        </label>
        <label className="reference-upload">
          <span>Left angle</span>
          <div style={{
            width: '100%',
            aspectRatio: '1',
            borderRadius: '16px',
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '8px 0',
          }}>
            <LocalReferencePreview file={leftAngle} fallback="Required" label="Left angle reference" />
          </div>
          <strong>{leftAngle ? 'Uploaded / Ready' : 'Required'}</strong>
          <span className="muted">{leftAngle?.name ?? 'No file selected'}</span>
          <input type="file" accept="image/*" onChange={(event) => setLeftAngle(event.target.files?.[0] ?? null)} />
        </label>
        <label className="reference-upload">
          <span>Right angle</span>
          <div style={{
            width: '100%',
            aspectRatio: '1',
            borderRadius: '16px',
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '8px 0',
          }}>
            <LocalReferencePreview file={rightAngle} fallback="Required" label="Right angle reference" />
          </div>
          <strong>{rightAngle ? 'Uploaded / Ready' : 'Required'}</strong>
          <span className="muted">{rightAngle?.name ?? 'No file selected'}</span>
          <input type="file" accept="image/*" onChange={(event) => setRightAngle(event.target.files?.[0] ?? null)} />
        </label>
        <label className="reference-upload">
          <span>Full body</span>
          <div style={{
            width: '100%',
            aspectRatio: '1',
            borderRadius: '16px',
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '8px 0',
          }}>
            <LocalReferencePreview file={fullBody} fallback="Optional" label="Full body reference" />
          </div>
          <strong>{fullBody ? 'Uploaded / Ready' : 'Optional'}</strong>
          <span className="muted">{fullBody?.name ?? 'No file selected'}</span>
          <input type="file" accept="image/*" onChange={(event) => setFullBody(event.target.files?.[0] ?? null)} />
        </label>
      </div>

      <label className="field-block">
        <span>Selfie video 1</span>
        <input type="file" accept="video/*" onChange={(event) => setSelfieVideo(event.target.files?.[0] ?? null)} />
      </label>

      <label className="field-block">
        <span>Selfie video 2</span>
        <input type="file" accept="video/*" onChange={(event) => setSelfieVideo2(event.target.files?.[0] ?? null)} />
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
        <span>I confirm I own or have permission to use these reference images/videos.</span>
      </label>

      <button type="button" className="primary-btn full-width" onClick={handleSubmit} disabled={busy}>
        {busy ? 'Saving...' : 'Save character'}
      </button>

      {status ? <p className="muted">{status}</p> : null}
    </section>
  );
}
