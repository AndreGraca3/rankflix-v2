using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Models.Users;

namespace Rankflix.Services;

public interface IUserStatsService
{
    Task<UserStatsResponse> GetStatsAsync(int userId);
}

public class UserStatsService(RankflixDbContext db) : IUserStatsService
{
    public async Task<UserStatsResponse> GetStatsAsync(int userId)
    {
        var totalGroups = await db.RankGroupMembers.CountAsync(m => m.UserId == userId);

        var watchedTmdbIds = await db.RankGroupWatchStatuses
            .Where(w => w.UserId == userId)
            .Select(w => w.MediaId)
            .Distinct()
            .ToListAsync();

        var watchedMedia = await db.Media
            .Where(m => watchedTmdbIds.Contains(m.TmdbId))
            .ToListAsync();

        var moviesWatched = watchedMedia.Count(m => m.Type == "movie");
        var tvWatched = watchedMedia.Count(m => m.Type == "tv");

        var reviews = await db.Reviews.Where(r => r.UserId == userId).ToListAsync();
        var totalRatingsGiven = reviews.Count;
        var averageRatingGiven = reviews.Count > 0 ? reviews.Average(r => r.Rating) : (double?)null;

        TopMediaResponse? topRated = null;
        var topReview = reviews.OrderByDescending(r => r.Rating).FirstOrDefault();
        if (topReview is not null)
        {
            var media = await db.Media.FirstOrDefaultAsync(m => m.TmdbId == topReview.MediaId);
            if (media is not null)
            {
                topRated = new TopMediaResponse
                {
                    TmdbId = media.TmdbId,
                    Title = media.Title,
                    PosterUrl = media.PosterUrl,
                    Rating = topReview.Rating
                };
            }
        }

        return new UserStatsResponse
        {
            TotalGroups = totalGroups,
            MoviesWatched = moviesWatched,
            TvWatched = tvWatched,
            TotalRatingsGiven = totalRatingsGiven,
            AverageRatingGiven = averageRatingGiven,
            TopRated = topRated
        };
    }
}
