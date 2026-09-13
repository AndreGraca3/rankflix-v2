using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Data.Entities;
using Rankflix.Models.Media;

namespace Rankflix.Services;

public interface IMediaService
{
    Task<GroupMediaResponse> AddMediaToGroupAsync(int groupId, int addedByUserId, AddMediaRequest request);
    Task<List<GroupMediaResponse>> GetGroupMediaAsync(int groupId);
    Task<GroupMediaResponse> UpdateVotingDurationAsync(int groupId, int tmdbId, int votingDurationHours);
    Task SetWatchedAsync(int groupId, int tmdbId, int userId, bool watched, bool isSiteAdmin);
    Task SetWatchedPendingAsync(int groupId, int tmdbId, string discordId, bool watched, bool isSiteAdmin);
    Task RemoveMediaFromGroupAsync(int groupId, int tmdbId);
}

public class MediaService(RankflixDbContext db, ISseService sse, IMediaMetadataService mediaMetadataService) : IMediaService
{
    public async Task<GroupMediaResponse> AddMediaToGroupAsync(int groupId, int addedByUserId, AddMediaRequest request)
    {
        if (!await db.RankGroups.AnyAsync(g => g.Id == groupId))
            throw new AppException("Group not found", StatusCodes.Status404NotFound);

        var media = await db.Media.FirstOrDefaultAsync(m => m.TmdbId == request.TmdbId);
        if (media is null)
        {
            media = new MediaEntity { TmdbId = request.TmdbId, Title = request.Title, Type = request.Type, PosterUrl = request.PosterUrl };
            db.Media.Add(media);
        }
        else
        {
            // Keep the shared catalog row fresh: older rows (added before poster_url existed,
            // or via a stale title) would otherwise silently keep showing no poster forever.
            media.Title = request.Title;
            media.Type = request.Type;
            if (!string.IsNullOrWhiteSpace(request.PosterUrl)) media.PosterUrl = request.PosterUrl;
        }

        // Search results don't carry runtime, so fetch it once here for the watch-time stats
        // (best-effort - a TMDB hiccup shouldn't block adding the media).
        if (media.RuntimeMinutes is null)
        {
            var metadata = await mediaMetadataService.FetchAsync(request.TmdbId, request.Type);
            if (metadata?.RuntimeMinutes is not null) media.RuntimeMinutes = metadata.RuntimeMinutes;
        }

        var alreadyInGroup = await db.RankGroupMedia
            .AnyAsync(gm => gm.GroupId == groupId && gm.MediaId == request.TmdbId);
        if (alreadyInGroup)
            throw new AppException("Media already added to this group", StatusCodes.Status409Conflict);

        var groupMedia = new RankGroupMediaEntity
        {
            MediaId = request.TmdbId,
            GroupId = groupId,
            AddedAt = DateTime.UtcNow,
            AddedBy = addedByUserId,
            VotingDurationHours = request.VotingDurationHours ?? 24
        };
        db.RankGroupMedia.Add(groupMedia);

        if (request.WatchedByUserIds is { Count: > 0 })
        {
            var validMemberIds = await db.RankGroupMembers
                .Where(m => m.GroupId == groupId && request.WatchedByUserIds.Contains(m.UserId))
                .Select(m => m.UserId)
                .ToListAsync();

            foreach (var userId in validMemberIds)
            {
                db.RankGroupWatchStatuses.Add(new RankGroupWatchStatusEntity
                {
                    Id = Guid.NewGuid(),
                    GroupId = groupId,
                    MediaId = request.TmdbId,
                    UserId = userId,
                    WatchedAt = DateTime.UtcNow
                });
            }
        }

        if (request.WatchedByDiscordIds is { Count: > 0 })
        {
            var validDiscordIds = await db.PendingGroupMembers
                .Where(p => p.GroupId == groupId && request.WatchedByDiscordIds.Contains(p.DiscordId))
                .Select(p => p.DiscordId)
                .ToListAsync();

            foreach (var discordId in validDiscordIds)
            {
                db.RankGroupWatchStatuses.Add(new RankGroupWatchStatusEntity
                {
                    Id = Guid.NewGuid(),
                    GroupId = groupId,
                    MediaId = request.TmdbId,
                    PendingDiscordId = discordId,
                    WatchedAt = DateTime.UtcNow
                });
            }
        }

        await db.SaveChangesAsync();

        await PublishGroupUpdatedAsync(groupId, tmdbId: request.TmdbId, eventName: "media-added");

        return await BuildResponseAsync(groupId, request.TmdbId);
    }

    public async Task<List<GroupMediaResponse>> GetGroupMediaAsync(int groupId)
    {
        // Batch-fetch everything for the whole group in a handful of queries instead of the
        // previous N+1 pattern (which issued ~6 sequential round-trips per media item - noticeably
        // slow once a group has dozens of titles). Everything below is then joined in memory.
        var groupMediaList = await db.RankGroupMedia
            .Where(gm => gm.GroupId == groupId)
            .ToListAsync();
        if (groupMediaList.Count == 0) return [];

        var tmdbIds = groupMediaList.Select(gm => gm.MediaId).ToList();

        var mediaById = await db.Media
            .Where(m => tmdbIds.Contains(m.TmdbId))
            .ToDictionaryAsync(m => m.TmdbId);

        // Older media rows (added before we tracked runtime) won't have it yet - fetch it from
        // TMDB on demand and persist it so this only happens once per title (see also
        // GroupStatsService, which does the same lazy backfill for the stats endpoint).
        var mediaMissingRuntime = mediaById.Values.Where(m => m.RuntimeMinutes is null).ToList();
        if (mediaMissingRuntime.Count > 0)
        {
            var metadataByTmdbId = await mediaMetadataService.FetchManyAsync(
                mediaMissingRuntime.Select(m => (m.TmdbId, m.Type)).ToList());

            foreach (var media in mediaMissingRuntime)
            {
                if (metadataByTmdbId.TryGetValue(media.TmdbId, out var metadata) && metadata?.RuntimeMinutes is not null)
                    media.RuntimeMinutes = metadata.RuntimeMinutes;
            }

            await db.SaveChangesAsync();
        }

        var members = await (
            from m in db.RankGroupMembers
            join u in db.Users on m.UserId equals u.Id
            where m.GroupId == groupId
            select new MemberInfo(u.Id, u.Username, u.AvatarUrl)
        ).ToListAsync();

        var watchStatusesByMedia = (await db.RankGroupWatchStatuses
                .Where(w => w.GroupId == groupId)
                .ToListAsync())
            .GroupBy(w => w.MediaId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var reviewsByMedia = (await db.Reviews
                .Where(r => r.GroupId == groupId)
                .ToListAsync())
            .GroupBy(r => r.MediaId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var pendingGroupMembers = await db.PendingGroupMembers
            .Where(p => p.GroupId == groupId)
            .ToListAsync();
        var pendingDisplayNames = pendingGroupMembers.ToDictionary(p => p.DiscordId, p => p.DisplayName);

        var results = new List<GroupMediaResponse>();
        foreach (var groupMedia in groupMediaList)
        {
            if (!mediaById.TryGetValue(groupMedia.MediaId, out var media)) continue;

            var watchStatuses = watchStatusesByMedia.GetValueOrDefault(groupMedia.MediaId, []);
            var reviews = reviewsByMedia.GetValueOrDefault(groupMedia.MediaId, []);

            results.Add(BuildResponse(groupMedia, media, members, watchStatuses, reviews, pendingDisplayNames));
        }

        return results;
    }

    public async Task<GroupMediaResponse> UpdateVotingDurationAsync(int groupId, int tmdbId, int votingDurationHours)
    {
        var groupMedia = await db.RankGroupMedia
            .FirstOrDefaultAsync(gm => gm.GroupId == groupId && gm.MediaId == tmdbId)
            ?? throw new AppException("Media not found in group", StatusCodes.Status404NotFound);

        var votingClosesAt = groupMedia.AddedAt.AddHours(groupMedia.VotingDurationHours);
        if (DateTime.UtcNow >= votingClosesAt)
            throw new AppException("Voting is closed for this media - voting duration can no longer be changed", StatusCodes.Status400BadRequest);

        groupMedia.VotingDurationHours = votingDurationHours;
        await db.SaveChangesAsync();

        await PublishGroupUpdatedAsync(groupId, tmdbId, "voting-duration-changed");

        return await BuildResponseAsync(groupId, tmdbId);
    }

    public async Task SetWatchedAsync(int groupId, int tmdbId, int userId, bool watched, bool isSiteAdmin)
    {
        var groupMedia = await db.RankGroupMedia
            .FirstOrDefaultAsync(gm => gm.GroupId == groupId && gm.MediaId == tmdbId)
            ?? throw new AppException("Media not found in group", StatusCodes.Status404NotFound);

        var votingClosesAt = groupMedia.AddedAt.AddHours(groupMedia.VotingDurationHours);
        if (DateTime.UtcNow >= votingClosesAt && !isSiteAdmin)
            throw new AppException("Voting is closed for this media - only a site admin can change watched status now", StatusCodes.Status403Forbidden);

        var existing = await db.RankGroupWatchStatuses
            .FirstOrDefaultAsync(w => w.GroupId == groupId && w.MediaId == tmdbId && w.UserId == userId);

        if (watched)
        {
            if (existing is not null) return;

            db.RankGroupWatchStatuses.Add(new RankGroupWatchStatusEntity
            {
                Id = Guid.NewGuid(),
                GroupId = groupId,
                MediaId = tmdbId,
                UserId = userId,
                WatchedAt = DateTime.UtcNow
            });
        }
        else
        {
            if (existing is null) return;

            // Removing watcher status also clears any rating for this media so state stays
            // consistent and the change is immediately reflected in averages/rankings.
            var review = await db.Reviews.FirstOrDefaultAsync(r => r.GroupId == groupId && r.MediaId == tmdbId && r.UserId == userId);
            if (review is not null) db.Reviews.Remove(review);

            db.RankGroupWatchStatuses.Remove(existing);
        }

        await db.SaveChangesAsync();
        await PublishGroupUpdatedAsync(groupId, tmdbId, "watcher-changed");
    }

    public async Task SetWatchedPendingAsync(int groupId, int tmdbId, string discordId, bool watched, bool isSiteAdmin)
    {
        var groupMedia = await db.RankGroupMedia
            .FirstOrDefaultAsync(gm => gm.GroupId == groupId && gm.MediaId == tmdbId)
            ?? throw new AppException("Media not found in group", StatusCodes.Status404NotFound);

        var votingClosesAt = groupMedia.AddedAt.AddHours(groupMedia.VotingDurationHours);
        if (DateTime.UtcNow >= votingClosesAt && !isSiteAdmin)
            throw new AppException("Voting is closed for this media - only a site admin can change watched status now", StatusCodes.Status403Forbidden);

        var existing = await db.RankGroupWatchStatuses
            .FirstOrDefaultAsync(w => w.GroupId == groupId && w.MediaId == tmdbId && w.PendingDiscordId == discordId);

        if (watched)
        {
            if (existing is not null) return;

            db.RankGroupWatchStatuses.Add(new RankGroupWatchStatusEntity
            {
                Id = Guid.NewGuid(),
                GroupId = groupId,
                MediaId = tmdbId,
                PendingDiscordId = discordId,
                WatchedAt = DateTime.UtcNow
            });
        }
        else
        {
            if (existing is null) return;

            var review = await db.Reviews.FirstOrDefaultAsync(r => r.GroupId == groupId && r.MediaId == tmdbId && r.PendingDiscordId == discordId);
            if (review is not null) db.Reviews.Remove(review);

            db.RankGroupWatchStatuses.Remove(existing);
        }

        await db.SaveChangesAsync();
        await PublishGroupUpdatedAsync(groupId, tmdbId, "watcher-changed");
    }

    public async Task RemoveMediaFromGroupAsync(int groupId, int tmdbId)
    {
        var groupMedia = await db.RankGroupMedia
            .FirstOrDefaultAsync(gm => gm.GroupId == groupId && gm.MediaId == tmdbId)
            ?? throw new AppException("Media not found in group", StatusCodes.Status404NotFound);

        // Reviews and watch statuses for this group+media cascade-delete in the database
        // (FK on (media_id, group_id) references rank_group_media ... on delete cascade),
        // so removing this row is enough; other groups' rankings for the same media are untouched.
        db.RankGroupMedia.Remove(groupMedia);
        await db.SaveChangesAsync();
        await PublishGroupUpdatedAsync(groupId, tmdbId, "media-removed");
    }

    private async Task PublishGroupUpdatedAsync(int groupId, int tmdbId, string eventName)
    {
        var memberIds = await db.RankGroupMembers
            .Where(m => m.GroupId == groupId)
            .Select(m => m.UserId)
            .ToListAsync();

        sse.PublishToUsers(memberIds, eventName, new { groupId, tmdbId });
    }

    private async Task<GroupMediaResponse> BuildResponseAsync(int groupId, int tmdbId)
    {
        var groupMedia = await db.RankGroupMedia
            .FirstOrDefaultAsync(gm => gm.GroupId == groupId && gm.MediaId == tmdbId)
            ?? throw new AppException("Media not found in group", StatusCodes.Status404NotFound);

        var media = await db.Media.FirstAsync(m => m.TmdbId == tmdbId);

        var members = await (
            from m in db.RankGroupMembers
            join u in db.Users on m.UserId equals u.Id
            where m.GroupId == groupId
            select new MemberInfo(u.Id, u.Username, u.AvatarUrl)
        ).ToListAsync();

        var watchStatuses = await db.RankGroupWatchStatuses
            .Where(w => w.GroupId == groupId && w.MediaId == tmdbId)
            .ToListAsync();

        var reviews = await db.Reviews
            .Where(r => r.GroupId == groupId && r.MediaId == tmdbId)
            .ToListAsync();

        // Discord ids without a matched account yet (from Excel import) are still group members and
        // should be selectable as watchers even before they have any watch/rating history for this media.
        var pendingGroupMembers = await db.PendingGroupMembers
            .Where(p => p.GroupId == groupId)
            .ToListAsync();
        var pendingDisplayNames = pendingGroupMembers.ToDictionary(p => p.DiscordId, p => p.DisplayName);

        return BuildResponse(groupMedia, media, members, watchStatuses, reviews, pendingDisplayNames);
    }

    private record MemberInfo(int Id, string Username, string? AvatarUrl);

    private static GroupMediaResponse BuildResponse(
        RankGroupMediaEntity groupMedia,
        MediaEntity media,
        List<MemberInfo> members,
        List<RankGroupWatchStatusEntity> watchStatuses,
        List<ReviewEntity> reviews,
        Dictionary<string, string?> pendingDisplayNames)
    {
        var watchers = members.Select(member =>
        {
            var review = reviews.FirstOrDefault(r => r.UserId == member.Id);
            var watched = review is not null || watchStatuses.Any(w => w.UserId == member.Id);

            return new WatcherStatusResponse
            {
                UserId = member.Id,
                Username = member.Username,
                AvatarUrl = member.AvatarUrl,
                HasWatched = watched,
                Rating = review?.Rating,
                Comment = review?.Comment,
                RatedAt = review?.CreatedAt
            };
        }).ToList();

        foreach (var discordId in pendingDisplayNames.Keys)
        {
            var review = reviews.FirstOrDefault(r => r.PendingDiscordId == discordId);
            var watched = review is not null || watchStatuses.Any(w => w.PendingDiscordId == discordId);

            watchers.Add(new WatcherStatusResponse
            {
                UserId = null,
                Username = pendingDisplayNames.TryGetValue(discordId, out var name) && !string.IsNullOrWhiteSpace(name)
                    ? name!
                    : discordId,
                HasWatched = watched,
                Rating = review?.Rating,
                Comment = review?.Comment,
                RatedAt = review?.CreatedAt,
                IsPending = true,
                DiscordId = discordId
            });
        }

        var votingClosesAt = groupMedia.AddedAt.AddHours(groupMedia.VotingDurationHours);

        return new GroupMediaResponse
        {
            TmdbId = media.TmdbId,
            Title = media.Title,
            Type = media.Type,
            PosterUrl = media.PosterUrl,
            AddedAt = groupMedia.AddedAt,
            VotingDurationHours = groupMedia.VotingDurationHours,
            VotingClosesAt = votingClosesAt,
            VotingOpen = DateTime.UtcNow < votingClosesAt,
            AverageRating = reviews.Count > 0 ? reviews.Average(r => r.Rating) : groupMedia.ImportedAverageRating,
            Watchers = watchers,
            RuntimeMinutes = media.RuntimeMinutes
        };
    }
}
