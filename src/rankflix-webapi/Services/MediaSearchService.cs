using TMDbLib.Client;
using TMDbLib.Objects.General;
using TMDbLib.Objects.Search;

namespace Rankflix.Services;

public record MediaSearchResult(int TmdbId, string Title, string Type, string? Year, string? PosterUrl, string? Genre);

public interface IMediaSearchService
{
    Task<List<MediaSearchResult>> SearchAsync(string query);
}

public class MediaSearchService(TMDbClient client) : IMediaSearchService
{
    private const string BaseImageUrl = "https://image.tmdb.org/t/p/w185";

    // TMDB's genre list is a small, rarely-changing lookup table shared by every search request,
    // so it's cached for the life of the process instead of being re-fetched on every search.
    private static readonly SemaphoreSlim GenreCacheLock = new(1, 1);
    private static Dictionary<int, string>? _movieGenres;
    private static Dictionary<int, string>? _tvGenres;

    public async Task<List<MediaSearchResult>> SearchAsync(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];

        var multiSearch = await client.SearchMultiAsync(query);
        var (movieGenres, tvGenres) = await GetGenreMapsAsync();

        return multiSearch.Results
            .Where(r => r.MediaType is MediaType.Movie or MediaType.Tv)
            .Select(r =>
            {
                if (r.MediaType == MediaType.Movie)
                {
                    var movie = r as SearchMovie;
                    return new MediaSearchResult(
                        movie!.Id,
                        movie.Title,
                        "movie",
                        movie.ReleaseDate?.Year.ToString(),
                        movie.PosterPath is not null ? $"{BaseImageUrl}{movie.PosterPath}" : null,
                        FormatGenres(movie.GenreIds, movieGenres));
                }

                var tv = r as SearchTv;
                return new MediaSearchResult(
                    tv!.Id,
                    tv.Name,
                    "tv",
                    tv.FirstAirDate?.Year.ToString(),
                    tv.PosterPath is not null ? $"{BaseImageUrl}{tv.PosterPath}" : null,
                    FormatGenres(tv.GenreIds, tvGenres));
            })
            .Take(10)
            .ToList();
    }

    private async Task<(Dictionary<int, string> Movie, Dictionary<int, string> Tv)> GetGenreMapsAsync()
    {
        if (_movieGenres is not null && _tvGenres is not null) return (_movieGenres, _tvGenres);

        await GenreCacheLock.WaitAsync();
        try
        {
            _movieGenres ??= (await client.GetMovieGenresAsync()).ToDictionary(g => g.Id, g => g.Name);
            _tvGenres ??= (await client.GetTvGenresAsync()).ToDictionary(g => g.Id, g => g.Name);
        }
        finally
        {
            GenreCacheLock.Release();
        }

        return (_movieGenres, _tvGenres);
    }

    private static string? FormatGenres(List<int>? ids, Dictionary<int, string> genreMap)
    {
        if (ids is null || ids.Count == 0) return null;
        var joined = string.Join(", ", ids.Take(3).Select(id => genreMap.GetValueOrDefault(id)).Where(n => !string.IsNullOrEmpty(n)));
        return string.IsNullOrEmpty(joined) ? null : joined;
    }
}

