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
    public required string DisplayName { get; init; }
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
    public int? RuntimeMinutes { get; init; }
    public string? Genre { get; init; }
    public int? Year { get; init; }
}

// Query params for GET /api/groups/{id}/media. Filtering/sorting/pagination all happen
// server-side so the client only ever transfers one page of the (possibly narrowed-down) list.
public class GetGroupMediaQuery
{
    public int Skip { get; set; } = 0;
    public int Take { get; set; } = 30;
    public string? Search { get; set; }
    public List<string>? Genre { get; set; }
    public double? MinRating { get; set; }
    public bool UnratedOnly { get; set; }
    public string VotingStatus { get; set; } = "all"; // all | open | closed
    public bool PendingVotesOnly { get; set; }

    // "average" (default), a numeric real-member user id, or a pending (Excel-imported) member's
    // Discord id - determines both what rating each item is ranked/sorted by and, for a specific
    // member, that only media they've watched is included (matches the old client-side behavior).
    public string RankingMember { get; set; } = "average";
}

public class PagedGroupMediaResponse
{
    public required List<GroupMediaResponse> Items { get; init; }
    public required int TotalCount { get; init; }
    public required bool HasMore { get; init; }
    // Total media in the group regardless of active filters - lets the client tell "no media in
    // this group at all" apart from "no media matches the current filters".
    public required int TotalMediaInGroup { get; init; }
    public required List<string> AvailableGenres { get; init; }
}
