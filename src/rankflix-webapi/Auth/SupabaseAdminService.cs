using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Rankflix.Auth;

public interface ISupabaseAdminService
{
    /// <summary>Directly sets a Supabase Auth user's password via the Admin API. Used for
    /// admin-initiated resets, since the app has no email channel of its own to run a
    /// self-service "forgot password" flow through.</summary>
    Task SetUserPasswordAsync(Guid supabaseUserId, string newPassword, CancellationToken ct = default);

    /// <summary>Creates a Supabase Auth user via the Admin API (server-side, secret-key
    /// authenticated). Used for registration instead of the public client-side
    /// `supabase.auth.signUp()`, because that endpoint validates the email address has a
    /// resolvable domain/MX record - which the app's synthetic "username@rankflix.local"
    /// addresses never will, since they're never meant to receive real mail. The Admin API
    /// has no such restriction. Returns the new user's Supabase UUID.</summary>
    /// <exception cref="SupabaseUserAlreadyExistsException">The email is already registered.</exception>
    Task<Guid> CreateUserAsync(string email, string password, string displayName, CancellationToken ct = default);
}

public class SupabaseUserAlreadyExistsException : Exception;

public class SupabaseAdminService : ISupabaseAdminService
{
    private readonly HttpClient _http;

    public SupabaseAdminService(HttpClient http, IOptions<SupabaseOptions> options)
    {
        var opts = options.Value;
        _http = http;
        _http.BaseAddress = new Uri(opts.Url.TrimEnd('/') + "/");
        // Supabase's Admin API accepts the secret/service-role key as both the apikey header
        // and the bearer token.
        _http.DefaultRequestHeaders.Add("apikey", opts.SecretKey);
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", opts.SecretKey);
    }

    public async Task SetUserPasswordAsync(Guid supabaseUserId, string newPassword, CancellationToken ct = default)
    {
        var response = await _http.PutAsJsonAsync(
            $"auth/v1/admin/users/{supabaseUserId}",
            new { password = newPassword },
            ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Supabase admin password reset failed ({(int)response.StatusCode}): {body}");
        }
    }

    public async Task<Guid> CreateUserAsync(string email, string password, string displayName, CancellationToken ct = default)
    {
        var response = await _http.PostAsJsonAsync(
            "auth/v1/admin/users",
            new
            {
                email,
                password,
                email_confirm = true,
                user_metadata = new { display_name = displayName }
            },
            ct);

        var body = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
        {
            // Supabase returns 422 with a message like "A user with this email address has
            // already been registered" when the (synthetic) email is taken.
            if (body.Contains("already been registered", StringComparison.OrdinalIgnoreCase)
                || body.Contains("already exists", StringComparison.OrdinalIgnoreCase))
                throw new SupabaseUserAlreadyExistsException();

            throw new InvalidOperationException(
                $"Supabase admin user creation failed ({(int)response.StatusCode}): {body}");
        }

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("id").GetGuid();
    }
}
