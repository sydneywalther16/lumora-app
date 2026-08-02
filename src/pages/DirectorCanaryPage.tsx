import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { CREATOR_PROGRESS_STEPS } from '../lib/createExperience';
import {
  api,
  type DirectorCanaryStatusResponse,
} from '../lib/api';
import {
  canStartDirectorCanary,
  formatDirectorCanaryCountdown,
  remainingDirectorCanarySeconds,
  synchronizedDirectorCanaryRunState,
  type DirectorCanaryRunState,
} from '../lib/directorCanaryStatus';
import { useSession } from '../hooks/useSession';

const DIRECTOR_CANARY_SCENE =
  'She walks through a candlelit mansion and pauses after hearing a sound behind her.';

export default function DirectorCanaryPage() {
  const { authReady, configured, session } = useSession();
  const startedRef = useRef(false);
  const runStateRef = useRef<DirectorCanaryRunState>('checking');
  const statusRequestRef = useRef<Promise<DirectorCanaryStatusResponse> | null>(null);
  const [runState, setRunState] = useState<DirectorCanaryRunState>('checking');
  const [progressIndex, setProgressIndex] = useState(0);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [videoRecovery, setVideoRecovery] = useState(false);

  const isNative = Capacitor.isNativePlatform();
  const sessionUserId = session?.user.id ?? null;
  const canRun =
    !isNative &&
    configured &&
    authReady &&
    Boolean(sessionUserId) &&
    canStartDirectorCanary(runState, remainingSeconds);

  const updateRunState = useCallback((nextState: DirectorCanaryRunState) => {
    runStateRef.current = nextState;
    setRunState(nextState);
  }, []);

  const requestAuthorizationStatus = useCallback(async (fresh = false) => {
    if (fresh && statusRequestRef.current) {
      await statusRequestRef.current.catch(() => undefined);
    }
    if (statusRequestRef.current) return statusRequestRef.current;

    const request = api.getDirectorCanaryStatus();
    statusRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (statusRequestRef.current === request) statusRequestRef.current = null;
    }
  }, []);

  const applyAuthorizationStatus = useCallback((status: DirectorCanaryStatusResponse) => {
    setVideoRecovery(status.recovery === true);
    if (status.state === 'ready' && status.expiresInSeconds > 0) {
      startedRef.current = false;
      const nextRemaining = Math.max(0, Math.floor(status.expiresInSeconds));
      setRemainingSeconds(nextRemaining);
      setExpiresAt(Date.now() + nextRemaining * 1_000);
      updateRunState('ready');
      return;
    }

    setRemainingSeconds(0);
    setExpiresAt(null);
    updateRunState(synchronizedDirectorCanaryRunState(runStateRef.current, status));
  }, [updateRunState]);

  const refreshAuthorizationStatus = useCallback(async (showChecking: boolean) => {
    if (showChecking) updateRunState('checking');
    try {
      applyAuthorizationStatus(await requestAuthorizationStatus());
    } catch {
      setRemainingSeconds(0);
      setExpiresAt(null);
      updateRunState('failed');
    }
  }, [applyAuthorizationStatus, requestAuthorizationStatus, updateRunState]);

  useEffect(() => {
    if (isNative || !configured || !authReady || !sessionUserId) return;

    void refreshAuthorizationStatus(true);

    const refreshIfIdle = () => {
      if (runStateRef.current !== 'running') void refreshAuthorizationStatus(false);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshIfIdle();
    };
    const intervalId = window.setInterval(refreshIfIdle, 10_000);
    window.addEventListener('focus', refreshIfIdle);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshIfIdle);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [authReady, configured, isNative, refreshAuthorizationStatus, sessionUserId]);

  useEffect(() => {
    if (runState !== 'ready' || expiresAt === null) return;

    const updateCountdown = () => {
      const nextRemaining = remainingDirectorCanarySeconds(expiresAt);
      setRemainingSeconds(nextRemaining);
      if (nextRemaining === 0) {
        startedRef.current = false;
        setExpiresAt(null);
        updateRunState('expired');
      }
    };

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 1_000);
    return () => window.clearInterval(intervalId);
  }, [expiresAt, runState, updateRunState]);

  async function runOneCanary() {
    if (!canRun || startedRef.current) return;
    startedRef.current = true;
    updateRunState('checking');

    let finalStatus: DirectorCanaryStatusResponse;
    try {
      finalStatus = await requestAuthorizationStatus(true);
    } catch {
      updateRunState('failed');
      return;
    }
    if (finalStatus.state !== 'ready' || finalStatus.expiresInSeconds <= 0) {
      applyAuthorizationStatus(finalStatus);
      return;
    }

    setRemainingSeconds(Math.floor(finalStatus.expiresInSeconds));
    setExpiresAt(Date.now() + finalStatus.expiresInSeconds * 1_000);
    updateRunState('running');
    setProgressIndex(0);

    const progressTimer = window.setInterval(() => {
      setProgressIndex((current) => Math.min(current + 1, CREATOR_PROGRESS_STEPS.length - 1));
    }, 12_000);

    try {
      const result = await api.runDirectorCanary();
      updateRunState(result.status === 'completed' && result.draftSaved ? 'completed' : 'failed');
    } catch {
      updateRunState('failed');
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  let statusMessage = 'Checking one-time authorization…';
  if (isNative) statusMessage = 'This temporary check is available on the Lumora website only.';
  else if (!configured) statusMessage = 'Lumora account services are not configured.';
  else if (!authReady) statusMessage = 'Restoring your Lumora session.';
  else if (!session) statusMessage = 'Sign in to Lumora before opening this page.';
  else if (runState === 'ready' && videoRecovery) statusMessage = 'Ready to continue the stored scene.';
  else if (runState === 'ready') statusMessage = 'Ready for one signed-in, one-time Director canary.';
  else if (runState === 'missing') statusMessage = 'No active one-time authorization.';
  else if (runState === 'expired') statusMessage = 'This one-time authorization expired.';
  else if (runState === 'running') statusMessage = CREATOR_PROGRESS_STEPS[progressIndex];
  else if (runState === 'completed') statusMessage = 'Scene completed and saved to Drafts.';
  else if (runState === 'failed') statusMessage = 'The one-time canary did not complete. Your scene remains safe.';
  else if (runState === 'blocked_multiple') statusMessage = 'The one-time authorization is unavailable.';

  return (
    <div className="page lumora-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">internal verification</span>
          <h2>Director canary</h2>
        </div>
        <p>This page runs one guarded production check for the signed-in Lumora account.</p>
      </section>

      <section className="editor-card lumora-card">
        <span className="eyebrow">scene</span>
        <p className="prompt-copy">{DIRECTOR_CANARY_SCENE}</p>
        <p className="muted">
          Maximum authorized spend: ${videoRecovery ? '1.00' : '2.00'} · one attempt · no retries
        </p>
      </section>

      <section className="editor-card lumora-card" aria-live="polite">
        <span className="eyebrow">status</span>
        <p>{statusMessage}</p>
        {runState === 'ready' ? (
          <p className="muted">Authorization expires in {formatDirectorCanaryCountdown(remainingSeconds)}</p>
        ) : null}
        <div className="button-row">
          <button
            className="primary-btn"
            type="button"
            disabled={!canRun}
            onClick={() => void runOneCanary()}
          >
            Run one Director canary
          </button>
        </div>
      </section>
    </div>
  );
}
