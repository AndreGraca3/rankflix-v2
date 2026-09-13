namespace Rankflix.Models.Auth;

public class RegisterRequest
{
    public required string Username { get; set; }

    public required string Password { get; set; }

    // Required once Registration:InviteCode is configured (see AuthService.RegisterAsync) - lets
    // an admin share a private link/code with friends instead of leaving sign-up wide open to
    // anyone who finds the URL once this is deployed publicly.
    public string? InviteCode { get; set; }
}
