using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Data.Entities;
using TMDbLib.Client;

namespace Rankflix.Services;

public record ExcelImportResult(int MediaImported, int ReviewsImported, int WatchStatusesImported,
    List<string> UnmatchedDiscordIds, int MediaRemoved);

public interface IExcelService
{
    Task<byte[]> ExportGroupAsync(int groupId);
    Task<ExcelImportResult> ImportGroupAsync(int groupId, Stream fileStream, int importedByUserId);
}

/// <summary>
/// Replicates the legacy Rankflix Discord bot's spreadsheet layout (rankflix-console/ExcelService.java):
/// row 3 = discord ids, row 4 = usernames, starting at column E; media rows start at row 5
/// (col C = tmdb id, col D = title); one rating column per user ("rating - comment", or blank);
/// red background = not watched, yellow background = watched but not yet rated; last column = average.
/// </summary>
public class ExcelService(RankflixDbContext db, TMDbClient tmdbClient) : IExcelService
{
    private const string TmdbPosterBaseUrl = "https://image.tmdb.org/t/p/w185";
    private const int UserRowIdx = 3; // row 3 (1-based) = discord ids
    private const int UsernameRowIdx = 4; // row 4 = usernames
    private const int FirstMediaRowIdx = 5;
    private const int MediaIdColIdx = 3; // column C
    private const int MediaTitleColIdx = 4; // column D
    private const int FirstUserRatingColIdx = 5; // column E

    private record ExportColumn(string DiscordId, string DisplayName, int? UserId, string? PendingDiscordId);

    public async Task<byte[]> ExportGroupAsync(int groupId)
    {
        var members = await (
            from m in db.RankGroupMembers
            join u in db.Users on m.UserId equals u.Id
            where m.GroupId == groupId
            orderby u.Id
            select u
        ).ToListAsync();

        // Pending members (discord ids with imported history but no linked account yet) still need a
        // column so their ratings/watch status aren't dropped from the export.
        var pendingMembers = await db.PendingGroupMembers
            .Where(p => p.GroupId == groupId)
            .OrderBy(p => p.DiscordId)
            .ToListAsync();

        var columns = members
            .Select(u => new ExportColumn(u.DiscordId ?? "", u.Username, u.Id, null))
            .Concat(pendingMembers.Select(p =>
                new ExportColumn(p.DiscordId, p.DisplayName ?? p.DiscordId, null, p.DiscordId)))
            .ToList();

        var groupMedia = await db.RankGroupMedia
            .Where(gm => gm.GroupId == groupId)
            .OrderBy(gm => gm.AddedAt)
            .ToListAsync();

        var mediaIds = groupMedia.Select(gm => gm.MediaId).ToList();
        var mediaById = await db.Media.Where(m => mediaIds.Contains(m.TmdbId))
            .ToDictionaryAsync(m => m.TmdbId);

        var reviews = await db.Reviews
            .Where(r => r.GroupId == groupId && mediaIds.Contains(r.MediaId))
            .ToListAsync();

        var watchStatuses = await db.RankGroupWatchStatuses
            .Where(w => w.GroupId == groupId && mediaIds.Contains(w.MediaId))
            .ToListAsync();

        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Media");

        var averageColIdx = FirstUserRatingColIdx + columns.Count;

        // Header rows: discord ids + usernames
        for (var i = 0; i < columns.Count; i++)
        {
            var col = FirstUserRatingColIdx + i;
            sheet.Cell(UserRowIdx, col).Value = columns[i].DiscordId;
            sheet.Cell(UsernameRowIdx, col).Value = columns[i].DisplayName;
        }

        var rowIdx = FirstMediaRowIdx;
        foreach (var gm in groupMedia)
        {
            var media = mediaById[gm.MediaId];
            sheet.Cell(rowIdx, MediaIdColIdx).Value = media.TmdbId;
            sheet.Cell(rowIdx, MediaTitleColIdx).Value = media.Title;

            var ratingsForAverage = new List<double>();

            for (var i = 0; i < columns.Count; i++)
            {
                var column = columns[i];
                var col = FirstUserRatingColIdx + i;
                var cell = sheet.Cell(rowIdx, col);

                var review = reviews.FirstOrDefault(r => r.MediaId == gm.MediaId &&
                    (column.UserId is not null ? r.UserId == column.UserId : r.PendingDiscordId == column.PendingDiscordId));
                var watched = watchStatuses.Any(w => w.MediaId == gm.MediaId &&
                    (column.UserId is not null ? w.UserId == column.UserId : w.PendingDiscordId == column.PendingDiscordId));

                if (review is not null)
                {
                    cell.Value = review.Comment is not null
                        ? $"{review.Rating} - {review.Comment}"
                        : review.Rating.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    ratingsForAverage.Add(review.Rating);
                }
                else if (watched)
                {
                    cell.Style.Fill.BackgroundColor = XLColor.Yellow;
                }
                else
                {
                    cell.Style.Fill.BackgroundColor = XLColor.Red;
                }
            }

            sheet.Cell(rowIdx, averageColIdx).Value =
                ratingsForAverage.Count > 0 ? ratingsForAverage.Average() : 0;

            rowIdx++;
        }

        // Per-user average row below the last media row
        for (var i = 0; i < columns.Count; i++)
        {
            var column = columns[i];
            var col = FirstUserRatingColIdx + i;
            var userRatings = reviews
                .Where(r => column.UserId is not null ? r.UserId == column.UserId : r.PendingDiscordId == column.PendingDiscordId)
                .Select(r => r.Rating).ToList();
            sheet.Cell(rowIdx, col).Value = userRatings.Count > 0 ? userRatings.Average() : 0;
        }

        sheet.Columns(1, averageColIdx).AdjustToContents();

        var lastDataRow = Math.Max(rowIdx, FirstMediaRowIdx); // includes the trailing per-user average row
        var usedRange = sheet.Range(UserRowIdx, MediaIdColIdx, lastDataRow, averageColIdx);
        usedRange.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        usedRange.Style.Border.InsideBorder = XLBorderStyleValues.Thin;

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    public async Task<ExcelImportResult> ImportGroupAsync(int groupId, Stream fileStream, int importedByUserId)
    {
        if (!await db.RankGroups.AnyAsync(g => g.Id == groupId))
            throw new AppException("Group not found", StatusCodes.Status404NotFound);

        using var workbook = new XLWorkbook(fileStream);
        var sheet = workbook.Worksheet(1);

        var lastCol = sheet.LastColumnUsed()?.ColumnNumber() ?? FirstUserRatingColIdx;
        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? FirstMediaRowIdx;

        // Map columns -> discord id + (optional) matched user. Unmatched ids are reported but not
        // dropped: their ratings/watch status are still stored against the discord id (PendingDiscordId)
        // so nothing is lost, and get attached automatically once an admin assigns that discord id to a
        // real account (see UserController.UpdateUser).
        var columnToDiscordId = new Dictionary<int, string>();
        var columnToUser = new Dictionary<int, UserEntity>();
        var unmatchedDiscordIds = new List<string>();

        for (var col = FirstUserRatingColIdx; col <= lastCol; col++)
        {
            var discordId = sheet.Cell(UserRowIdx, col).GetString().Trim();
            if (string.IsNullOrEmpty(discordId)) continue;

            columnToDiscordId[col] = discordId;

            var user = await db.Users.FirstOrDefaultAsync(u => u.DiscordId == discordId);
            if (user is null)
            {
                unmatchedDiscordIds.Add(discordId);

                // Remember the spreadsheet's username for this Discord id so the UI can show a real
                // name instead of a raw id until the account exists (see GroupService/GroupStatsService).
                var displayName = sheet.Cell(UsernameRowIdx, col).GetString().Trim();
                var pendingMember = await db.PendingGroupMembers
                    .FirstOrDefaultAsync(p => p.GroupId == groupId && p.DiscordId == discordId);
                if (pendingMember is null)
                {
                    db.PendingGroupMembers.Add(new PendingGroupMemberEntity
                    {
                        GroupId = groupId,
                        DiscordId = discordId,
                        DisplayName = string.IsNullOrWhiteSpace(displayName) ? null : displayName
                    });
                }
                else if (!string.IsNullOrWhiteSpace(displayName))
                {
                    pendingMember.DisplayName = displayName;
                }

                continue;
            }

            columnToUser[col] = user;

            var isMember = await db.RankGroupMembers
                .AnyAsync(m => m.GroupId == groupId && m.UserId == user.Id);
            if (!isMember)
                db.RankGroupMembers.Add(new RankGroupMemberEntity { GroupId = groupId, UserId = user.Id });
        }

        await db.SaveChangesAsync();

        // First pass: parse every media row's id/type/title without touching the DB or TMDb yet, so
        // we know exactly which tmdb ids need a poster lookup and can fetch them all concurrently
        // instead of one-by-one (this was the main source of import slowness on large spreadsheets).
        var mediaRows = new List<(int Row, int TmdbId, string MediaType, string Title)>();
        for (var row = FirstMediaRowIdx; row < lastRow; row++)
        {
            var idCell = sheet.Cell(row, MediaIdColIdx);
            if (idCell.IsEmpty()) continue;

            // Legacy bot ids are prefixed by media type, e.g. "M-27205" (movie) / "S-1399" (tv).
            if (!TryParseLegacyMediaId(idCell.GetString().Trim(), out var tmdbId, out var mediaType)) continue;
            var title = sheet.Cell(row, MediaTitleColIdx).GetString().Trim();
            mediaRows.Add((row, tmdbId, mediaType, title));
        }

        var existingMedia = await db.Media
            .Where(m => mediaRows.Select(r => r.TmdbId).Contains(m.TmdbId))
            .ToDictionaryAsync(m => m.TmdbId);

        var tmdbIdsNeedingPoster = mediaRows
            .Select(r => (r.TmdbId, r.MediaType))
            .Where(r => !existingMedia.TryGetValue(r.TmdbId, out var m) || string.IsNullOrWhiteSpace(m.PosterUrl))
            .DistinctBy(r => r.TmdbId)
            .ToList();

        var posterByTmdbId = await FetchPostersAsync(tmdbIdsNeedingPoster);

        var mediaImported = 0;
        var reviewsImported = 0;
        var watchStatusesImported = 0;

        // Batch-load everything the per-row/per-cell loop below needs, instead of querying the DB
        // once per media-row and again per member column (that N+1 pattern was the main source of
        // slowness on larger spreadsheets - the same class of bug fixed in MediaService).
        var existingGroupMediaByTmdbId = await db.RankGroupMedia
            .Where(gm => gm.GroupId == groupId)
            .ToDictionaryAsync(gm => gm.MediaId);

        var existingWatchKeys = (await db.RankGroupWatchStatuses
                .Where(w => w.GroupId == groupId)
                .Select(w => new { w.MediaId, w.UserId, w.PendingDiscordId })
                .ToListAsync())
            .Select(w => WatchKey(w.MediaId, w.UserId, w.PendingDiscordId))
            .ToHashSet();

        var existingReviewKeys = (await db.Reviews
                .Where(r => r.GroupId == groupId)
                .Select(r => new { r.MediaId, r.UserId, r.PendingDiscordId })
                .ToListAsync())
            .Select(r => WatchKey(r.MediaId, r.UserId, r.PendingDiscordId))
            .ToHashSet();

        foreach (var (row, tmdbId, mediaType, title) in mediaRows)
        {
            if (!existingMedia.TryGetValue(tmdbId, out var media))
            {
                media = new MediaEntity { TmdbId = tmdbId, Title = title, Type = mediaType };
                db.Media.Add(media);
                existingMedia[tmdbId] = media;
            }

            if (string.IsNullOrWhiteSpace(media.PosterUrl) && posterByTmdbId.TryGetValue(tmdbId, out var posterUrl))
            {
                media.PosterUrl = posterUrl;
            }

            var groupMedia = existingGroupMediaByTmdbId.GetValueOrDefault(tmdbId);
            if (groupMedia is null)
            {
                groupMedia = new RankGroupMediaEntity
                {
                    GroupId = groupId,
                    MediaId = tmdbId,
                    AddedAt = DateTime.UtcNow,
                    AddedBy = importedByUserId,
                    // Imported media is historical: voting has already happened, so it shouldn't
                    // re-open a fresh voting window like brand-new media does.
                    VotingDurationHours = 0
                };
                db.RankGroupMedia.Add(groupMedia);
                existingGroupMediaByTmdbId[tmdbId] = groupMedia;
                mediaImported++;
            }
            else
            {
                // Also force-close voting on media that was already in the group (e.g. added
                // manually before importing, or from a previous import) - imported data is always
                // historical, so it should never still show time left to vote.
                groupMedia.VotingDurationHours = 0;
            }

            // Legacy spreadsheets sometimes only have this computed average (everyone marked
            // watched, but nobody's individual rating was captured) - keep it as a fallback so
            // the group doesn't show the media as unrated when there's really a known average.
            var avgCell = sheet.Cell(row, lastCol);
            if (!avgCell.IsEmpty() &&
                double.TryParse(avgCell.GetString().Trim().Replace(",", "."),
                    System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var importedAverage) &&
                importedAverage > 0)
            {
                groupMedia.ImportedAverageRating = importedAverage;
            }

            foreach (var (col, discordId) in columnToDiscordId)
            {
                var cell = sheet.Cell(row, col);
                var backgroundColor = cell.Style.Fill.BackgroundColor;
                columnToUser.TryGetValue(col, out var user);
                var pendingDiscordId = user is null ? discordId : null;

                var key = WatchKey(tmdbId, user?.Id, pendingDiscordId);
                var hasWatchStatus = existingWatchKeys.Contains(key);

                if (!cell.IsEmpty())
                {
                    var raw = cell.GetString().Trim();
                    var parts = raw.Split(" - ", 2);
                    if (double.TryParse(parts[0].Replace(",", "."),
                            System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out var rating))
                    {
                        if (!hasWatchStatus)
                        {
                            db.RankGroupWatchStatuses.Add(new RankGroupWatchStatusEntity
                            {
                                Id = Guid.NewGuid(),
                                GroupId = groupId, MediaId = tmdbId, UserId = user?.Id,
                                PendingDiscordId = pendingDiscordId, WatchedAt = DateTime.UtcNow
                            });
                            existingWatchKeys.Add(key);
                            watchStatusesImported++;
                        }

                        if (!existingReviewKeys.Contains(key))
                        {
                            db.Reviews.Add(new ReviewEntity
                            {
                                Id = Guid.NewGuid(),
                                GroupId = groupId,
                                MediaId = tmdbId,
                                UserId = user?.Id,
                                PendingDiscordId = pendingDiscordId,
                                Rating = rating,
                                Comment = parts.Length > 1 ? parts[1] : null,
                                CreatedAt = DateTime.UtcNow
                            });
                            existingReviewKeys.Add(key);
                            reviewsImported++;
                        }
                    }
                }
                else if (IsWatchedNotRatedFill(backgroundColor) && !hasWatchStatus)
                {
                    // Blank + yellow background = watched but not yet rated.
                    db.RankGroupWatchStatuses.Add(new RankGroupWatchStatusEntity
                    {
                        Id = Guid.NewGuid(),
                        GroupId = groupId, MediaId = tmdbId, UserId = user?.Id,
                        PendingDiscordId = pendingDiscordId, WatchedAt = DateTime.UtcNow
                    });
                    existingWatchKeys.Add(key);
                    watchStatusesImported++;
                }
                // Blank + red background = not watched -> nothing to import.
            }
        }

        await db.SaveChangesAsync();

        // True "overwrite" semantics: any media the group currently has that isn't in this
        // spreadsheet gets removed (e.g. something added manually on-site that was never part of
        // the legacy export). DB-level ON DELETE CASCADE on rank_group_media cleans up the
        // matching reviews/watch-statuses for it automatically.
        var importedTmdbIds = mediaRows.Select(r => r.TmdbId).ToHashSet();
        var staleMedia = await db.RankGroupMedia
            .Where(gm => gm.GroupId == groupId && !importedTmdbIds.Contains(gm.MediaId))
            .ToListAsync();
        db.RankGroupMedia.RemoveRange(staleMedia);
        await db.SaveChangesAsync();

        return new ExcelImportResult(mediaImported, reviewsImported, watchStatusesImported, unmatchedDiscordIds,
            staleMedia.Count);
    }

    // Business key for "does this media already have a watch-status/review for this member",
    // used to de-duplicate in-memory instead of re-querying the DB per row/cell.
    private static string WatchKey(int mediaId, int? userId, string? pendingDiscordId) =>
        $"{mediaId}:{(userId is not null ? $"u{userId}" : $"d{pendingDiscordId}")}";

    // Legacy bot ids look like "M-27205" (movie) or "S-1399" (tv show).
    private static bool TryParseLegacyMediaId(string raw, out int tmdbId, out string mediaType)
    {
        tmdbId = 0;
        mediaType = "movie";

        var idPart = raw;
        if (raw.StartsWith("M-", StringComparison.OrdinalIgnoreCase))
        {
            mediaType = "movie";
            idPart = raw[2..];
        }
        else if (raw.StartsWith("S-", StringComparison.OrdinalIgnoreCase))
        {
            mediaType = "tv";
            idPart = raw[2..];
        }

        return int.TryParse(idPart.Trim(), out tmdbId);
    }

    // Our own exports use ClosedXML's RGB XLColor.Yellow, but files produced by the legacy
    // Discord bot use the old fixed Excel color palette (indexed color 13 = yellow).
    private static bool IsWatchedNotRatedFill(XLColor backgroundColor) =>
        backgroundColor.ColorType == XLColorType.Indexed
            ? backgroundColor.Indexed == 13
            : backgroundColor.Color == XLColor.Yellow.Color;

    private async Task<string?> TryFetchPosterUrlAsync(int tmdbId, string mediaType)
    {
        try
        {
            if (mediaType == "tv")
            {
                var tv = await tmdbClient.GetTvShowAsync(tmdbId);
                return tv?.PosterPath is not null ? $"{TmdbPosterBaseUrl}{tv.PosterPath}" : null;
            }

            var movie = await tmdbClient.GetMovieAsync(tmdbId);
            return movie?.PosterPath is not null ? $"{TmdbPosterBaseUrl}{movie.PosterPath}" : null;
        }
        catch
        {
            // TMDb lookup is best-effort during import (rate limits, unknown/removed ids, etc.) -
            // missing a poster shouldn't fail the whole import.
            return null;
        }
    }

    // TMDb's public API rate limit is generous (~50 req/s) but not unlimited, so instead of firing
    // hundreds of requests at once (which would trip 429s) or doing them one-by-one (which is what
    // made large imports slow), we fan out with a small bounded concurrency and let TMDbLib retry
    // 429s internally. 8 concurrent requests is comfortably under the limit while still cutting
    // import time roughly 8x for spreadsheets with many distinct titles.
    private const int MaxConcurrentTmdbRequests = 8;

    private async Task<Dictionary<int, string?>> FetchPostersAsync(List<(int TmdbId, string MediaType)> items)
    {
        var result = new System.Collections.Concurrent.ConcurrentDictionary<int, string?>();
        if (items.Count == 0) return new Dictionary<int, string?>();

        using var throttle = new SemaphoreSlim(MaxConcurrentTmdbRequests);
        var tasks = items.Select(async item =>
        {
            await throttle.WaitAsync();
            try
            {
                result[item.TmdbId] = await TryFetchPosterUrlAsync(item.TmdbId, item.MediaType);
            }
            finally
            {
                throttle.Release();
            }
        });

        await Task.WhenAll(tasks);
        return new Dictionary<int, string?>(result);
    }
}
