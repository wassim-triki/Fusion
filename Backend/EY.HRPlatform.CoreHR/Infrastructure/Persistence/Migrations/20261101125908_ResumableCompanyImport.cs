using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ResumableCompanyImport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Problem",
                schema: "corehr",
                table: "CompanyImportSources",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PlanJson",
                schema: "corehr",
                table: "CompanyImportSessions",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RunJson",
                schema: "corehr",
                table: "CompanyImportSessions",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Problem",
                schema: "corehr",
                table: "CompanyImportSources");

            migrationBuilder.DropColumn(
                name: "PlanJson",
                schema: "corehr",
                table: "CompanyImportSessions");

            migrationBuilder.DropColumn(
                name: "RunJson",
                schema: "corehr",
                table: "CompanyImportSessions");
        }
    }
}
