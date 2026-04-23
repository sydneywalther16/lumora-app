import { useState } from 'react';
import type { GenerationJob } from '../lib/api';

type Props = {
  jobs: GenerationJob[];
};

function formatStatus(status: string) {
  if (status === 'queued-demo') return 'Queued';
  if (status === 'processing') return 'Rendering';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  return status;
}

function formatUpdated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export default function StudioList({ jobs }: Props) {
  const [selectedJob, setSelectedJob] = useState<GenerationJob | null>(null);

  if (!jobs.length) {
    return (
      <section className="list-stack">
        <article className="list-card">
          <div className="row-between">
            <h3>No projects yet</h3>
            <span className="tiny-pill status-drafting">Ready</span>
          </div>
          <p>Your generated concepts will appear here once you queue one from Create.</p>
        </article>
      </section>
    );
  }

  return (
    <>
      <section className="list-stack">
        {jobs.map((job) => {
          const statusLabel = formatStatus(job.status);

          return (
            <article className="list-card" key={job.id}>
              {job.resultAssetUrl ? (
                <button
                  type="button"
                  onClick={() => setSelectedJob(job)}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginBottom: '12px',
                    padding: 0,
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <img
                    src={job.resultAssetUrl}
                    alt={job.title}
                    style={{
                      width: '100%',
                      height: '220px',
                      objectFit: 'cover',
                      borderRadius: '16px',
                      display: 'block',
                    }}
                  />
                </button>
              ) : null}

              <div className="row-between">
                <h3>{job.title}</h3>
                <span className={`tiny-pill status-${statusLabel.toLowerCase()}`}>
                  {statusLabel}
                </span>
              </div>

              <p>
                {job.errorMessage
                  ? job.errorMessage
                  : job.resultAssetUrl
                  ? 'Your concept has finished processing and is ready for the next step.'
                  : 'Smart clips, AI sequences, and export variations are processing.'}
              </p>

              <div className="row-between muted-line">
                <span>Updated {formatUpdated(job.updatedAt)}</span>

                <div style={{ display: 'flex', gap: '10px' }}>
                  {job.resultAssetUrl ? (
                    <>
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => setSelectedJob(job)}
                      >
                        Open
                      </button>

                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => {
                          localStorage.setItem('remixPrompt', job.prompt || job.title || '');
                          localStorage.setItem(
                            'remixTitle',
                            `Remix of ${job.title || 'Untitled concept'}`
                          );
                          window.location.href = 'https://lumora-app-topaz.vercel.app/create';
                        }}
                      >
                        Remix
                      </button>
                    </>
                  ) : (
                    <button type="button" className="text-btn" disabled>
                      Processing
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {/* 🔥 MODAL VIEWER */}
      {selectedJob ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedJob(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '18px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(920px, 100%)',
              maxHeight: '92vh',
              overflow: 'auto',
              borderRadius: '24px',
              background: '#141018',
              boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
              padding: '18px',
              color: 'white',
            }}
          >
            <div className="row-between" style={{ marginBottom: '14px' }}>
              <div>
                <span className="eyebrow">concept preview</span>
                <h2 style={{ margin: '4px 0 0' }}>{selectedJob.title}</h2>
              </div>

              <button
                type="button"
                className="text-btn"
                onClick={() => setSelectedJob(null)}
              >
                Close
              </button>
            </div>

            {selectedJob.resultAssetUrl ? (
              <img
                src={selectedJob.resultAssetUrl}
                alt={selectedJob.title}
                style={{
                  width: '100%',
                  maxHeight: '62vh',
                  objectFit: 'contain',
                  borderRadius: '18px',
                  display: 'block',
                  background: '#000',
                }}
              />
            ) : null}

            <p style={{ marginTop: '14px', opacity: 0.8 }}>
              {selectedJob.prompt || 'No prompt saved for this concept yet.'}
            </p>

            {/* 🚀 ACTION BAR */}
            <div
              style={{
                display: 'flex',
                gap: '10px',
                marginTop: '16px',
                flexWrap: 'wrap',
              }}
            >
              {/* PRIMARY */}
              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  alert('Posted! (next step: real feed 👀)');
                }}
              >
                Post
              </button>

              {/* Remix */}
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  localStorage.setItem('remixPrompt', selectedJob.prompt || selectedJob.title || '');
                  localStorage.setItem(
                    'remixTitle',
                    `Remix of ${selectedJob.title || 'Untitled concept'}`
                  );
                  window.location.href = 'https://lumora-app-topaz.vercel.app/create';
                }}
              >
                Remix This
              </button>

              {/* Download */}
              <a
                href={selectedJob.resultAssetUrl || '#'}
                download
                className="ghost-btn"
              >
                Download
              </a>

              {/* Share */}
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  if (selectedJob.resultAssetUrl) {
                    navigator.clipboard.writeText(selectedJob.resultAssetUrl);
                    alert('Link copied ✨');
                  }
                }}
              >
                Share
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
