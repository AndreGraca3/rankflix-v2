namespace Rankflix.Models.Auth;

public class RegisterRequest
{
    public required string Username { get; set; }

    public required string Password { get; set; }

    // Optional; falls back to Username if left blank. Shown everywhere in the UI instead of
    // Username, which stays private (login-only) from here on.
    public string? DisplayName { get; set; }
}
