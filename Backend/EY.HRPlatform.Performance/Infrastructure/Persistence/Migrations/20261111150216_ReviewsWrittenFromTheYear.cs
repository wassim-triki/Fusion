using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ReviewsWrittenFromTheYear : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The person no longer nominates peers (D-40); stored nominations read as Fusion's picks.
            migrationBuilder.Sql("UPDATE performance.\"PeerNominations\" SET \"Source\" = 'Fusion' WHERE \"Source\" = 'Subject';");
            // Peers are no longer nominated or approved: those notification kinds are gone.
            migrationBuilder.Sql("DELETE FROM performance.\"PerformanceNotifications\" WHERE \"Kind\" IN ('PeersNominated', 'PeerListApproved');");
            migrationBuilder.Sql("DELETE FROM performance.\"PerformanceOutboxMessages\" WHERE \"Kind\" IN ('PeersNominated', 'PeerListApproved');");

            migrationBuilder.DropColumn(
                name: "PeerListApprovedAt",
                schema: "performance",
                table: "PerformanceReviews");

            migrationBuilder.DropColumn(
                name: "PeerListApprovedByEmployeeId",
                schema: "performance",
                table: "PerformanceReviews");

            migrationBuilder.AddColumn<DateOnly>(
                name: "OpensOn",
                schema: "performance",
                table: "ReviewRounds",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CitationsJson",
                schema: "performance",
                table: "ReviewQuestionAnswers",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ManagerGrade",
                schema: "performance",
                table: "ReviewItemResponses",
                type: "numeric(3,2)",
                precision: 3,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ManagerGradeReason",
                schema: "performance",
                table: "ReviewItemResponses",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SelfGrade",
                schema: "performance",
                table: "ReviewItemResponses",
                type: "numeric(3,2)",
                precision: 3,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SelfGradeReason",
                schema: "performance",
                table: "ReviewItemResponses",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OpensOn",
                schema: "performance",
                table: "ReviewRounds");

            migrationBuilder.DropColumn(
                name: "CitationsJson",
                schema: "performance",
                table: "ReviewQuestionAnswers");

            migrationBuilder.DropColumn(
                name: "ManagerGrade",
                schema: "performance",
                table: "ReviewItemResponses");

            migrationBuilder.DropColumn(
                name: "ManagerGradeReason",
                schema: "performance",
                table: "ReviewItemResponses");

            migrationBuilder.DropColumn(
                name: "SelfGrade",
                schema: "performance",
                table: "ReviewItemResponses");

            migrationBuilder.DropColumn(
                name: "SelfGradeReason",
                schema: "performance",
                table: "ReviewItemResponses");

            migrationBuilder.AddColumn<DateTime>(
                name: "PeerListApprovedAt",
                schema: "performance",
                table: "PerformanceReviews",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PeerListApprovedByEmployeeId",
                schema: "performance",
                table: "PerformanceReviews",
                type: "uuid",
                nullable: true);
        }
    }
}
