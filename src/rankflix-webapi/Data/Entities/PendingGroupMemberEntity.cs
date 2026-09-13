using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

/// <summary>
/// Tracks the display name (from the legacy spreadsheet's username row) for a Discord id that has
/// imported history in a group but no matching user account yet. Lets the UI show "Nemo" instead of
/// a raw Discord id until an admin creates the account and assigns it (see ExcelService/UserController).
/// </summary>
[Table("rank_group_pending_member")]
public class PendingGroupMemberEntity
{
    [Column("group_id")] public int GroupId { get; set; }

    [Column("discord_id")] public required string DiscordId { get; set; }

    [Column("display_name")] public string? DisplayName { get; set; }
}
