using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRoleHolders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ByRule",
                schema: "identity",
                table: "UserAccessProfiles",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsChosen",
                schema: "identity",
                table: "UserAccessProfiles",
                type: "boolean",
                nullable: false,
                // Every row before roles had holders was someone chosen for the role. The seeded Employees and
                // Managers are moved to their holders by the start-up seeding, which marks their rows held by rule.
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "HolderKind",
                schema: "identity",
                table: "AccessProfiles",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "chosen");

            migrationBuilder.CreateTable(
                name: "AccessProfileRuleConditions",
                schema: "identity",
                columns: table => new
                {
                    AccessProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TargetId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccessProfileRuleConditions", x => new { x.AccessProfileId, x.Kind, x.TargetId });
                    table.ForeignKey(
                        name: "FK_AccessProfileRuleConditions_AccessProfiles_AccessProfileId_~",
                        columns: x => new { x.AccessProfileId, x.TenantId },
                        principalSchema: "identity",
                        principalTable: "AccessProfiles",
                        principalColumns: new[] { "Id", "TenantId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AccessProfileRuleConditions_AccessProfileId_TenantId",
                schema: "identity",
                table: "AccessProfileRuleConditions",
                columns: new[] { "AccessProfileId", "TenantId" });

            migrationBuilder.CreateIndex(
                name: "IX_AccessProfileRuleConditions_TenantId",
                schema: "identity",
                table: "AccessProfileRuleConditions",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AccessProfileRuleConditions",
                schema: "identity");

            migrationBuilder.DropColumn(
                name: "ByRule",
                schema: "identity",
                table: "UserAccessProfiles");

            migrationBuilder.DropColumn(
                name: "IsChosen",
                schema: "identity",
                table: "UserAccessProfiles");

            migrationBuilder.DropColumn(
                name: "HolderKind",
                schema: "identity",
                table: "AccessProfiles");
        }
    }
}
