using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Rankflix.Models.Reviews;
using Rankflix.Services;

namespace Rankflix.Controllers;

[ApiController]
[Route("api/groups/{groupId:int}/media/{tmdbId:int}/reviews")]
[Authorize]
public class ReviewsController(IReviewService reviewService, IGroupService groupService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<ReviewResponse>>> GetReviews(int groupId, int tmdbId)
    {
        try
        {
            await EnsureAccessAsync(groupId);
            return await reviewService.GetReviewsAsync(groupId, tmdbId);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost]
    public async Task<ActionResult<ReviewResponse>> SubmitReview(int groupId, int tmdbId,
        [FromBody] SubmitReviewRequest request)
    {
        try
        {
            await EnsureAccessAsync(groupId);
            return await reviewService.SubmitReviewAsync(groupId, tmdbId, GetUserId(), request);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpDelete("{userId:int}")]
    public async Task<IActionResult> DeleteReview(int groupId, int tmdbId, int userId)
    {
        try
        {
            await groupService.EnsureManagerAsync(groupId, GetUserId(), User.IsInRole("admin"));
            await reviewService.DeleteReviewAsync(groupId, tmdbId, userId, User.IsInRole("admin"));
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

    private int GetUserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
