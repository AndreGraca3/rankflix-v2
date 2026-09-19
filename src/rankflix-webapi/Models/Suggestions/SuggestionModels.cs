namespace Rankflix.Models.Suggestions;

public class AddSuggestionRequest
{
    public required int TmdbId { get; set; }
    public required string Title { get; set; }
    public required string Type { get; set; } // "movie" | "tv"
    public string? PosterUrl { get; set; }
}

public class PromoteSuggestionRequest
{
    public int? VotingDurationHours { get; set; }
}

public class SpinSuggestionsResponse
{
    public required Guid WinnerSuggestionId { get; init; }
}

public class SuggestionResponse
{
    public required Guid Id { get; init; }
    public required int TmdbId { get; init; }
    public required string Title { get; init; }
    public required string Type { get; init; }
    public string? PosterUrl { get; init; }
    public int? Year { get; init; }
    public int? RuntimeMinutes { get; init; }
    public string? Genre { get; init; }
    public required int AddedByUserId { get; init; }
    public required string AddedByDisplayName { get; init; }
    public string? AddedByAvatarUrl { get; init; }
    public required DateTime AddedAt { get; init; }
    // Computed server-side: true if the requesting user added this suggestion, or is a group
    // owner/site admin - lets the UI show/hide the remove action without duplicating that logic.
    public required bool CanRemove { get; init; }
}
