import { useState } from 'react';
import { inboxThreads } from '../data/mockData';

export default function InboxPage() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const selectedThread = inboxThreads.find((thread) => thread.id === selectedThreadId) ?? null;

  return (
    <div className="page">
      <section className="headline-card">
        <div>
          <span className="eyebrow">communications</span>
          <h2>Collabs, alerts, and brand interest</h2>
        </div>
        <p>A clean inbox for creator ops, product notifications, and trend updates.</p>
      </section>
      <section className="list-stack">
        {inboxThreads.map((thread) => (
          <article
            className="list-card"
            key={thread.id}
            role="button"
            tabIndex={0}
            aria-label={`Open message from ${thread.from}: ${thread.subject}`}
            onClick={() => setSelectedThreadId(thread.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelectedThreadId(thread.id);
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <div className="row-between">
              <h3>{thread.subject}</h3>
              {thread.unread ? <span className="tiny-dot" /> : <span className="muted">Read</span>}
            </div>
            <strong className="subline">From: {thread.from}</strong>
            <p>{thread.preview}</p>
          </article>
        ))}
      </section>
      {selectedThread ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedThreadId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '18px',
            background: 'var(--modal-backdrop)',
          }}
        >
          <section
            className="headline-card"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(420px, 100%)',
              background: 'var(--modal-surface)',
              boxShadow: 'var(--modal-shadow)',
            }}
          >
            <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start' }}>
              <div>
                <span className="eyebrow">message</span>
                <h2 style={{ margin: '6px 0 0' }}>{selectedThread.subject}</h2>
              </div>
              <button type="button" className="text-btn" onClick={() => setSelectedThreadId(null)}>
                Close
              </button>
            </div>
            <p className="muted" style={{ marginTop: '12px' }}>
              From: {selectedThread.from}
            </p>
            <p>{selectedThread.preview}</p>
            <p className="muted">Reply tools are coming soon.</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
