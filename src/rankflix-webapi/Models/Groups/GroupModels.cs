namespace Rankflix.Models.Groups;

public class CreateGroupRequest
{
    public required string Name { get; set; }
    public string? ImageUrl { get; set; }
}

public class UpdateGroupRequest
{
    public string? Name { get; set; }
    public string? ImageUrl { get; set; }
}

public class AddMemberRequest
{
    public required int UserId { get; set; }
}

public class MemberResponse
{
    public required int UserId { get; init; }
    public required string Username { get; init; }
    public string? AvatarUrl { get; init; }
    public string? DiscordId { get; init; }
    public required bool IsOwner { get; init; }
}

public class PendingMemberResponse
{
    public required string DiscordId { get; init; }
    public string? DisplayName { get; init; }
}

public class UpdateMembershipOwnershipRequest
{
    public required bool IsOwner { get; set; }
}

public class GroupResponse
{
    public required int Id { get; init; }
    public required string Name { get; init; }
    // The user who originally created the group. Informational only - actual management
    // permissions are governed by each member's IsOwner flag (a group can have several owners).
    public required int OwnerId { get; init; }
    public string? ImageUrl { get; init; }
    public required List<MemberResponse> Members { get; init; }
    public required List<PendingMemberResponse> PendingMembers { get; init; }
}

public class MemberStatsResponse
{
    public required int UserId { get; init; }
    public required string Username { get; init; }
    public string? AvatarUrl { get; init; }
    public string? DiscordId { get; init; }
    public required int MoviesWatched { get; init; }
    public required int TvWatched { get; init; }
    public required int TotalRatingsGiven { get; init; }
    public double? AverageRatingGiven { get; init; }
}

public class PendingMemberStatsResponse
{
    public required string DiscordId { get; init; }
    public string? DisplayName { get; init; }
    public required int MoviesWatched { get; init; }
    public required int TvWatched { get; init; }
    public required int TotalRatingsGiven { get; init; }
    public double? AverageRatingGiven { get; init; }
}

public class GroupStatsResponse
{
    public required List<MemberStatsResponse> Members { get; init; }
    public required List<PendingMemberStatsResponse> PendingMembers { get; init; }
    public TopMediaInGroupResponse? TopMedia { get; init; }
}

public class TopMediaInGroupResponse
{
    public required int TmdbId { get; init; }
    public required string Title { get; init; }
    public string? PosterUrl { get; init; }
    public required double AverageRating { get; init; }
}
