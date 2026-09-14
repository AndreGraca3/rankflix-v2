using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Models.Auth;
using Rankflix.Models.Users;
using Rankflix.Services;

namespace Rankflix.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public class UserController(IUserRepository userRepository, RankflixDbContext db, ISseService sse) : ControllerBase
{
    [HttpGet("me")]
    public async Task<ActionResult<UserProfileResponse>> GetMe()
    {
        var user = await userRepository.GetByIdAsync(GetUserId());
        if (user is null) return NotFound();

        return new UserProfileResponse
        {
            Id = user.Id,
            Username = user.Username,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            DiscordId = user.DiscordId,
            Role = user.Role,
            Status = user.Status
        };
    }

    [HttpPatch("me")]
    public async Task<ActionResult<UserProfileResponse>> UpdateMe([FromBody] UpdateOwnProfileRequest request)
    {
        var user = await userRepository.GetByIdAsync(GetUserId());
        if (user is null) return NotFound();

        if (request.Username is not null)
        {
            try
            {
                var newUsername = UsernameValidator.ValidateAndTrim(request.Username);
                if (newUsername != user.Username)
                {
                    var existing = await userRepository.GetByUsernameAsync(newUsername);
                    if (existing is not null && existing.Id != user.Id)
                        return Problem("Username already in use", statusCode: StatusCodes.Status409Conflict);

                    user.Username = newUsername;
                }
            }
            catch (AppException ex)
            {
                return Problem(ex.Message, statusCode: ex.StatusCode);
            }
        }

        if (request.DisplayName is not null)
        {
            try
            {
                user.DisplayName = DisplayNameValidator.ValidateAndTrim(request.DisplayName);
            }
            catch (AppException ex)
            {
                return Problem(ex.Message, statusCode: ex.StatusCode);
            }
        }

        if (request.AvatarUrl is not null) user.AvatarUrl = request.AvatarUrl;

        await userRepository.SaveChangesAsync();

        return new UserProfileResponse
        {
            Id = user.Id,
            Username = user.Username,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            DiscordId = user.DiscordId,
            Role = user.Role,
            Status = user.Status
        };
    }

    [HttpPatch("me/status")]
    public async Task<ActionResult<UserProfileResponse>> UpdateStatus([FromBody] UpdateStatusRequest request)
    {
        if (request.Status != "online" && request.Status != "invisible")
            return Problem("Status must be 'online' or 'invisible'", statusCode: StatusCodes.Status400BadRequest);

        var user = await userRepository.GetByIdAsync(GetUserId());
        if (user is null) return NotFound();

        user.Status = request.Status;
        await userRepository.SaveChangesAsync();

        // Reflect the change immediately for anyone currently viewing this user as online.
        sse.UpdateStatus(user.Id, user.Status);

        return new UserProfileResponse
        {
            Id = user.Id,
            Username = user.Username,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            DiscordId = user.DiscordId,
            Role = user.Role,
            Status = user.Status
        };
    }

    [HttpPost("me/change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
    {
        var user = await userRepository.GetByIdAsync(GetUserId());
        if (user is null) return NotFound();

        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.PasswordHash))
            return Problem("Current password is incorrect", statusCode: StatusCodes.Status400BadRequest);

        if (request.NewPassword.Length < 8)
            return Problem("New password must be at least 8 characters", statusCode: StatusCodes.Status400BadRequest);

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        await userRepository.SaveChangesAsync();

        return NoContent();
    }

    [HttpGet]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<List<UserListItemResponse>>> GetUsers()
    {
        var users = await userRepository.GetAllAsync();
        return users.Select(u => new UserListItemResponse
        {
            Id = u.Id,
            DisplayName = u.DisplayName,
            AvatarUrl = u.AvatarUrl,
            DiscordId = u.DiscordId,
            Role = u.Role
        }).ToList();
    }

    // Lightweight, non-admin-only user list (no discord id/role) so any group owner can look up
    // and add members to their own group without needing the site-admin-only full user list.
    [HttpGet("directory")]
    public async Task<ActionResult<List<UserDirectoryItemResponse>>> GetUserDirectory()
    {
        var users = await userRepository.GetAllAsync();
        return users.Select(u => new UserDirectoryItemResponse
        {
            Id = u.Id,
            DisplayName = u.DisplayName,
            AvatarUrl = u.AvatarUrl
        }).ToList();
    }

    // Snapshot of who's currently connected (has a live SSE stream open), for the initial
    // online/offline render before any real-time "presence-changed" events arrive.
    [HttpGet("online")]
    public ActionResult<List<int>> GetOnlineUsers() => sse.GetOnlineUserIds().ToList();

    [HttpPatch("{userId:int}")]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<UserListItemResponse>> UpdateUser(int userId, [FromBody] AdminUpdateUserRequest request)
    {
        var user = await userRepository.GetByIdAsync(userId);
        if (user is null) return NotFound();

        if (request.DisplayName is not null)
        {
            try
            {
                user.DisplayName = DisplayNameValidator.ValidateAndTrim(request.DisplayName);
            }
            catch (AppException ex)
            {
                return Problem(ex.Message, statusCode: ex.StatusCode);
            }
        }
        if (request.AvatarUrl is not null) user.AvatarUrl = request.AvatarUrl;
        if (request.DiscordId is not null) user.DiscordId = request.DiscordId;
        if (request.Role is not null)
        {
            if (request.Role is not ("admin" or "member"))
                return Problem("Role must be 'admin' or 'member'", statusCode: StatusCodes.Status400BadRequest);

            if (user.Role == "admin" && request.Role == "member")
            {
                var admins = await userRepository.GetAllAsync();
                if (admins.Count(u => u.Role == "admin") <= 1)
                    return Problem("Cannot remove the last remaining admin", statusCode: StatusCodes.Status400BadRequest);
            }

            user.Role = request.Role;
        }

        await userRepository.SaveChangesAsync();

        if (request.DiscordId is not null)
            await BackfillPendingImportsAsync(user.Id, request.DiscordId);

        return new UserListItemResponse
        {
            Id = user.Id,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            DiscordId = user.DiscordId,
            Role = user.Role
        };
    }

    // Attaches any Excel-imported reviews/watch statuses that were stored against a not-yet-registered
    // discord id (see ExcelService) to the user account that discord id has just been assigned to. This
    // is also how switching a friend's discord id later re-links their history without losing anything.
    private async Task BackfillPendingImportsAsync(int userId, string discordId)
    {
        var existingMemberGroupIds = (await db.RankGroupMembers
            .Where(m => m.UserId == userId)
            .Select(m => m.GroupId)
            .ToListAsync()).ToHashSet();
        var newlyJoinedGroupIds = new List<int>();

        var pendingWatchStatuses = await db.RankGroupWatchStatuses
            .Where(w => w.PendingDiscordId == discordId)
            .ToListAsync();

        foreach (var w in pendingWatchStatuses)
        {
            var alreadyHasReal = await db.RankGroupWatchStatuses.AnyAsync(existing =>
                existing.GroupId == w.GroupId && existing.MediaId == w.MediaId && existing.UserId == userId);
            if (alreadyHasReal)
                db.RankGroupWatchStatuses.Remove(w);
            else
            {
                w.UserId = userId;
                w.PendingDiscordId = null;
            }

            // Track memberships already added in this loop too, so two pending rows for the
            // same group don't both try to insert the same (group_id, user_id) primary key.
            if (existingMemberGroupIds.Add(w.GroupId))
            {
                db.RankGroupMembers.Add(new Data.Entities.RankGroupMemberEntity { GroupId = w.GroupId, UserId = userId });
                newlyJoinedGroupIds.Add(w.GroupId);
            }
        }

        var pendingReviews = await db.Reviews
            .Where(r => r.PendingDiscordId == discordId)
            .ToListAsync();

        foreach (var r in pendingReviews)
        {
            var alreadyHasReal = await db.Reviews.AnyAsync(existing =>
                existing.GroupId == r.GroupId && existing.MediaId == r.MediaId && existing.UserId == userId);
            if (alreadyHasReal)
                db.Reviews.Remove(r);
            else
            {
                r.UserId = userId;
                r.PendingDiscordId = null;
            }
        }

        // The discord id is now attached to a real account, so it no longer needs a placeholder
        // "pending" row for display purposes.
        var pendingMembers = await db.PendingGroupMembers
            .Where(p => p.DiscordId == discordId)
            .ToListAsync();
        db.PendingGroupMembers.RemoveRange(pendingMembers);

        await db.SaveChangesAsync();

        if (newlyJoinedGroupIds.Count > 0)
        {
            // Let the (re)assigned user's dashboard pick up the new group(s) immediately, and let
            // every other member of those groups see the newly attached history in real time.
            sse.Publish(userId, "groups-changed", new { });
            foreach (var groupId in newlyJoinedGroupIds)
            {
                var memberIds = await db.RankGroupMembers
                    .Where(m => m.GroupId == groupId)
                    .Select(m => m.UserId)
                    .ToListAsync();
                sse.PublishToUsers(memberIds, "group-updated", new { groupId });
            }
        }
    }

    [HttpDelete("{userId:int}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> DeleteUser(int userId)
    {
        var user = await userRepository.GetByIdAsync(userId);
        if (user is null) return NotFound();

        if (userId == GetUserId())
            return Problem("Cannot delete your own account", statusCode: StatusCodes.Status400BadRequest);

        if (user.Role == "admin")
        {
            var allUsers = await userRepository.GetAllAsync();
            if (allUsers.Count(u => u.Role == "admin") <= 1)
                return Problem("Cannot delete the last remaining admin", statusCode: StatusCodes.Status400BadRequest);
        }

        // Reassign the "created by" reference for any groups this user created to the admin
        // performing the deletion, since owner_id has no cascade/null-on-delete - otherwise the FK
        // would block the delete and orphan the group and everyone else's history/rankings in it.
        var createdGroups = await db.RankGroups.Where(g => g.OwnerId == userId).ToListAsync();
        foreach (var g in createdGroups) g.OwnerId = GetUserId();

        // If this user was the sole owner of any group, promote another remaining member (if any)
        // so the group doesn't end up ownerless once their membership cascade-deletes below.
        var ownedGroupIds = await db.RankGroupMembers
            .Where(m => m.UserId == userId && m.IsOwner)
            .Select(m => m.GroupId)
            .ToListAsync();
        foreach (var groupId in ownedGroupIds)
        {
            var remainingOwners = await db.RankGroupMembers
                .CountAsync(m => m.GroupId == groupId && m.IsOwner && m.UserId != userId);
            if (remainingOwners > 0) continue;

            var nextMember = await db.RankGroupMembers
                .Where(m => m.GroupId == groupId && m.UserId != userId)
                .OrderBy(m => m.UserId)
                .FirstOrDefaultAsync();
            if (nextMember is not null) nextMember.IsOwner = true;
        }

        // Reviews, watch statuses, group memberships and refresh tokens all cascade-delete via FK.
        db.Users.Remove(user);
        await db.SaveChangesAsync();

        return NoContent();
    }

    [HttpPost("{userId:int}/reset-password")]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<ResetPasswordResponse>> ResetPassword(int userId)
    {
        var user = await userRepository.GetByIdAsync(userId);
        if (user is null) return NotFound();

        var newPassword = GenerateRandomPassword();
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(newPassword);
        await userRepository.SaveChangesAsync();

        return new ResetPasswordResponse { NewPassword = newPassword };
    }

    // Not cryptographically excessive, just needs to be unguessable enough for a one-time
    // admin-communicated temporary password the user should change after logging in.
    private static string GenerateRandomPassword()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
        var bytes = System.Security.Cryptography.RandomNumberGenerator.GetBytes(12);
        return new string(bytes.Select(b => chars[b % chars.Length]).ToArray());
    }

    [HttpGet("me/stats")]
    public async Task<ActionResult<UserStatsResponse>> GetMyStats([FromServices] IUserStatsService statsService)
    {
        return await statsService.GetStatsAsync(GetUserId());
    }

    private int GetUserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
