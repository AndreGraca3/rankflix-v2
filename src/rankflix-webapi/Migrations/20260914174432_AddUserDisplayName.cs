using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Rankflix.Migrations
{
    /// <inheritdoc />
    public partial class AddUserDisplayName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "display_name",
                table: "user",
                type: "character varying(60)",
                maxLength: 60,
                nullable: false,
                defaultValue: "");

            // Existing accounts had no display name yet - default it to their username so nothing
            // shows up blank until they choose to change it.
            migrationBuilder.Sql("UPDATE \"user\" SET display_name = username;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "display_name",
                table: "user");
        }
    }
}
