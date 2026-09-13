using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Rankflix.Models.Groups;
using Rankflix.Services;

namespace Rankflix.Controllers;

[ApiController]
[Route("api/groups")]
[Authorize]
public class GroupsController(IGroupService groupService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<GroupResponse>>> GetGroups()
    {
        var (userId, isAdmin) = GetCurrentUser();
        return await groupService.GetGroupsForUserAsync(userId, isAdmin);
    }

    [HttpGet("all")]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<List<GroupResponse>>> GetAllGroups()
    {
        return await groupService.GetAllGroupsAsync();
    }

    [HttpGet("{groupId:int}")]
    public async Task<ActionResult<GroupResponse>> GetGroup(int groupId)
    {
        var (userId, isAdmin) = GetCurrentUser();
        try
        {
            return await groupService.GetGroupAsync(groupId, userId, isAdmin);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost]
    public async Task<ActionResult<GroupResponse>> CreateGroup([FromBody] CreateGroupRequest request)
    {
        var (userId, _) = GetCurrentUser();
        return await groupService.CreateGroupAsync(request.Name, userId, request.ImageUrl);
    }

    [HttpPatch("{groupId:int}")]
    public async Task<ActionResult<GroupResponse>> UpdateGroup(int groupId, [FromBody] UpdateGroupRequest request)
    {
        var (userId, isAdmin) = GetCurrentUser();
        try
        {
            await groupService.EnsureManagerAsync(groupId, userId, isAdmin);
            return await groupService.UpdateGroupAsync(groupId, request.Name, request.ImageUrl);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpDelete("{groupId:int}")]
    public async Task<IActionResult> DeleteGroup(int groupId)
    {
        var (userId, isAdmin) = GetCurrentUser();
        try
        {
            await groupService.EnsureManagerAsync(groupId, userId, isAdmin);
            await groupService.DeleteGroupAsync(groupId);
            return NoContent();
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost("{groupId:int}/members")]
    public async Task<ActionResult<GroupResponse>> AddMember(int groupId, [FromBody] AddMemberRequest request)
    {
        var (userId, isAdmin) = GetCurrentUser();
        try
        {
            await groupService.EnsureManagerAsync(groupId, userId, isAdmin);
            return await groupService.AddMemberAsync(groupId, request.UserId);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpDelete("{groupId:int}/members/{userId:int}")]
    public async Task<IActionResult> RemoveMember(int groupId, int userId)
    {
        var (requestingUserId, isAdmin) = GetCurrentUser();
        try
        {
            await groupService.EnsureManagerAsync(groupId, requestingUserId, isAdmin);
            await groupService.RemoveMemberAsync(groupId, userId);
            return NoContent();
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpDelete("{groupId:int}/pending-members/{discordId}")]
    public async Task<IActionResult> RemovePendingMember(int groupId, string discordId)
    {
        var (userId, isAdmin) = GetCurrentUser();
        try
        {
            await groupService.EnsureManagerAsync(groupId, userId, isAdmin);
            await groupService.RemovePendingMemberAsync(groupId, discordId);
            return NoContent();
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPatch("{groupId:int}/members/{userId:int}/ownership")]
    public async Task<ActionResult<GroupResponse>> SetMemberOwnership(int groupId, int userId,
        [FromBody] UpdateMembershipOwnershipRequest request)
    {
        var (requestingUserId, isAdmin) = GetCurrentUser();
        try
        {
            await groupService.EnsureManagerAsync(groupId, requestingUserId, isAdmin);
            return await groupService.SetMemberOwnershipAsync(groupId, userId, request.IsOwner);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpGet("{groupId:int}/stats")]
    public async Task<ActionResult<Models.Groups.GroupStatsResponse>> GetGroupStats(
        int groupId, [FromServices] IGroupStatsService groupStatsService)
    {
        var (userId, isAdmin) = GetCurrentUser();
        try
        {
            await groupService.GetGroupAsync(groupId, userId, isAdmin); // enforces membership/visibility
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }

        return await groupStatsService.GetGroupStatsAsync(groupId);
    }

    private (int UserId, bool IsAdmin) GetCurrentUser()
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var isAdmin = User.IsInRole("admin");
        return (userId, isAdmin);
    }
}
