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
            var result = await authService.RegisterAsync(request.Username, request.Password, request.DisplayName);
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
    public async Task<IActionResult> Logout()
    {
        // Revoke only this device's refresh token - other devices/tabs stay signed in.
        var refreshTokenCookie = Request.Cookies[RefreshTokenCookieName];
        if (refreshTokenCookie is not null && Guid.TryParse(refreshTokenCookie, out var refreshTokenValue))
        {
            await authService.RevokeRefreshTokenByValueAsync(refreshTokenValue);
        }

        Response.Cookies.Delete(RefreshTokenCookieName);
        return NoContent();
    }

    private void SetRefreshTokenCookie(Guid refreshToken, DateTime expiresAt)
    {
        // The frontend (static site) and this API run on different Render domains, which
        // browsers treat as cross-site. Cross-site fetch/XHR requests only ever include
        // SameSite=None cookies (Strict/Lax are silently dropped on cross-site requests,
        // even though they still get stored after login) - so refresh-on-page-load would
        // always fail in production without this. SameSite=None requires Secure=true,
        // which browsers refuse to persist over plain HTTP, so dev (plain HTTP) still
        // needs Lax/non-secure instead.
        var isProd = env.IsProduction();
        Response.Cookies.Append(RefreshTokenCookieName, refreshToken.ToString(), new CookieOptions
        {
            HttpOnly = true,
            Secure = isProd,
            SameSite = isProd ? SameSiteMode.None : SameSiteMode.Lax,
            Expires = expiresAt
        });
    }
}
