using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Rankflix.Migrations
{
    /// <inheritdoc />
    public partial class AddMediaRuntimeMinutes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "runtime_minutes",
                table: "media",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "runtime_minutes",
                table: "media");
        }
    }
}
