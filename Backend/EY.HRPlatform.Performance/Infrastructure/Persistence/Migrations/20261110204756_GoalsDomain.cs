using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class GoalsDomain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Measurement_Direction",
                schema: "performance",
                table: "Objectives");

            migrationBuilder.AddColumn<string>(
                name: "GoalsSnapshotJson",
                schema: "performance",
                table: "PlanDecisions",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PlanWeightIsSet",
                schema: "performance",
                table: "Objectives",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GoalsSnapshotJson",
                schema: "performance",
                table: "PlanDecisions");

            migrationBuilder.DropColumn(
                name: "PlanWeightIsSet",
                schema: "performance",
                table: "Objectives");

            migrationBuilder.AddColumn<string>(
                name: "Measurement_Direction",
                schema: "performance",
                table: "Objectives",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }
    }
}
