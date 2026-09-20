using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Rankflix.Auth;

namespace Rankflix.Controllers;

public record RegisterRequest(string Username, string Password, string DisplayName);

[ApiController]
[Route("api/auth")]
[AllowAnonymous]
public partial class AuthController(ISupabaseAdminService supabaseAdmin, ILogger<AuthController> logger) : ControllerBase
{
    // Same pattern enforced client-side on the Register form's username input.
    [GeneratedRegex("^[A-Za-z0-9._-]{1,60}$")]
    private static partial Regex UsernamePattern();

    // Registration is handled server-side via the Supabase Admin API rather than the public
    // client-side `supabase.auth.signUp()`, because that endpoint validates the email address
    // has a resolvable domain/MX record - which this app's synthetic
    // "username@rankflix.local" addresses never will (there's no real mailbox behind them,
    // by design - see syntheticEmail.ts). The Admin API has no such restriction. The frontend
    // signs in normally with the same credentials right after this succeeds.
    [HttpPost("register")]
    public async Task<ActionResult> Register([FromBody] RegisterRequest request)
    {
        var username = request.Username?.Trim().ToLowerInvariant() ?? "";
        var displayName = request.DisplayName?.Trim() ?? "";

        if (!UsernamePattern().IsMatch(username))
            return Problem("Username must be 1-60 characters: letters, numbers, dots, dashes, or underscores.", statusCode: 400);
        if (string.IsNullOrWhiteSpace(displayName))
            return Problem("Display name is required.", statusCode: 400);
        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 6)
            return Problem("Password must be at least 6 characters.", statusCode: 400);

        var syntheticEmail = $"{username}@rankflix.local";

        try
        {
            await supabaseAdmin.CreateUserAsync(syntheticEmail, request.Password, displayName);
        }
        catch (SupabaseUserAlreadyExistsException)
        {
            return Problem("Username already in use", statusCode: 409);
        }
        catch (Exception ex)
        {
            // Covers any Supabase Admin API failure we haven't specifically anticipated (rate
            // limiting, transient outage, unexpected error shape, etc.) - returning a normal
            // Problem response here (rather than letting it propagate to the global handler)
            // keeps the message specific to registration.
            logger.LogError(ex, "Registration failed for username {Username}", username);
            return Problem("Registration failed. Please try again in a moment.", statusCode: 502);
        }

        return NoContent();
    }
}
