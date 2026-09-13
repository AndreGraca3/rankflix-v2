using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Rankflix.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:pgcrypto", ",,");

            migrationBuilder.CreateTable(
                name: "media",
                columns: table => new
                {
                    tmdb_id = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    type = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    poster_url = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_media", x => x.tmdb_id);
                    table.CheckConstraint("ck_media_type", "type in ('movie', 'tv')");
                });

            migrationBuilder.CreateTable(
                name: "user",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    username = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    avatar_url = table.Column<string>(type: "text", nullable: true),
                    password_hash = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    discord_id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "member"),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "online"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user", x => x.id);
                    table.CheckConstraint("ck_user_role", "role in ('admin', 'member')");
                    table.CheckConstraint("ck_user_status", "status in ('online', 'invisible')");
                });

            migrationBuilder.CreateTable(
                name: "rank_group",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    owner_id = table.Column<int>(type: "integer", nullable: false),
                    image_url = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rank_group", x => x.id);
                    table.ForeignKey(
                        name: "FK_rank_group_user_owner_id",
                        column: x => x.owner_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "refresh_token",
                columns: table => new
                {
                    value = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    user_id = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_refresh_token", x => x.value);
                    table.ForeignKey(
                        name: "FK_refresh_token_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "rank_group_media",
                columns: table => new
                {
                    media_id = table.Column<int>(type: "integer", nullable: false),
                    group_id = table.Column<int>(type: "integer", nullable: false),
                    added_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    added_by = table.Column<int>(type: "integer", nullable: false),
                    voting_duration_hours = table.Column<int>(type: "integer", nullable: false, defaultValue: 24),
                    imported_average_rating = table.Column<double>(type: "double precision", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rank_group_media", x => new { x.media_id, x.group_id });
                    table.ForeignKey(
                        name: "FK_rank_group_media_media_media_id",
                        column: x => x.media_id,
                        principalTable: "media",
                        principalColumn: "tmdb_id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_rank_group_media_rank_group_group_id",
                        column: x => x.group_id,
                        principalTable: "rank_group",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_rank_group_media_user_added_by",
                        column: x => x.added_by,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "rank_group_member",
                columns: table => new
                {
                    group_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    is_owner = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rank_group_member", x => new { x.group_id, x.user_id });
                    table.ForeignKey(
                        name: "FK_rank_group_member_rank_group_group_id",
                        column: x => x.group_id,
                        principalTable: "rank_group",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_rank_group_member_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "rank_group_pending_member",
                columns: table => new
                {
                    group_id = table.Column<int>(type: "integer", nullable: false),
                    discord_id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    display_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rank_group_pending_member", x => new { x.group_id, x.discord_id });
                    table.ForeignKey(
                        name: "FK_rank_group_pending_member_rank_group_group_id",
                        column: x => x.group_id,
                        principalTable: "rank_group",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "rank_group_watch_status",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    media_id = table.Column<int>(type: "integer", nullable: false),
                    group_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: true),
                    pending_discord_id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    watched_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rank_group_watch_status", x => x.id);
                    table.ForeignKey(
                        name: "FK_rank_group_watch_status_rank_group_media_media_id_group_id",
                        columns: x => new { x.media_id, x.group_id },
                        principalTable: "rank_group_media",
                        principalColumns: new[] { "media_id", "group_id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_rank_group_watch_status_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "review",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    rating = table.Column<double>(type: "double precision", nullable: false),
                    comment = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    media_id = table.Column<int>(type: "integer", nullable: false),
                    group_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: true),
                    pending_discord_id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_review", x => x.id);
                    table.ForeignKey(
                        name: "FK_review_rank_group_media_media_id_group_id",
                        columns: x => new { x.media_id, x.group_id },
                        principalTable: "rank_group_media",
                        principalColumns: new[] { "media_id", "group_id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_review_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_owner_id",
                table: "rank_group",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_media_added_by",
                table: "rank_group_media",
                column: "added_by");

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_media_group_id",
                table: "rank_group_media",
                column: "group_id");

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_member_user_id",
                table: "rank_group_member",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_watch_status_media_id_group_id_pending_discord_id",
                table: "rank_group_watch_status",
                columns: new[] { "media_id", "group_id", "pending_discord_id" },
                unique: true,
                filter: "pending_discord_id is not null");

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_watch_status_media_id_group_id_user_id",
                table: "rank_group_watch_status",
                columns: new[] { "media_id", "group_id", "user_id" },
                unique: true,
                filter: "user_id is not null");

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_watch_status_user_id",
                table: "rank_group_watch_status",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_refresh_token_user_id",
                table: "refresh_token",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_review_media_id_group_id",
                table: "review",
                columns: new[] { "media_id", "group_id" });

            migrationBuilder.CreateIndex(
                name: "IX_review_media_id_group_id_pending_discord_id",
                table: "review",
                columns: new[] { "media_id", "group_id", "pending_discord_id" },
                unique: true,
                filter: "pending_discord_id is not null");

            migrationBuilder.CreateIndex(
                name: "IX_review_media_id_group_id_user_id",
                table: "review",
                columns: new[] { "media_id", "group_id", "user_id" },
                unique: true,
                filter: "user_id is not null");

            migrationBuilder.CreateIndex(
                name: "IX_review_user_id",
                table: "review",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_user_username",
                table: "user",
                column: "username",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "rank_group_member");

            migrationBuilder.DropTable(
                name: "rank_group_pending_member");

            migrationBuilder.DropTable(
                name: "rank_group_watch_status");

            migrationBuilder.DropTable(
                name: "refresh_token");

            migrationBuilder.DropTable(
                name: "review");

            migrationBuilder.DropTable(
                name: "rank_group_media");

            migrationBuilder.DropTable(
                name: "media");

            migrationBuilder.DropTable(
                name: "rank_group");

            migrationBuilder.DropTable(
                name: "user");
        }
    }
}
