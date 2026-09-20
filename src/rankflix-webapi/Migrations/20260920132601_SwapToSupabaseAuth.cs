using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Rankflix.Migrations
{
    /// <inheritdoc />
    public partial class SwapToSupabaseAuth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "refresh_token");

            migrationBuilder.DropColumn(
                name: "password_hash",
                table: "user");

            migrationBuilder.AddColumn<Guid>(
                name: "supabase_user_id",
                table: "user",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_supabase_user_id",
                table: "user",
                column: "supabase_user_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_user_supabase_user_id",
                table: "user");

            migrationBuilder.DropColumn(
                name: "supabase_user_id",
                table: "user");

            migrationBuilder.AddColumn<string>(
                name: "password_hash",
                table: "user",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "refresh_token",
                columns: table => new
                {
                    value = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    replaced_by_value = table.Column<Guid>(type: "uuid", nullable: true),
                    used_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
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

            migrationBuilder.CreateIndex(
                name: "IX_refresh_token_user_id",
                table: "refresh_token",
                column: "user_id");
        }
    }
}
