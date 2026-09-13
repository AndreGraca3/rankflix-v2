using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Data.Entities;
using Rankflix.Models.Reviews;

namespace Rankflix.Services;

public interface IReviewService
{
    Task<ReviewResponse> SubmitReviewAsync(int groupId, int tmdbId, int userId, SubmitReviewRequest request);
    Task<List<ReviewResponse>> GetReviewsAsync(int groupId, int tmdbId);
    Task DeleteReviewAsync(int groupId, int tmdbId, int userId, bool isSiteAdmin);
}

public class ReviewService(RankflixDbContext db, ISseService sse) : IReviewService
{
    public async Task<ReviewResponse> SubmitReviewAsync(int groupId, int tmdbId, int userId,
        SubmitReviewRequest request)
    {
        var groupMedia = await db.RankGroupMedia
            .FirstOrDefaultAsync(gm => gm.GroupId == groupId && gm.MediaId == tmdbId)
            ?? throw new AppException("Media not found in group", StatusCodes.Status404NotFound);

        var votingClosesAt = groupMedia.AddedAt.AddHours(groupMedia.VotingDurationHours);
        if (DateTime.UtcNow >= votingClosesAt)
            throw new AppException("Voting window for this media has closed", StatusCodes.Status400BadRequest);

        var hasWatched = await db.RankGroupWatchStatuses
            .AnyAsync(w => w.GroupId == groupId && w.MediaId == tmdbId && w.UserId == userId);
        if (!hasWatched)
            throw new AppException("You must be marked as having watched this media before voting",
                StatusCodes.Status400BadRequest);

        if (request.Rating is < 0 or > 10)
            throw new AppException("Rating must be between 0 and 10", StatusCodes.Status400BadRequest);

        var review = await db.Reviews
            .FirstOrDefaultAsync(r => r.GroupId == groupId && r.MediaId == tmdbId && r.UserId == userId);

        if (review is null)
        {
            review = new ReviewEntity
            {
                Id = Guid.NewGuid(),
                GroupId = groupId,
                MediaId = tmdbId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow
            };
            db.Reviews.Add(review);
        }

        review.Rating = request.Rating;
        review.Comment = request.Comment;

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (db.Entry(review).State == EntityState.Added)
        {
            // Two concurrent submits from the same user (e.g. a double-click or a retried request)
            // can both pass the FirstOrDefaultAsync check above before either has inserted its row.
            // The unique (media_id, group_id, user_id) index then rejects the loser here - detach it
            // and fall back to an update against the row the winner just created, instead of a 500.
            db.Entry(review).State = EntityState.Detached;
            review = await db.Reviews
                .FirstAsync(r => r.GroupId == groupId && r.MediaId == tmdbId && r.UserId == userId);
            review.Rating = request.Rating;
            review.Comment = request.Comment;
            await db.SaveChangesAsync();
        }

        var username = await db.Users.Where(u => u.Id == userId).Select(u => u.Username).FirstAsync();

        await PublishGroupUpdatedAsync(groupId, tmdbId, "rating-changed");

        return new ReviewResponse
        {
            Id = review.Id,
            UserId = userId,
            Username = username,
            Rating = review.Rating,
            Comment = review.Comment,
            CreatedAt = review.CreatedAt
        };
    }

    public async Task<List<ReviewResponse>> GetReviewsAsync(int groupId, int tmdbId)
    {
        return await (
            from r in db.Reviews
            join u in db.Users on r.UserId equals (int?)u.Id
            where r.GroupId == groupId && r.MediaId == tmdbId
            select new ReviewResponse
            {
                Id = r.Id,
                UserId = u.Id,
                Username = u.Username,
                Rating = r.Rating,
                Comment = r.Comment,
                CreatedAt = r.CreatedAt
            }
        ).ToListAsync();
    }

    public async Task DeleteReviewAsync(int groupId, int tmdbId, int userId, bool isSiteAdmin)
    {
        var review = await db.Reviews
            .FirstOrDefaultAsync(r => r.GroupId == groupId && r.MediaId == tmdbId && r.UserId == userId)
            ?? throw new AppException("Review not found", StatusCodes.Status404NotFound);

        if (!isSiteAdmin)
        {
            var groupMedia = await db.RankGroupMedia
                .FirstOrDefaultAsync(gm => gm.GroupId == groupId && gm.MediaId == tmdbId)
                ?? throw new AppException("Media not found in group", StatusCodes.Status404NotFound);

            var votingClosesAt = groupMedia.AddedAt.AddHours(groupMedia.VotingDurationHours);
            if (DateTime.UtcNow >= votingClosesAt)
                throw new AppException("Voting is closed for this media - only a site admin can remove ratings now", StatusCodes.Status403Forbidden);
        }

        db.Reviews.Remove(review);
        await db.SaveChangesAsync();
        await PublishGroupUpdatedAsync(groupId, tmdbId, "rating-changed");
    }

    private async Task PublishGroupUpdatedAsync(int groupId, int tmdbId, string eventName)
    {
        var memberIds = await db.RankGroupMembers
            .Where(m => m.GroupId == groupId)
            .Select(m => m.UserId)
            .ToListAsync();

        sse.PublishToUsers(memberIds, eventName, new { groupId, tmdbId });
    }
}
