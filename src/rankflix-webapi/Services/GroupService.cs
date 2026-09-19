using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Data.Entities;
using Rankflix.Models.Groups;

namespace Rankflix.Services;

public interface IGroupService
{
    Task<List<GroupResponse>> GetGroupsForUserAsync(int userId, bool isAdmin);
    Task<List<GroupResponse>> GetAllGroupsAsync();
    Task<GroupResponse> GetGroupAsync(int groupId, int requestingUserId, bool isAdmin);
    Task<GroupResponse> CreateGroupAsync(string name, int ownerId, string? imageUrl);
    Task<GroupResponse> UpdateGroupAsync(int groupId, string? name, string? imageUrl, bool? spinsDisabledForMembers);
    Task DeleteGroupAsync(int groupId);
    Task<GroupResponse> AddMemberAsync(int groupId, int userId);
    Task RemoveMemberAsync(int groupId, int userId);
    Task RemovePendingMemberAsync(int groupId, string discordId);
    Task<GroupResponse> SetMemberOwnershipAsync(int groupId, int userId, bool isOwner);
    Task EnsureMemberAsync(int groupId, int userId);
    Task EnsureManagerAsync(int groupId, int userId, bool isSiteAdmin);
}

public class GroupService(RankflixDbContext db, ISseService sse) : IGroupService
{
    public async Task<List<GroupResponse>> GetGroupsForUserAsync(int userId, bool isAdmin)
    {
        var groupIds = await db.RankGroups
            .Where(g => g.OwnerId == userId || db.RankGroupMembers.Any(m => m.GroupId == g.Id && m.UserId == userId))
            .Select(g => g.Id)
            .ToListAsync();

        var results = new List<GroupResponse>();
        foreach (var id in groupIds) results.Add(await BuildGroupResponseAsync(id));
        return results;
    }

    public async Task<List<GroupResponse>> GetAllGroupsAsync()
    {
        var groupIds = await db.RankGroups.Select(g => g.Id).ToListAsync();
        var results = new List<GroupResponse>();
        foreach (var id in groupIds) results.Add(await BuildGroupResponseAsync(id));
        return results;
    }

    public async Task<GroupResponse> GetGroupAsync(int groupId, int requestingUserId, bool isAdmin)
    {
        await EnsureAccessAsync(groupId, requestingUserId, isAdmin);
        return await BuildGroupResponseAsync(groupId);
    }

    public async Task<GroupResponse> CreateGroupAsync(string name, int ownerId, string? imageUrl)
    {
        var group = new RankGroupEntity { Name = name, OwnerId = ownerId, ImageUrl = imageUrl };
        db.RankGroups.Add(group);
        await db.SaveChangesAsync();

        db.RankGroupMembers.Add(new RankGroupMemberEntity { GroupId = group.Id, UserId = ownerId, IsOwner = true });
        await db.SaveChangesAsync();

        return await BuildGroupResponseAsync(group.Id);
    }

    public async Task<GroupResponse> UpdateGroupAsync(int groupId, string? name, string? imageUrl, bool? spinsDisabledForMembers)
    {
        var group = await db.RankGroups.FirstOrDefaultAsync(g => g.Id == groupId)
                    ?? throw new AppException("Group not found", StatusCodes.Status404NotFound);

        if (!string.IsNullOrWhiteSpace(name)) group.Name = name;
        if (imageUrl is not null) group.ImageUrl = string.IsNullOrWhiteSpace(imageUrl) ? null : imageUrl;
        if (spinsDisabledForMembers is not null) group.SpinsDisabledForMembers = spinsDisabledForMembers.Value;

        await db.SaveChangesAsync();
        await PublishGroupUpdatedToMembersAsync(groupId);
        return await BuildGroupResponseAsync(groupId);
    }

    public async Task DeleteGroupAsync(int groupId)
    {
        var group = await db.RankGroups.FirstOrDefaultAsync(g => g.Id == groupId)
                    ?? throw new AppException("Group not found", StatusCodes.Status404NotFound);

        var memberIds = await db.RankGroupMembers
            .Where(m => m.GroupId == groupId)
            .Select(m => m.UserId)
            .ToListAsync();

        // All group-scoped data (members, media, reviews, watch statuses, pending members) cascades
        // via ON DELETE CASCADE foreign keys, so removing the group row is enough.
        db.RankGroups.Remove(group);
        await db.SaveChangesAsync();

        sse.PublishToUsers(memberIds, "groups-changed", new { groupId });
    }

    public async Task<GroupResponse> AddMemberAsync(int groupId, int userId)
    {
        if (!await db.RankGroups.AnyAsync(g => g.Id == groupId))
            throw new AppException("Group not found", StatusCodes.Status404NotFound);

        if (!await db.Users.AnyAsync(u => u.Id == userId))
            throw new AppException("User not found", StatusCodes.Status404NotFound);

        var alreadyMember = await db.RankGroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == userId);
        if (!alreadyMember)
        {
            db.RankGroupMembers.Add(new RankGroupMemberEntity { GroupId = groupId, UserId = userId });
            await db.SaveChangesAsync();

            // The new member needs their own "groups list changed" signal since they weren't
            // in the group-member broadcast list before this just now.
            sse.Publish(userId, "groups-changed", new { groupId });
            await PublishGroupUpdatedToMembersAsync(groupId);
        }

        return await BuildGroupResponseAsync(groupId);
    }

    public async Task RemoveMemberAsync(int groupId, int userId)
    {
        var member = await db.RankGroupMembers
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == userId);

        if (member is null) return;

        if (member.IsOwner)
        {
            var ownerCount = await db.RankGroupMembers.CountAsync(m => m.GroupId == groupId && m.IsOwner);
            if (ownerCount <= 1)
                throw new AppException("Cannot remove the last owner of a group", StatusCodes.Status400BadRequest);
        }

        db.RankGroupMembers.Remove(member);

        // Once someone is removed from a group they should no longer influence its rankings/averages -
        // their ratings and watch status for this group's media are removed along with the membership.
        var reviews = await db.Reviews.Where(r => r.GroupId == groupId && r.UserId == userId).ToListAsync();
        db.Reviews.RemoveRange(reviews);

        var watchStatuses = await db.RankGroupWatchStatuses
            .Where(w => w.GroupId == groupId && w.UserId == userId)
            .ToListAsync();
        db.RankGroupWatchStatuses.RemoveRange(watchStatuses);

        await db.SaveChangesAsync();

        sse.Publish(userId, "groups-changed", new { groupId });
        await PublishGroupUpdatedToMembersAsync(groupId);
    }

    public async Task RemovePendingMemberAsync(int groupId, string discordId)
    {
        var pendingMember = await db.PendingGroupMembers
            .FirstOrDefaultAsync(p => p.GroupId == groupId && p.DiscordId == discordId);

        if (pendingMember is null) return;

        db.PendingGroupMembers.Remove(pendingMember);

        // Same cleanup as removing a real member: drop their imported ratings/watch status for this
        // group's media so they no longer influence its rankings/averages.
        var reviews = await db.Reviews
            .Where(r => r.GroupId == groupId && r.PendingDiscordId == discordId)
            .ToListAsync();
        db.Reviews.RemoveRange(reviews);

        var watchStatuses = await db.RankGroupWatchStatuses
            .Where(w => w.GroupId == groupId && w.PendingDiscordId == discordId)
            .ToListAsync();
        db.RankGroupWatchStatuses.RemoveRange(watchStatuses);

        await db.SaveChangesAsync();

        await PublishGroupUpdatedToMembersAsync(groupId);
    }

    public async Task<GroupResponse> SetMemberOwnershipAsync(int groupId, int userId, bool isOwner)
    {
        var member = await db.RankGroupMembers
                         .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == userId)
                     ?? throw new AppException("Member not found in this group", StatusCodes.Status404NotFound);

        if (!isOwner && member.IsOwner)
        {
            var ownerCount = await db.RankGroupMembers.CountAsync(m => m.GroupId == groupId && m.IsOwner);
            if (ownerCount <= 1)
                throw new AppException("Cannot remove the last owner of a group", StatusCodes.Status400BadRequest);
        }

        member.IsOwner = isOwner;
        await db.SaveChangesAsync();
        await PublishGroupUpdatedToMembersAsync(groupId);

        return await BuildGroupResponseAsync(groupId);
    }

    public async Task EnsureMemberAsync(int groupId, int userId)
    {
        var isMember = await db.RankGroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == userId);
        if (!isMember)
            throw new AppException("You are not a member of this group", StatusCodes.Status403Forbidden);
    }

    // Group management actions (add/remove members, media, imports, voting duration, etc.) require
    // being an owner of that specific group. Site admins can still manage any group as a fallback/
    // support capability, but are otherwise a separate concept from group ownership.
    public async Task EnsureManagerAsync(int groupId, int userId, bool isSiteAdmin)
    {
        if (isSiteAdmin) return;

        var isOwner = await db.RankGroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == userId && m.IsOwner);
        if (!isOwner)
            throw new AppException("Only a group owner can do this", StatusCodes.Status403Forbidden);
    }

    private async Task PublishGroupUpdatedToMembersAsync(int groupId)
    {
        var memberIds = await db.RankGroupMembers
            .Where(m => m.GroupId == groupId)
            .Select(m => m.UserId)
            .ToListAsync();

        sse.PublishToUsers(memberIds, "group-updated", new { groupId });
    }

    private async Task EnsureAccessAsync(int groupId, int userId, bool isAdmin)
    {
        if (isAdmin) return;

        var isMember = await db.RankGroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == userId);
        if (!isMember)
            throw new AppException("You are not a member of this group", StatusCodes.Status403Forbidden);
    }

    private async Task<GroupResponse> BuildGroupResponseAsync(int groupId)
    {
        var group = await db.RankGroups.FirstOrDefaultAsync(g => g.Id == groupId)
                    ?? throw new AppException("Group not found", StatusCodes.Status404NotFound);

        var members = await (
            from m in db.RankGroupMembers
            join u in db.Users on m.UserId equals u.Id
            where m.GroupId == groupId
            select new MemberResponse
            {
                UserId = u.Id, DisplayName = u.DisplayName, AvatarUrl = u.AvatarUrl, DiscordId = u.DiscordId,
                IsOwner = m.IsOwner
            }
        ).ToListAsync();

        // Discord ids that have historical ratings/watch-status imported for this group but no
        // matching user account yet (see ExcelService/UserController backfill). Surfacing them here
        // keeps the member count and per-member stats honest until an admin assigns them a real user.
        var pendingFromReviews = db.Reviews
            .Where(r => r.GroupId == groupId && r.PendingDiscordId != null)
            .Select(r => r.PendingDiscordId!);
        var pendingFromWatchStatus = db.RankGroupWatchStatuses
            .Where(w => w.GroupId == groupId && w.PendingDiscordId != null)
            .Select(w => w.PendingDiscordId!);
        var pendingMembers = await pendingFromReviews.Concat(pendingFromWatchStatus)
            .Distinct()
            .OrderBy(id => id)
            .ToListAsync();

        var displayNames = await db.PendingGroupMembers
            .Where(p => p.GroupId == groupId)
            .ToDictionaryAsync(p => p.DiscordId, p => p.DisplayName);

        var pendingMemberResponses = pendingMembers
            .Select(id => new PendingMemberResponse
            {
                DiscordId = id,
                DisplayName = displayNames.TryGetValue(id, out var name) ? name : null
            })
            .ToList();

        return new GroupResponse
        {
            Id = group.Id,
            Name = group.Name,
            OwnerId = group.OwnerId,
            ImageUrl = group.ImageUrl,
            SpinsDisabledForMembers = group.SpinsDisabledForMembers,
            Members = members,
            PendingMembers = pendingMemberResponses
        };
    }
}
