import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isCustomerAuthConfigured } from "../services/supabaseClient";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isCustomerAuthConfigured);

  useEffect(() => {
    if (!isCustomerAuthConfigured) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signInWithPassword = (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password });

  const signUp = (email: string, password: string) =>
    supabase.auth.signUp({ email, password });

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({ provider: "google" });

  const signOut = () => supabase.auth.signOut();

  return {
    session,
    user: session?.user ?? null,
    accessToken: session?.access_token ?? null,
    loading,
    signInWithPassword,
    signUp,
    signInWithGoogle,
    signOut,
  };
}
