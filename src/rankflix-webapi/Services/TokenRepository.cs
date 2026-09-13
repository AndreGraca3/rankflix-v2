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
    Task MarkUsedAsync(RefreshTokenEntity token, Guid replacedByValue);
    Task RemoveByUserIdAsync(int userId);
    Task RemoveByValueAsync(Guid value);
    bool IsExpired(RefreshTokenEntity token);
}

public class TokenRepository(RankflixDbContext db, IOptions<RefreshTokenOptions> refreshTokenOptions)
    : ITokenRepository
{
    private readonly RefreshTokenOptions _options = refreshTokenOptions.Value;

    public Task<RefreshTokenEntity?> GetByValueAsync(Guid value) =>
        db.RefreshTokens.FirstOrDefaultAsync(t => t.Value == value);

    public async Task<RefreshTokenEntity> AddAsync(int userId)
    {
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

    public async Task MarkUsedAsync(RefreshTokenEntity token, Guid replacedByValue)
    {
        token.UsedAt = DateTime.UtcNow;
        token.ReplacedByValue = replacedByValue;
        await db.SaveChangesAsync();
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

    public bool IsExpired(RefreshTokenEntity token) =>
        token.CreatedAt.AddMinutes(_options.ExpireMinutes) < DateTime.UtcNow;
}
