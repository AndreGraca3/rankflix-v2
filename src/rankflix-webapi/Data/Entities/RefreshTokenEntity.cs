using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("refresh_token")]
public class RefreshTokenEntity
{
    [Column("value")] public Guid Value { get; set; }

    [Column("created_at")] public DateTime CreatedAt { get; set; }

    [Column("user_id")] public int UserId { get; set; }

    // Set when this token is rotated out (instead of being deleted outright) so a
    // near-simultaneous request from another tab on the same device/cookie jar can still be
    // honored within a short grace window instead of being wrongly treated as invalid/stolen.
    [Column("used_at")] public DateTime? UsedAt { get; set; }

    // Points at the token that replaced this one, so the rotation chain can be followed to
    // find the current still-active token during the reuse grace window.
    [Column("replaced_by_value")] public Guid? ReplacedByValue { get; set; }
}
