export type SelfReferencePreviewReference = {
  url?: string | null;
  path?: string | null;
  fileName?: string | null;
  name?: string | null;
  [key: string]: unknown;
};

type Props = {
  label: string;
  reference?: SelfReferencePreviewReference | null;
  required?: boolean;
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeReference(
  reference: SelfReferencePreviewReference | null | undefined,
  fallbackUrlKey: string,
  fallbackPathKey: string,
) {
  const normalized = {
    url: readString(reference?.url) || readString(reference?.[fallbackUrlKey]),
    path: readString(reference?.path) || readString(reference?.[fallbackPathKey]),
    fileName: readString(reference?.fileName) || readString(reference?.name) || '',
  };

  console.log('NORMALIZED REFERENCE:', normalized);
  return normalized;
}

function cleanReferencePath(path?: string | null) {
  return path
    ?.trim()
    .replace(/^\/+/, '')
    .replace(/^character-reference-images\/+/, '');
}

export default function SelfReferencePreview({ label, reference, required }: Props) {
  const cleanPath = cleanReferencePath(reference?.path);
  const resolvedUrl =
    reference?.url?.startsWith('http')
      ? reference.url
      : cleanPath
        ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/character-reference-images/${cleanPath}`
        : null;

  console.log('REFERENCE OBJECT:', reference);
  console.log('RESOLVED URL:', resolvedUrl);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 aspect-square">
      {resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt={label}
          className="absolute inset-0 h-full w-full object-cover"
          onLoad={() => console.log('LOADED PREVIEW:', resolvedUrl)}
          onError={() => console.error('FAILED PREVIEW:', resolvedUrl)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">
          {required ? 'Required' : 'Optional'}
        </div>
      )}
    </div>
  );
}
