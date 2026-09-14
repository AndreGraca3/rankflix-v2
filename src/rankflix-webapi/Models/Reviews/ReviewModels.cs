namespace Rankflix.Models.Reviews;

public class SubmitReviewRequest
{
    public required double Rating { get; set; }
    public string? Comment { get; set; }
}

public class ReviewResponse
{
    public required Guid Id { get; init; }
    public required int UserId { get; init; }
    public required string DisplayName { get; init; }
    public required double Rating { get; init; }
    public string? Comment { get; init; }
    public required DateTime CreatedAt { get; init; }
}
