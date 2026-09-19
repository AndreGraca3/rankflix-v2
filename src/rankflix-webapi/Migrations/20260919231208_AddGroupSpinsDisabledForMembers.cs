using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Rankflix.Migrations
{
    /// <inheritdoc />
    public partial class AddGroupSpinsDisabledForMembers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "spins_disabled_for_members",
                table: "rank_group",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "spins_disabled_for_members",
                table: "rank_group");
        }
    }
}
