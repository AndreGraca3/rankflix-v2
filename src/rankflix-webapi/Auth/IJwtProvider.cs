using Rankflix.Data.Entities;

namespace Rankflix.Auth;

public interface IJwtProvider
{
    (string Token, DateTime ExpiresAt) Generate(UserEntity user);
}
