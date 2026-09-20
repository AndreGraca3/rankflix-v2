namespace Rankflix.Auth;

public class SupabaseOptions
{
    // Base project URL, e.g. https://xxxxx.supabase.co - not secret, safe to check in (the
    // same value is already embedded in the frontend bundle).
    public required string Url { get; set; }

    // Supabase's "secret" (service_role-equivalent) API key. Server-side only - grants full
    // admin access to the Auth Admin API (e.g. directly setting a user's password without
    // knowing their current one). Never send this to the frontend.
    public required string SecretKey { get; set; }
}
