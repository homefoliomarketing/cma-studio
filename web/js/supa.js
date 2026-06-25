// Supabase client — shared across the whole app.
//
// The PUBLISHABLE key is safe to ship in the browser: Row-Level Security (RLS)
// on every table is what actually protects each agent's data. The SECRET key is
// NEVER placed here (or anywhere in this repo). supabase-js is loaded as an ES
// module straight from the CDN, so there's no build step.
//
// Pinned to an EXACT version (not a floating @2): esm.sh serves immutable content
// per exact version, so this can't silently change under us. Bump deliberately.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const SUPABASE_URL = 'https://bzppmddqkajswjjrxbem.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yy9y6niM0KuGUS3PJ2IDbQ_dNCGqBuj';

// Photos + page-renders live in this Storage bucket (public-read, per-user write).
export const MEDIA_BUCKET = 'media';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,     // keep the agent logged in across reloads
    autoRefreshToken: true,
    detectSessionInUrl: true, // handle the password-reset redirect link
  },
});
