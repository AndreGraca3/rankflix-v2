namespace Rankflix.Services;

/// <summary>
/// An exception whose message and status code are safe to return directly to API clients.
/// </summary>
public class AppException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
