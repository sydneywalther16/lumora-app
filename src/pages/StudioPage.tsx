import { useEffect, useState } from 'react';
import StudioList from '../components/StudioList';
import { type GenerationJob } from '../lib/api';
import { loadStudioProjects, type StudioProject } from '../lib/projectStorage';
import { useSession } from '../hooks/useSession';
import { loadSupabaseProjects } from '../lib/supabaseAppData';

export default function StudioPage() {
  const { user } = useSession();
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [status, setStatus] = useState('Loading studio...');

  useEffect(() => {
    let active = true;

    async function loadJobs() {
      try {
        const projects = user
          ? await loadSupabaseProjects(user.id)
          : loadStudioProjects();
        if (!active) return;
        const mappedJobs = mapProjectsToJobs(projects);
        setJobs(mappedJobs);
        setStatus(mappedJobs.length ? '' : 'No projects yet');
      } catch (error) {
        if (!active) return;
        setJobs([]);
        setStatus(error instanceof Error ? error.message : 'Unable to load studio projects.');
      }
    }

    void loadJobs();

    return () => {
      active = false;
    };
  }, [user]);

  function mapProjectsToJobs(projects: StudioProject[]): GenerationJob[] {
    return projects.map((project) => ({
      id: project.id,
      projectId: project.id,
      characterId: project.characterId,
      characterName: project.characterName,
      characterAvatar: project.characterAvatar ?? null,
      isDefaultSelfCharacter: Boolean(project.isDefaultSelfCharacter),
      creatorName: project.creatorName ?? null,
      creatorUsername: project.creatorUsername ?? null,
      creatorAvatar: project.creatorAvatar ?? null,
      title:
        project.title ||
        (project.isDefaultSelfCharacter
          ? 'Created as self'
          : project.characterName
            ? `Character: ${project.characterName}`
            : 'Generated video'),
      prompt: project.prompt,
      status: project.status,
      outputType: 'video',
      provider: project.provider,
      durationSeconds: null,
      aspectRatio: null,
      privacy: 'private',
      resultAssetUrl: project.videoUrl,
      errorMessage: null,
      createdAt: project.createdAt,
      updatedAt: project.createdAt,
    }));
  }

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
