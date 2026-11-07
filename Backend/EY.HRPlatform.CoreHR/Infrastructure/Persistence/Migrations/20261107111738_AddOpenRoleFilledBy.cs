using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOpenRoleFilledBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "FilledByEmployeeId",
                schema: "corehr",
                table: "OpenRoles",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "FilledOn",
                schema: "corehr",
                table: "OpenRoles",
                type: "date",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_OpenRoles_FilledByEmployeeId",
                schema: "corehr",
                table: "OpenRoles",
                column: "FilledByEmployeeId");

            migrationBuilder.AddForeignKey(
                name: "FK_OpenRoles_Employees_FilledByEmployeeId",
                schema: "corehr",
                table: "OpenRoles",
                column: "FilledByEmployeeId",
                principalSchema: "corehr",
                principalTable: "Employees",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_OpenRoles_Employees_FilledByEmployeeId",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropIndex(
                name: "IX_OpenRoles_FilledByEmployeeId",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropColumn(
                name: "FilledByEmployeeId",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropColumn(
                name: "FilledOn",
                schema: "corehr",
                table: "OpenRoles");
        }
    }
}
