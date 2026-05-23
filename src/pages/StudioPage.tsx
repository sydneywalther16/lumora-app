import { useEffect, useState } from 'react';
import StudioList from '../components/StudioList';
import { type GenerationJob, type VideoEngine } from '../lib/api';
import { isUnpublishedDraftProject, loadStudioProjects, type StudioProject } from '../lib/projectStorage';
import { useSession } from '../hooks/useSession';
import { listDrafts } from '../lib/supabaseAppData';
import { resolveGeneratedVideoMedia } from '../lib/mediaThumbnail';

const characterProfilesMigrationWarning = 'Cast needs the latest Lumora update.';

function shouldShowMockDraftStates() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('mockStates') === '1' || params.get('mockVideoNoPoster') === '1';
}

function mockDraftJobs(): GenerationJob[] {
  const now = new Date().toISOString();
  const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const mockVideoNoPoster = params.get('mockVideoNoPoster') === '1';
  const videoUrl = mockVideoNoPoster
    ? 'https://replicate.delivery/pbxt/generated-garden.mp4'
    : '/demo-placeholder.jpg';
  const referenceUrl = '/demo-placeholder.jpg';
  return [
    {
      id: 'mock-focused-completed-draft',
      projectId: 'mock-focused-completed-draft',
      characterId: 'mock-cast',
      characterName: 'Cinematic self',
      characterAvatar: '/demo-placeholder.jpg',
      isDefaultSelfCharacter: true,
      creatorName: 'Lumora Creator',
      creatorUsername: 'lumora.creator',
      creatorAvatar: null,
      title: 'Sunlit garden moment',
      caption: 'A quiet cinematic scene ready to continue.',
      prompt: 'The cast character walks through a sunlit garden with peaceful movement and soft cinematic light.',
      status: 'completed',
      outputType: 'video',
      provider: 'mock',
      displayEngine: null,
      durationSeconds: 4,
      aspectRatio: '9:16',
      privacy: 'private',
      resultAssetUrl: videoUrl,
      thumbnailUrl: mockVideoNoPoster ? referenceUrl : '/demo-placeholder.jpg',
      posterUrl: mockVideoNoPoster ? null : '/demo-placeholder.jpg',
      referenceImageUrl: referenceUrl,
      referenceImageUrls: null,
      additionalReferenceImageUrls: null,
      generationMode: 'seedance-multimodal-reference',
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

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
      if (shouldShowMockDraftStates()) {
        setJobs(mockDraftJobs());
        setStatus('');
        return;
      }

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
        setStatus(mappedJobs.length ? '' : 'Your cinematic scenes will appear here.');
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
    return projects.map((project) => {
      const generatedMedia = resolveGeneratedVideoMedia(project);
      return {
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
            ? 'Soft self guidance'
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
        thumbnailUrl: generatedMedia.thumbnailUrl,
        posterUrl: generatedMedia.posterUrl,
        thumbnailSource: generatedMedia.thumbnailSource,
        referenceImageUrl: project.referenceImageUrl ?? null,
        referenceImageUrls: project.referenceImageUrls ?? null,
        additionalReferenceImageUrls: project.additionalReferenceImageUrls ?? null,
        generationMode: project.generationMode ?? null,
        errorMessage: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt ?? project.createdAt,
      };
    });
  }

  return (
    <div className="page lumora-page">
      <section className="headline-card lumora-card lumora-card-hero luxury-page-hero drafts-workbench-hero">
        <div>
          <span className="eyebrow">drafts</span>
          <h2>Your cinematic workbench</h2>
        </div>
        <p>Private scenes, active renders, and paused moments gather here until they are ready to join your profile.</p>
      </section>
      {status ? <p className="muted">{status}</p> : null}
      <StudioList
        jobs={jobs}
        onPublished={(jobId) => {
          setJobs((current) => {
            const nextJobs = current.filter((job) => job.id !== jobId && job.projectId !== jobId);
            setStatus(nextJobs.length ? '' : 'Your cinematic scenes will appear here.');
            return nextJobs;
          });
        }}
      />
    </div>
  );
}
