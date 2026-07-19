import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AUTH_UPDATE_PASSWORD_PATH } from '../hooks/useSession';
import {
  cleanPasswordResetConfirmUrl,
  createPasswordRecoveryVerifier,
  hasPasswordRecoveryToken,
  parsePasswordRecoveryToken,
  type PasswordRecoveryTokenInput,
  type PasswordRecoveryVerificationResult,
} from '../lib/passwordRecoveryTokenHash';
import { supabase } from '../lib/supabase';

type ConfirmationStatus = 'invalid' | 'manual' | 'ready' | 'verifying';

const INVALID_RESET_LINK_MESSAGE = 'This reset link expired or could not be verified. Request a new one.';

export default function AuthResetConfirmPage() {
  const navigate = useNavigate();
  const recoveryInputRef = useRef<PasswordRecoveryTokenInput | null>(null);
  const verificationAttemptedRef = useRef(false);
  const verificationOutcomeRef = useRef<PasswordRecoveryVerificationResult | null>(null);
  const verifierRef = useRef<ReturnType<typeof createPasswordRecoveryVerifier> | null>(null);

  if (!recoveryInputRef.current) {
    recoveryInputRef.current = parsePasswordRecoveryToken(new URL(window.location.href));
  }

  const hasRecoveryRequest = hasPasswordRecoveryToken(recoveryInputRef.current);
  const [status, setStatus] = useState<ConfirmationStatus>(hasRecoveryRequest ? 'ready' : 'manual');

  if (!verifierRef.current && supabase && hasRecoveryRequest) {
    verifierRef.current = createPasswordRecoveryVerifier(supabase, recoveryInputRef.current);
  }

  function cleanAfterRecordedVerification() {
    if (!verificationOutcomeRef.current) return;
    cleanPasswordResetConfirmUrl();
  }

  async function handleContinue() {
    if (verificationAttemptedRef.current || status !== 'ready') return;
    verificationAttemptedRef.current = true;
    setStatus('verifying');

    const result = verifierRef.current
      ? await verifierRef.current.verify()
      : 'invalid';

    verificationOutcomeRef.current = result;
    recoveryInputRef.current = {
      hasRecoveryType: false,
      tokenHash: null,
    };

    if (result === 'valid') {
      cleanAfterRecordedVerification();
      navigate(AUTH_UPDATE_PASSWORD_PATH, {
        replace: true,
        state: { passwordRecoveryVerified: true },
      });
      return;
    }

    setStatus('invalid');
    cleanAfterRecordedVerification();
  }

  function handleCancel() {
    recoveryInputRef.current = {
      hasRecoveryType: false,
      tokenHash: null,
    };
    cleanPasswordResetConfirmUrl();
    navigate('/profile', { replace: true });
  }

  return (
    <div className="page" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <section className="headline-card" style={{ width: 'min(520px, 100%)' }}>
        <div>
          <span className="eyebrow">auth</span>
          <h1>Reset your Lumora password</h1>
        </div>

        {status === 'manual' ? (
          <>
            <p className="muted">This reset page must be opened from the newest email link.</p>
            <div className="button-row">
              <button type="button" className="ghost-btn" onClick={handleCancel}>Back to profile</button>
            </div>
          </>
        ) : null}

        {status === 'ready' ? (
          <>
            <p>Continue to verify this one-time reset request.</p>
            <div className="button-row">
              <button type="button" className="primary-btn" onClick={() => void handleContinue()}>
                Continue to reset password
              </button>
              <button type="button" className="ghost-btn" onClick={handleCancel}>Cancel</button>
            </div>
          </>
        ) : null}

        {status === 'verifying' ? (
          <>
            <p className="muted">Verifying reset request…</p>
            <div className="button-row">
              <button type="button" className="primary-btn" disabled>Continue to reset password</button>
              <button type="button" className="ghost-btn" disabled>Cancel</button>
            </div>
          </>
        ) : null}

        {status === 'invalid' ? (
          <>
            <p className="muted">{INVALID_RESET_LINK_MESSAGE}</p>
            <div className="button-row">
              <button type="button" className="ghost-btn" onClick={handleCancel}>Back to profile</button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
