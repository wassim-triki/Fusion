using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OneOnOneMeetingPage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SharedNotes",
                schema: "performance",
                table: "OneOnOneMeetings");

            migrationBuilder.DropColumn(
                name: "SharedNotesRevision",
                schema: "performance",
                table: "OneOnOneMeetings");

            migrationBuilder.AddColumn<Guid>(
                name: "CarriedFromItemId",
                schema: "performance",
                table: "OneOnOneAgendaItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "FirstAddedAt",
                schema: "performance",
                table: "OneOnOneAgendaItems",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.Sql("""UPDATE performance."OneOnOneAgendaItems" SET "FirstAddedAt" = "CreatedAt";""");

            migrationBuilder.AddColumn<string>(
                name: "Note",
                schema: "performance",
                table: "OneOnOneAgendaItems",
                type: "character varying(10000)",
                maxLength: 10000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<long>(
                name: "NoteRevision",
                schema: "performance",
                table: "OneOnOneAgendaItems",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "CalendarFeeds",
                schema: "performance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CalendarFeeds", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CalendarFeeds_TenantId_EmployeeId",
                schema: "performance",
                table: "CalendarFeeds",
                columns: new[] { "TenantId", "EmployeeId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CalendarFeeds_TokenHash",
                schema: "performance",
                table: "CalendarFeeds",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CalendarFeeds",
                schema: "performance");

            migrationBuilder.DropColumn(
                name: "CarriedFromItemId",
                schema: "performance",
                table: "OneOnOneAgendaItems");

            migrationBuilder.DropColumn(
                name: "FirstAddedAt",
                schema: "performance",
                table: "OneOnOneAgendaItems");

            migrationBuilder.DropColumn(
                name: "Note",
                schema: "performance",
                table: "OneOnOneAgendaItems");

            migrationBuilder.DropColumn(
                name: "NoteRevision",
                schema: "performance",
                table: "OneOnOneAgendaItems");

            migrationBuilder.AddColumn<string>(
                name: "SharedNotes",
                schema: "performance",
                table: "OneOnOneMeetings",
                type: "character varying(10000)",
                maxLength: 10000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<long>(
                name: "SharedNotesRevision",
                schema: "performance",
                table: "OneOnOneMeetings",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);
        }
    }
}
