using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Data.Entities;
using Rankflix.Models.Media;

namespace Rankflix.Services;

public interface IMediaService
{
    Task<GroupMediaResponse> AddMediaToGroupAsync(int groupId, int addedByUserId, AddMediaRequest request);
    Task<PagedGroupMediaResponse> GetGroupMediaAsync(int groupId, GetGroupMediaQuery query);
    Task<GroupMediaResponse> GetMediaItemAsync(int groupId, int tmdbId);
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

        // Search results don't carry runtime/genre/year, so fetch them once here for the watch-time
        // stats and detail display (best-effort - a TMDB hiccup shouldn't block adding the media).
        if (media.RuntimeMinutes is null || media.Genre is null || media.Year is null)
        {
            var metadata = await mediaMetadataService.FetchAsync(request.TmdbId, request.Type);
            if (metadata is not null)
            {
                if (metadata.RuntimeMinutes is not null) media.RuntimeMinutes = metadata.RuntimeMinutes;
                if (metadata.Genre is not null) media.Genre = metadata.Genre;
                if (metadata.Year is not null) media.Year = metadata.Year;
            }
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

    public async Task<PagedGroupMediaResponse> GetGroupMediaAsync(int groupId, GetGroupMediaQuery query)
    {
        // Batch-fetch everything for the whole group in a handful of queries instead of the
        // previous N+1 pattern (which issued ~6 sequential round-trips per media item - noticeably
        // slow once a group has dozens of titles). Everything below is then joined in memory, then
        // filtered/sorted/paginated in memory too - group media counts are small enough that this
        // is simpler than pushing every filter combination into SQL, while still only sending one
        // page of results back over the wire.
        var groupMediaList = await db.RankGroupMedia
            .Where(gm => gm.GroupId == groupId)
            .ToListAsync();
        if (groupMediaList.Count == 0)
            return new PagedGroupMediaResponse { Items = [], TotalCount = 0, HasMore = false, AvailableGenres = [], TotalMediaInGroup = 0 };

        var tmdbIds = groupMediaList.Select(gm => gm.MediaId).ToList();

        var mediaById = await db.Media
            .Where(m => tmdbIds.Contains(m.TmdbId))
            .ToDictionaryAsync(m => m.TmdbId);

        // Older media rows (added before we tracked runtime/genre/year) won't have them yet - fetch
        // from TMDB on demand and persist so this only happens once per title (see also
        // GroupStatsService, which does the same lazy backfill for the stats endpoint).
        var mediaMissingMetadata = mediaById.Values
            .Where(m => m.RuntimeMinutes is null || m.Genre is null || m.Year is null)
            .ToList();
        if (mediaMissingMetadata.Count > 0)
        {
            var metadataByTmdbId = await mediaMetadataService.FetchManyAsync(
                mediaMissingMetadata.Select(m => (m.TmdbId, m.Type)).ToList());

            foreach (var media in mediaMissingMetadata)
            {
                if (!metadataByTmdbId.TryGetValue(media.TmdbId, out var metadata) || metadata is null) continue;
                if (metadata.RuntimeMinutes is not null) media.RuntimeMinutes = metadata.RuntimeMinutes;
                if (metadata.Genre is not null) media.Genre = metadata.Genre;
                if (metadata.Year is not null) media.Year = metadata.Year;
            }

            await db.SaveChangesAsync();
        }

        var members = await (
            from m in db.RankGroupMembers
            join u in db.Users on m.UserId equals u.Id
            where m.GroupId == groupId
            select new MemberInfo(u.Id, u.DisplayName, u.AvatarUrl)
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

        var allResponses = new List<GroupMediaResponse>();
        foreach (var groupMedia in groupMediaList)
        {
            if (!mediaById.TryGetValue(groupMedia.MediaId, out var media)) continue;

            var watchStatuses = watchStatusesByMedia.GetValueOrDefault(groupMedia.MediaId, []);
            var reviews = reviewsByMedia.GetValueOrDefault(groupMedia.MediaId, []);

            allResponses.Add(BuildResponse(groupMedia, media, members, watchStatuses, reviews, pendingDisplayNames));
        }

        // Genre options come from the *full* unfiltered set so the dropdown doesn't shrink as the
        // user narrows results down with other filters.
        var availableGenres = allResponses
            .SelectMany(r => (r.Genre ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(g => g, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // "average" (default), a numeric real-member user id, or a pending member's Discord id.
        int? rankingUserId = null;
        string? rankingDiscordId = null;
        if (!string.IsNullOrEmpty(query.RankingMember) && query.RankingMember != "average")
        {
            if (int.TryParse(query.RankingMember, out var parsedId)) rankingUserId = parsedId;
            else rankingDiscordId = query.RankingMember;
        }

        double? RatingOf(GroupMediaResponse m) =>
            rankingUserId is not null
                ? m.Watchers.FirstOrDefault(w => w.UserId == rankingUserId)?.Rating
                : rankingDiscordId is not null
                    ? m.Watchers.FirstOrDefault(w => w.DiscordId == rankingDiscordId)?.Rating
                    : m.AverageRating;

        bool WatchedByRankingMember(GroupMediaResponse m) =>
            rankingUserId is not null
                ? m.Watchers.Any(w => w.UserId == rankingUserId && w.HasWatched)
                : m.Watchers.Any(w => w.DiscordId == rankingDiscordId && w.HasWatched);

        IEnumerable<GroupMediaResponse> filtered = allResponses;

        if (rankingUserId is not null || rankingDiscordId is not null)
            filtered = filtered.Where(WatchedByRankingMember);

        if (query.VotingStatus is "open" or "closed")
            filtered = filtered.Where(m => query.VotingStatus == "open" ? m.VotingOpen : !m.VotingOpen);

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var search = query.Search.Trim();
            filtered = filtered.Where(m => m.Title.Contains(search, StringComparison.OrdinalIgnoreCase));
        }

        var wantedGenres = query.Genre?.Select(g => g.Trim()).Where(g => g.Length > 0).ToList();
        if (wantedGenres is { Count: > 0 })
        {
            filtered = filtered.Where(m =>
            {
                var genres = (m.Genre ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                return wantedGenres.Any(g => genres.Contains(g, StringComparer.OrdinalIgnoreCase));
            });
        }

        if (query.UnratedOnly)
            filtered = filtered.Where(m => m.AverageRating is null);
        else if (query.MinRating is not null)
            filtered = filtered.Where(m => m.AverageRating is not null && m.AverageRating >= query.MinRating);

        if (query.PendingVotesOnly)
            filtered = filtered.Where(m => m.Watchers.Any(w => w.HasWatched && w.Rating is null));

        // Default ("rating"): highest-rated first (from whichever ranking-member perspective was
        // requested), unrated items last. "title"/"added" let the client sort by name or recency
        // instead, independent of ranking perspective. Ties within any of these are broken
        // alphabetically by title then by tmdbId, so the order is stable and reproducible instead
        // of depending on whatever incidental order the database happened to return rows in.
        var withRating = filtered.Select(m => (Media: m, Rating: RatingOf(m)));
        var sorted = (query.SortBy switch
        {
            "title" => withRating.OrderBy(x => x.Media.Title, StringComparer.OrdinalIgnoreCase),
            "added" => withRating.OrderByDescending(x => x.Media.AddedAt),
            _ => withRating
                .OrderByDescending(x => x.Rating is not null)
                .ThenByDescending(x => x.Rating ?? 0)
        })
            .ThenBy(x => x.Media.Title, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.Media.TmdbId)
            .Select(x => x.Media)
            .ToList();

        var totalCount = sorted.Count;
        var skip = Math.Max(0, query.Skip);
        var take = Math.Clamp(query.Take, 1, 200);
        var pageItems = sorted.Skip(skip).Take(take).ToList();
        var hasMore = totalCount > skip + take;

        return new PagedGroupMediaResponse
        {
            Items = pageItems,
            TotalCount = totalCount,
            HasMore = hasMore,
            AvailableGenres = availableGenres,
            TotalMediaInGroup = allResponses.Count
        };
    }

    // Fetches just one media item's current state - used by the frontend to patch a single row
    // in-place after a watcher/rating/voting-duration SSE event instead of refetching the whole
    // (possibly filtered/paginated) list.
    public async Task<GroupMediaResponse> GetMediaItemAsync(int groupId, int tmdbId) => await BuildResponseAsync(groupId, tmdbId);

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
            select new MemberInfo(u.Id, u.DisplayName, u.AvatarUrl)
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

    private record MemberInfo(int Id, string DisplayName, string? AvatarUrl);

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
                DisplayName = member.DisplayName,
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
                DisplayName = pendingDisplayNames.TryGetValue(discordId, out var name) && !string.IsNullOrWhiteSpace(name)
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
            RuntimeMinutes = media.RuntimeMinutes,
            Genre = media.Genre,
            Year = media.Year
        };
    }
}
