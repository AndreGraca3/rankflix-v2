using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Rankflix.Models.Media;
using Rankflix.Models.Suggestions;
using Rankflix.Services;

namespace Rankflix.Controllers;

[ApiController]
[Route("api/groups/{groupId:int}/suggestions")]
[Authorize]
public class SuggestionsController(ISuggestionService suggestionService, IGroupService groupService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<SuggestionResponse>>> GetSuggestions(int groupId)
    {
        try
        {
            await EnsureAccessAsync(groupId);
            return await suggestionService.GetSuggestionsAsync(groupId, GetUserId(), User.IsInRole("admin"));
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    // Any group member can suggest a title, not just owners/admins - this is a wishlist,
    // not the managed media list.
    [HttpPost]
    public async Task<ActionResult<SuggestionResponse>> AddSuggestion(int groupId, [FromBody] AddSuggestionRequest request)
    {
        try
        {
            await EnsureAccessAsync(groupId);
            return await suggestionService.AddSuggestionAsync(groupId, GetUserId(), request);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpDelete("{suggestionId:guid}")]
    public async Task<IActionResult> RemoveSuggestion(int groupId, Guid suggestionId)
    {
        try
        {
            await EnsureAccessAsync(groupId);
            await suggestionService.RemoveSuggestionAsync(groupId, suggestionId, GetUserId(), User.IsInRole("admin"));
            return NoContent();
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    // Converts a suggestion into a real, votable media item - same permission level as adding
    // media directly (group owner or site admin).
    [HttpPost("{suggestionId:guid}/promote")]
    public async Task<ActionResult<GroupMediaResponse>> PromoteSuggestion(int groupId, Guid suggestionId,
        [FromBody] PromoteSuggestionRequest request)
    {
        try
        {
            await groupService.EnsureManagerAsync(groupId, GetUserId(), User.IsInRole("admin"));
            return await suggestionService.PromoteSuggestionAsync(groupId, suggestionId, GetUserId(), request);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    // Any group member can trigger a pick - it's a shared, broadcast animation (see
    // suggestion-spin SSE event) rather than a personal action, so no owner/admin gating here.
    [HttpPost("spin")]
    public async Task<ActionResult<SpinSuggestionsResponse>> SpinSuggestions(int groupId)
    {
        try
        {
            await EnsureAccessAsync(groupId);
            return await suggestionService.SpinSuggestionsAsync(groupId, GetUserId(), User.IsInRole("admin"));
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

    private int GetUserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
