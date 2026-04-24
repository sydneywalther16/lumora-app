import { useState } from 'react';
import type { GenerationJob } from '../lib/api';

type Props = {
  jobs: GenerationJob[];
};

type LumoraPost = {
  id: string;
  title: string;
  prompt?: string;
  imageUrl?: string | null;
  createdAt: string;
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

function getStoredPosts(): LumoraPost[] {
  try {
    const saved = JSON.parse(localStorage.getItem('lumoraPosts') || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export default function StudioList({ jobs }: Props) {
  const [selectedJob, setSelectedJob] = useState<GenerationJob | null>(null);
  const [postedIds, setPostedIds] = useState<string[]>(
    getStoredPosts().map((p) => p.id)
  );

  function isPosted(id: string) {
    return postedIds.includes(id);
  }

  function postToFeed(job: GenerationJob) {
    const existingPosts = getStoredPosts();

    const alreadyPosted = existingPosts.some((post) => post.id === job.id);

    const newPost: LumoraPost = {
      id: job.id,
      title: job.title,
      prompt: job.prompt,
      imageUrl: job.resultAssetUrl || null,
      createdAt: new Date().toISOString(),
    };

    const updatedPosts = alreadyPosted
      ? existingPosts
      : [newPost, ...existingPosts];

    localStorage.setItem('lumoraPosts', JSON.stringify(updatedPosts));

    setPostedIds(updatedPosts.map((p) => p.id));

    window.dispatchEvent(new Event('lumoraPostsUpdated'));

    alert(alreadyPosted ? 'Already posted ✨' : 'Posted to your Lumora feed ✨');
  }

  async function shareAsset(job: GenerationJob) {
    if (!job.resultAssetUrl) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: job.title || 'Lumora concept',
          text: job.prompt || '',
          url: job.resultAssetUrl,
        });
        return;
      } catch {}
    }

    navigator.clipboard.writeText(job.resultAssetUrl);
    alert('Link copied ✨');
  }

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
              {job.resultAssetUrl && (
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
                    }}
                  />
                </button>
              )}

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
                          window.location.href = '/create';
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

      {selectedJob && (
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
            onClick={(e) => e.stopPropagation()}
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
                <h2>{selectedJob.title}</h2>
              </div>

              <button className="text-btn" onClick={() => setSelectedJob(null)}>
                Close
              </button>
            </div>

            {selectedJob.resultAssetUrl && (
              <img
                src={selectedJob.resultAssetUrl}
                alt={selectedJob.title}
                style={{
                  width: '100%',
                  maxHeight: '62vh',
                  objectFit: 'contain',
                  borderRadius: '18px',
                  background: '#000',
                }}
              />
            )}

            <p style={{ marginTop: '14px', opacity: 0.8 }}>
              {selectedJob.prompt || 'No prompt saved for this concept yet.'}
            </p>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
              
              <button
                className="primary-btn"
                onClick={() => postToFeed(selectedJob)}
                disabled={isPosted(selectedJob.id)}
              >
                {isPosted(selectedJob.id) ? 'Posted' : 'Post'}
              </button>

              <button
                className="ghost-btn"
                onClick={() => {
                  localStorage.setItem('remixPrompt', selectedJob.prompt || selectedJob.title || '');
                  localStorage.setItem(
                    'remixTitle',
                    `Remix of ${selectedJob.title || 'Untitled concept'}`
                  );
                  window.location.href = '/create';
                }}
              >
                Remix This
              </button>

              <a
                href={selectedJob.resultAssetUrl || '#'}
                download
                className="ghost-btn"
              >
                Download
              </a>

              <button
                className="ghost-btn"
                onClick={() => shareAsset(selectedJob)}
              >
                Share
              </button>

            </div>
          </div>
        </div>
      )}
    </>
  );
}
