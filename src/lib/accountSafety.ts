import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type ReportReason =
  | 'ai_safety'
  | 'harassment'
  | 'hate'
  | 'sexual_content'
  | 'violence'
  | 'privacy'
  | 'spam'
  | 'copyright'
  | 'other';

export const reportReasons: Array<{ value: ReportReason; label: string }> = [
  { value: 'ai_safety', label: 'Unsafe or harmful AI output' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hateful content' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'privacy', label: 'Privacy or impersonation' },
  { value: 'spam', label: 'Spam or misleading content' },
  { value: 'copyright', label: 'Copyright or rights concern' },
  { value: 'other', label: 'Something else' },
];

export type BlockedCreator = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  blockedAt: string;
};

function requireSupabase() {
  if (!supabase) throw new Error('Lumora account services are unavailable.');
  return supabase;
}

async function requireUserId() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.id) throw new Error('Sign in to use this safety tool.');
  return data.user.id;
}

export async function submitContentReport(input: {
  contentType: 'post' | 'generation';
  contentId: string;
  postId?: string | null;
  reason: ReportReason;
  details?: string;
}) {
  const client = requireSupabase();
  const reporterUserId = await requireUserId();
  const { error } = await client.from('content_reports').insert({
    reporter_user_id: reporterUserId,
    content_type: input.contentType,
    content_id: input.contentId,
    post_id: input.contentType === 'post' ? input.postId ?? input.contentId : null,
    reason: input.reason,
    details: input.details?.trim() || null,
    status: 'pending',
  });

  if (!error) return;
  if (error.code === '23505') throw new Error('You already reported this content.');
  throw new Error('The report could not be sent. Please try again.');
}

export async function blockCreator(blockedUserId: string) {
  const client = requireSupabase();
  const blockerUserId = await requireUserId();
  if (blockerUserId === blockedUserId) throw new Error('You cannot block your own account.');

  const { error } = await client.from('user_blocks').upsert(
    { blocker_user_id: blockerUserId, blocked_user_id: blockedUserId },
    { onConflict: 'blocker_user_id,blocked_user_id', ignoreDuplicates: true },
  );
  if (error) throw new Error('The creator could not be blocked. Please try again.');
}

export async function unblockCreator(blockedUserId: string) {
  const client = requireSupabase();
  const blockerUserId = await requireUserId();
  const { error } = await client
    .from('user_blocks')
    .delete()
    .eq('blocker_user_id', blockerUserId)
    .eq('blocked_user_id', blockedUserId);
  if (error) throw new Error('The creator could not be unblocked. Please try again.');
}

export async function loadBlockedUserIds(): Promise<Set<string>> {
  if (!supabase) return new Set();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return new Set();

  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_user_id')
    .eq('blocker_user_id', userId);
  if (error) return new Set();
  return new Set((data ?? []).map((row) => String(row.blocked_user_id)).filter(Boolean));
}

export async function loadBlockedCreators(): Promise<BlockedCreator[]> {
  const client = requireSupabase();
  const blockerUserId = await requireUserId();
  const { data: blockRows, error: blockError } = await client
    .from('user_blocks')
    .select('blocked_user_id,created_at')
    .eq('blocker_user_id', blockerUserId)
    .order('created_at', { ascending: false });
  if (blockError) throw new Error('Blocked creators could not be loaded.');

  const ids = (blockRows ?? []).map((row) => String(row.blocked_user_id)).filter(Boolean);
  if (!ids.length) return [];

  const { data: profiles } = await client
    .from('profiles')
    .select('id,user_id,display_name,username,handle,avatar_url')
    .in('user_id', ids);
  const profileById = new Map(
    (profiles ?? []).map((profile) => [String(profile.user_id || profile.id), profile]),
  );

  return (blockRows ?? []).map((row) => {
    const userId = String(row.blocked_user_id);
    const profile = profileById.get(userId);
    return {
      userId,
      displayName: String(profile?.display_name || profile?.username || 'Blocked creator'),
      username: profile?.username || profile?.handle ? String(profile.username || profile.handle) : null,
      avatarUrl: profile?.avatar_url ? String(profile.avatar_url) : null,
      blockedAt: String(row.created_at),
    };
  });
}

function decodeJwtPayload(token: string): { iat?: number } | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
  } catch {
    return null;
  }
}

export function hasRecentSignIn(session: Session | null, maxAgeSeconds = 10 * 60) {
  if (!session) return false;
  const issuedAt = decodeJwtPayload(session.access_token)?.iat;
  const lastSignInAt = session.user.last_sign_in_at ? Date.parse(session.user.last_sign_in_at) : Number.NaN;
  if (!issuedAt || !Number.isFinite(lastSignInAt)) return false;
  const now = Date.now();
  return now - issuedAt * 1000 <= maxAgeSeconds * 1000
    && now - lastSignInAt <= maxAgeSeconds * 1000;
}

export async function reauthenticateWithPassword(email: string, password: string) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error('That password did not verify your account.');
  return data.session;
}

export async function permanentlyDeleteAccount() {
  const client = requireSupabase();
  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Sign in again before deleting your account.');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) throw new Error('Lumora account services are unavailable.');

  const response = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmation: 'DELETE' }),
  });
  const result = await response.json().catch(() => ({})) as { deleted?: boolean; error?: string };
  if (response.ok && result.deleted) return;
  if (result.error === 'recent_authentication_required') {
    throw new Error('Sign in again, then return here within 10 minutes.');
  }
  throw new Error('Your account was not deleted. No further action was taken.');
}

function deleteIndexedDatabase(name: string) {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function clearLumoraLocalData() {
  if (typeof window !== 'undefined') {
    const removableKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && (key.startsWith('lumora_') || key.startsWith('sb-'))) removableKeys.push(key);
    }
    removableKeys.push('remixPrompt', 'remixTitle');
    [...new Set(removableKeys)].forEach((key) => window.localStorage.removeItem(key));
  }
  await deleteIndexedDatabase('lumora_local_media');
}
