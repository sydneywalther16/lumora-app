import { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { CREATOR_PROGRESS_STEPS } from '../lib/createExperience';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';

const DIRECTOR_CANARY_SCENE =
  'She walks through a candlelit mansion and pauses after hearing a sound behind her.';

type RunState = 'ready' | 'running' | 'completed' | 'failed';

export default function DirectorCanaryPage() {
  const { authReady, configured, session } = useSession();
  const startedRef = useRef(false);
  const [runState, setRunState] = useState<RunState>('ready');
  const [progressIndex, setProgressIndex] = useState(0);

  const isNative = Capacitor.isNativePlatform();
  const canRun = !isNative && configured && authReady && Boolean(session) && runState === 'ready';

  async function runOneCanary() {
    if (!canRun || startedRef.current) return;
    startedRef.current = true;
    setRunState('running');
    setProgressIndex(0);

    const progressTimer = window.setInterval(() => {
      setProgressIndex((current) => Math.min(current + 1, CREATOR_PROGRESS_STEPS.length - 1));
    }, 12_000);

    try {
      const result = await api.runDirectorCanary();
      setRunState(result.status === 'completed' && result.draftSaved ? 'completed' : 'failed');
    } catch {
      setRunState('failed');
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  let statusMessage = 'Ready for one signed-in, one-time Director canary.';
  if (isNative) statusMessage = 'This temporary check is available on the Lumora website only.';
  else if (!configured) statusMessage = 'Lumora account services are not configured.';
  else if (!authReady) statusMessage = 'Restoring your Lumora session.';
  else if (!session) statusMessage = 'Sign in to Lumora before opening this page.';
  else if (runState === 'running') statusMessage = CREATOR_PROGRESS_STEPS[progressIndex];
  else if (runState === 'completed') statusMessage = 'Scene completed and saved to Drafts.';
  else if (runState === 'failed') statusMessage = 'The one-time canary did not complete. Your scene remains safe.';

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
        <p className="muted">Maximum authorized spend: $2.00 · one attempt · no retries</p>
      </section>

      <section className="editor-card lumora-card" aria-live="polite">
        <span className="eyebrow">status</span>
        <p>{statusMessage}</p>
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
