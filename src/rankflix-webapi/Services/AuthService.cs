using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Rankflix.Auth;
using Rankflix.Data.Entities;
using Rankflix.Models.Auth;

namespace Rankflix.Services;

public record LoginResult(string AccessToken, int ExpireMinutes, Guid RefreshToken, DateTime RefreshTokenExpiresAt);

public interface IAuthService
{
    Task<LoginResult> RegisterAsync(string username, string password, string displayName);
    Task<LoginResult> LoginAsync(string username, string password);
    Task<LoginResult> RefreshTokensAsync(Guid refreshToken);
    Task RevokeRefreshTokenAsync(int userId);
    Task RevokeRefreshTokenByValueAsync(Guid refreshToken);
}

public class AuthService(
    IUserRepository userRepository,
    ITokenRepository tokenRepository,
    IJwtProvider jwtProvider,
    IOptions<RefreshTokenOptions> refreshTokenOptions) : IAuthService
{
    private readonly RefreshTokenOptions _refreshTokenOptions = refreshTokenOptions.Value;

    // How long a just-rotated (single-use) refresh token is still tolerated. Needed because
    // several tabs on the same device/browser share one cookie: if two of them silently
    // refresh around the same moment (e.g. laptop waking from sleep, both SSE connections
    // reconnecting at once), only the first request actually rotates the token - without this
    // grace window, the second, near-simultaneous request would be wrongly rejected as an
    // invalid/reused token and that tab would get logged out.
    private static readonly TimeSpan ReuseGracePeriod = TimeSpan.FromSeconds(30);

    public async Task<LoginResult> RegisterAsync(string username, string password, string displayName)
    {
        username = UsernameValidator.ValidateAndTrim(username);

        if (await userRepository.GetByUsernameAsync(username) is not null)
            throw new AppException("Username already in use", StatusCodes.Status409Conflict);

        var resolvedDisplayName = DisplayNameValidator.ValidateAndTrim(displayName);

        // The very first account ever created becomes admin automatically, so there is
        // no manual DB step needed to bootstrap the first admin on a fresh deployment.
        var isFirstUser = !await userRepository.AnyAsync();

        var user = await userRepository.AddAsync(new UserEntity
        {
            Username = username,
            DisplayName = resolvedDisplayName,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = isFirstUser ? "admin" : "member",
            CreatedAt = DateTime.UtcNow
        });

        return await GenerateLoginResultAsync(user);
    }

    public async Task<LoginResult> LoginAsync(string username, string password)
    {
        var user = await userRepository.GetByUsernameAsync(username);
        if (user is null || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
            throw new AppException("Invalid username or password", StatusCodes.Status401Unauthorized);

        return await GenerateLoginResultAsync(user);
    }

    public async Task<LoginResult> RefreshTokensAsync(Guid refreshToken)
    {
        var token = await tokenRepository.GetByValueAsync(refreshToken);
        if (token is null)
            throw new AppException("Invalid refresh token", StatusCodes.Status401Unauthorized);

        if (token.UsedAt is not null)
        {
            if (DateTime.UtcNow - token.UsedAt.Value <= ReuseGracePeriod)
            {
                // Within the grace window: treat this as a benign race from another tab on the
                // same device rather than an error - follow the rotation chain to the still-valid
                // current token and hand that back (without rotating again) so both tabs converge
                // on the same session.
                var current = await tokenRepository.GetLatestInChainAsync(token);
                if (current is null || tokenRepository.IsExpired(current))
                    throw new AppException("Invalid refresh token", StatusCodes.Status401Unauthorized);

                var currentUser = await userRepository.GetByIdAsync(current.UserId)
                                   ?? throw new AppException("User not found", StatusCodes.Status401Unauthorized);
                return BuildLoginResult(currentUser, current);
            }

            // Reuse outside the grace window is a strong signal of a stolen/replayed token -
            // revoke every session for this user as a precaution.
            await tokenRepository.RemoveByUserIdAsync(token.UserId);
            throw new AppException("Invalid refresh token", StatusCodes.Status401Unauthorized);
        }

        if (tokenRepository.IsExpired(token))
            throw new AppException("Invalid refresh token", StatusCodes.Status401Unauthorized);

        var user = await userRepository.GetByIdAsync(token.UserId)
                   ?? throw new AppException("User not found", StatusCodes.Status401Unauthorized);

        // Rotate only the token being used (single-use, replay-proof) - other devices/tabs keep
        // their own refresh tokens and stay logged in.
        var newToken = await tokenRepository.AddAsync(user.Id);
        await tokenRepository.MarkUsedAsync(token.Value, newToken.Value);
        return BuildLoginResult(user, newToken);
    }

    public async Task RevokeRefreshTokenAsync(int userId)
    {
        await tokenRepository.RemoveByUserIdAsync(userId);
    }

    public async Task RevokeRefreshTokenByValueAsync(Guid refreshToken)
    {
        await tokenRepository.RemoveByValueAsync(refreshToken);
    }

    private async Task<LoginResult> GenerateLoginResultAsync(UserEntity user)
    {
        var refreshToken = await tokenRepository.AddAsync(user.Id);
        return BuildLoginResult(user, refreshToken);
    }

    private LoginResult BuildLoginResult(UserEntity user, RefreshTokenEntity refreshToken)
    {
        var (accessToken, accessTokenExpiresAt) = jwtProvider.Generate(user);
        var refreshTokenExpiresAt = refreshToken.CreatedAt.AddMinutes(_refreshTokenOptions.ExpireMinutes);

        return new LoginResult(
            accessToken,
            (int)accessTokenExpiresAt.Subtract(DateTime.UtcNow).TotalMinutes,
            refreshToken.Value,
            refreshTokenExpiresAt);
    }
}
