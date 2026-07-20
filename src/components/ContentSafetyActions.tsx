import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  blockCreator,
  reportReasons,
  submitContentReport,
  type ReportReason,
} from '../lib/accountSafety';

type Props = {
  contentType: 'post' | 'generation';
  contentId: string;
  postId?: string | null;
  creatorUserId?: string | null;
  creatorLabel?: string | null;
  compact?: boolean;
  onBlocked?: (blockedUserId: string) => void;
  currentUserId?: string | null;
};

export default function ContentSafetyActions({
  contentType,
  contentId,
  postId,
  creatorUserId,
  creatorLabel,
  compact = false,
  onBlocked,
  currentUserId,
}: Props) {
  const [mode, setMode] = useState<'closed' | 'menu' | 'report' | 'block'>('closed');
  const [reason, setReason] = useState<ReportReason>('ai_safety');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canBlock = Boolean(creatorUserId && creatorUserId !== currentUserId);

  function requireSignIn() {
    if (currentUserId) return true;
    setMessage('Sign in to report content or block a creator.');
    setMode('menu');
    return false;
  }

  async function sendReport() {
    if (!requireSignIn()) return;
    setBusy(true);
    setMessage('');
    try {
      await submitContentReport({ contentType, contentId, postId, reason, details });
      setMessage('Report sent. Thank you for helping keep Lumora safe.');
      setMode('menu');
      setDetails('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The report could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmBlock() {
    if (!creatorUserId || !requireSignIn()) return;
    setBusy(true);
    setMessage('');
    try {
      await blockCreator(creatorUserId);
      setMessage(`${creatorLabel || 'This creator'} is blocked. Their content is now hidden.`);
      setMode('menu');
      onBlocked?.(creatorUserId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The creator could not be blocked.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'closed') {
    return (
      <button
        type="button"
        className={compact ? 'content-safety-trigger compact' : 'ghost-btn content-safety-trigger'}
        onClick={(event) => {
          event.stopPropagation();
          setMode('menu');
        }}
        aria-label="Content safety options"
      >
        {compact ? '•••' : 'Safety'}
      </button>
    );
  }

  return createPortal(
    <div className="content-safety-backdrop" onClick={() => setMode('closed')}>
      <div
        className="content-safety-popover"
        role="dialog"
        aria-modal="true"
        aria-label="Content safety options"
        onClick={(event) => event.stopPropagation()}
      >
      <div className="row-between" style={{ gap: '10px' }}>
        <strong>{mode === 'report' ? 'Report content' : mode === 'block' ? 'Block creator?' : 'Safety'}</strong>
        <button type="button" className="text-btn" onClick={() => setMode('closed')}>Close</button>
      </div>

      {mode === 'menu' ? (
        <div className="content-safety-menu">
          <button type="button" className="ghost-btn" onClick={() => requireSignIn() && setMode('report')}>Report content</button>
          {canBlock ? (
            <button type="button" className="ghost-btn" onClick={() => requireSignIn() && setMode('block')}>
              Block {creatorLabel || 'creator'}
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'report' ? (
        <div className="content-safety-form">
          <label className="field-block">
            <span>Reason</span>
            <select value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
              {reportReasons.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field-block">
            <span>Details (optional)</span>
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value.slice(0, 2000))}
              maxLength={2000}
              rows={3}
              placeholder="Do not include passwords or private links."
            />
          </label>
          <button type="button" className="primary-btn" onClick={() => void sendReport()} disabled={busy}>
            {busy ? 'Sending...' : 'Send report'}
          </button>
        </div>
      ) : null}

      {mode === 'block' ? (
        <div className="content-safety-form">
          <p className="muted" style={{ margin: 0 }}>
            You will stop seeing this creator's content. They are not notified. You can unblock them in Account settings.
          </p>
          <button type="button" className="danger-btn" onClick={() => void confirmBlock()} disabled={busy}>
            {busy ? 'Blocking...' : 'Confirm block'}
          </button>
        </div>
      ) : null}

        {message ? <p className="content-safety-message">{message}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
