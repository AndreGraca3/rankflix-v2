using System.ComponentModel.DataAnnotations.Schema;

namespace Rankflix.Data.Entities;

[Table("user")]
public class UserEntity
{
    [Column("id")] public int Id { get; set; }

    [Column("username")] public required string Username { get; set; }

    // Links this row to the Supabase Auth user that owns it (Supabase issues JWTs with this
    // value as the `sub` claim). Passwords/sessions are fully managed by Supabase now - this
    // app's database only stores the profile/permissions data layered on top.
    [Column("supabase_user_id")] public Guid? SupabaseUserId { get; set; }

    // Friendly name shown everywhere in the UI (leaderboards, watcher lists, reviews, admin
    // panels). Kept separate from Username so friends can rename themselves freely without
    // touching their private login credential.
    [Column("display_name")] public required string DisplayName { get; set; }

    [Column("avatar_url")] public string? AvatarUrl { get; set; }

    // Editable by admin independently of login identity, since friends occasionally switch Discord accounts.
    [Column("discord_id")] public string? DiscordId { get; set; }

    [Column("role")] public string Role { get; set; } = "member";

    // User-chosen presence preference: "online" (default) or "invisible" (appears offline to
    // others regardless of connection state). Persisted so it's remembered across devices/logins.
    [Column("status")] public string Status { get; set; } = "online";

    [Column("created_at")] public DateTime CreatedAt { get; set; }
}

