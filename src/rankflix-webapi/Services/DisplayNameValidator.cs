using Microsoft.AspNetCore.Http;

namespace Rankflix.Services;

/// <summary>
/// Shared length rules for the friendly display name shown throughout the UI (leaderboards,
/// watcher lists, reviews, admin panels), enforced at registration, self-service profile updates,
/// and admin edits alike. Unlike <see cref="UsernameValidator"/>, display names don't need to be
/// unique - they're just a friendly label, independent of the private login credential.
/// </summary>
public static class DisplayNameValidator
{
    public const int MinLength = 1;
    public const int MaxLength = 60;

    /// <summary>
    /// Trims the given display name and validates its length, throwing an <see cref="AppException"/>
    /// (400) with a client-safe message if it's out of bounds. Returns the trimmed value.
    /// </summary>
    public static string ValidateAndTrim(string displayName)
    {
        var trimmed = displayName.Trim();
        if (trimmed.Length < MinLength || trimmed.Length > MaxLength)
        {
            throw new AppException(
                $"Display name must be between {MinLength} and {MaxLength} characters",
                StatusCodes.Status400BadRequest);
        }

        return trimmed;
    }
}
