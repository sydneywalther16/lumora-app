import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { hasSupabaseConfig, supabase } from '../lib/supabase';

type SessionSource =
  | 'auth-state-change'
  | 'initial'
  | 'refresh'
  | 'unconfigured'
  | 'url-code'
  | 'url-token'
  | 'url-token-hash';
type EmailOtpType = 'email' | 'email_change' | 'invite' | 'magiclink' | 'recovery' | 'signup';

type SessionState = {
  loading: boolean;
  user: User | null;
  session: Session | null;
  configured: boolean;
  source: SessionSource;
  refreshSession: () => Promise<Session | null>;
};

type SessionSnapshot = Omit<SessionState, 'refreshSession'>;
type SupabaseClient = NonNullable<typeof supabase>;

const AUTH_REDIRECT_STORAGE_KEY = 'lumora_auth_redirect_path';
const validOtpTypes: EmailOtpType[] = ['email', 'email_change', 'invite', 'magiclink', 'recovery', 'signup'];

const emptySnapshot: SessionSnapshot = {
  loading: hasSupabaseConfig,
  user: null,
  session: null,
  configured: hasSupabaseConfig,
  source: hasSupabaseConfig ? 'initial' : 'unconfigured',
};

let currentSnapshot = emptySnapshot;
let initialSessionPromise: Promise<void> | null = null;
let initialHydrated = false;
let authSubscription: { unsubscribe: () => void } | null = null;
const subscribers = new Set<(snapshot: SessionSnapshot) => void>();

function emitSessionState(snapshot: SessionSnapshot) {
  currentSnapshot = snapshot;
  subscribers.forEach((subscriber) => subscriber(snapshot));
}

function routeWithoutAuthParams(url: URL): string {
  const authParamNames = [
    'access_token',
    'code',
    'expires_at',
    'expires_in',
    'provider_refresh_token',
    'provider_token',
    'refresh_token',
    'token_hash',
    'token_type',
    'type',
  ];

  const nextUrl = new URL(url.href);
  authParamNames.forEach((paramName) => nextUrl.searchParams.delete(paramName));
  return `${nextUrl.pathname}${nextUrl.search ? nextUrl.search : ''}`;
}

function sanitizeRedirectPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;

  try {
    return routeWithoutAuthParams(new URL(value, window.location.origin));
  } catch {
    return null;
  }
}

function currentRoutePath(): string {
  if (typeof window === 'undefined') return '/profile';
  return routeWithoutAuthParams(new URL(window.location.href));
}

export function rememberAuthRedirectPath(path = currentRoutePath()): string {
  const redirectPath = sanitizeRedirectPath(path) ?? '/profile';

  if (typeof window !== 'undefined') {
    localStorage.setItem(AUTH_REDIRECT_STORAGE_KEY, redirectPath);
  }

  return redirectPath;
}

function consumeRememberedRedirectPath(fallbackPath: string): string {
  if (typeof window === 'undefined') return fallbackPath;

  const rememberedPath = sanitizeRedirectPath(localStorage.getItem(AUTH_REDIRECT_STORAGE_KEY));
  localStorage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
  return rememberedPath ?? fallbackPath;
}

function getAuthParams() {
  if (typeof window === 'undefined') {
    return {
      code: null,
      accessToken: null,
      refreshToken: null,
      tokenHash: null,
      type: null,
    };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash,
  );

  return {
    code: searchParams.get('code'),
    accessToken: hashParams.get('access_token') ?? searchParams.get('access_token'),
    refreshToken: hashParams.get('refresh_token') ?? searchParams.get('refresh_token'),
    tokenHash: hashParams.get('token_hash') ?? searchParams.get('token_hash'),
    type: hashParams.get('type') ?? searchParams.get('type'),
  };
}

function normalizeEmailOtpType(value: string | null): EmailOtpType {
  return validOtpTypes.includes(value as EmailOtpType) ? (value as EmailOtpType) : 'magiclink';
}

function cleanAuthUrl() {
  if (typeof window === 'undefined') return;

  const fallbackPath = routeWithoutAuthParams(new URL(window.location.href));
  const redirectPath = consumeRememberedRedirectPath(fallbackPath);
  window.history.replaceState({}, document.title, redirectPath);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function logAuthUserId(source: SessionSource, session: Session | null) {
  console.log('AUTH USER ID', {
    authUserId: session?.user?.id ?? null,
    source,
  });
}

async function readSession(client: SupabaseClient, source: SessionSource): Promise<SessionSnapshot> {
  const { data, error } = await client.auth.getSession();
  if (error) {
    console.error('Unable to load Supabase session:', error);
  }

  const session = data.session ?? null;
  console.log('AUTH SESSION LOADED', {
    authUserId: session?.user?.id ?? null,
    source,
  });
  logAuthUserId(source, session);

  return {
    loading: false,
    user: session?.user ?? null,
    session,
    configured: true,
    source,
  };
}

async function consumeUrlSession(client: SupabaseClient): Promise<SessionSource | null> {
  const { code, accessToken, refreshToken, tokenHash, type } = getAuthParams();

  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('Unable to exchange Supabase magic-link code:', error);
    } else if (data.session) {
      console.log('AUTH CODE EXCHANGED', {
        authUserId: data.session.user.id,
        source: 'url-code',
      });
      cleanAuthUrl();
      return 'url-code';
    }
  }

  if (tokenHash) {
    const { data, error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: normalizeEmailOtpType(type),
    });
    if (error) {
      console.error('Unable to verify Supabase magic-link token hash:', error);
    } else if (data.session) {
      console.log('AUTH CODE EXCHANGED', {
        authUserId: data.session.user.id,
        source: 'url-token-hash',
      });
      cleanAuthUrl();
      return 'url-token-hash';
    }
  }

  if (accessToken && refreshToken) {
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      console.error('Unable to consume Supabase magic-link tokens:', error);
    } else if (data.session) {
      console.log('AUTH CODE EXCHANGED', {
        authUserId: data.session.user.id,
        source: 'url-token',
      });
      cleanAuthUrl();
      return 'url-token';
    }
  }

  return null;
}

async function hydrateSession(source: SessionSource = 'refresh'): Promise<Session | null> {
  if (!supabase) {
    const unconfigured: SessionSnapshot = {
      loading: false,
      user: null,
      session: null,
      configured: false,
      source: 'unconfigured',
    };
    emitSessionState(unconfigured);
    return null;
  }

  emitSessionState({ ...currentSnapshot, loading: true });

  const urlSource = await consumeUrlSession(supabase);
  const nextSnapshot = await readSession(supabase, urlSource ?? source);
  initialHydrated = true;
  emitSessionState(nextSnapshot);
  return nextSnapshot.session;
}

function ensureAuthSubscription() {
  if (!supabase) {
    emitSessionState({
      loading: false,
      user: null,
      session: null,
      configured: false,
      source: 'unconfigured',
    });
    return;
  }

  if (!authSubscription) {
    const client = supabase;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!initialHydrated && event === 'INITIAL_SESSION' && !session) {
        return;
      }

      console.log('AUTH STATE CHANGED', {
        authUserId: session?.user?.id ?? null,
        event,
      });
      logAuthUserId('auth-state-change', session ?? null);
      emitSessionState({
        loading: false,
        user: session?.user ?? null,
        session: session ?? null,
        configured: true,
        source: 'auth-state-change',
      });
    });

    authSubscription = subscription;
  }

  if (!initialSessionPromise) {
    initialSessionPromise = hydrateSession('initial').then(() => undefined);
  }
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionSnapshot>(currentSnapshot);

  useEffect(() => {
    subscribers.add(setState);
    ensureAuthSubscription();

    return () => {
      subscribers.delete(setState);
    };
  }, []);

  return {
    ...state,
    refreshSession: () => hydrateSession('refresh'),
  };
}
