namespace Rankflix.Models.Auth;

public class UserProfileResponse
{
    public required int Id { get; init; }

    public required string Username { get; init; }

    public string? AvatarUrl { get; init; }

    public string? DiscordId { get; init; }

    public required string Role { get; init; }

    public required string Status { get; init; }
}
