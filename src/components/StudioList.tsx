import { useEffect, useState } from 'react';
import StudioList from '../components/StudioList';
import { api, type GenerationJob } from '../lib/api';

export default function StudioPage() {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [status, setStatus] = useState('Loading studio…');

  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      try {
        const result = await api.listGenerationJobs();
        if (cancelled) return;
        setJobs(result.jobs);
        setStatus(result.jobs.length ? '' : 'No jobs yet');
      } catch (error) {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : 'Unable to load studio');
      }
    }

    void loadJobs();
    const interval = window.setInterval(loadJobs, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="page">
      <section className="headline-card">
        <div>
          <span className="eyebrow">projects</span>
          <h2>Your content factory</h2>
        </div>
        <p>Everything in one place: drafts, renders, queued exports, and published concepts.</p>
      </section>
      {status ? <p className="muted">{status}</p> : null}
      <StudioList jobs={jobs} />
    </div>
  );
}
