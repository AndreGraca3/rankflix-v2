namespace Rankflix.Auth;

public class JwtOptions
{
    public required string SecretKey { get; set; }

    public required string Issuer { get; set; }

    public required string Audience { get; set; }

    public int ExpireMinutes { get; set; } = 30;
}
