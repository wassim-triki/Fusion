using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddViewAsSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ViewAsSessions",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ViewerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ViewerMembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetMembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ViewAsSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ViewAsSessions_TenantMemberships_TargetMembershipId_TargetU~",
                        columns: x => new { x.TargetMembershipId, x.TargetUserId, x.TenantId },
                        principalSchema: "identity",
                        principalTable: "TenantMemberships",
                        principalColumns: new[] { "Id", "UserId", "TenantId" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ViewAsSessions_TenantMemberships_ViewerMembershipId_ViewerU~",
                        columns: x => new { x.ViewerMembershipId, x.ViewerUserId, x.TenantId },
                        principalSchema: "identity",
                        principalTable: "TenantMemberships",
                        principalColumns: new[] { "Id", "UserId", "TenantId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ViewAsSessions_TargetMembershipId_TargetUserId_TenantId",
                schema: "identity",
                table: "ViewAsSessions",
                columns: new[] { "TargetMembershipId", "TargetUserId", "TenantId" });

            migrationBuilder.CreateIndex(
                name: "IX_ViewAsSessions_TenantId_ViewerUserId",
                schema: "identity",
                table: "ViewAsSessions",
                columns: new[] { "TenantId", "ViewerUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_ViewAsSessions_ViewerMembershipId_ViewerUserId_TenantId",
                schema: "identity",
                table: "ViewAsSessions",
                columns: new[] { "ViewerMembershipId", "ViewerUserId", "TenantId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ViewAsSessions",
                schema: "identity");
        }
    }
}
