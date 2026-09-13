namespace Rankflix.Models.Media;

public class AddMediaRequest
{
    public required int TmdbId { get; set; }
    public required string Title { get; set; }
    public required string Type { get; set; } // "movie" | "tv"
    public string? PosterUrl { get; set; }
    public int? VotingDurationHours { get; set; }
    public List<int>? WatchedByUserIds { get; set; }
    public List<string>? WatchedByDiscordIds { get; set; }
}

public class UpdateVotingDurationRequest
{
    public required int VotingDurationHours { get; set; }
}

public class WatcherStatusResponse
{
    public int? UserId { get; init; }
    public required string Username { get; init; }
    public string? AvatarUrl { get; init; }
    public required bool HasWatched { get; init; }
    public double? Rating { get; init; }
    public string? Comment { get; init; }
    public DateTime? RatedAt { get; init; }
    public bool IsPending { get; init; }
    public string? DiscordId { get; init; }
}

public class GroupMediaResponse
{
    public required int TmdbId { get; init; }
    public required string Title { get; init; }
    public required string Type { get; init; }
    public string? PosterUrl { get; init; }
    public required DateTime AddedAt { get; init; }
    public required int VotingDurationHours { get; init; }
    public required DateTime VotingClosesAt { get; init; }
    public required bool VotingOpen { get; init; }
    public required double? AverageRating { get; init; }
    public required List<WatcherStatusResponse> Watchers { get; init; }
}
