using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Rankflix.Models.Media;
using Rankflix.Services;

namespace Rankflix.Controllers;

[ApiController]
[Route("api/groups/{groupId:int}/media")]
[Authorize]
public class MediaController(IMediaService mediaService, IGroupService groupService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedGroupMediaResponse>> GetMedia(int groupId, [FromQuery] GetGroupMediaQuery query)
    {
        try
        {
            await EnsureAccessAsync(groupId);
            return await mediaService.GetGroupMediaAsync(groupId, query);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost]
    public async Task<ActionResult<GroupMediaResponse>> AddMedia(int groupId, [FromBody] AddMediaRequest request)
    {
        try
        {
            await EnsureManagerAsync(groupId);
            var userId = GetUserId();
            return await mediaService.AddMediaToGroupAsync(groupId, userId, request);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPatch("{tmdbId:int}/voting-duration")]
    public async Task<ActionResult<GroupMediaResponse>> UpdateVotingDuration(int groupId, int tmdbId,
        [FromBody] UpdateVotingDurationRequest request)
    {
        try
        {
            await EnsureManagerAsync(groupId);
            return await mediaService.UpdateVotingDurationAsync(groupId, tmdbId, request.VotingDurationHours);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost("{tmdbId:int}/watch/{userId:int}")]
    public async Task<IActionResult> SetWatched(int groupId, int tmdbId, int userId, [FromQuery] bool watched = true)
    {
        try
        {
            await EnsureManagerAsync(groupId);
            await mediaService.SetWatchedAsync(groupId, tmdbId, userId, watched, User.IsInRole("admin"));
            return NoContent();
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost("{tmdbId:int}/watch-pending/{discordId}")]
    public async Task<IActionResult> SetWatchedPending(int groupId, int tmdbId, string discordId, [FromQuery] bool watched = true)
    {
        try
        {
            await EnsureManagerAsync(groupId);
            await mediaService.SetWatchedPendingAsync(groupId, tmdbId, discordId, watched, User.IsInRole("admin"));
            return NoContent();
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpDelete("{tmdbId:int}")]
    public async Task<IActionResult> RemoveMedia(int groupId, int tmdbId)
    {
        try
        {
            await EnsureManagerAsync(groupId);
            await mediaService.RemoveMediaFromGroupAsync(groupId, tmdbId);
            return NoContent();
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    private async Task EnsureAccessAsync(int groupId)
    {
        if (User.IsInRole("admin")) return;
        await groupService.EnsureMemberAsync(groupId, GetUserId());
    }

    private async Task EnsureManagerAsync(int groupId)
    {
        await groupService.EnsureManagerAsync(groupId, GetUserId(), User.IsInRole("admin"));
    }

    private int GetUserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
