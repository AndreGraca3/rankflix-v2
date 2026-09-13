namespace Rankflix.Auth;

public class RegistrationOptions
{
    // When set, new registrations (other than the very first/admin account) must supply a matching
    // invite code. Leave blank to keep registration open (e.g. local development).
    public string? InviteCode { get; set; }
}
