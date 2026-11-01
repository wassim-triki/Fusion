using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddChecklistsAndBirthdaySharing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "SharesBirthday",
                schema: "corehr",
                table: "Employees",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "Checklists",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Day = table.Column<DateOnly>(type: "date", nullable: false),
                    ManagerEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    WorkforceChangeId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Checklists", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Checklists_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalSchema: "corehr",
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ChecklistTemplateTasks",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Owner = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    OffsetDays = table.Column<int>(type: "integer", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChecklistTemplateTasks", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ChecklistTasks",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ChecklistId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Owner = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    DoneAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DoneByName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    DoneByEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChecklistTasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChecklistTasks_Checklists_ChecklistId",
                        column: x => x.ChecklistId,
                        principalSchema: "corehr",
                        principalTable: "Checklists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Checklists_EmployeeId",
                schema: "corehr",
                table: "Checklists",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_Checklists_ManagerEmployeeId",
                schema: "corehr",
                table: "Checklists",
                column: "ManagerEmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_Checklists_TenantId_EmployeeId",
                schema: "corehr",
                table: "Checklists",
                columns: new[] { "TenantId", "EmployeeId" });

            migrationBuilder.CreateIndex(
                name: "IX_Checklists_WorkforceChangeId",
                schema: "corehr",
                table: "Checklists",
                column: "WorkforceChangeId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistTasks_ChecklistId",
                schema: "corehr",
                table: "ChecklistTasks",
                column: "ChecklistId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistTasks_TenantId_DueDate",
                schema: "corehr",
                table: "ChecklistTasks",
                columns: new[] { "TenantId", "DueDate" });

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistTemplateTasks_TenantId_Kind_SortOrder",
                schema: "corehr",
                table: "ChecklistTemplateTasks",
                columns: new[] { "TenantId", "Kind", "SortOrder" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChecklistTasks",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "ChecklistTemplateTasks",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "Checklists",
                schema: "corehr");

            migrationBuilder.DropColumn(
                name: "SharesBirthday",
                schema: "corehr",
                table: "Employees");
        }
    }
}
