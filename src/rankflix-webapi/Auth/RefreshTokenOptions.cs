namespace Rankflix.Auth;

public class RefreshTokenOptions
{
    public int ExpireMinutes { get; set; } = 60 * 24 * 30; // 30 days
}
