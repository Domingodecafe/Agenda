import { createHandler } from './handler.js';

// Somente chave pública e JWT do chamador; nunca usa service_role/secret.
Deno.serve(createHandler({
  projectUrl: Deno.env.get('SUPABASE_URL') ?? '',
  publicKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  fetchImpl: fetch,
}));
