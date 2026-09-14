using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("media")]
public class MediaEntity
{
    [Column("tmdb_id")] public int TmdbId { get; set; }

    [Column("title")] public required string Title { get; set; }

    [Column("type")] public required string Type { get; set; } // "movie" | "tv"

    [Column("poster_url")] public string? PosterUrl { get; set; }

    // Total runtime in minutes: a movie's runtime, or (episode runtime x episode count) for a TV
    // show - used to estimate total watch time. Null until fetched from TMDB (lazily backfilled
    // for older rows - see GroupStatsService).
    [Column("runtime_minutes")] public int? RuntimeMinutes { get; set; }

    // Comma-separated genre names (e.g. "Action, Comedy") and release year, both from TMDB.
    // Same lazy-backfill treatment as runtime: null until fetched, then persisted so it's a
    // one-time TMDB lookup per title.
    [Column("genre")] public string? Genre { get; set; }

    [Column("year")] public int? Year { get; set; }
}
