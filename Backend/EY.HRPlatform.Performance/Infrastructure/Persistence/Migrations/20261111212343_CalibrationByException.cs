using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CalibrationByException : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CalibrationFacilitators",
                schema: "performance");

            migrationBuilder.DropColumn(
                name: "SummaryCheckedAt",
                schema: "performance",
                table: "PerformanceReviews");

            migrationBuilder.DropColumn(
                name: "SummaryRevisedAt",
                schema: "performance",
                table: "PerformanceReviews");

            migrationBuilder.DropColumn(
                name: "SummaryRevisedByEmployeeId",
                schema: "performance",
                table: "PerformanceReviews");

            migrationBuilder.DropColumn(
                name: "CalibratedPotential",
                schema: "performance",
                table: "CalibrationSubjects");

            migrationBuilder.DropColumn(
                name: "DiscussionState",
                schema: "performance",
                table: "CalibrationSubjects");

            migrationBuilder.DropColumn(
                name: "OriginalPotential",
                schema: "performance",
                table: "CalibrationSubjects");

            migrationBuilder.DropColumn(
                name: "FinalizedAt",
                schema: "performance",
                table: "CalibrationSessions");

            migrationBuilder.DropColumn(
                name: "FinalizedByUserId",
                schema: "performance",
                table: "CalibrationSessions");

            migrationBuilder.DropColumn(
                name: "OpenedByUserId",
                schema: "performance",
                table: "CalibrationSessions");

            migrationBuilder.DropColumn(
                name: "ReadyNotifiedAt",
                schema: "performance",
                table: "CalibrationSessions");

            migrationBuilder.DropColumn(
                name: "State",
                schema: "performance",
                table: "CalibrationSessions");

            migrationBuilder.DropColumn(
                name: "NewPotential",
                schema: "performance",
                table: "CalibrationAdjustments");

            migrationBuilder.DropColumn(
                name: "PreviousPotential",
                schema: "performance",
                table: "CalibrationAdjustments");

            migrationBuilder.AddColumn<DateTime>(
                name: "DecidedAt",
                schema: "performance",
                table: "CalibrationSubjects",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DecidedByUserId",
                schema: "performance",
                table: "CalibrationSubjects",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DecidedAt",
                schema: "performance",
                table: "CalibrationSubjects");

            migrationBuilder.DropColumn(
                name: "DecidedByUserId",
                schema: "performance",
                table: "CalibrationSubjects");

            migrationBuilder.AddColumn<DateTime>(
                name: "SummaryCheckedAt",
                schema: "performance",
                table: "PerformanceReviews",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SummaryRevisedAt",
                schema: "performance",
                table: "PerformanceReviews",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SummaryRevisedByEmployeeId",
                schema: "performance",
                table: "PerformanceReviews",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CalibratedPotential",
                schema: "performance",
                table: "CalibrationSubjects",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DiscussionState",
                schema: "performance",
                table: "CalibrationSubjects",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "OriginalPotential",
                schema: "performance",
                table: "CalibrationSubjects",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "FinalizedAt",
                schema: "performance",
                table: "CalibrationSessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "FinalizedByUserId",
                schema: "performance",
                table: "CalibrationSessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OpenedByUserId",
                schema: "performance",
                table: "CalibrationSessions",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<DateTime>(
                name: "ReadyNotifiedAt",
                schema: "performance",
                table: "CalibrationSessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "State",
                schema: "performance",
                table: "CalibrationSessions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NewPotential",
                schema: "performance",
                table: "CalibrationAdjustments",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PreviousPotential",
                schema: "performance",
                table: "CalibrationAdjustments",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CalibrationFacilitators",
                schema: "performance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    DisplayName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    NamedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NamedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CalibrationFacilitators", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CalibrationFacilitators_CalibrationSessions_SessionId",
                        column: x => x.SessionId,
                        principalSchema: "performance",
                        principalTable: "CalibrationSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CalibrationFacilitators_SessionId_UserId",
                schema: "performance",
                table: "CalibrationFacilitators",
                columns: new[] { "SessionId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CalibrationFacilitators_TenantId",
                schema: "performance",
                table: "CalibrationFacilitators",
                column: "TenantId");
        }
    }
}
