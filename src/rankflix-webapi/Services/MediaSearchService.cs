using TMDbLib.Client;
using TMDbLib.Objects.General;
using TMDbLib.Objects.Search;

namespace Rankflix.Services;

public record MediaSearchResult(int TmdbId, string Title, string Type, string? Year, string? PosterUrl);

public interface IMediaSearchService
{
    Task<List<MediaSearchResult>> SearchAsync(string query);
}

public class MediaSearchService(TMDbClient client) : IMediaSearchService
{
    private const string BaseImageUrl = "https://image.tmdb.org/t/p/w185";

    public async Task<List<MediaSearchResult>> SearchAsync(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];

        var multiSearch = await client.SearchMultiAsync(query);

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
                        movie.PosterPath is not null ? $"{BaseImageUrl}{movie.PosterPath}" : null);
                }

                var tv = r as SearchTv;
                return new MediaSearchResult(
                    tv!.Id,
                    tv.Name,
                    "tv",
                    tv.FirstAirDate?.Year.ToString(),
                    tv.PosterPath is not null ? $"{BaseImageUrl}{tv.PosterPath}" : null);
            })
            .Take(10)
            .ToList();
    }
}
