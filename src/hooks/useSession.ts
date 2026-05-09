import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  AUTH_CALLBACK_PATH,
  bootstrapSession,
  consumeAuthRedirectPath,
  getAuthCallbackUrl,
  getAuthSessionSnapshot,
  refreshBootstrapSession,
  rememberAuthRedirectPath,
  subscribeAuthSession,
  type SessionSource,
} from '../lib/bootstrapSession';

type SessionState = {
  authReady: boolean;
  loading: boolean;
  user: User | null;
  session: Session | null;
  configured: boolean;
  source: SessionSource;
  refreshSession: () => Promise<Session | null>;
};

export {
  AUTH_CALLBACK_PATH,
  consumeAuthRedirectPath,
  getAuthCallbackUrl,
  rememberAuthRedirectPath,
};

export function useSession(): SessionState {
  const [state, setState] = useState(() => getAuthSessionSnapshot());

  useEffect(() => {
    const unsubscribe = subscribeAuthSession(setState);
    void bootstrapSession();

    return unsubscribe;
  }, []);

  return {
    authReady: state.authReady,
    loading: !state.authReady,
    user: state.authUser,
    session: state.authSession,
    configured: state.configured,
    source: state.source,
    refreshSession: () => refreshBootstrapSession('refresh'),
  };
}
