using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("rank_group_media")]
public class RankGroupMediaEntity
{
    [Column("media_id")] public int MediaId { get; set; }

    [Column("group_id")] public int GroupId { get; set; }

    [Column("added_at")] public DateTime AddedAt { get; set; }

    [Column("added_by")] public int AddedBy { get; set; }

    // Admin-editable voting window, applied from AddedAt. Defaults to 24 hours.
    [Column("voting_duration_hours")] public int VotingDurationHours { get; set; } = 24;

    // Legacy Excel imports sometimes only have a computed average rating (no individual
    // per-user ratings, e.g. everyone marked watched but nobody scored it in the old bot). This
    // preserves that average as a fallback so the group's history isn't shown as unrated.
    [Column("imported_average_rating")] public double? ImportedAverageRating { get; set; }
}
