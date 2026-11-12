using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class YearSetup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EarlyCloseReason",
                schema: "performance",
                table: "PerformanceCycles");

            migrationBuilder.AddColumn<DateOnly>(
                name: "CalibrationOn",
                schema: "performance",
                table: "PerformanceCycles",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<List<Guid>>(
                name: "DroppedCompanyGoalIds",
                schema: "performance",
                table: "PerformanceCycles",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddColumn<bool>(
                name: "JoinersJoin",
                schema: "performance",
                table: "PerformanceCycles",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "MidYearCheckInOn",
                schema: "performance",
                table: "PerformanceCycles",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ResultsOutOn",
                schema: "performance",
                table: "PerformanceCycles",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ReviewOpensOn",
                schema: "performance",
                table: "PerformanceCycles",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "SelfReviewsDueOn",
                schema: "performance",
                table: "PerformanceCycles",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CarriedFromObjectiveId",
                schema: "performance",
                table: "Objectives",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CalibrationOn",
                schema: "performance",
                table: "PerformanceCycles");

            migrationBuilder.DropColumn(
                name: "DroppedCompanyGoalIds",
                schema: "performance",
                table: "PerformanceCycles");

            migrationBuilder.DropColumn(
                name: "JoinersJoin",
                schema: "performance",
                table: "PerformanceCycles");

            migrationBuilder.DropColumn(
                name: "MidYearCheckInOn",
                schema: "performance",
                table: "PerformanceCycles");

            migrationBuilder.DropColumn(
                name: "ResultsOutOn",
                schema: "performance",
                table: "PerformanceCycles");

            migrationBuilder.DropColumn(
                name: "ReviewOpensOn",
                schema: "performance",
                table: "PerformanceCycles");

            migrationBuilder.DropColumn(
                name: "SelfReviewsDueOn",
                schema: "performance",
                table: "PerformanceCycles");

            migrationBuilder.DropColumn(
                name: "CarriedFromObjectiveId",
                schema: "performance",
                table: "Objectives");

            migrationBuilder.AddColumn<string>(
                name: "EarlyCloseReason",
                schema: "performance",
                table: "PerformanceCycles",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);
        }
    }
}
