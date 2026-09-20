using Microsoft.AspNetCore.Authentication;
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

builder.Services.Configure<SupabaseOptions>(builder.Configuration.GetSection("Supabase"));

builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IClaimsTransformation, SupabaseClaimsTransformation>();
builder.Services.AddHttpClient<ISupabaseAdminService, SupabaseAdminService>();
builder.Services.AddScoped<IGroupService, GroupService>();
builder.Services.AddScoped<IMediaService, MediaService>();
builder.Services.AddScoped<IReviewService, ReviewService>();
builder.Services.AddScoped<IExcelService, ExcelService>();
builder.Services.AddScoped<IUserStatsService, UserStatsService>();
builder.Services.AddScoped<IGroupStatsService, GroupStatsService>();
builder.Services.AddScoped<ISuggestionService, SuggestionService>();
builder.Services.AddSingleton<ISseService, SseService>();

var tmdbApiKey = builder.Configuration["Tmdb:ApiKey"];
builder.Services.AddSingleton(new TMDbClient(string.IsNullOrWhiteSpace(tmdbApiKey) ? "missing-api-key" : tmdbApiKey));
builder.Services.AddScoped<IMediaSearchService, MediaSearchService>();
builder.Services.AddScoped<IMediaMetadataService, MediaMetadataService>();

var supabaseUrl = builder.Configuration["Supabase:Url"]
                  ?? throw new InvalidOperationException(
                      "Missing Supabase:Url configuration (or the Supabase__Url environment variable).");
var supabaseIssuer = $"{supabaseUrl.TrimEnd('/')}/auth/v1";

builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        // Authority + MetadataAddress let the handler fetch Supabase's JWKS
        // (asymmetric ES256 signing keys) automatically and refresh them on rotation -
        // no shared secret is ever stored on this API.
        options.Authority = supabaseIssuer;
        options.MetadataAddress = $"{supabaseIssuer}/.well-known/openid-configuration";
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = supabaseIssuer,
            ValidateAudience = true,
            ValidAudience = "authenticated",
            ValidateLifetime = true
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

// Registered before UseCors so that if anything downstream throws unhandled, this catches it
// and writes a normal JSON response - crucially, ASP.NET Core's CORS middleware only adds
// Access-Control-Allow-Origin via a response.OnStarting callback, and an unhandled exception
// that reaches the host without ever going through a "normal" response write means that
// callback never fires. The browser then reports a generic "blocked by CORS policy" /
// "Failed to fetch" error that completely hides the real 500 and its cause. Catching here
// (and logging it) guarantees every response - success or failure - gets proper CORS headers
// and a real error body to look at.
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex)
    {
        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("UnhandledException");
        logger.LogError(ex, "Unhandled exception for {Method} {Path}", context.Request.Method, context.Request.Path);

        if (!context.Response.HasStarted)
        {
            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                type = "https://tools.ietf.org/html/rfc9110#section-15.6.1",
                title = "An unexpected error occurred.",
                status = 500,
                traceId = context.TraceIdentifier
            });
        }
    }
});

app.UseCors(corsPolicy);

app.UseAuthentication();
app.UseAuthorization();

// Also touches the database (not just returns 200) so the cron ping that keeps Render's
// free-tier instance awake also counts as activity for Supabase, which auto-pauses free
// Postgres projects after 7 days of no database activity.
app.MapGet("/health", async (RankflixDbContext db) =>
{
    await db.Database.ExecuteSqlRawAsync("SELECT 1");
    return Results.Ok(new { status = "ok" });
});

app.MapControllers();

app.Run();
