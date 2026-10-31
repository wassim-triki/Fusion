using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEmployeeFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmployeeFieldCatalogs",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmployeeFieldCatalogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EmployeeFieldDefinitions",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    CatalogId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Area = table.Column<int>(type: "integer", nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Editor = table.Column<int>(type: "integer", nullable: false),
                    Visible = table.Column<bool>(type: "boolean", nullable: false),
                    VisibleToEmployee = table.Column<bool>(type: "boolean", nullable: false),
                    VisibleToManager = table.Column<bool>(type: "boolean", nullable: false),
                    Required = table.Column<bool>(type: "boolean", nullable: false),
                    IsBuiltIn = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    SourceKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    GalleryKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmployeeFieldDefinitions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmployeeFieldDefinitions_EmployeeFieldCatalogs_CatalogId",
                        column: x => x.CatalogId,
                        principalSchema: "corehr",
                        principalTable: "EmployeeFieldCatalogs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EmployeeFieldValues",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    FieldId = table.Column<Guid>(type: "uuid", nullable: false),
                    ValueJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmployeeFieldValues", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmployeeFieldValues_EmployeeFieldDefinitions_FieldId",
                        column: x => x.FieldId,
                        principalSchema: "corehr",
                        principalTable: "EmployeeFieldDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EmployeeFieldValues_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalSchema: "corehr",
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeFieldCatalogs_TenantId",
                schema: "corehr",
                table: "EmployeeFieldCatalogs",
                column: "TenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeFieldDefinitions_CatalogId",
                schema: "corehr",
                table: "EmployeeFieldDefinitions",
                column: "CatalogId");

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeFieldDefinitions_TenantId_Area_SortOrder",
                schema: "corehr",
                table: "EmployeeFieldDefinitions",
                columns: new[] { "TenantId", "Area", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeFieldDefinitions_TenantId_Key",
                schema: "corehr",
                table: "EmployeeFieldDefinitions",
                columns: new[] { "TenantId", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeFieldValues_EmployeeId",
                schema: "corehr",
                table: "EmployeeFieldValues",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeFieldValues_FieldId",
                schema: "corehr",
                table: "EmployeeFieldValues",
                column: "FieldId");

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeFieldValues_TenantId_EmployeeId_FieldId",
                schema: "corehr",
                table: "EmployeeFieldValues",
                columns: new[] { "TenantId", "EmployeeId", "FieldId" },
                unique: true);

            // Every existing company gets one catalogue. Deterministic UUIDs keep the data migration repeatable in
            // relational Up/Down tests without depending on a PostgreSQL UUID extension.
            migrationBuilder.Sql("""
                WITH tenants AS (
                    SELECT DISTINCT "TenantId" FROM corehr."Employees"
                    UNION
                    SELECT DISTINCT "TenantId" FROM corehr."TenantSettings"
                )
                INSERT INTO corehr."EmployeeFieldCatalogs" (
                    "Id", "TenantId", "CreatedAt", "CreatedBy")
                SELECT md5("TenantId"::text || ':employee-fields')::uuid,
                       "TenantId", CURRENT_TIMESTAMP, 'Migration'
                FROM tenants;

                WITH specs("Key", "Label", "Area", "Type", "Editor", "Required", "SortOrder", "SourceKey", "VisibleToManager", "GalleryKey") AS (
                    VALUES
                        ('about-me',        'About me',          1, 1, 1, false,  10, 'about',             true,  NULL),
                        ('preferred-name',  'Preferred name',    2, 1, 1, false,  10, 'preferredName',     true,  NULL),
                        ('phone',           'Phone',             2, 5, 1, false,  20, 'phone',             true,  NULL),
                        ('personal-email',  'Personal email',    2, 4, 1, false,  30, 'personalEmail',     false, NULL),
                        ('home-address',    'Home address',      2, 6, 3, false,  40, 'homeAddress',       false, NULL),
                        ('emergency-contact','Emergency contact',2, 7, 1, false,  50, 'emergencyContacts', false, 'emergency-contact'),
                        ('date-of-birth',   'Date of birth',     2, 3, 2, false,  60, 'dateOfBirth',       false, NULL),
                        ('first-name',      'First name',        2, 1, 2, true,  900, 'firstName',         true,  NULL),
                        ('last-name',       'Last name',         2, 1, 2, true,  910, 'lastName',          true,  NULL),
                        ('work-email',      'Work email',        2, 4, 2, false, 920, 'email',             true,  NULL),
                        ('hire-date',       'Hire date',         3, 3, 4, true,   10, 'hireDate',          true,  NULL),
                        ('job-title',       'Job',               3, 1, 4, false,  20, 'jobTitle',          true,  NULL),
                        ('work-location',   'Place',             3, 1, 4, false,  30, 'workLocation',     true,  NULL),
                        ('employment-type', 'Employment type',   3, 1, 4, false,  40, 'employmentType',   true,  NULL)
                )
                INSERT INTO corehr."EmployeeFieldDefinitions" (
                    "Id", "TenantId", "CatalogId", "Key", "Label", "Area", "Type", "Editor",
                    "Visible", "VisibleToEmployee", "VisibleToManager", "Required", "IsBuiltIn", "IsActive",
                    "SortOrder", "SourceKey", "GalleryKey", "CreatedAt", "CreatedBy")
                SELECT md5(c."TenantId"::text || ':employee-field:' || s."Key")::uuid,
                       c."TenantId", c."Id", s."Key", s."Label", s."Area", s."Type", s."Editor",
                       CASE WHEN s."SourceKey" NOT IN ('firstName', 'lastName', 'email', 'hireDate', 'phone', 'jobTitle', 'workLocation', 'employmentType') THEN true ELSE
                           COALESCE((t."SettingsOverrides" #>> ARRAY['employeeFieldConfig', s."SourceKey", 'visible'])::boolean, true) END,
                       CASE WHEN s."SourceKey" NOT IN ('firstName', 'lastName', 'email', 'hireDate', 'phone', 'jobTitle', 'workLocation', 'employmentType') THEN true ELSE
                           COALESCE((t."SettingsOverrides" #>> ARRAY['employeeFieldConfig', s."SourceKey", 'visibleToEmployee'])::boolean, true) END,
                       CASE WHEN s."SourceKey" NOT IN ('firstName', 'lastName', 'email', 'hireDate', 'phone', 'jobTitle', 'workLocation', 'employmentType') THEN s."VisibleToManager" ELSE
                           COALESCE((t."SettingsOverrides" #>> ARRAY['employeeFieldConfig', s."SourceKey", 'visibleToManager'])::boolean, s."VisibleToManager") END,
                       CASE WHEN s."SourceKey" NOT IN ('firstName', 'lastName', 'email', 'hireDate', 'phone', 'jobTitle', 'workLocation', 'employmentType') THEN s."Required" ELSE
                           COALESCE((t."SettingsOverrides" #>> ARRAY['employeeFieldConfig', s."SourceKey", 'required'])::boolean, s."Required") END,
                       true, true, s."SortOrder", s."SourceKey", s."GalleryKey", CURRENT_TIMESTAMP, 'Migration'
                FROM corehr."EmployeeFieldCatalogs" c
                CROSS JOIN specs s
                LEFT JOIN corehr."TenantSettings" t ON t."TenantId" = c."TenantId";

                UPDATE corehr."TenantSettings"
                SET "SettingsOverrides" = NULLIF("SettingsOverrides" - 'employeeFieldConfig', '{}'::jsonb)
                WHERE "SettingsOverrides" ? 'employeeFieldConfig';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Put the eight legacy policy records back before removing the catalogue, so rollback loses no setting.
            migrationBuilder.Sql("""
                WITH policies AS (
                    SELECT "TenantId",
                           jsonb_object_agg("SourceKey", jsonb_build_object(
                               'visible', "Visible",
                               'required', "Required",
                               'visibleToEmployee', "VisibleToEmployee",
                               'visibleToManager', "VisibleToManager")) AS policy
                    FROM corehr."EmployeeFieldDefinitions"
                    WHERE "SourceKey" IN ('firstName', 'lastName', 'email', 'hireDate', 'phone', 'jobTitle', 'workLocation', 'employmentType')
                    GROUP BY "TenantId"
                )
                UPDATE corehr."TenantSettings" t
                SET "SettingsOverrides" = COALESCE(t."SettingsOverrides", '{}'::jsonb)
                    || jsonb_build_object('employeeFieldConfig', p.policy)
                FROM policies p
                WHERE p."TenantId" = t."TenantId";
                """);

            migrationBuilder.DropTable(
                name: "EmployeeFieldValues",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "EmployeeFieldDefinitions",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "EmployeeFieldCatalogs",
                schema: "corehr");
        }
    }
}
