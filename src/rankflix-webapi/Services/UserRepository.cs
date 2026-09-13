using Microsoft.EntityFrameworkCore;
using Rankflix.Data;
using Rankflix.Data.Entities;

namespace Rankflix.Services;

public interface IUserRepository
{
    Task<UserEntity?> GetByIdAsync(int id);
    Task<UserEntity?> GetByUsernameAsync(string username);
    Task<List<UserEntity>> GetAllAsync();
    Task<bool> AnyAsync();
    Task<UserEntity> AddAsync(UserEntity user);
    Task SaveChangesAsync();
}

public class UserRepository(RankflixDbContext db) : IUserRepository
{
    public Task<UserEntity?> GetByIdAsync(int id) =>
        db.Users.FirstOrDefaultAsync(u => u.Id == id);

    public Task<UserEntity?> GetByUsernameAsync(string username) =>
        db.Users.FirstOrDefaultAsync(u => u.Username == username);

    public Task<List<UserEntity>> GetAllAsync() =>
        db.Users.OrderBy(u => u.Id).ToListAsync();

    public Task<bool> AnyAsync() => db.Users.AnyAsync();

    public async Task<UserEntity> AddAsync(UserEntity user)
    {
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    public Task SaveChangesAsync() => db.SaveChangesAsync();
}
