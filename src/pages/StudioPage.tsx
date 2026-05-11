import { useEffect, useState } from 'react';
import StudioList from '../components/StudioList';
import { type GenerationJob, type LumoraPost, type VideoEngine } from '../lib/api';
import { loadStudioProjects, type StudioProject } from '../lib/projectStorage';
import { useSession } from '../hooks/useSession';
import { loadSupabaseProfilePosts, loadSupabaseProjects } from '../lib/supabaseAppData';

export default function StudioPage() {
  const { user, session, loading, configured } = useSession();
  const authUser = session?.user ?? user;
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [status, setStatus] = useState('Loading studio...');

  useEffect(() => {
    console.info('STUDIO OK');
  }, []);

  useEffect(() => {
    let active = true;

    async function loadJobs() {
      if (configured && loading && !authUser) {
        setStatus('Loading studio...');
        return;
      }

      try {
        const localProjects = loadStudioProjects();
        const projects = authUser
          ? mergeProjects(
              await loadSupabaseProjects(authUser.id),
              mapPostsToProjects(await loadSupabaseProfilePosts(authUser.id)),
              localProjects,
            )
          : localProjects;
        if (!active) return;
        const mappedJobs = mapProjectsToJobs(projects);
        setJobs(mappedJobs);
        setStatus(mappedJobs.length ? '' : 'No projects yet');
      } catch (error) {
        if (!active) return;
        const fallbackJobs = mapProjectsToJobs(loadStudioProjects());
        setJobs(fallbackJobs);
        setStatus(
          fallbackJobs.length
            ? 'Showing local Studio backups while account projects are unavailable.'
            : error instanceof Error ? error.message : 'Unable to load studio projects.',
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

  function mapPostsToProjects(posts: LumoraPost[]): StudioProject[] {
    return posts
      .filter((post) => Boolean(post.videoUrl))
      .map((post) => ({
        id: post.sourceGenerationId || post.id,
        title: post.title ?? 'Posted video',
        caption: post.caption ?? post.prompt ?? '',
        prompt: post.prompt ?? post.caption ?? '',
        finalPrompt: post.prompt ?? null,
        videoUrl: post.videoUrl ?? '',
        thumbnailUrl: post.imageUrl ?? post.videoUrl ?? null,
        status: post.status || 'completed',
        provider: (post.provider || 'replicate') as VideoEngine,
        engine: (post.provider || 'replicate') as VideoEngine,
        displayEngine: post.provider ?? null,
        characterId: post.characterId ?? null,
        characterName: post.characterName ?? null,
        characterAvatar: post.characterAvatar ?? null,
        isDefaultSelfCharacter: post.isDefaultSelfCharacter ?? false,
        creatorName: post.creatorName ?? post.displayName ?? null,
        creatorUsername: post.creatorUsername ?? post.username ?? null,
        creatorAvatar: post.creatorAvatar ?? post.avatar ?? null,
        createdAt: post.createdAt,
        updatedAt: post.createdAt,
      }));
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
