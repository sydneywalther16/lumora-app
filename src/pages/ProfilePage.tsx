import { useEffect, useState } from 'react';
import AuthCard from '../components/auth/AuthCard';
import ProfileHero from '../components/ProfileHero';
import StudioList from '../components/StudioList';
import {
  isSelfReady,
  loadCharacters,
  loadProfile,
  saveProfile,
  type LumoraCharacter,
  type LumoraProfile,
} from '../lib/localProfile';

function generateSelfCaptureNumbers() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default function ProfilePage() {
  const [characters, setCharacters] = useState<LumoraCharacter[]>([]);
  const [profile, setProfile] = useState<LumoraProfile>(() => loadProfile());
  const [activeNumbers, setActiveNumbers] = useState(profile.selfCapture.numbers || '');

  useEffect(() => {
    setCharacters(loadCharacters());
  }, []);

  function updateProfile(nextProfile: LumoraProfile) {
    setProfile(nextProfile);
    saveProfile(nextProfile);
  }

  function selectDefaultSelfCharacter(character: LumoraCharacter) {
    const nextProfile: LumoraProfile = {
      ...profile,
      defaultSelfCharacterId: character.id,
      defaultSelfCharacterName: character.name || 'Untitled character',
      defaultSelfCharacterAvatar:
        character.avatar || (character.name ? character.name.slice(0, 1).toUpperCase() : 'L'),
    };

    updateProfile(nextProfile);
  }

  function startSelfCapture() {
    const numbers = generateSelfCaptureNumbers();
    setActiveNumbers(numbers);

    updateProfile({
      ...profile,
      selfCapture: {
        ...profile.selfCapture,
        numbers,
        completed: false,
        capturedAt: undefined,
      },
    });
  }

  function saveSelfCaptureVideo(file: File) {
    updateProfile({
      ...profile,
      selfCapture: {
        ...profile.selfCapture,
        videoUrl: URL.createObjectURL(file),
        completed: true,
        capturedAt: new Date().toISOString(),
      },
    });
  }

  const ready = isSelfReady(profile);

  return (
    <div className="page">
      <AuthCard />
      <ProfileHero />

      <section className="list-card">
        <div className="row-between">
          <div>
            <span className="eyebrow">identity setup</span>
            <h3>Default Self Character</h3>
          </div>

          <span className="tiny-pill" style={{ background: ready ? '#214331' : '#4b2f21' }}>
            {ready ? 'Ready' : 'Required'}
          </span>
        </div>

        <p>This is your default self character.</p>
        <p className="muted">Used when you create videos as yourself.</p>
        <p className="muted">
          Self capture is required before this character can be used as your default self.
        </p>

        <div className="field-block">
          <span>Select your self character</span>

          {characters.length ? (
            <div className="chip-row wrap">
              {characters.map((character) => {
                const characterName = character.name || 'Untitled character';
                const selected = profile.defaultSelfCharacterId === character.id;

                return (
                  <button
                    key={character.id}
                    type="button"
                    className={`chip ${selected ? 'active' : ''}`}
                    onClick={() => selectDefaultSelfCharacter(character)}
                  >
                    {selected ? '✓ ' : ''}
                    {characterName}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted">
              No saved characters found yet. Create a regular character first, then come back to
              assign one as your default self character.
            </p>
          )}
        </div>

        {profile.defaultSelfCharacterName ? (
          <div className="list-card selected" style={{ marginBottom: '14px' }}>
            <div className="row-between">
              <div>
                <h3>{profile.defaultSelfCharacterName}</h3>
                <p className="muted">This is your default self character.</p>
              </div>
              <span className="avatar-glow" style={{ width: 54, height: 54, borderRadius: 18 }}>
                {profile.defaultSelfCharacterAvatar || 'L'}
              </span>
            </div>
          </div>
        ) : null}

        <div className="field-block">
          <span>Self Capture</span>
          <p className="muted">
            Read the numbers shown on screen, then slowly turn your head left, right, and up.
          </p>

          <button type="button" className="primary-btn" onClick={startSelfCapture}>
            Start self capture
          </button>

          {activeNumbers ? (
            <div className="list-card" style={{ marginTop: '10px' }}>
              <span className="eyebrow">read aloud</span>
              <h2 style={{ margin: '8px 0' }}>{activeNumbers}</h2>

              <ul style={{ color: '#d3cdf3', lineHeight: 1.7, paddingLeft: '20px' }}>
                <li>Read the numbers out loud</li>
                <li>Face forward</li>
                <li>Turn head left</li>
                <li>Turn head right</li>
                <li>Tilt head up</li>
              </ul>

              <label className="field-block">
                <span>Upload selfie video</span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) saveSelfCaptureVideo(file);
                  }}
                />
              </label>
            </div>
          ) : null}
        </div>

        <label
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
            color: '#d3cdf3',
            lineHeight: 1.45,
          }}
        >
          <input
            type="checkbox"
            checked={profile.selfCapture.consent}
            onChange={(event) =>
              updateProfile({
                ...profile,
                selfCapture: {
                  ...profile.selfCapture,
                  consent: event.target.checked,
                },
              })
            }
            style={{ width: 'auto', marginTop: '4px' }}
          />
          <span>
            I confirm this is me and I consent to using this video to create my self character.
          </span>
        </label>

        {profile.selfCapture.videoUrl ? (
          <p className="muted">Self capture video added.</p>
        ) : (
          <p className="muted">Self capture video still needed.</p>
        )}

        <p className="muted">
          Default self status: {ready ? 'Ready to create as yourself.' : 'Not ready yet.'}
        </p>
      </section>

      <section className="headline-card compact">
        <div>
          <span className="eyebrow">signature workflow</span>
          <h2>Recent outputs</h2>
        </div>
      </section>

      <StudioList />
    </div>
  );
}