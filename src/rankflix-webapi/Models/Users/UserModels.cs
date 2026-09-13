namespace Rankflix.Models.Users;

public class AdminUpdateUserRequest
{
    public string? Username { get; set; }
    public string? AvatarUrl { get; set; }

    // Admin can reassign this when a friend changes/loses their Discord account,
    // without losing their review/group history (which is keyed off the internal user id).
    public string? DiscordId { get; set; }

    public string? Role { get; set; } // "admin" | "member"
}

public class UpdateOwnProfileRequest
{
    public string? Username { get; set; }
    public string? AvatarUrl { get; set; }
}

public class UpdateStatusRequest
{
    public required string Status { get; set; } // "online" | "invisible"
}

public class ChangePasswordRequest
{
    public required string CurrentPassword { get; set; }
    public required string NewPassword { get; set; }
}

public class ResetPasswordResponse
{
    public required string NewPassword { get; init; }
}

public class UserListItemResponse
{
    public required int Id { get; init; }
    public required string Username { get; init; }
    public string? AvatarUrl { get; init; }
    public string? DiscordId { get; init; }
    public required string Role { get; init; }
}

public class UserDirectoryItemResponse
{
    public required int Id { get; init; }
    public required string Username { get; init; }
    public string? AvatarUrl { get; init; }
}

public class TopMediaResponse
{
    public required int TmdbId { get; init; }
    public required string Title { get; init; }
    public string? PosterUrl { get; init; }
    public required double Rating { get; init; }
}

public class UserStatsResponse
{
    public required int TotalGroups { get; init; }
    public required int MoviesWatched { get; init; }
    public required int TvWatched { get; init; }
    public required int TotalRatingsGiven { get; init; }
    public double? AverageRatingGiven { get; init; }
    public TopMediaResponse? TopRated { get; init; }
}
