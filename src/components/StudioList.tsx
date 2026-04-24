import { useState } from 'react';
import type { GenerationJob } from '../lib/api';

type Props = {
  jobs: GenerationJob[];
};

export default function StudioList({ jobs }: Props) {
  const [selectedJob, setSelectedJob] = useState<GenerationJob | null>(null);

  function handlePost(job: GenerationJob) {
    const existing = JSON.parse(localStorage.getItem('lumoraPosts') || '[]');

    const newPost = {
      id: job.id,
      title: job.title,
      prompt: job.prompt,
      imageUrl: job.resultAssetUrl,
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem('lumoraPosts', JSON.stringify([newPost, ...existing]));

    alert('Posted to your Lumora feed ✨');
    window.location.assign('/home');
  }

  return (
    <>
      <section className="list-stack">
        {jobs.map((job) => (
          <article className="list-card" key={job.id}>
            {job.resultAssetUrl && (
              <button
                onClick={() => setSelectedJob(job)}
                style={{ border: 0, background: 'transparent' }}
              >
                <img
                  src={job.resultAssetUrl}
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
              <span className="tiny-pill">Completed</span>
            </div>
          </article>
        ))}
      </section>

      {selectedJob && (
        <div
          onClick={() => setSelectedJob(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#141018',
              padding: '20px',
              borderRadius: '20px',
              width: '90%',
              maxWidth: '800px',
            }}
          >
            <h2>{selectedJob.title}</h2>

            <img
              src={selectedJob.resultAssetUrl || ''}
              style={{ width: '100%', borderRadius: '16px' }}
            />

            <p>{selectedJob.prompt}</p>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button className="primary-btn" onClick={() => handlePost(selectedJob)}>
                Post
              </button>

              <button className="ghost-btn">Remix This</button>

              <a href={selectedJob.resultAssetUrl || '#'} download className="ghost-btn">
                Download
              </a>

              <button className="ghost-btn">Share</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
