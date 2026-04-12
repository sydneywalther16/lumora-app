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
      {jobs.map((job) => (
        <article className="list-card" key={job.id}>
          <div className="row-between">
            <h3>{job.title}</h3>
            <span className={`tiny-pill status-${formatStatus(job.status).toLowerCase()}`}>
              {formatStatus(job.status)}
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
            <button type="button" className="text-btn" disabled>
              {job.resultAssetUrl ? 'Ready' : 'Processing'}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
