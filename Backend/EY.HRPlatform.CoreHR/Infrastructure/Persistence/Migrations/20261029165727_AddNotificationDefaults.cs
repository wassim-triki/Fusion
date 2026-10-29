using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationDefaults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<List<string>>(
                name: "EmailOn",
                schema: "corehr",
                table: "CoreNotificationPreferences",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.CreateTable(
                name: "CoreNotificationDefaults",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Required = table.Column<List<string>>(type: "text[]", nullable: false),
                    Off = table.Column<List<string>>(type: "text[]", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CoreNotificationDefaults", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CoreNotificationDefaults_TenantId",
                schema: "corehr",
                table: "CoreNotificationDefaults",
                column: "TenantId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CoreNotificationDefaults",
                schema: "corehr");

            migrationBuilder.DropColumn(
                name: "EmailOn",
                schema: "corehr",
                table: "CoreNotificationPreferences");
        }
    }
}
