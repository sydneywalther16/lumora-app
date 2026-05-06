import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { hasSupabaseConfig, supabase } from '../lib/supabase';

type SessionSource = 'auth-state-change' | 'initial' | 'refresh' | 'unconfigured' | 'url-redirect';

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
  return rememberedPath ?? fallbackPath;
}

function hasAuthRedirectParams(): boolean {
  if (typeof window === 'undefined') return false;

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash,
  );

  return authParamNames.some((paramName) => searchParams.has(paramName) || hashParams.has(paramName));
}

function authSearchParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function authHashParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(
    window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash,
  );
}

async function exchangeRedirectSession(client: SupabaseClient): Promise<Session | null> {
  const searchParams = authSearchParams();
  const hashParams = authHashParams();
  const code = searchParams.get('code');

  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('AUTH CODE EXCHANGE FAILED', error);
    }

    if (data.session) {
      console.log('AUTH CODE EXCHANGED', {
        authUserId: data.session.user.id,
      });
      return data.session;
    }
  }

  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');

  if (accessToken && refreshToken) {
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.error('AUTH HASH SESSION SAVE FAILED', error);
    }

    if (data.session) {
      console.log('AUTH CODE EXCHANGED', {
        authUserId: data.session.user.id,
        format: 'hash',
      });
      return data.session;
    }
  }

  return null;
}

function cleanAuthUrl() {
  if (typeof window === 'undefined') return;

  const fallbackPath = routeWithoutAuthParams(new URL(window.location.href));
  const redirectPath = consumeRememberedRedirectPath(fallbackPath);
  window.history.replaceState({}, document.title, redirectPath);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function getSessionAfterRedirect(
  client: SupabaseClient,
  hasRedirectParams: boolean,
): Promise<{ data: { session: Session | null }; error: unknown }> {
  const exchangedSession = hasRedirectParams ? await exchangeRedirectSession(client) : null;
  let lastResult = await client.auth.getSession();

  if (exchangedSession && !lastResult.data.session) {
    lastResult = {
      data: { session: exchangedSession },
      error: null,
    };
  }

  if (!hasRedirectParams || lastResult.data.session) {
    return lastResult;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delay(100);
    lastResult = await client.auth.getSession();
    if (lastResult.data.session) {
      return lastResult;
    }
  }

  return lastResult;
}

function logSessionResult(input: {
  session: Session | null;
  source: SessionSource;
  foundOnLoad: boolean;
  restoredFromStorage: boolean;
  savedFromRedirect: boolean;
}) {
  const authUserId = input.session?.user?.id ?? null;

  console.log('AUTH USER ID', {
    authUserId,
    source: input.source,
  });

  if (input.foundOnLoad && input.session) {
    console.log('SESSION FOUND ON LOAD', { authUserId });
  }

  if (input.savedFromRedirect && input.session) {
    console.log('SESSION SAVED', { authUserId });
  }

  if (input.restoredFromStorage && input.session) {
    console.log('SESSION RESTORED', { authUserId });
  }

  if (!input.session) {
    console.log('SESSION MISSING', { source: input.source });
  }
}

async function readSession(
  client: SupabaseClient,
  source: SessionSource,
  hasRedirectParams: boolean,
): Promise<SessionSnapshot> {
  const { data, error } = await getSessionAfterRedirect(client, hasRedirectParams);
  if (error) {
    console.error('Unable to load Supabase session:', error);
  }

  const session = data.session ?? null;
  console.log('AUTH SESSION LOADED', {
    authUserId: session?.user?.id ?? null,
    source,
  });
  logSessionResult({
    session,
    source,
    foundOnLoad: source === 'initial',
    restoredFromStorage: source === 'initial' || source === 'refresh',
    savedFromRedirect: hasRedirectParams,
  });

  return {
    loading: false,
    user: session?.user ?? null,
    session,
    configured: true,
    source,
  };
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

  const redirectParamsPresent = hasAuthRedirectParams();
  emitSessionState({ ...currentSnapshot, loading: true });

  const nextSource: SessionSource = redirectParamsPresent ? 'url-redirect' : source;
  const nextSnapshot = await readSession(supabase, nextSource, redirectParamsPresent);
  initialHydrated = true;
  emitSessionState(nextSnapshot);

  if (redirectParamsPresent && nextSnapshot.session) {
    cleanAuthUrl();
  }

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

      if (session) {
        console.log('SESSION SAVED', {
          authUserId: session.user.id,
          event,
        });
      } else {
        console.log('SESSION MISSING', { source: 'auth-state-change', event });
      }

      console.log('AUTH USER ID', {
        authUserId: session?.user?.id ?? null,
        source: 'auth-state-change',
      });

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
