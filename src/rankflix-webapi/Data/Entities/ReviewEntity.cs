using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("review")]
public class ReviewEntity
{
    [Column("id")] public Guid Id { get; set; }

    [Column("rating")] public double Rating { get; set; }

    [Column("comment")] public string? Comment { get; set; }

    [Column("created_at")] public DateTime CreatedAt { get; set; }

    [Column("media_id")] public int MediaId { get; set; }

    [Column("group_id")] public int GroupId { get; set; }

    // Nullable so a legacy Excel import can preserve a rating for a Discord id that doesn't
    // have an account yet. PendingDiscordId is set instead, and this gets backfilled with the
    // real user id once an admin assigns that discord id to an account.
    [Column("user_id")] public int? UserId { get; set; }

    [Column("pending_discord_id")] public string? PendingDiscordId { get; set; }
}
