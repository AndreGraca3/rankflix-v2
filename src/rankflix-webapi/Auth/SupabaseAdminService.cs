using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace Rankflix.Auth;

public interface ISupabaseAdminService
{
    /// <summary>Directly sets a Supabase Auth user's password via the Admin API. Used for
    /// admin-initiated resets, since the app has no email channel of its own to run a
    /// self-service "forgot password" flow through.</summary>
    Task SetUserPasswordAsync(Guid supabaseUserId, string newPassword, CancellationToken ct = default);
}

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
}
