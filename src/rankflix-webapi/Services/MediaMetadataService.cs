using System.Collections.Concurrent;
using TMDbLib.Client;

namespace Rankflix.Services;

public record MediaMetadata(string? PosterUrl, int? RuntimeMinutes);

public interface IMediaMetadataService
{
    Task<MediaMetadata?> FetchAsync(int tmdbId, string mediaType);
    Task<Dictionary<int, MediaMetadata?>> FetchManyAsync(List<(int TmdbId, string MediaType)> items);
}

/// <summary>
/// Wraps TMDB lookups for the metadata we need beyond what search results already give us:
/// poster (for older rows added before we stored one) and runtime (for the watch-time stats).
/// Both come back on the same movie/tv "details" call, so fetching them together is free -
/// no extra TMDB requests compared to only fetching the poster.
/// </summary>
public class MediaMetadataService(TMDbClient client) : IMediaMetadataService
{
    private const string PosterBaseUrl = "https://image.tmdb.org/t/p/w185";

    // TMDb's public API rate limit is generous (~50 req/s) but not unlimited, so instead of firing
    // requests for every item at once (which would trip 429s) or doing them one-by-one (slow for
    // large imports/backfills), fan out with a small bounded concurrency and let TMDbLib retry
    // 429s internally.
    private const int MaxConcurrentTmdbRequests = 8;

    public async Task<MediaMetadata?> FetchAsync(int tmdbId, string mediaType)
    {
        try
        {
            if (mediaType == "tv")
            {
                var tv = await client.GetTvShowAsync(tmdbId);
                if (tv is null) return null;

                var posterUrl = tv.PosterPath is not null ? $"{PosterBaseUrl}{tv.PosterPath}" : null;

                // We only track "watched: yes/no" for a whole show (no per-episode progress), so
                // watching it is treated as watching the full run: episode runtime x episode count.
                var episodeRuntime = tv.EpisodeRunTime?.Where(r => r > 0).ToList();
                int? runtimeMinutes = episodeRuntime is { Count: > 0 } && tv.NumberOfEpisodes > 0
                    ? (int)Math.Round(episodeRuntime.Average() * tv.NumberOfEpisodes)
                    : null;

                return new MediaMetadata(posterUrl, runtimeMinutes);
            }

            var movie = await client.GetMovieAsync(tmdbId);
            if (movie is null) return null;

            var moviePosterUrl = movie.PosterPath is not null ? $"{PosterBaseUrl}{movie.PosterPath}" : null;
            return new MediaMetadata(moviePosterUrl, movie.Runtime);
        }
        catch
        {
            // TMDb lookup is best-effort (rate limits, unknown/removed ids, etc.) - missing
            // metadata shouldn't fail whatever the caller is doing.
            return null;
        }
    }

    public async Task<Dictionary<int, MediaMetadata?>> FetchManyAsync(List<(int TmdbId, string MediaType)> items)
    {
        var result = new ConcurrentDictionary<int, MediaMetadata?>();
        if (items.Count == 0) return new Dictionary<int, MediaMetadata?>();

        using var throttle = new SemaphoreSlim(MaxConcurrentTmdbRequests);
        var tasks = items.Select(async item =>
        {
            await throttle.WaitAsync();
            try
            {
                result[item.TmdbId] = await FetchAsync(item.TmdbId, item.MediaType);
            }
            finally
            {
                throttle.Release();
            }
        });

        await Task.WhenAll(tasks);
        return new Dictionary<int, MediaMetadata?>(result);
    }
}
