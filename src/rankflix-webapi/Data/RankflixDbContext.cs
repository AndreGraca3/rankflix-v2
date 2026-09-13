using Microsoft.EntityFrameworkCore;
using Rankflix.Data.Entities;

namespace Rankflix.Data;

public class RankflixDbContext(DbContextOptions<RankflixDbContext> options) : DbContext(options)
{
    public DbSet<UserEntity> Users => Set<UserEntity>();
    public DbSet<RefreshTokenEntity> RefreshTokens => Set<RefreshTokenEntity>();
    public DbSet<MediaEntity> Media => Set<MediaEntity>();
    public DbSet<RankGroupEntity> RankGroups => Set<RankGroupEntity>();
    public DbSet<RankGroupMemberEntity> RankGroupMembers => Set<RankGroupMemberEntity>();
    public DbSet<RankGroupMediaEntity> RankGroupMedia => Set<RankGroupMediaEntity>();
    public DbSet<RankGroupWatchStatusEntity> RankGroupWatchStatuses => Set<RankGroupWatchStatusEntity>();
    public DbSet<ReviewEntity> Reviews => Set<ReviewEntity>();
    public DbSet<PendingGroupMemberEntity> PendingGroupMembers => Set<PendingGroupMemberEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<UserEntity>(e =>
        {
            e.HasKey(u => u.Id);
            e.HasIndex(u => u.Username).IsUnique();
        });

        modelBuilder.Entity<RefreshTokenEntity>(e =>
        {
            e.HasKey(t => t.Value);
            e.HasIndex(t => t.UserId);
        });

        modelBuilder.Entity<MediaEntity>(e => { e.HasKey(m => m.TmdbId); });

        modelBuilder.Entity<RankGroupEntity>(e => { e.HasKey(g => g.Id); });

        modelBuilder.Entity<RankGroupMemberEntity>(e => { e.HasKey(m => new { m.GroupId, m.UserId }); });

        modelBuilder.Entity<RankGroupMediaEntity>(e => { e.HasKey(m => new { m.MediaId, m.GroupId }); });

        modelBuilder.Entity<RankGroupWatchStatusEntity>(e =>
        {
            e.HasKey(w => w.Id);
            e.HasIndex(w => new { w.MediaId, w.GroupId, w.UserId }).IsUnique()
                .HasFilter("user_id is not null");
            e.HasIndex(w => new { w.MediaId, w.GroupId, w.PendingDiscordId }).IsUnique()
                .HasFilter("pending_discord_id is not null");
        });

        modelBuilder.Entity<ReviewEntity>(e =>
        {
            e.HasKey(r => r.Id);
            e.HasIndex(r => new { r.MediaId, r.GroupId, r.UserId }).IsUnique()
                .HasFilter("user_id is not null");
            e.HasIndex(r => new { r.MediaId, r.GroupId, r.PendingDiscordId }).IsUnique()
                .HasFilter("pending_discord_id is not null");
        });

        modelBuilder.Entity<PendingGroupMemberEntity>(e => { e.HasKey(p => new { p.GroupId, p.DiscordId }); });
    }
}
