using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Rankflix.Auth;
using Rankflix.Data;
using Rankflix.Services;
using TMDbLib.Client;

var builder = WebApplication.CreateBuilder(args);

const string corsPolicy = "Frontend";

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<RankflixDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("RankflixDatabase")));

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.Configure<RefreshTokenOptions>(builder.Configuration.GetSection("RefreshToken"));

builder.Services.AddScoped<IJwtProvider, JwtProvider>();
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<ITokenRepository, TokenRepository>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IGroupService, GroupService>();
builder.Services.AddScoped<IMediaService, MediaService>();
builder.Services.AddScoped<IReviewService, ReviewService>();
builder.Services.AddScoped<IExcelService, ExcelService>();
builder.Services.AddScoped<IUserStatsService, UserStatsService>();
builder.Services.AddScoped<IGroupStatsService, GroupStatsService>();
builder.Services.AddSingleton<ISseService, SseService>();

var tmdbApiKey = builder.Configuration["Tmdb:ApiKey"];
builder.Services.AddSingleton(new TMDbClient(string.IsNullOrWhiteSpace(tmdbApiKey) ? "missing-api-key" : tmdbApiKey));
builder.Services.AddScoped<IMediaSearchService, MediaSearchService>();
builder.Services.AddScoped<IMediaMetadataService, MediaMetadataService>();

var jwtOptions = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()
                  ?? throw new InvalidOperationException("Missing Jwt configuration section");

// Refuse to start with the checked-in placeholder secret or anything too short to be a real
// signing key - running with it would let anyone forge valid access tokens for any user.
if (string.IsNullOrWhiteSpace(jwtOptions.SecretKey) ||
    jwtOptions.SecretKey == "CHANGE_ME_TO_A_LONG_RANDOM_SECRET" ||
    jwtOptions.SecretKey.Length < 32)
{
    throw new InvalidOperationException(
        "Jwt:SecretKey must be set to a real, random secret (at least 32 characters) via configuration " +
        "or the Jwt__SecretKey environment variable - refusing to start with the placeholder/default value.");
}

builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidAudience = jwtOptions.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SecretKey))
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(options =>
{
    options.AddPolicy(corsPolicy, policy =>
    {
        var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
                              ?? ["http://localhost:5173"];

        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var app = builder.Build();

// Apply any pending EF Core migrations on startup so the schema is always up to date -
// this lets a brand-new (e.g. Supabase) database provision itself on first deploy.
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<RankflixDbContext>();
    dbContext.Database.Migrate();
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseCors(corsPolicy);

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapControllers();

app.Run();
