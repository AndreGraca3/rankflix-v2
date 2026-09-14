namespace Rankflix.Models.Auth;

public class RegisterRequest
{
    public required string Username { get; set; }

    public required string Password { get; set; }

    // Public friendly name shown everywhere in the UI instead of Username, which stays
    // private (login-only) from here on.
    public required string DisplayName { get; set; }
}
