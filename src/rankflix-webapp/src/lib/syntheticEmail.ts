// This app has no real email of its own to send anything to - users sign in with a plain
// username. Supabase's email/password provider still requires a syntactically valid email
// address though, so we transparently map username -> a synthetic, never-delivered address
// under a fixed fake domain. Users never see or type this anywhere.
const SYNTHETIC_EMAIL_DOMAIN = "rankflix.local";

export function toSyntheticEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}
