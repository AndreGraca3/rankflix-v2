using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Data.Entities;
using Rankflix.Models.Media;
using Rankflix.Models.Suggestions;

namespace Rankflix.Services;

public interface ISuggestionService
{
    Task<List<SuggestionResponse>> GetSuggestionsAsync(int groupId, int requestingUserId, bool isSiteAdmin);
    Task<SuggestionResponse> AddSuggestionAsync(int groupId, int userId, AddSuggestionRequest request);
    Task RemoveSuggestionAsync(int groupId, Guid suggestionId, int requestingUserId, bool isSiteAdmin);
    Task<GroupMediaResponse> PromoteSuggestionAsync(int groupId, Guid suggestionId, int requestingUserId,
        PromoteSuggestionRequest request);
}

public class SuggestionService(
    RankflixDbContext db,
    ISseService sse,
    IMediaMetadataService mediaMetadataService,
    IMediaService mediaService) : ISuggestionService
{
    public async Task<List<SuggestionResponse>> GetSuggestionsAsync(int groupId, int requestingUserId, bool isSiteAdmin)
    {
        var isOwner = await db.RankGroupMembers
            .AnyAsync(m => m.GroupId == groupId && m.UserId == requestingUserId && m.IsOwner);
        var canRemoveAny = isSiteAdmin || isOwner;

        var rows = await (
            from s in db.RankGroupSuggestions
            join media in db.Media on s.TmdbId equals media.TmdbId
            join u in db.Users on s.AddedBy equals u.Id
            where s.GroupId == groupId
            orderby s.AddedAt descending
            select new { s, media, u }
        ).ToListAsync();

        return rows.Select(r => new SuggestionResponse
        {
            Id = r.s.Id,
            TmdbId = r.s.TmdbId,
            Title = r.media.Title,
            Type = r.media.Type,
            PosterUrl = r.media.PosterUrl,
            Year = r.media.Year,
            RuntimeMinutes = r.media.RuntimeMinutes,
            Genre = r.media.Genre,
            AddedByUserId = r.s.AddedBy,
            AddedByDisplayName = r.u.DisplayName,
            AddedByAvatarUrl = r.u.AvatarUrl,
            AddedAt = r.s.AddedAt,
            CanRemove = canRemoveAny || r.s.AddedBy == requestingUserId
        }).ToList();
    }

    public async Task<SuggestionResponse> AddSuggestionAsync(int groupId, int userId, AddSuggestionRequest request)
    {
        if (!await db.RankGroups.AnyAsync(g => g.Id == groupId))
            throw new AppException("Group not found", StatusCodes.Status404NotFound);

        var alreadyInGroup = await db.RankGroupMedia
            .AnyAsync(gm => gm.GroupId == groupId && gm.MediaId == request.TmdbId);
        if (alreadyInGroup)
            throw new AppException("This title is already in the group's media list", StatusCodes.Status409Conflict);

        var alreadySuggested = await db.RankGroupSuggestions
            .AnyAsync(s => s.GroupId == groupId && s.TmdbId == request.TmdbId);
        if (alreadySuggested)
            throw new AppException("This title has already been suggested", StatusCodes.Status409Conflict);

        var media = await db.Media.FirstOrDefaultAsync(m => m.TmdbId == request.TmdbId);
        if (media is null)
        {
            media = new MediaEntity { TmdbId = request.TmdbId, Title = request.Title, Type = request.Type, PosterUrl = request.PosterUrl };
            db.Media.Add(media);
        }

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

        var suggestion = new RankGroupSuggestionEntity
        {
            Id = Guid.NewGuid(),
            GroupId = groupId,
            TmdbId = request.TmdbId,
            AddedBy = userId,
            AddedAt = DateTime.UtcNow
        };
        db.RankGroupSuggestions.Add(suggestion);
        await db.SaveChangesAsync();

        await PublishSuggestionsChangedAsync(groupId);

        var addedBy = await db.Users.FirstAsync(u => u.Id == userId);
        return new SuggestionResponse
        {
            Id = suggestion.Id,
            TmdbId = media.TmdbId,
            Title = media.Title,
            Type = media.Type,
            PosterUrl = media.PosterUrl,
            Year = media.Year,
            RuntimeMinutes = media.RuntimeMinutes,
            Genre = media.Genre,
            AddedByUserId = userId,
            AddedByDisplayName = addedBy.DisplayName,
            AddedByAvatarUrl = addedBy.AvatarUrl,
            AddedAt = suggestion.AddedAt,
            CanRemove = true
        };
    }

    public async Task RemoveSuggestionAsync(int groupId, Guid suggestionId, int requestingUserId, bool isSiteAdmin)
    {
        var suggestion = await db.RankGroupSuggestions
            .FirstOrDefaultAsync(s => s.Id == suggestionId && s.GroupId == groupId)
            ?? throw new AppException("Suggestion not found", StatusCodes.Status404NotFound);

        if (!isSiteAdmin && suggestion.AddedBy != requestingUserId)
        {
            var isOwner = await db.RankGroupMembers
                .AnyAsync(m => m.GroupId == groupId && m.UserId == requestingUserId && m.IsOwner);
            if (!isOwner)
                throw new AppException("Only the person who suggested this, or a group owner, can remove it",
                    StatusCodes.Status403Forbidden);
        }

        db.RankGroupSuggestions.Remove(suggestion);
        await db.SaveChangesAsync();
        await PublishSuggestionsChangedAsync(groupId);
    }

    public async Task<GroupMediaResponse> PromoteSuggestionAsync(int groupId, Guid suggestionId, int requestingUserId,
        PromoteSuggestionRequest request)
    {
        var suggestion = await db.RankGroupSuggestions
            .FirstOrDefaultAsync(s => s.Id == suggestionId && s.GroupId == groupId)
            ?? throw new AppException("Suggestion not found", StatusCodes.Status404NotFound);

        var media = await db.Media.FirstAsync(m => m.TmdbId == suggestion.TmdbId);

        var response = await mediaService.AddMediaToGroupAsync(groupId, requestingUserId, new AddMediaRequest
        {
            TmdbId = media.TmdbId,
            Title = media.Title,
            Type = media.Type,
            PosterUrl = media.PosterUrl,
            VotingDurationHours = request.VotingDurationHours
        });

        db.RankGroupSuggestions.Remove(suggestion);
        await db.SaveChangesAsync();
        await PublishSuggestionsChangedAsync(groupId);

        return response;
    }

    private async Task PublishSuggestionsChangedAsync(int groupId)
    {
        var memberIds = await db.RankGroupMembers
            .Where(m => m.GroupId == groupId)
            .Select(m => m.UserId)
            .ToListAsync();

        sse.PublishToUsers(memberIds, "suggestions-changed", new { groupId });
    }
}
