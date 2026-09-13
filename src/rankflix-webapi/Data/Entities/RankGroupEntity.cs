using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("rank_group")]
public class RankGroupEntity
{
    [Column("id")] public int Id { get; set; }

    [Column("name")] public required string Name { get; set; }

    [Column("owner_id")] public int OwnerId { get; set; }

    [Column("image_url")] public string? ImageUrl { get; set; }
}
