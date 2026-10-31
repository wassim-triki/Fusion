using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddInvitationPlans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InvitationAutoSends",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Reference = table.Column<Guid>(type: "uuid", nullable: false),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvitationAutoSends", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InvitationAutoSends_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalSchema: "corehr",
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "InvitationSchedules",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Audience = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EmployeeIdsJson = table.Column<string>(type: "jsonb", nullable: false),
                    SendAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CanceledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Invited = table.Column<int>(type: "integer", nullable: true),
                    NotSent = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvitationSchedules", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InvitationAutoSends_EmployeeId",
                schema: "corehr",
                table: "InvitationAutoSends",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_InvitationAutoSends_TenantId_Kind_Reference",
                schema: "corehr",
                table: "InvitationAutoSends",
                columns: new[] { "TenantId", "Kind", "Reference" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvitationSchedules_TenantId_SendAt",
                schema: "corehr",
                table: "InvitationSchedules",
                columns: new[] { "TenantId", "SendAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InvitationAutoSends",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "InvitationSchedules",
                schema: "corehr");
        }
    }
}
