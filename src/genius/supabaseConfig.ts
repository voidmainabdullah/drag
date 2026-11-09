/**
 * Public Supabase configuration (URL + publishable key). Both are designed to be public: row-level security is what
 * protects data, and no service-role key is ever used or required. Override per environment with
 * VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (the NEXT_PUBLIC_* names are accepted too).
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

export const SUPABASE_URL: string = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || 'https://oiffztqactqszxyjrqtj.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY: string = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_BZkatwDc3m9x2OXvym3ZsA_cAEAt4xj'
