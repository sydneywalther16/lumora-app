import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { hasSupabaseConfig, supabase } from '../lib/supabase';

type SessionState = {
  loading: boolean;
  user: User | null;
  session: Session | null;
  configured: boolean;
};

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    loading: hasSupabaseConfig,
    user: null,
    session: null,
    configured: hasSupabaseConfig,
  });

  useEffect(() => {
    if (!supabase) {
      setState({ loading: false, user: null, session: null, configured: false });
      return;
    }
    const client = supabase;

    async function loadInitialSession() {
      const { data } = await client.auth.getSession();
      let session = data.session ?? null;

      if (!session) {
        const code = new URLSearchParams(window.location.search).get('code');
        if (code) {
          const exchangeResult = await client.auth.exchangeCodeForSession(code).catch(() => null);
          session = exchangeResult?.data.session ?? null;

          if (session) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }
      }

      console.log('LOADED SUPABASE USER', {
        authUserId: session?.user?.id ?? null,
      });
      setState({
        loading: false,
        user: session?.user ?? null,
        session,
        configured: true,
      });
    }

    void loadInitialSession();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      console.log('LOADED SUPABASE USER', {
        authUserId: session?.user?.id ?? null,
      });
      setState({
        loading: false,
        user: session?.user ?? null,
        session: session ?? null,
        configured: true,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  return state;
}
