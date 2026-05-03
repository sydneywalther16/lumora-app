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

    supabase.auth.getSession().then(({ data }) => {
      console.log('LOADED SUPABASE USER', {
        authUserId: data.session?.user?.id ?? null,
      });
      setState({
        loading: false,
        user: data.session?.user ?? null,
        session: data.session ?? null,
        configured: true,
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
