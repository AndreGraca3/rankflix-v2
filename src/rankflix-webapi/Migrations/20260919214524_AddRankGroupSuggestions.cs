using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Rankflix.Migrations
{
    /// <inheritdoc />
    public partial class AddRankGroupSuggestions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "rank_group_suggestions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    group_id = table.Column<int>(type: "integer", nullable: false),
                    tmdb_id = table.Column<int>(type: "integer", nullable: false),
                    added_by = table.Column<int>(type: "integer", nullable: false),
                    added_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rank_group_suggestions", x => x.id);
                    table.ForeignKey(
                        name: "FK_rank_group_suggestions_media_tmdb_id",
                        column: x => x.tmdb_id,
                        principalTable: "media",
                        principalColumn: "tmdb_id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_rank_group_suggestions_rank_group_group_id",
                        column: x => x.group_id,
                        principalTable: "rank_group",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_rank_group_suggestions_user_added_by",
                        column: x => x.added_by,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_suggestions_added_by",
                table: "rank_group_suggestions",
                column: "added_by");

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_suggestions_group_id_tmdb_id",
                table: "rank_group_suggestions",
                columns: new[] { "group_id", "tmdb_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_rank_group_suggestions_tmdb_id",
                table: "rank_group_suggestions",
                column: "tmdb_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "rank_group_suggestions");
        }
    }
}
