using Microsoft.AspNetCore.Mvc;
using Rankflix.Models.Auth;
using Rankflix.Services;

namespace Rankflix.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(IAuthService authService, IWebHostEnvironment env) : ControllerBase
{
    // Renamed once to unstick browsers holding an old Secure cookie from before the
    // dev-mode Secure/SameSite fix (Secure cookies can't be cleared over plain HTTP).
    private const string RefreshTokenCookieName = "rf_token";

    [HttpPost("register")]
    public async Task<ActionResult<LoginResponse>> Register([FromBody] RegisterRequest request)
    {
        try
        {
            var result = await authService.RegisterAsync(request.Username, request.Password);
            SetRefreshTokenCookie(result.RefreshToken, result.RefreshTokenExpiresAt);
            return new LoginResponse { AccessToken = result.AccessToken, ExpireMinutes = result.ExpireMinutes };
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost("login")]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request)
    {
        try
        {
            var result = await authService.LoginAsync(request.Username, request.Password);
            SetRefreshTokenCookie(result.RefreshToken, result.RefreshTokenExpiresAt);
            return new LoginResponse { AccessToken = result.AccessToken, ExpireMinutes = result.ExpireMinutes };
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost("refresh")]
    public async Task<ActionResult<LoginResponse>> Refresh()
    {
        var oldRefreshToken = Request.Cookies[RefreshTokenCookieName];
        if (oldRefreshToken is null || !Guid.TryParse(oldRefreshToken, out var refreshTokenValue))
            return Unauthorized();

        try
        {
            var result = await authService.RefreshTokensAsync(refreshTokenValue);
            SetRefreshTokenCookie(result.RefreshToken, result.RefreshTokenExpiresAt);
            return new LoginResponse { AccessToken = result.AccessToken, ExpireMinutes = result.ExpireMinutes };
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost("sign-out")]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(RefreshTokenCookieName);
        return NoContent();
    }

    private void SetRefreshTokenCookie(Guid refreshToken, DateTime expiresAt)
    {
        // In dev the site runs over plain HTTP, and browsers refuse to persist
        // Secure cookies over HTTP, so the refresh cookie would silently never
        // be stored (breaking "stay logged in"). Only require Secure/SameSite=Strict
        // in production where everything runs over HTTPS.
        var isProd = env.IsProduction();
        Response.Cookies.Append(RefreshTokenCookieName, refreshToken.ToString(), new CookieOptions
        {
            HttpOnly = true,
            Secure = isProd,
            SameSite = isProd ? SameSiteMode.Strict : SameSiteMode.Lax,
            Expires = expiresAt
        });
    }
}
