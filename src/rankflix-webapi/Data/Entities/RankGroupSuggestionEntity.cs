using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

// A group member's pick for "what to watch next" - lives in its own queue, separate from
// rank_group_media (the actual watched/rated history), until an owner/admin promotes it into
// the real media list (or a member removes it).
[Table("rank_group_suggestions")]
public class RankGroupSuggestionEntity
{
    [Column("id")] public Guid Id { get; set; }

    [Column("group_id")] public int GroupId { get; set; }

    [Column("tmdb_id")] public int TmdbId { get; set; }

    [Column("added_by")] public int AddedBy { get; set; }

    [Column("added_at")] public DateTime AddedAt { get; set; }
}
