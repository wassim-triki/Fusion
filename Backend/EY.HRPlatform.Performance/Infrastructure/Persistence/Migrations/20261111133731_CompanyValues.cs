using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CompanyValues : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "CompetencyId",
                schema: "performance",
                table: "Praise",
                newName: "ValueId");

            migrationBuilder.CreateTable(
                name: "CompanyValues",
                schema: "performance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    NameKey = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    RemovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompanyValues", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CompanyValues_TenantId_NameKey",
                schema: "performance",
                table: "CompanyValues",
                columns: new[] { "TenantId", "NameKey" },
                unique: true,
                filter: "\"RemovedAt\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CompanyValues",
                schema: "performance");

            migrationBuilder.RenameColumn(
                name: "ValueId",
                schema: "performance",
                table: "Praise",
                newName: "CompetencyId");
        }
    }
}
