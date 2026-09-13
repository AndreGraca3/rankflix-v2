using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Rankflix.Migrations
{
    /// <inheritdoc />
    public partial class RevertRefreshTokenRotationTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "replaced_by_value",
                table: "refresh_token");

            migrationBuilder.DropColumn(
                name: "used_at",
                table: "refresh_token");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "replaced_by_value",
                table: "refresh_token",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "used_at",
                table: "refresh_token",
                type: "timestamp with time zone",
                nullable: true);
        }
    }
}
