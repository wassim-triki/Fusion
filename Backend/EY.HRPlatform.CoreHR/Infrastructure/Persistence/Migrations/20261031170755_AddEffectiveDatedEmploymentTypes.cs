using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEffectiveDatedEmploymentTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmploymentTypePeriods",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmploymentId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmploymentTypeId = table.Column<Guid>(type: "uuid", nullable: true),
                    EmploymentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    EffectiveFrom = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EffectiveTo = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmploymentTypePeriods", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmploymentTypePeriods_CompanyListValues_EmploymentTypeId",
                        column: x => x.EmploymentTypeId,
                        principalSchema: "corehr",
                        principalTable: "CompanyListValues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EmploymentTypePeriods_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalSchema: "corehr",
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EmploymentTypePeriods_Employments_EmploymentId",
                        column: x => x.EmploymentId,
                        principalSchema: "corehr",
                        principalTable: "Employments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentTypePeriods_EmployeeId",
                schema: "corehr",
                table: "EmploymentTypePeriods",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentTypePeriods_EmploymentId",
                schema: "corehr",
                table: "EmploymentTypePeriods",
                column: "EmploymentId");

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentTypePeriods_EmploymentTypeId",
                schema: "corehr",
                table: "EmploymentTypePeriods",
                column: "EmploymentTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentTypePeriods_TenantId_EmployeeId",
                schema: "corehr",
                table: "EmploymentTypePeriods",
                columns: new[] { "TenantId", "EmployeeId" },
                unique: true,
                filter: "\"EffectiveTo\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentTypePeriods_TenantId_EmployeeId_EffectiveFrom",
                schema: "corehr",
                table: "EmploymentTypePeriods",
                columns: new[] { "TenantId", "EmployeeId", "EffectiveFrom" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Without periods the employment row is the only type: keep today's, so a rollback doesn't revert it.
            migrationBuilder.Sql("""
                UPDATE corehr."Employments" e
                SET "EmploymentTypeId" = p."EmploymentTypeId", "EmploymentType" = p."EmploymentType"
                FROM corehr."EmploymentTypePeriods" p
                WHERE p."EmploymentId" = e."Id" AND p."EffectiveFrom" <= now()
                  AND (p."EffectiveTo" IS NULL OR now() < p."EffectiveTo");
                """);

            migrationBuilder.DropTable(
                name: "EmploymentTypePeriods",
                schema: "corehr");
        }
    }
}
