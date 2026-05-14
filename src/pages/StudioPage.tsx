import { useEffect, useState } from 'react';
import StudioList from '../components/StudioList';
import { type GenerationJob, type VideoEngine } from '../lib/api';
import { isUnpublishedDraftProject, loadStudioProjects, type StudioProject } from '../lib/projectStorage';
import { useSession } from '../hooks/useSession';
import { listDrafts } from '../lib/supabaseAppData';
import { getBestPoster, getBestThumbnail } from '../lib/mediaThumbnail';

const characterProfilesMigrationWarning = 'Character Profiles need the latest database migration.';

function studioLoadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('character_id')) {
    return characterProfilesMigrationWarning;
  }

  return error instanceof Error ? error.message : 'Unable to load drafts.';
}

export default function StudioPage() {
  const { user, session, loading, configured } = useSession();
  const authUser = session?.user ?? user;
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [status, setStatus] = useState('Loading drafts...');

  useEffect(() => {
    console.info('STUDIO OK');
  }, []);

  useEffect(() => {
    let active = true;

    async function loadJobs() {
      if (configured && loading && !authUser) {
        setStatus('Loading drafts...');
        return;
      }

      try {
        const localProjects = loadStudioProjects().filter(isUnpublishedDraftProject);
        const projects = authUser
          ? mergeProjects(
              await listDrafts(authUser.id),
              localProjects,
            )
          : localProjects;
        if (!active) return;
        const mappedJobs = mapProjectsToJobs(projects);
        setJobs(mappedJobs);
        setStatus(mappedJobs.length ? '' : 'No drafts yet');
      } catch (error) {
        if (!active) return;
        const fallbackJobs = mapProjectsToJobs(loadStudioProjects().filter(isUnpublishedDraftProject));
        setJobs(fallbackJobs);
        setStatus(
          fallbackJobs.length
            ? 'Showing local Draft backups while account drafts are unavailable.'
            : studioLoadErrorMessage(error),
        );
      }
    }

    void loadJobs();

    return () => {
      active = false;
    };
  }, [authUser, configured, loading]);

  function mergeProjects(...groups: StudioProject[][]): StudioProject[] {
    const seen = new Set<string>();
    return groups
      .flat()
      .filter((project) => {
        if (!project.id || seen.has(project.id)) return false;
        seen.add(project.id);
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
  }

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
      caption: project.caption || project.prompt || '',
      prompt: project.prompt,
      status: project.status,
      outputType: 'video',
      provider: project.provider,
      displayEngine: project.displayEngine ?? null,
      durationSeconds: null,
      aspectRatio: project.aspectRatio ?? null,
      privacy: 'private',
      resultAssetUrl: project.videoUrl,
      thumbnailUrl: getBestThumbnail(project),
      posterUrl: getBestPoster(project),
      referenceImageUrl: project.referenceImageUrl ?? null,
      referenceImageUrls: project.referenceImageUrls ?? null,
      additionalReferenceImageUrls: project.additionalReferenceImageUrls ?? null,
      generationMode: project.generationMode ?? null,
      errorMessage: null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt ?? project.createdAt,
    }));
  }

  return (
    <div className="page">
      <section className="headline-card">
        <div>
          <span className="eyebrow">drafts</span>
          <h2>Unpublished drafts</h2>
        </div>
        <p>Review unpublished renders, post them to your profile, or remix before they go live.</p>
      </section>
      {status ? <p className="muted">{status}</p> : null}
      <StudioList
        jobs={jobs}
        onPublished={(jobId) => {
          setJobs((current) => {
            const nextJobs = current.filter((job) => job.id !== jobId && job.projectId !== jobId);
            setStatus(nextJobs.length ? '' : 'No drafts yet');
            return nextJobs;
          });
        }}
      />
    </div>
  );
}
