import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Session, User, AuthError } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '@/utils/supabase';
import { postAccountDelete } from '@/utils/lucyApi';
import { flushAnalytics, track } from '@/utils/analytics';

WebBrowser.maybeCompleteAuthSession();

export interface Profile {
  id: string;
  user_id: string;
  first_name: string;
  date_of_birth: string;
  gender?: string;
  timezone: string;
  notification_preferences: {
    enabled: boolean;
    daily_reminder: boolean;
    weekly_summary: boolean;
  };
  avatar_url?: string;
  onboarding_completed: boolean;
  privacy_consent_given: boolean;
  privacy_consent_at?: string | null;
  /**
   * Échanges offerts consommés (porte du chat, voir constants/chatGate.ts). Écrit
   * par le serveur uniquement ; l'app le lit, et le met à jour localement depuis
   * chaque réponse de POST /chat (patchProfile) pour poser le mur sans relire la base.
   */
  free_exchanges_used?: number | null;
  /** Instant du premier refus du serveur (sixième envoi) : le mur est tombé. Écrit par le serveur. */
  chat_wall_reached_at?: string | null;
  /** Réponses du questionnaire (clés d'options), écrites à la fin de l'onboarding. */
  onboarding_answers?: OnboardingProfileAnswers | null;
  created_at: string;
  updated_at: string;
}

export interface OnboardingProfileAnswers {
  mood?: string | null;
  energy?: string | null;
  concerns?: string[] | null;
  stress?: string | null;
  talk_to?: string | null;
  openness?: string | null;
  goals?: string[] | null;
  pride?: string[] | null;
  understood?: string[] | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signInWithApple: () => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  /**
   * Retente la connexion avec les identifiants de la dernière inscription, pour
   * savoir si l'adresse vient d'être confirmée. Voir `pendingCredentials`.
   */
  retryPendingSignIn: () => Promise<{ confirmed: boolean }>;
  deleteAccount: () => Promise<{ error: Error | null }>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
  /**
   * Met à jour le profil EN MÉMOIRE seulement, sans écrire en base. Pour les
   * champs que le serveur possède et renvoie (compteur d'échanges offerts) : la
   * base est déjà à jour, l'app se contente de refléter ce qu'elle vient de lire.
   */
  patchProfile: (updates: Partial<Profile>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Identifiants de la dernière inscription par email, gardés le temps de la
 * confirmation d'adresse.
 *
 * Quand Supabase exige une confirmation, `signUp` ne renvoie AUCUNE session : le
 * seul moyen de savoir si l'adresse a été validée est de retenter une connexion.
 * D'où la conservation temporaire du couple email / mot de passe.
 *
 * En mémoire du module, jamais dans AsyncStorage ni dans les paramètres de route
 * (expo-router les sérialise dans l'état de navigation). Effacés dès que la
 * connexion réussit, et à chaque déconnexion.
 */
let pendingCredentials: { email: string; password: string } | null = null;

/**
 * Fenêtre pendant laquelle un lien `lucy://…#access_token=…` est accepté.
 *
 * Sans elle, le listener de deep links ouvre une session à partir de N'IMPORTE
 * quelle URL au bon format, y compris une URL fabriquée par un tiers (lien dans
 * un message, page web, QR code) : un seul appui suffit alors à basculer
 * l'appareil sur le compte de l'attaquant, qui récupère ensuite la conversation
 * et l'humeur de la personne. C'est une fixation de session.
 *
 * Les deux flux OAuth lisent déjà le jeton dans la valeur de retour de
 * `openAuthSessionAsync` : ce listener n'est qu'un filet pour les appareils où
 * la redirection arrive par Linking. On le garde, mais seulement pendant les
 * secondes qui suivent un OAuth réellement lancé depuis l'app.
 */
const OAUTH_LINK_GRACE_MS = 20_000;
let oauthWindowUntil = 0;
const openOAuthWindow = () => {
  oauthWindowUntil = Date.now() + OAUTH_LINK_GRACE_MS;
};
const isOAuthWindowOpen = () => Date.now() < oauthWindowUntil;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // Validation SERVEUR de la session restaurée : un compte supprimé côté Supabase
      // laisse un JWT local encore « valide » → utilisateur fantôme → erreurs FK
      // (profiles_user_id_fkey) impossibles à corriger côté client. On déconnecte.
      if (session?.user) {
        const { error: userError } = await supabase.auth.getUser();
        if (userError) {
          console.warn('[auth] session orpheline (compte supprimé ?) — déconnexion');
          await supabase.auth.signOut().catch(() => {});
          setSession(null);
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }
      }
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      })();
    });

    const handleDeepLink = async (event: { url: string }) => {
      const url = event.url;
      // Ne jamais logger l'URL : elle peut contenir access_token et refresh_token dans le hash.

      // Aucun OAuth lancé depuis l'app dans les secondes qui précèdent : ce lien
      // ne vient pas de nous. Voir OAUTH_LINK_GRACE_MS.
      if (url && url.includes('#access_token=') && !isOAuthWindowOpen()) {
        console.warn('[auth] lien de session ignoré : aucune connexion OAuth en cours');
        return;
      }

      if (url && url.includes('#access_token=')) {
        const hashIndex = url.indexOf('#');
        if (hashIndex !== -1) {
          const hashParams = new URLSearchParams(url.substring(hashIndex + 1));
          const access_token = hashParams.get('access_token');
          const refresh_token = hashParams.get('refresh_token');

          if (access_token && refresh_token) {
            console.log('Setting session from deep link');
            try {
              const { error } = await supabase.auth.setSession({
                access_token,
                refresh_token,
              });

              if (error) {
                console.error('Error setting session from deep link:', error);
              }
            } catch (error) {
              console.error('Exception setting session from deep link:', error);
            }
          }
        }
      }
    };

    const subscription2 = Linking.addEventListener('url', handleDeepLink);

    return () => {
      subscription.unsubscribe();
      subscription2.remove();
    };
  }, []);

  const signUp = async (email: string, password: string) => {
    track('auth_started', { method: 'email', intent: 'signup' });
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    // Jamais l'adresse ni le message d'erreur : seulement l'issue. Un compte
    // déjà existant et un mot de passe refusé n'appellent pas la même
    // correction, d'où le nom de l'erreur Supabase.
    if (error) {
      track('auth_failed', { method: 'email', intent: 'signup', error_name: error.name });
    } else {
      pendingCredentials = { email, password };
    }
    return { error };
  };

  /**
   * L'écran de confirmation d'email s'en sert au retour au premier plan et sur
   * appui du bouton : si l'adresse a été validée entre-temps, la connexion passe
   * et `onAuthStateChange` fait le reste (redirection vers l'onboarding).
   *
   * Un échec n'est pas remonté comme une erreur : tant que l'adresse n'est pas
   * confirmée, Supabase refuse la connexion, ce qui est le cas nominal ici.
   */
  const retryPendingSignIn = async (): Promise<{ confirmed: boolean }> => {
    if (!pendingCredentials) return { confirmed: false };

    const { data, error } = await supabase.auth.signInWithPassword(pendingCredentials);
    if (error || !data.session) return { confirmed: false };

    pendingCredentials = null;
    // `signup_completed` n'est PAS émis ici : ce chemin ne voit que
    // l'inscription par e-mail sur le même appareil. Il l'est depuis
    // RootLayoutNav, où les trois chemins convergent.
    return { confirmed: true };
  };

  const signIn = async (email: string, password: string) => {
    // Symétrique de signUp : sans lui, une connexion par e-mail ne produirait
    // aucun `auth_started` alors que Google et Apple en produisent un — et
    // l'étape 2 de l'entonnoir compterait les uns sans les autres.
    track('auth_started', { method: 'email', intent: 'login' });
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    // Seul l'ÉCHEC est signalé ici. Le succès crée une session, et c'est
    // RootLayoutNav qui dira s'il s'agit d'une inscription ou d'un retour —
    // AuthContext ne peut pas le savoir.
    if (error) {
      track('auth_failed', { method: 'email', intent: 'login', error_name: error.name });
    }
    return { error };
  };

  const signInWithGoogle = async () => {
    // Le même bouton sert à s'inscrire et à revenir : l'intention n'est pas
    // connue à ce stade. La nommer « signup » gonflerait l'entonnoir
    // d'inscription de toutes les reconnexions.
    track('auth_started', { method: 'google', intent: 'unknown' });
    try {
      const redirectUrl = Platform.OS === 'web'
        ? `${window.location.origin}/auth/callback`
        : 'lucy://oauthredirect';

      // Ouvre la fenêtre AVANT de partir sur le navigateur : la redirection peut
      // revenir par Linking avant que openAuthSessionAsync ait rendu la main.
      openOAuthWindow();

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: Platform.OS !== 'web',
        },
      });

      if (error) throw error;

      if (Platform.OS !== 'web' && data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          redirectUrl
        );

        if (result.type === 'success') {
          const url = result.url;
          // Ne jamais logger url : elle contient access_token et refresh_token dans le hash.

          const hashIndex = url.indexOf('#');
          if (hashIndex !== -1) {
            const hashParams = new URLSearchParams(url.substring(hashIndex + 1));

            if (hashParams.get('error')) {
              throw new Error(hashParams.get('error_description') || 'Authentication failed');
            }

            const access_token = hashParams.get('access_token');
            const refresh_token = hashParams.get('refresh_token');

            if (access_token && refresh_token) {
              const { error: sessionError } = await supabase.auth.setSession({
                access_token,
                refresh_token,
              });

              if (sessionError) throw sessionError;
            }
          }
        } else if (result.type === 'cancel') {
          track('oauth_cancelled', { method: 'google' });
          return { error: { message: 'Authentication cancelled', name: 'AuthCancelled' } as AuthError };
        }
      }

      // Pas de `logged_in` ici : ce `return` est aussi atteint quand la
      // fenêtre s'est refermée sans session (result.type autre que success ou
      // cancel). L'issue réelle se lit à l'apparition de la session.
      return { error: null };
    } catch (error: any) {
      track('auth_failed', {
        method: 'google',
        intent: 'unknown',
        error_name: error?.name ?? 'unknown',
      });
      console.error('Error signing in with Google:', error);
      return { error: error as AuthError };
    }
  };

  const signInWithApple = async () => {
    // Le même bouton sert à s'inscrire et à revenir : l'intention n'est pas
    // connue à ce stade. La nommer « signup » gonflerait l'entonnoir
    // d'inscription de toutes les reconnexions.
    track('auth_started', { method: 'apple', intent: 'unknown' });
    try {
      const redirectUrl = Platform.OS === 'web'
        ? `${window.location.origin}/auth/callback`
        : 'lucy://oauthredirect';

      // Ouvre la fenêtre AVANT de partir sur le navigateur : la redirection peut
      // revenir par Linking avant que openAuthSessionAsync ait rendu la main.
      openOAuthWindow();

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: Platform.OS !== 'web',
        },
      });

      if (error) throw error;

      if (Platform.OS !== 'web' && data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          redirectUrl
        );

        if (result.type === 'success') {
          const url = result.url;
          // Ne jamais logger url : elle contient access_token et refresh_token dans le hash.

          const hashIndex = url.indexOf('#');
          if (hashIndex !== -1) {
            const hashParams = new URLSearchParams(url.substring(hashIndex + 1));

            if (hashParams.get('error')) {
              throw new Error(hashParams.get('error_description') || 'Authentication failed');
            }

            const access_token = hashParams.get('access_token');
            const refresh_token = hashParams.get('refresh_token');

            if (access_token && refresh_token) {
              const { error: sessionError } = await supabase.auth.setSession({
                access_token,
                refresh_token,
              });

              if (sessionError) throw sessionError;
            }
          }
        } else if (result.type === 'cancel') {
          track('oauth_cancelled', { method: 'apple' });
          return { error: { message: 'Authentication cancelled', name: 'AuthCancelled' } as AuthError };
        }
      }

      // Pas de `logged_in` ici : ce `return` est aussi atteint quand la
      // fenêtre s'est refermée sans session (result.type autre que success ou
      // cancel). L'issue réelle se lit à l'apparition de la session.
      return { error: null };
    } catch (error: any) {
      track('auth_failed', {
        method: 'apple',
        intent: 'unknown',
        error_name: error?.name ?? 'unknown',
      });
      console.error('Error signing in with Apple:', error);
      return { error: error as AuthError };
    }
  };

  const signOut = async () => {
    // Émis AVANT la déconnexion, tant que l'identité est encore connue — et
    // suivi d'un envoi forcé : reset() efface l'identifiant, un événement
    // encore en file partirait rattaché à personne.
    track('logged_out');
    flushAnalytics();
    pendingCredentials = null;
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
  };

  const deleteAccount = async (): Promise<{ error: Error | null }> => {
    if (!user || !session) {
      return { error: new Error('No user logged in') };
    }

    try {
      await postAccountDelete(session.access_token, user.id);
    } catch (error) {
      track('account_deletion_failed');
      return { error: error as Error };
    }

    // Émis pendant que l'identité vaut encore quelque chose, et poussé tout de
    // suite : la déconnexion qui suit efface l'identifiant.
    track('account_deleted', {
      was_onboarded: !!profile?.onboarding_completed,
    });
    flushAnalytics();

    // Compte supprimé côté serveur — déconnexion locale uniquement
    // (l'utilisateur n'existe plus côté Supabase, un appel serveur échouerait)
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Ignore : on nettoie l'état local dans tous les cas
    }
    setSession(null);
    setUser(null);
    setProfile(null);

    return { error: null };
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) {
      return { error: new Error('No user logged in') };
    }
  
    try {
      // On construit le payload en s'assurant que user_id est présent
      const payload = {
        user_id: user.id,
        ...updates,
      };
  
      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .maybeSingle();
  
      if (error) throw error;
  
      // On met à jour le contexte directement avec la ligne retournée
      if (data) {
        setProfile(data as Profile);
      }
  
      return { error: null };
    } catch (error) {
      console.error('updateProfile error:', error);
      return { error: error as Error };
    }
  };  

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const patchProfile = (updates: Partial<Profile>) => {
    setProfile((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        signUp,
        signIn,
        signInWithGoogle,
        signInWithApple,
        signOut,
        retryPendingSignIn,
        deleteAccount,
        updateProfile,
        refreshProfile,
        patchProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
