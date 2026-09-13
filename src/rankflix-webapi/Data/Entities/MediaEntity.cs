using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("media")]
public class MediaEntity
{
    [Column("tmdb_id")] public int TmdbId { get; set; }

    [Column("title")] public required string Title { get; set; }

    [Column("type")] public required string Type { get; set; } // "movie" | "tv"

    [Column("poster_url")] public string? PosterUrl { get; set; }
}
