import { createClient } from 'npm:@supabase/supabase-js@2.56.0';

const STORAGE_BUCKETS = [
  'avatars',
  'character-reference-images',
  'self-capture-videos',
  'voice-samples',
  'lumora-assets',
  'generated-videos',
  'post-thumbnails',
] as const;

const MAX_REAUTH_AGE_SECONDS = 10 * 60;
const STORAGE_PAGE_SIZE = 1000;

type ListedStorageObject = {
  id?: string | null;
  name: string;
  metadata?: Record<string, unknown> | null;
};

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const allowedOrigins = new Set([
    'https://lumora-app-topaz.vercel.app',
    'https://lumoracreator.com',
    'https://www.lumoracreator.com',
    'capacitor://localhost',
    'http://localhost',
    'http://localhost:4173',
    'http://localhost:5173',
  ]);

  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin)
      ? origin
      : 'https://lumora-app-topaz.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? '';
}

function jwtIssuedAt(token: string): number | null {
  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return null;
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { iat?: unknown };
    return typeof payload.iat === 'number' ? payload.iat : null;
  } catch {
    return null;
  }
}

function hasFreshAuthentication(token: string, lastSignInAt?: string | null) {
  const issuedAt = jwtIssuedAt(token);
  const lastSignInTime = lastSignInAt ? Date.parse(lastSignInAt) : Number.NaN;
  if (!issuedAt || !Number.isFinite(lastSignInTime)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  const lastSignInAgeSeconds = Math.floor((Date.now() - lastSignInTime) / 1000);
  return ageSeconds >= -60
    && ageSeconds <= MAX_REAUTH_AGE_SECONDS
    && lastSignInAgeSeconds >= -60
    && lastSignInAgeSeconds <= MAX_REAUTH_AGE_SECONDS;
}

function joinStoragePath(prefix: string, name: string) {
  return prefix ? `${prefix}/${name}` : name;
}

async function listStorageObjects(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const objectPaths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, {
      limit: STORAGE_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error) throw new Error(`Unable to list ${bucket} media.`);

    const entries = (data ?? []) as ListedStorageObject[];
    for (const entry of entries) {
      const objectPath = joinStoragePath(prefix, entry.name);
      if (entry.id) {
        objectPaths.push(objectPath);
      } else {
        objectPaths.push(...await listStorageObjects(admin, bucket, objectPath));
      }
    }

    if (entries.length < STORAGE_PAGE_SIZE) break;
    offset += STORAGE_PAGE_SIZE;
  }

  return objectPaths;
}

async function deleteStorageObjects(
  admin: ReturnType<typeof createClient>,
  userId: string,
) {
  for (const bucket of STORAGE_BUCKETS) {
    const objectPaths = await listStorageObjects(admin, bucket, userId);
    for (let index = 0; index < objectPaths.length; index += STORAGE_PAGE_SIZE) {
      const batch = objectPaths.slice(index, index + STORAGE_PAGE_SIZE);
      const { error } = await admin.storage.from(bucket).remove(batch);
      if (error) throw new Error(`Unable to delete ${bucket} media.`);
    }
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }

  if (request.method !== 'POST') {
    return json(request, { error: 'method_not_allowed' }, 405);
  }

  try {
    const token = bearerToken(request);
    if (!token) return json(request, { error: 'auth_required' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(request, { error: 'service_not_configured' }, 503);
    }

    const body = await request.json().catch(() => ({})) as {
      confirmation?: unknown;
    };
    if (body.confirmation !== 'DELETE') {
      return json(request, { error: 'confirmation_required' }, 400);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    const user = userData.user;
    if (userError || !user?.id) {
      return json(request, { error: 'auth_invalid' }, 401);
    }

    if (!hasFreshAuthentication(token, user.last_sign_in_at)) {
      return json(request, { error: 'recent_authentication_required' }, 401);
    }

    await deleteStorageObjects(admin, user.id);

    const { error: dataError } = await admin.rpc('delete_account_data', {
      target_user_id: user.id,
    });
    if (dataError) throw new Error('Unable to delete account data.');

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) throw new Error('Unable to delete the account.');

    return json(request, { deleted: true });
  } catch (error) {
    console.error('Account deletion failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return json(request, { error: 'account_deletion_failed' }, 500);
  }
});
