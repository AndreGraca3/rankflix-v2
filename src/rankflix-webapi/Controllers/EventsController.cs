using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Rankflix.Services;

namespace Rankflix.Controllers;

[ApiController]
[Route("api/events")]
[Authorize]
public class EventsController(ISseService sse, IUserRepository userRepository) : ControllerBase
{
    // A single long-lived Server-Sent-Events connection per browser tab. The client
    // authenticates with the normal Authorization header (this uses fetch + a readable
    // stream on the frontend, not the native EventSource API, precisely so we can send a
    // Bearer token like any other request instead of smuggling it in the query string).
    [HttpGet("stream")]
    public async Task Stream(CancellationToken requestAborted)
    {
        var userId = GetUserId();
        var user = await userRepository.GetByIdAsync(userId);
        var status = user?.Status ?? "online";

        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no"; // disable proxy buffering (nginx et al.)

        var reader = sse.Subscribe(userId, status, out var subscriptionId);
        try
        {
            await Response.WriteAsync(": connected\n\n", requestAborted);
            await Response.Body.FlushAsync(requestAborted);

            while (!requestAborted.IsCancellationRequested)
            {
                using var heartbeatCts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
                heartbeatCts.CancelAfter(TimeSpan.FromSeconds(20));

                string? message = null;
                try
                {
                    message = await reader.ReadAsync(heartbeatCts.Token);
                }
                catch (OperationCanceledException) when (!requestAborted.IsCancellationRequested)
                {
                    // 20s elapsed with no event - send a comment to keep the connection alive
                    // through idle-timeout-happy proxies/load balancers.
                }

                if (requestAborted.IsCancellationRequested) break;

                await Response.WriteAsync(message ?? ": ping\n\n", requestAborted);
                await Response.Body.FlushAsync(requestAborted);
            }
        }
        catch (OperationCanceledException)
        {
            // Client disconnected - normal.
        }
        finally
        {
            sse.Unsubscribe(userId, subscriptionId);
        }
    }

    private int GetUserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
