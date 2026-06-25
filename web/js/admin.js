// Admin API client (admin-only). These wrap the protected endpoints in
// service.py, which hold the Supabase service-role key and verify — server-side
// — that the caller is an admin before doing anything. We attach the logged-in
// user's access token as a bearer so the server can confirm who is asking; the
// secret key never touches the browser.
import { supabase } from './supa.js';

async function authHeaders(extra = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('You are not signed in.');
  return { Authorization: 'Bearer ' + token, ...extra };
}

async function handle(res) {
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok || !json || json.ok === false) {
    throw new Error((json && json.error) || `Request failed (${res.status}).`);
  }
  return json;
}

// List every agent account (email, id, created, last sign-in).
export async function listAgents() {
  const res = await fetch('/api/admin/users', { headers: await authHeaders() });
  return (await handle(res)).users || [];
}

// Create an agent with a temporary password. They'll be forced to choose their
// own on first login (the must_reset flag defaults true for new accounts).
export async function createAgent(email, password) {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  });
  return (await handle(res)).user;
}

// Permanently delete an agent (their profile, saved CMAs and photos cascade).
export async function deleteAgent(uid) {
  const res = await fetch('/api/admin/users/' + encodeURIComponent(uid), {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  return handle(res);
}

// The signed-in user's id, used to keep an admin from deleting their own row.
export async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

// A friendly, reasonably strong temporary password (the agent resets it on
// first login anyway). Uses the crypto RNG available in the app's secure context.
export function genTempPassword() {
  const words = ['Cedar', 'Maple', 'River', 'Stone', 'Harbor', 'Summit', 'Birch', 'Aspen', 'Vista', 'Willow'];
  const r = (max) => crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return words[r(words.length)] + (1000 + r(9000)) + '!cma';
}
