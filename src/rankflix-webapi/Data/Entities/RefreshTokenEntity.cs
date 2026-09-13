using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("refresh_token")]
public class RefreshTokenEntity
{
    [Column("value")] public Guid Value { get; set; }

    [Column("created_at")] public DateTime CreatedAt { get; set; }

    [Column("user_id")] public int UserId { get; set; }
}
