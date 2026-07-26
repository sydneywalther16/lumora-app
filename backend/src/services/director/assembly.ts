export type DirectorAssemblyClip = {
  inputPath: string;
  trimStartSeconds?: number;
  trimDurationSeconds?: number;
};

export type DirectorAssemblyPlan = {
  executable: 'ffmpeg';
  args: string[];
  posterArgs: string[];
  features: {
    trimming: true;
    shotJoining: boolean;
    fades: boolean;
    audioNormalization: boolean;
    captions: boolean;
    posterExtraction: true;
  };
};

export function buildDirectorAssemblyPlan(input: {
  clips: DirectorAssemblyClip[];
  outputPath: string;
  posterPath: string;
  captionsPath?: string | null;
  fadeSeconds?: number;
  normalizeAudio?: boolean;
}): DirectorAssemblyPlan {
  if (!input.clips.length || input.clips.length > 3) {
    throw new Error('Director assembly requires between one and three clips.');
  }
  const fadeSeconds = Math.max(0, Math.min(input.fadeSeconds ?? 0.2, 1));
  const args: string[] = ['-y'];
  input.clips.forEach((clip) => {
    if (clip.trimStartSeconds) args.push('-ss', String(clip.trimStartSeconds));
    if (clip.trimDurationSeconds) args.push('-t', String(clip.trimDurationSeconds));
    args.push('-i', clip.inputPath);
  });

  const videoFilters = [
    ...(fadeSeconds > 0 ? [`fade=t=in:st=0:d=${fadeSeconds}`] : []),
    ...(input.captionsPath ? [`subtitles=${input.captionsPath}`] : []),
  ];
  const normalizeAudio = input.normalizeAudio !== false;

  if (input.clips.length > 1) {
    const videoInputs = input.clips.map((_, index) => `[${index}:v:0][${index}:a:0]`).join('');
    const graph = [`${videoInputs}concat=n=${input.clips.length}:v=1:a=1[vjoined][ajoined]`];
    if (videoFilters.length) graph.push(`[vjoined]${videoFilters.join(',')}[vout]`);
    if (normalizeAudio) graph.push('[ajoined]loudnorm=I=-16:LRA=11:TP=-1.5[aout]');
    args.push('-filter_complex', graph.join(';'));
    args.push(
      '-map',
      videoFilters.length ? '[vout]' : '[vjoined]',
      '-map',
      normalizeAudio ? '[aout]' : '[ajoined]',
    );
  } else {
    if (videoFilters.length) args.push('-vf', videoFilters.join(','));
    if (normalizeAudio) args.push('-af', 'loudnorm=I=-16:LRA=11:TP=-1.5');
  }
  args.push('-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', input.outputPath);

  return {
    executable: 'ffmpeg',
    args,
    posterArgs: ['-y', '-i', input.outputPath, '-frames:v', '1', '-q:v', '2', input.posterPath],
    features: {
      trimming: true,
      shotJoining: input.clips.length > 1,
      fades: fadeSeconds > 0,
      audioNormalization: normalizeAudio,
      captions: Boolean(input.captionsPath),
      posterExtraction: true,
    },
  };
}
