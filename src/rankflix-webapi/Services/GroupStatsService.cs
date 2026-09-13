using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Models.Groups;

namespace Rankflix.Services;

public interface IGroupStatsService
{
    Task<GroupStatsResponse> GetGroupStatsAsync(int groupId);
}

public class GroupStatsService(RankflixDbContext db) : IGroupStatsService
{
    public async Task<GroupStatsResponse> GetGroupStatsAsync(int groupId)
    {
        var members = await (
            from m in db.RankGroupMembers
            join u in db.Users on m.UserId equals u.Id
            where m.GroupId == groupId
            select u
        ).ToListAsync();

        var groupMedia = await db.RankGroupMedia
            .Where(gm => gm.GroupId == groupId)
            .ToListAsync();
        var mediaIds = groupMedia.Select(gm => gm.MediaId).ToList();

        var mediaById = await db.Media
            .Where(m => mediaIds.Contains(m.TmdbId))
            .ToDictionaryAsync(m => m.TmdbId);

        var watchStatuses = await db.RankGroupWatchStatuses
            .Where(w => w.GroupId == groupId)
            .ToListAsync();

        var reviews = await db.Reviews
            .Where(r => r.GroupId == groupId)
            .ToListAsync();

        var memberStats = members.Select(user =>
        {
            var watchedTmdbIds = watchStatuses
                .Where(w => w.UserId == user.Id)
                .Select(w => w.MediaId)
                .Distinct()
                .ToList();
            var watchedMedia = watchedTmdbIds.Where(mediaById.ContainsKey).Select(id => mediaById[id]).ToList();

            var userReviews = reviews.Where(r => r.UserId == user.Id).ToList();

            return new MemberStatsResponse
            {
                UserId = user.Id,
                Username = user.Username,
                AvatarUrl = user.AvatarUrl,
                DiscordId = user.DiscordId,
                MoviesWatched = watchedMedia.Count(m => m.Type == "movie"),
                TvWatched = watchedMedia.Count(m => m.Type == "tv"),
                TotalRatingsGiven = userReviews.Count,
                AverageRatingGiven = userReviews.Count > 0 ? userReviews.Average(r => r.Rating) : null
            };
        }).ToList();

        // Discord ids without a matched account yet (from Excel import) still have real watch/rating
        // history - compute their stats the same way so counts/averages shown in the UI are accurate.
        var pendingDiscordIds = watchStatuses.Where(w => w.PendingDiscordId != null).Select(w => w.PendingDiscordId!)
            .Concat(reviews.Where(r => r.PendingDiscordId != null).Select(r => r.PendingDiscordId!))
            .Distinct()
            .ToList();

        var pendingDisplayNames = await db.PendingGroupMembers
            .Where(p => p.GroupId == groupId)
            .ToDictionaryAsync(p => p.DiscordId, p => p.DisplayName);

        var pendingMemberStats = pendingDiscordIds.Select(discordId =>
        {
            var watchedTmdbIds = watchStatuses
                .Where(w => w.PendingDiscordId == discordId)
                .Select(w => w.MediaId)
                .Distinct()
                .ToList();
            var watchedMedia = watchedTmdbIds.Where(mediaById.ContainsKey).Select(id => mediaById[id]).ToList();

            var discordReviews = reviews.Where(r => r.PendingDiscordId == discordId).ToList();

            return new PendingMemberStatsResponse
            {
                DiscordId = discordId,
                DisplayName = pendingDisplayNames.TryGetValue(discordId, out var name) ? name : null,
                MoviesWatched = watchedMedia.Count(m => m.Type == "movie"),
                TvWatched = watchedMedia.Count(m => m.Type == "tv"),
                TotalRatingsGiven = discordReviews.Count,
                AverageRatingGiven = discordReviews.Count > 0 ? discordReviews.Average(r => r.Rating) : null
            };
        }).ToList();

        TopMediaInGroupResponse? topMedia = null;
        var reviewsByMedia = reviews.GroupBy(r => r.MediaId)
            .ToDictionary(g => g.Key, g => g.Average(r => r.Rating));
        var byMedia = groupMedia
            .Select(gm => new
            {
                gm.MediaId,
                Average = reviewsByMedia.TryGetValue(gm.MediaId, out var avg) ? avg : gm.ImportedAverageRating
            })
            .Where(x => x.Average is not null && mediaById.ContainsKey(x.MediaId))
            .OrderByDescending(x => x.Average)
            .FirstOrDefault();
        if (byMedia is not null)
        {
            var media = mediaById[byMedia.MediaId];
            topMedia = new TopMediaInGroupResponse
            {
                TmdbId = media.TmdbId,
                Title = media.Title,
                PosterUrl = media.PosterUrl,
                AverageRating = byMedia.Average!.Value
            };
        }

        return new GroupStatsResponse { Members = memberStats, PendingMembers = pendingMemberStats, TopMedia = topMedia };
    }
}
