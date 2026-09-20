using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Rankflix.Auth;
using Rankflix.Data;
using Rankflix.Data.Entities;

namespace Rankflix.Services;

public interface ITokenRepository
{
    Task<RefreshTokenEntity?> GetByValueAsync(Guid value);
    Task<RefreshTokenEntity> AddAsync(int userId);
    Task RemoveByUserIdAsync(int userId);
    Task RemoveByValueAsync(Guid value);
    Task MarkUsedAsync(Guid value, Guid replacedByValue);
    Task<RefreshTokenEntity?> GetLatestInChainAsync(RefreshTokenEntity token);
    bool IsExpired(RefreshTokenEntity token);
}

public class TokenRepository(RankflixDbContext db, IOptions<RefreshTokenOptions> refreshTokenOptions)
    : ITokenRepository
{
    private readonly RefreshTokenOptions _options = refreshTokenOptions.Value;

    // Used tokens are kept (not deleted) so the rotation chain can be followed within the
    // reuse grace window (see AuthService) - but old ones no longer serve any purpose once
    // that window has long passed, so prune them opportunistically to keep the table bounded.
    private static readonly TimeSpan UsedTokenRetention = TimeSpan.FromHours(1);

    public Task<RefreshTokenEntity?> GetByValueAsync(Guid value) =>
        db.RefreshTokens.FirstOrDefaultAsync(t => t.Value == value);

    public async Task<RefreshTokenEntity> AddAsync(int userId)
    {
        var staleUsedTokens = db.RefreshTokens.Where(t =>
            t.UserId == userId && t.UsedAt != null && t.UsedAt < DateTime.UtcNow - UsedTokenRetention);
        db.RefreshTokens.RemoveRange(staleUsedTokens);

        var token = new RefreshTokenEntity
        {
            Value = Guid.NewGuid(),
            UserId = userId,
            CreatedAt = DateTime.UtcNow
        };

        db.RefreshTokens.Add(token);
        await db.SaveChangesAsync();
        return token;
    }

    public async Task RemoveByUserIdAsync(int userId)
    {
        var tokens = db.RefreshTokens.Where(t => t.UserId == userId);
        db.RefreshTokens.RemoveRange(tokens);
        await db.SaveChangesAsync();
    }

    public async Task RemoveByValueAsync(Guid value)
    {
        var token = await db.RefreshTokens.FirstOrDefaultAsync(t => t.Value == value);
        if (token is null) return;
        db.RefreshTokens.Remove(token);
        await db.SaveChangesAsync();
    }

    public async Task MarkUsedAsync(Guid value, Guid replacedByValue)
    {
        var token = await db.RefreshTokens.FirstOrDefaultAsync(t => t.Value == value);
        if (token is null) return;
        token.UsedAt = DateTime.UtcNow;
        token.ReplacedByValue = replacedByValue;
        await db.SaveChangesAsync();
    }

    public async Task<RefreshTokenEntity?> GetLatestInChainAsync(RefreshTokenEntity token)
    {
        var current = token;
        // Hard cap guards against an unbounded loop if the chain data were ever corrupted.
        for (var i = 0; i < 10 && current.ReplacedByValue is not null; i++)
        {
            var next = await db.RefreshTokens.FirstOrDefaultAsync(t => t.Value == current.ReplacedByValue);
            if (next is null) return null;
            current = next;
        }
        return current;
    }

    public bool IsExpired(RefreshTokenEntity token) =>
        token.CreatedAt.AddMinutes(_options.ExpireMinutes) < DateTime.UtcNow;
}
