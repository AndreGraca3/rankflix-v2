using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Rankflix.Auth;
using Rankflix.Data.Entities;
using Rankflix.Models.Auth;

namespace Rankflix.Services;

public record LoginResult(string AccessToken, int ExpireMinutes, Guid RefreshToken, DateTime RefreshTokenExpiresAt);

public interface IAuthService
{
    Task<LoginResult> RegisterAsync(string username, string password, string? inviteCode);
    Task<LoginResult> LoginAsync(string username, string password);
    Task<LoginResult> RefreshTokensAsync(Guid refreshToken);
    Task RevokeRefreshTokenAsync(int userId);
}

public class AuthService(
    IUserRepository userRepository,
    ITokenRepository tokenRepository,
    IJwtProvider jwtProvider,
    IOptions<RefreshTokenOptions> refreshTokenOptions,
    IOptions<RegistrationOptions> registrationOptions) : IAuthService
{
    private readonly RefreshTokenOptions _refreshTokenOptions = refreshTokenOptions.Value;
    private readonly RegistrationOptions _registrationOptions = registrationOptions.Value;

    public async Task<LoginResult> RegisterAsync(string username, string password, string? inviteCode)
    {
        username = UsernameValidator.ValidateAndTrim(username);

        if (await userRepository.GetByUsernameAsync(username) is not null)
            throw new AppException("Username already in use", StatusCodes.Status409Conflict);

        // The very first account ever created becomes admin automatically, so there is
        // no manual DB step needed to bootstrap the first admin on a fresh deployment.
        var isFirstUser = !await userRepository.AnyAsync();

        // Once an invite code is configured, gate every sign-up after the bootstrap admin behind
        // it - otherwise anyone who finds the deployed URL could create an account.
        if (!isFirstUser && !string.IsNullOrEmpty(_registrationOptions.InviteCode) &&
            inviteCode != _registrationOptions.InviteCode)
        {
            throw new AppException("Invalid or missing invite code", StatusCodes.Status403Forbidden);
        }

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
        var token = await tokenRepository.GetByValueAsync(refreshToken);
        if (token is null || tokenRepository.IsExpired(token))
            throw new AppException("Invalid refresh token", StatusCodes.Status401Unauthorized);

        var user = await userRepository.GetByIdAsync(token.UserId)
                   ?? throw new AppException("User not found", StatusCodes.Status401Unauthorized);

        // Rotate only the token being used (single-use, replay-proof) - other devices/tabs keep
        // their own refresh tokens and stay logged in.
        await tokenRepository.RemoveByValueAsync(refreshToken);
        return await GenerateLoginResultAsync(user);
    }

    public async Task RevokeRefreshTokenAsync(int userId)
    {
        await tokenRepository.RemoveByUserIdAsync(userId);
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
