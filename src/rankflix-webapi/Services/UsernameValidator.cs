using Microsoft.AspNetCore.Http;

namespace Rankflix.Services;

/// <summary>
/// Shared length/shape rules for usernames, enforced at registration, self-service profile
/// updates, and admin user edits alike. The "user" table column is varchar(100), so without
/// this an overly long username would surface as a raw Postgres error instead of a clean 400.
/// </summary>
public static class UsernameValidator
{
    public const int MinLength = 3;
    public const int MaxLength = 32;

    /// <summary>
    /// Trims the given username and validates its length, throwing an <see cref="AppException"/>
    /// (400) with a client-safe message if it's out of bounds. Returns the trimmed value.
    /// </summary>
    public static string ValidateAndTrim(string username)
    {
        var trimmed = username.Trim();
        if (trimmed.Length < MinLength || trimmed.Length > MaxLength)
        {
            throw new AppException(
                $"Username must be between {MinLength} and {MaxLength} characters",
                StatusCodes.Status400BadRequest);
        }

        return trimmed;
    }
}
