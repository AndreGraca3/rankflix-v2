using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Data.Entities;

namespace Rankflix.Auth;

// Runs once per request after the Supabase-issued JWT has already been signature/issuer/audience
// validated by the JwtBearer handler. Supabase's `sub` claim is that user's Supabase Auth UUID,
// which has no meaning to the rest of this app (every controller keys everything off our own
// internal integer user id and "admin"/"member" role). This maps Supabase identity -> our
// UserEntity, lazily creating the row on a user's very first authenticated request (equivalent
// to what the old /api/auth/register endpoint used to do), then adds ClaimTypes.NameIdentifier
// and ClaimTypes.Role claims so every existing `User.FindFirstValue(ClaimTypes.NameIdentifier)`
// / `[Authorize(Roles = "admin")]` call site keeps working unchanged.
public class SupabaseClaimsTransformation(RankflixDbContext db) : IClaimsTransformation
{
    // Marker claim to make this idempotent - ASP.NET Core may invoke ClaimsTransformation more
    // than once for the same request/principal.
    private const string MappedClaimType = "rf:mapped";

    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        var identity = principal.Identity as ClaimsIdentity;
        if (identity is null || !identity.IsAuthenticated || identity.HasClaim(c => c.Type == MappedClaimType))
            return principal;

        var subClaim = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (subClaim is null || !Guid.TryParse(subClaim, out var supabaseUserId))
            return principal;

        var user = await db.Users.FirstOrDefaultAsync(u => u.SupabaseUserId == supabaseUserId);
        if (user is null)
        {
            var email = principal.FindFirstValue("email") ?? principal.FindFirstValue(ClaimTypes.Email);
            // The frontend signs up with a synthetic "username@rankflix.local" address (there is
            // no real email in this app) - strip the fake domain back off so the stored username
            // matches exactly what the user typed at signup.
            var usernameFromEmail = email?.Split('@')[0];
            var displayName = TryGetUserMetadataDisplayName(principal) ?? usernameFromEmail ?? subClaim;

            // The very first account ever created becomes admin automatically, so there is no
            // manual DB step needed to bootstrap the first admin on a fresh deployment.
            var isFirstUser = !await db.Users.AnyAsync();

            user = new UserEntity
            {
                SupabaseUserId = supabaseUserId,
                Username = usernameFromEmail ?? subClaim,
                DisplayName = displayName,
                Role = isFirstUser ? "admin" : "member",
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
        }

        // The JwtBearer handler's default inbound claim mapping already translates the token's
        // "sub" claim into a ClaimTypes.NameIdentifier claim holding the Supabase UUID -
        // FindFirstValue returns the *first* matching claim, so without removing that one first,
        // every `User.FindFirstValue(ClaimTypes.NameIdentifier)` call site would keep reading the
        // UUID instead of our internal int id, no matter that we also add our own claim below.
        foreach (var existing in identity.FindAll(ClaimTypes.NameIdentifier).ToList())
            identity.RemoveClaim(existing);
        foreach (var existing in identity.FindAll(ClaimTypes.Role).ToList())
            identity.RemoveClaim(existing);

        identity.AddClaim(new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()));
        identity.AddClaim(new Claim(ClaimTypes.Role, user.Role));
        identity.AddClaim(new Claim(MappedClaimType, "1"));

        return principal;
    }

    // Supabase puts any signup-time metadata (e.g. { "display_name": "..." } passed via
    // supabase.auth.signUp({ options: { data: {...} } })) into a single `user_metadata` JWT
    // claim whose value is a raw JSON object string, not a dotted claim key.
    private static string? TryGetUserMetadataDisplayName(ClaimsPrincipal principal)
    {
        var raw = principal.FindFirstValue("user_metadata");
        if (string.IsNullOrWhiteSpace(raw)) return null;

        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.TryGetProperty("display_name", out var value) ? value.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
