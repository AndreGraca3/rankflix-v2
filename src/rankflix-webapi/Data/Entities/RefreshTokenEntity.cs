using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("refresh_token")]
public class RefreshTokenEntity
{
    [Column("value")] public Guid Value { get; set; }

    [Column("created_at")] public DateTime CreatedAt { get; set; }

    [Column("user_id")] public int UserId { get; set; }

    // Set once this token has been exchanged for a new one. Kept (rather than deleting the
    // row outright) for a short grace window so a near-simultaneous duplicate refresh call
    // (e.g. two browser tabs on the same device racing right as the access token expires)
    // can follow the chain to its replacement instead of being wrongly logged out.
    [Column("used_at")] public DateTime? UsedAt { get; set; }

    [Column("replaced_by_value")] public Guid? ReplacedByValue { get; set; }
}
