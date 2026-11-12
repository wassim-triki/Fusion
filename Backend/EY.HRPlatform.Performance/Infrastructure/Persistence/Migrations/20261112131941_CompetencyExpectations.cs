using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CompetencyExpectations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CompetencyExpectations",
                schema: "performance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompetencyId = table.Column<Guid>(type: "uuid", nullable: false),
                    FamilyId = table.Column<Guid>(type: "uuid", nullable: false),
                    LevelId = table.Column<Guid>(type: "uuid", nullable: false),
                    Text = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompetencyExpectations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CompetencyExpectations_Competencies_CompetencyId",
                        column: x => x.CompetencyId,
                        principalSchema: "performance",
                        principalTable: "Competencies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CompetencyExpectations_CompetencyId",
                schema: "performance",
                table: "CompetencyExpectations",
                column: "CompetencyId");

            migrationBuilder.CreateIndex(
                name: "IX_CompetencyExpectations_TenantId_CompetencyId_FamilyId_Level~",
                schema: "performance",
                table: "CompetencyExpectations",
                columns: new[] { "TenantId", "CompetencyId", "FamilyId", "LevelId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CompetencyExpectations_TenantId_FamilyId",
                schema: "performance",
                table: "CompetencyExpectations",
                columns: new[] { "TenantId", "FamilyId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CompetencyExpectations",
                schema: "performance");
        }
    }
}
