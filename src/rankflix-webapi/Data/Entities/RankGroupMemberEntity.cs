using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("rank_group_member")]
public class RankGroupMemberEntity
{
    [Column("group_id")] public int GroupId { get; set; }

    [Column("user_id")] public int UserId { get; set; }

    // Groups can have multiple owners (any owner can grant/revoke ownership of other members).
    // A group must always retain at least one owner - see GroupService's ownership guards.
    [Column("is_owner")] public bool IsOwner { get; set; }
}
