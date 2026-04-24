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
  if (status === 'queued' || status === 'queued-demo') return 'Queued';
  if (status === 'processing') return 'Rendering';
  if (status === 'completed') return 'Done';
  return status;
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
  const [postedJobIds, setPostedJobIds] = useState<string[]>(
    () => getStoredPosts().map((post) => post.id)
  );

  function isPosted(jobId: string) {
    return postedJobIds.includes(jobId);
  }

  function postToFeed(job: GenerationJob) {
    const existingPosts = getStoredPosts();

    const alreadyPosted = existingPosts.some((post) => post.id === job.id);

    const newPost: LumoraPost = {
      id: job.id,
      title: job.title || 'Untitled concept',
      prompt: job.prompt,
      imageUrl: job.resultAssetUrl || null,
      createdAt: new Date().toISOString(),
    };

    const updatedPosts = alreadyPosted
      ? existingPosts
      : [newPost, ...existingPosts];

    localStorage.setItem('lumoraPosts', JSON.stringify(updatedPosts));

    setPostedJobIds(updatedPosts.map((post) => post.id));

    window.dispatchEvent(new Event('lumoraPostsUpdated'));

    alert(alreadyPosted ? 'Already posted ✨' : 'Posted to your Lumora feed ✨');
  }

  async function shareAsset(job: GenerationJob) {
    if (!job.resultAssetUrl) return;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: job.title || 'Lumora concept',
          text: job.prompt || undefined,
          url: job.resultAssetUrl,
        });
        return;
      } catch {
        // fallback
      }
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(job.resultAssetUrl);
      alert('Link copied ✨');
      return;
    }

    alert(job.resultAssetUrl);
  }

  if (!jobs.length) {
    return (
      <section className="list-stack">
        <p>No generations yet.</p>
      </section>
    );
  }

  return (
    <>
      <section className="list-stack">
        {jobs.map((job) => (
          <article
            key={job.id}
            className="list-card"
            onClick={() => setSelectedJob(job)}
            style={{ cursor: 'pointer' }}
          >
            {job.resultAssetUrl && (
              <img
                src={job.resultAssetUrl}
                alt={job.title}
                style={{
                  width: '100%',
                  height: '260px',
                  objectFit: 'cover',
                  borderRadius: '16px',
                  marginBottom: '10px',
                }}
              />
            )}

            <div className="row-between">
              <h3>{job.title || 'Untitled concept'}</h3>
              <span className="tiny-pill">{formatStatus(job.status)}</span>
            </div>
          </article>
        ))}
      </section>

      {selectedJob && (
        <div className="modal-overlay" onClick={() => setSelectedJob(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            {selectedJob.resultAssetUrl && (
              <img
                src={selectedJob.resultAssetUrl}
                alt={selectedJob.title}
                style={{
                  width: '100%',
                  borderRadius: '16px',
                  marginBottom: '16px',
                }}
              />
            )}

            <h2>{selectedJob.title || 'Untitled concept'}</h2>
            <p style={{ opacity: 0.8 }}>{selectedJob.prompt}</p>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                marginTop: '16px',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="primary-btn"
                onClick={() => postToFeed(selectedJob)}
                disabled={isPosted(selectedJob.id)}
              >
                {isPosted(selectedJob.id) ? 'Posted' : 'Post'}
              </button>

              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  localStorage.setItem(
                    'remixPrompt',
                    selectedJob.prompt || selectedJob.title || ''
                  );
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
                type="button"
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
