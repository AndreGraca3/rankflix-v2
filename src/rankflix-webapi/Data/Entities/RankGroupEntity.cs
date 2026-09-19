using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("rank_group")]
public class RankGroupEntity
{
    [Column("id")] public int Id { get; set; }

    [Column("name")] public required string Name { get; set; }

    [Column("owner_id")] public int OwnerId { get; set; }

    [Column("image_url")] public string? ImageUrl { get; set; }

    // When true, only group owners/site admins can trigger the suggestions random-pick spin -
    // lets an owner stop members from spamming spins if that becomes a nuisance.
    [Column("spins_disabled_for_members")] public bool SpinsDisabledForMembers { get; set; }
}
