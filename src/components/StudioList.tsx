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
    <section className="list-stack">
      {jobs.map((job) => {
        const label = job.resultAssetUrl ? 'Open concept' : 'Processing';
        const statusLabel = formatStatus(job.status);

        return (
          <article className="list-card" key={job.id}>
            {job.resultAssetUrl ? (
              <a
                href={job.resultAssetUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'block', marginBottom: '12px' }}
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
              </a>
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

              {job.resultAssetUrl ? (
                <a
                  href={job.resultAssetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-btn"
                >
                  {label}
                </a>
              ) : (
                <button type="button" className="text-btn" disabled>
                  {label}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
