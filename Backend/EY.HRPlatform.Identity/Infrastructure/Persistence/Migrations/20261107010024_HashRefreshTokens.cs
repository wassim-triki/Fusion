using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class HashRefreshTokens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Only a hash of each refresh token is kept from now on (B-294). Stored raw tokens can't be carried
            // across, so every existing session ends and everyone signs in again.
            migrationBuilder.Sql("DELETE FROM identity.\"RefreshTokens\";");

            migrationBuilder.DropIndex(
                name: "IX_RefreshTokens_Token",
                schema: "identity",
                table: "RefreshTokens");

            migrationBuilder.DropColumn(
                name: "Token",
                schema: "identity",
                table: "RefreshTokens");

            migrationBuilder.AddColumn<string>(
                name: "TokenHash",
                schema: "identity",
                table: "RefreshTokens",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_TokenHash",
                schema: "identity",
                table: "RefreshTokens",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM identity.\"RefreshTokens\";");

            migrationBuilder.DropIndex(
                name: "IX_RefreshTokens_TokenHash",
                schema: "identity",
                table: "RefreshTokens");

            migrationBuilder.DropColumn(
                name: "TokenHash",
                schema: "identity",
                table: "RefreshTokens");

            migrationBuilder.AddColumn<string>(
                name: "Token",
                schema: "identity",
                table: "RefreshTokens",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_Token",
                schema: "identity",
                table: "RefreshTokens",
                column: "Token",
                unique: true);
        }
    }
}
