using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("rank_group_watch_status")]
public class RankGroupWatchStatusEntity
{
    // Surrogate key (was previously composite media_id+group_id+user_id) so a row can
    // represent a "pending" watch status for a not-yet-registered Discord id (user_id null).
    [Column("id")] public Guid Id { get; set; }

    [Column("media_id")] public int MediaId { get; set; }

    [Column("group_id")] public int GroupId { get; set; }

    [Column("user_id")] public int? UserId { get; set; }

    [Column("pending_discord_id")] public string? PendingDiscordId { get; set; }

    [Column("watched_at")] public DateTime WatchedAt { get; set; }
}
