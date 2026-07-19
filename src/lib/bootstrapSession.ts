import type { Session, User } from '@supabase/supabase-js';
import { hasSupabaseConfig, supabase } from './supabase';

export type SessionSource =
  | 'auth-state-change'
  | 'initial'
  | 'refresh'
  | 'unconfigured'
  | 'url-redirect';

export type BootstrapSessionSnapshot = {
  authReady: boolean;
  authUser: User | null;
  authSession: Session | null;
  configured: boolean;
  source: SessionSource;
};

type SupabaseClient = NonNullable<typeof supabase>;

export const AUTH_CALLBACK_PATH = '/auth/callback';
export const AUTH_UPDATE_PASSWORD_PATH = '/auth/update-password';
const AUTH_REDIRECT_STORAGE_KEY = 'lumora_auth_redirect_path';
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
export const PRODUCTION_APP_ORIGIN = 'https://lumora-app-topaz.vercel.app';
const SESSION_RESTORE_TIMEOUT_MS = 7000;
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

const initialSnapshot: BootstrapSessionSnapshot = {
  authReady: !hasSupabaseConfig,
  authUser: null,
  authSession: null,
  configured: hasSupabaseConfig,
  source: hasSupabaseConfig ? 'initial' : 'unconfigured',
};

let currentSnapshot = initialSnapshot;
let bootstrapPromise: Promise<Session | null> | null = null;
let initialHydrated = false;
let authSubscription: { unsubscribe: () => void } | null = null;
const subscribers = new Set<(snapshot: BootstrapSessionSnapshot) => void>();

export let authReady = currentSnapshot.authReady;
export let authUser = currentSnapshot.authUser;
export let authSession = currentSnapshot.authSession;

function emitSessionState(snapshot: BootstrapSessionSnapshot) {
  currentSnapshot = snapshot;
  authReady = snapshot.authReady;
  authUser = snapshot.authUser;
  authSession = snapshot.authSession;
  subscribers.forEach((subscriber) => subscriber(snapshot));
}

export function getAuthSessionSnapshot(): BootstrapSessionSnapshot {
  return currentSnapshot;
}

export function subscribeAuthSession(
  subscriber: (snapshot: BootstrapSessionSnapshot) => void,
): () => void {
  subscribers.add(subscriber);
  subscriber(currentSnapshot);

  return () => {
    subscribers.delete(subscriber);
  };
}

function routeWithoutAuthParams(url: URL): string {
  const nextUrl = new URL(url.href);
  authParamNames.forEach((paramName) => nextUrl.searchParams.delete(paramName));
  nextUrl.hash = '';
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

export function getAppOrigin(): string {
  if (typeof window === 'undefined') {
    return PRODUCTION_APP_ORIGIN;
  }

  if (LOCALHOST_HOSTNAMES.has(window.location.hostname) || window.location.hostname.endsWith('.local')) {
    return window.location.origin;
  }

  return PRODUCTION_APP_ORIGIN;
}

export function getAuthCallbackUrl(): string {
  return `${getAppOrigin()}${AUTH_CALLBACK_PATH}`;
}

export function getPasswordUpdateUrl(): string {
  return `${getAppOrigin()}${AUTH_UPDATE_PASSWORD_PATH}`;
}

function consumeRememberedRedirectPath(fallbackPath: string): string {
  if (typeof window === 'undefined') return fallbackPath;

  const rememberedPath = sanitizeRedirectPath(localStorage.getItem(AUTH_REDIRECT_STORAGE_KEY));
  return rememberedPath ?? fallbackPath;
}

export function consumeAuthRedirectPath(fallbackPath = '/profile'): string {
  if (typeof window === 'undefined') return fallbackPath;

  const redirectPath = consumeRememberedRedirectPath(fallbackPath);
  localStorage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
  return redirectPath;
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

function isGlobalAuthRedirectRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname === AUTH_CALLBACK_PATH;
}

function cleanAuthParamsFromCurrentUrl() {
  if (typeof window === 'undefined') return;
  const safePath = routeWithoutAuthParams(new URL(window.location.href));
  window.history.replaceState({}, document.title, safePath);
}

async function exchangeRedirectSession(client: SupabaseClient): Promise<Session | null> {
  const searchParams = authSearchParams();
  const hashParams = authHashParams();
  const code = searchParams.get('code');
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const tokenHash = searchParams.get('token_hash') ?? hashParams.get('token_hash');
  const authType = searchParams.get('type') ?? hashParams.get('type');

  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('AUTH CODE EXCHANGE FAILED', { hasAuthError: true });
    }
    if (data.session) {
      console.log('AUTH CODE EXCHANGED', { hasSession: true });
      return data.session;
    }
  }

  if (accessToken && refreshToken) {
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      console.error('AUTH HASH SESSION SAVE FAILED', { hasAuthError: true });
    }
    if (data.session) {
      console.log('AUTH CODE EXCHANGED', { hasSession: true });
      return data.session;
    }
  }

  if (tokenHash && authType === 'recovery') {
    const { data, error } = await client.auth.verifyOtp({
      type: 'recovery',
      token_hash: tokenHash,
    });
    if (error) {
      console.error('AUTH RECOVERY VERIFY FAILED', { hasAuthError: true });
    }
    if (data.session) {
      console.log('AUTH CODE EXCHANGED', { hasSession: true });
      return data.session;
    }
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    console.error('AUTH SESSION URL DETECTION FAILED', { hasAuthError: true });
  }

  if (data.session) {
    console.log('AUTH CODE EXCHANGED', { hasSession: true });
  }

  return data.session ?? null;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
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
    if (lastResult.data.session) return lastResult;
  }

  return lastResult;
}

function logSession(session: Session | null, source: SessionSource) {
  console.log('AUTH SESSION RESTORED', {
    hasSession: Boolean(session),
    source,
  });

  if (!session) {
    console.log('SESSION MISSING', { source });
  }
}

async function readSession(
  client: SupabaseClient,
  source: SessionSource,
  redirectParamsPresent: boolean,
): Promise<BootstrapSessionSnapshot> {
  const { data, error } = await getSessionAfterRedirect(client, redirectParamsPresent);
  if (error) {
    console.error('Unable to load Supabase session', { hasAuthError: true });
  }

  const session = data.session ?? null;
  console.log('AUTH SESSION LOADED', {
    hasSession: Boolean(session),
    source,
  });
  logSession(session, source);

  return {
    authReady: true,
    authUser: session?.user ?? null,
    authSession: session,
    configured: true,
    source,
  };
}

function ensureAuthSubscription() {
  if (!supabase) {
    emitSessionState({
      authReady: true,
      authUser: null,
      authSession: null,
      configured: false,
      source: 'unconfigured',
    });
    return;
  }

  if (authSubscription) return;

  const client = supabase;
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    if (!initialHydrated && event === 'INITIAL_SESSION' && !session) {
      return;
    }

    console.log('AUTH STATE CHANGED', {
      event,
      hasSession: Boolean(session),
    });

    emitSessionState({
      authReady: true,
      authUser: session?.user ?? null,
      authSession: session ?? null,
      configured: true,
      source: 'auth-state-change',
    });
  });

  authSubscription = subscription;
}

export async function refreshBootstrapSession(source: SessionSource = 'refresh'): Promise<Session | null> {
  ensureAuthSubscription();

  if (!supabase) {
    emitSessionState({
      authReady: true,
      authUser: null,
      authSession: null,
      configured: false,
      source: 'unconfigured',
    });
    return null;
  }

  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    const redirectParamsPresent = hasAuthRedirectParams();
    const shouldProcessRedirectParams = redirectParamsPresent && isGlobalAuthRedirectRoute();
    const passwordRecoveryOwnsParams = typeof window !== 'undefined'
      && window.location.pathname === AUTH_UPDATE_PASSWORD_PATH;

    if (
      redirectParamsPresent
      && !shouldProcessRedirectParams
      && !passwordRecoveryOwnsParams
      && typeof window !== 'undefined'
    ) {
      console.warn('AUTH REDIRECT URL WARNING', {
        callbackPath: window.location.pathname,
        expectedPath: AUTH_CALLBACK_PATH,
      });
    }

    const shouldShowRestoring = source === 'initial' && !initialHydrated;
    if (shouldShowRestoring) {
      emitSessionState({
        ...currentSnapshot,
        authReady: false,
        configured: true,
      });
    }

    const nextSource: SessionSource = shouldProcessRedirectParams ? 'url-redirect' : source;

    try {
      const nextSnapshot = await withTimeout(
        readSession(supabase, nextSource, shouldProcessRedirectParams),
        SESSION_RESTORE_TIMEOUT_MS,
        'Auth session restore',
      );
      initialHydrated = true;
      emitSessionState(nextSnapshot);

      if (shouldProcessRedirectParams) {
        cleanAuthParamsFromCurrentUrl();
      }

      return nextSnapshot.authSession;
    } catch (error) {
      console.error('Unable to bootstrap Supabase session', { hasAuthError: true });
      initialHydrated = true;
      emitSessionState({
        authReady: true,
        authUser: null,
        authSession: null,
        configured: true,
        source: nextSource,
      });

      if (shouldProcessRedirectParams) {
        cleanAuthParamsFromCurrentUrl();
      }

      return null;
    }
  })().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}

export function bootstrapSession(): Promise<Session | null> {
  ensureAuthSubscription();

  if (initialHydrated) {
    return Promise.resolve(currentSnapshot.authSession);
  }

  return refreshBootstrapSession('initial');
}
