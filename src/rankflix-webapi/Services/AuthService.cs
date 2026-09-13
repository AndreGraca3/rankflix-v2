using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Rankflix.Auth;
using Rankflix.Data.Entities;
using Rankflix.Models.Auth;

namespace Rankflix.Services;

public record LoginResult(string AccessToken, int ExpireMinutes, Guid RefreshToken, DateTime RefreshTokenExpiresAt);

public interface IAuthService
{
    Task<LoginResult> RegisterAsync(string username, string password);
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

    public async Task<LoginResult> RegisterAsync(string username, string password)
    {
        username = UsernameValidator.ValidateAndTrim(username);

        if (await userRepository.GetByUsernameAsync(username) is not null)
            throw new AppException("Username already in use", StatusCodes.Status409Conflict);

        // The very first account ever created becomes admin automatically, so there is
        // no manual DB step needed to bootstrap the first admin on a fresh deployment.
        var isFirstUser = !await userRepository.AnyAsync();

        var user = await userRepository.AddAsync(new UserEntity
        {
            Username = username,
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
        var token = await ResolveActiveTokenAsync(refreshToken, depth: 0);

        var user = await userRepository.GetByIdAsync(token.UserId)
                   ?? throw new AppException("User not found", StatusCodes.Status401Unauthorized);

        // Create the replacement first so the token being consumed can point at it - other
        // devices/tabs are unaffected, they keep their own separate refresh tokens.
        var result = await GenerateLoginResultAsync(user);
        await tokenRepository.MarkUsedAsync(token, result.RefreshToken);
        return result;
    }

    // Resolves a presented refresh token to the still-active token in its rotation chain.
    // Refresh tokens are single-use, but a short grace window lets a near-simultaneous
    // duplicate call (e.g. two browser tabs both refreshing right as the access token
    // expires) follow the chain to its replacement instead of being wrongly logged out.
    // Reuse of a token outside that window is treated as suspicious and revokes every
    // refresh token for the user.
    private async Task<RefreshTokenEntity> ResolveActiveTokenAsync(Guid value, int depth)
    {
        if (depth > 5) throw new AppException("Invalid refresh token", StatusCodes.Status401Unauthorized);

        var token = await tokenRepository.GetByValueAsync(value);
        if (token is null || tokenRepository.IsExpired(token))
            throw new AppException("Invalid refresh token", StatusCodes.Status401Unauthorized);

        if (token.UsedAt is null) return token;

        const int gracePeriodSeconds = 15;
        var withinGracePeriod = token.UsedAt.Value.AddSeconds(gracePeriodSeconds) >= DateTime.UtcNow;
        if (withinGracePeriod && token.ReplacedByValue is not null)
            return await ResolveActiveTokenAsync(token.ReplacedByValue.Value, depth + 1);

        await tokenRepository.RemoveByUserIdAsync(token.UserId);
        throw new AppException("Invalid refresh token", StatusCodes.Status401Unauthorized);
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
        var (accessToken, accessTokenExpiresAt) = jwtProvider.Generate(user);

        var refreshToken = await tokenRepository.AddAsync(user.Id);
        var refreshTokenExpiresAt = refreshToken.CreatedAt.AddMinutes(_refreshTokenOptions.ExpireMinutes);

        return new LoginResult(
            accessToken,
            (int)accessTokenExpiresAt.Subtract(DateTime.UtcNow).TotalMinutes,
            refreshToken.Value,
            refreshTokenExpiresAt);
    }
}
