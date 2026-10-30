using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddJobsPlacesAndLists : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "JobId",
                schema: "corehr",
                table: "WorkAssignments",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "PlaceId",
                schema: "corehr",
                table: "WorkAssignments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "JobId",
                schema: "corehr",
                table: "OpenRoles",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "PlaceId",
                schema: "corehr",
                table: "OpenRoles",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PlaceName",
                schema: "corehr",
                table: "OpenRoles",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "EmploymentType",
                schema: "corehr",
                table: "Employments",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(50)",
                oldMaxLength: 50,
                oldNullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EmploymentTypeId",
                schema: "corehr",
                table: "Employments",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CompanyListSeeds",
                schema: "corehr",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    SeededAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompanyListSeeds", x => x.TenantId);
                });

            migrationBuilder.CreateTable(
                name: "CompanyListValues",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    List = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Key = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedLabel = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsRetired = table.Column<bool>(type: "boolean", nullable: false),
                    RetiredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompanyListValues", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Places",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    City = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Country = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IsRetired = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Places", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Jobs",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    NormalizedTitle = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    FamilyId = table.Column<Guid>(type: "uuid", nullable: true),
                    LevelId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsRetired = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Jobs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Jobs_CompanyListValues_FamilyId",
                        column: x => x.FamilyId,
                        principalSchema: "corehr",
                        principalTable: "CompanyListValues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Jobs_CompanyListValues_LevelId",
                        column: x => x.LevelId,
                        principalSchema: "corehr",
                        principalTable: "CompanyListValues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkAssignments_JobId",
                schema: "corehr",
                table: "WorkAssignments",
                column: "JobId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkAssignments_PlaceId",
                schema: "corehr",
                table: "WorkAssignments",
                column: "PlaceId");

            migrationBuilder.CreateIndex(
                name: "IX_OpenRoles_JobId",
                schema: "corehr",
                table: "OpenRoles",
                column: "JobId");

            migrationBuilder.CreateIndex(
                name: "IX_OpenRoles_PlaceId",
                schema: "corehr",
                table: "OpenRoles",
                column: "PlaceId");

            migrationBuilder.CreateIndex(
                name: "IX_Employments_EmploymentTypeId",
                schema: "corehr",
                table: "Employments",
                column: "EmploymentTypeId");

            migrationBuilder.CreateIndex(
                name: "UX_CompanyListValues_TenantId_List_Key",
                schema: "corehr",
                table: "CompanyListValues",
                columns: new[] { "TenantId", "List", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_CompanyListValues_TenantId_List_NormalizedLabel",
                schema: "corehr",
                table: "CompanyListValues",
                columns: new[] { "TenantId", "List", "NormalizedLabel" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Jobs_FamilyId",
                schema: "corehr",
                table: "Jobs",
                column: "FamilyId");

            migrationBuilder.CreateIndex(
                name: "IX_Jobs_LevelId",
                schema: "corehr",
                table: "Jobs",
                column: "LevelId");

            migrationBuilder.CreateIndex(
                name: "UX_Jobs_TenantId_NormalizedTitle",
                schema: "corehr",
                table: "Jobs",
                columns: new[] { "TenantId", "NormalizedTitle" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_Places_TenantId_NormalizedName",
                schema: "corehr",
                table: "Places",
                columns: new[] { "TenantId", "NormalizedName" },
                unique: true);

            // Each tenant's free-text titles become its jobs and its locations its places, grouped by their trimmed,
            // single-spaced, case-insensitive form (the most common spelling names the job); employment-type texts
            // become values of the "Employment types" list. The text columns stay as the catalogue's display copies.
            migrationBuilder.Sql(@"
INSERT INTO corehr.""Jobs"" (""Id"", ""TenantId"", ""Title"", ""NormalizedTitle"", ""IsRetired"", ""CreatedAt"", ""CreatedBy"")
SELECT gen_random_uuid(), t.""TenantId"", t.title, t.norm, FALSE, now() AT TIME ZONE 'utc', 'Migration'
FROM (
    SELECT src.""TenantId"", upper(src.clean) AS norm, mode() WITHIN GROUP (ORDER BY src.clean) AS title
    FROM (
        SELECT ""TenantId"", left(btrim(regexp_replace(""JobTitle"", '\s+', ' ', 'g')), 150) AS clean FROM corehr.""WorkAssignments""
        UNION ALL
        SELECT ""TenantId"", left(btrim(regexp_replace(""JobTitle"", '\s+', ' ', 'g')), 150) FROM corehr.""OpenRoles""
    ) src
    WHERE src.clean <> ''
    GROUP BY src.""TenantId"", upper(src.clean)
) t;

UPDATE corehr.""WorkAssignments"" w SET ""JobId"" = j.""Id"", ""JobTitle"" = j.""Title""
FROM corehr.""Jobs"" j
WHERE j.""TenantId"" = w.""TenantId"" AND j.""NormalizedTitle"" = upper(left(btrim(regexp_replace(w.""JobTitle"", '\s+', ' ', 'g')), 150));

UPDATE corehr.""OpenRoles"" r SET ""JobId"" = j.""Id"", ""JobTitle"" = j.""Title""
FROM corehr.""Jobs"" j
WHERE j.""TenantId"" = r.""TenantId"" AND j.""NormalizedTitle"" = upper(left(btrim(regexp_replace(r.""JobTitle"", '\s+', ' ', 'g')), 150));

INSERT INTO corehr.""Places"" (""Id"", ""TenantId"", ""Name"", ""NormalizedName"", ""IsRetired"", ""CreatedAt"", ""CreatedBy"")
SELECT gen_random_uuid(), t.""TenantId"", t.name, t.norm, FALSE, now() AT TIME ZONE 'utc', 'Migration'
FROM (
    SELECT src.""TenantId"", upper(src.clean) AS norm, mode() WITHIN GROUP (ORDER BY src.clean) AS name
    FROM (
        SELECT ""TenantId"", left(btrim(regexp_replace(""WorkLocation"", '\s+', ' ', 'g')), 100) AS clean
        FROM corehr.""WorkAssignments"" WHERE ""WorkLocation"" IS NOT NULL
    ) src
    WHERE src.clean <> ''
    GROUP BY src.""TenantId"", upper(src.clean)
) t;

UPDATE corehr.""WorkAssignments"" w SET ""PlaceId"" = p.""Id"", ""WorkLocation"" = p.""Name""
FROM corehr.""Places"" p
WHERE w.""WorkLocation"" IS NOT NULL AND p.""TenantId"" = w.""TenantId""
    AND p.""NormalizedName"" = upper(left(btrim(regexp_replace(w.""WorkLocation"", '\s+', ' ', 'g')), 100));

INSERT INTO corehr.""CompanyListValues"" (""Id"", ""TenantId"", ""List"", ""Key"", ""Label"", ""NormalizedLabel"", ""SortOrder"", ""IsRetired"", ""CreatedAt"", ""CreatedBy"")
SELECT gen_random_uuid(), k.""TenantId"", 'EmploymentTypes',
    CASE WHEN k.n = 1 THEN k.slug ELSE k.slug || '-' || k.n END,
    k.label, upper(k.label), k.position - 1, FALSE, now() AT TIME ZONE 'utc', 'Migration'
FROM (
    SELECT v.*, row_number() OVER (PARTITION BY v.""TenantId"", v.slug ORDER BY v.label) AS n,
        row_number() OVER (PARTITION BY v.""TenantId"" ORDER BY v.label) AS position
    FROM (
        SELECT l.""TenantId"", l.label,
            coalesce(nullif(left(btrim(regexp_replace(lower(l.label), '[^a-z0-9]+', '-', 'g'), '-'), 50), ''), 'value') AS slug
        FROM (
            SELECT ""TenantId"", mode() WITHIN GROUP (ORDER BY btrim(regexp_replace(""EmploymentType"", '\s+', ' ', 'g'))) AS label
            FROM corehr.""Employments""
            WHERE ""EmploymentType"" IS NOT NULL AND btrim(""EmploymentType"") <> ''
            GROUP BY ""TenantId"", upper(btrim(regexp_replace(""EmploymentType"", '\s+', ' ', 'g')))
        ) l
    ) v
) k;

UPDATE corehr.""Employments"" e SET ""EmploymentTypeId"" = v.""Id"", ""EmploymentType"" = v.""Label""
FROM corehr.""CompanyListValues"" v
WHERE v.""List"" = 'EmploymentTypes' AND v.""TenantId"" = e.""TenantId"" AND e.""EmploymentType"" IS NOT NULL
    AND v.""NormalizedLabel"" = upper(btrim(regexp_replace(e.""EmploymentType"", '\s+', ' ', 'g')));
");

            migrationBuilder.AddForeignKey(
                name: "FK_Employments_CompanyListValues_EmploymentTypeId",
                schema: "corehr",
                table: "Employments",
                column: "EmploymentTypeId",
                principalSchema: "corehr",
                principalTable: "CompanyListValues",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_OpenRoles_Jobs_JobId",
                schema: "corehr",
                table: "OpenRoles",
                column: "JobId",
                principalSchema: "corehr",
                principalTable: "Jobs",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_OpenRoles_Places_PlaceId",
                schema: "corehr",
                table: "OpenRoles",
                column: "PlaceId",
                principalSchema: "corehr",
                principalTable: "Places",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_WorkAssignments_Jobs_JobId",
                schema: "corehr",
                table: "WorkAssignments",
                column: "JobId",
                principalSchema: "corehr",
                principalTable: "Jobs",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_WorkAssignments_Places_PlaceId",
                schema: "corehr",
                table: "WorkAssignments",
                column: "PlaceId",
                principalSchema: "corehr",
                principalTable: "Places",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The names never left the text columns; only a label longer than the old limit is cut to fit.
            migrationBuilder.Sql(@"UPDATE corehr.""Employments"" SET ""EmploymentType"" = left(""EmploymentType"", 50) WHERE length(""EmploymentType"") > 50;");

            migrationBuilder.DropForeignKey(
                name: "FK_Employments_CompanyListValues_EmploymentTypeId",
                schema: "corehr",
                table: "Employments");

            migrationBuilder.DropForeignKey(
                name: "FK_OpenRoles_Jobs_JobId",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropForeignKey(
                name: "FK_OpenRoles_Places_PlaceId",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropForeignKey(
                name: "FK_WorkAssignments_Jobs_JobId",
                schema: "corehr",
                table: "WorkAssignments");

            migrationBuilder.DropForeignKey(
                name: "FK_WorkAssignments_Places_PlaceId",
                schema: "corehr",
                table: "WorkAssignments");

            migrationBuilder.DropTable(
                name: "CompanyListSeeds",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "Jobs",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "Places",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "CompanyListValues",
                schema: "corehr");

            migrationBuilder.DropIndex(
                name: "IX_WorkAssignments_JobId",
                schema: "corehr",
                table: "WorkAssignments");

            migrationBuilder.DropIndex(
                name: "IX_WorkAssignments_PlaceId",
                schema: "corehr",
                table: "WorkAssignments");

            migrationBuilder.DropIndex(
                name: "IX_OpenRoles_JobId",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropIndex(
                name: "IX_OpenRoles_PlaceId",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropIndex(
                name: "IX_Employments_EmploymentTypeId",
                schema: "corehr",
                table: "Employments");

            migrationBuilder.DropColumn(
                name: "JobId",
                schema: "corehr",
                table: "WorkAssignments");

            migrationBuilder.DropColumn(
                name: "PlaceId",
                schema: "corehr",
                table: "WorkAssignments");

            migrationBuilder.DropColumn(
                name: "JobId",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropColumn(
                name: "PlaceId",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropColumn(
                name: "PlaceName",
                schema: "corehr",
                table: "OpenRoles");

            migrationBuilder.DropColumn(
                name: "EmploymentTypeId",
                schema: "corehr",
                table: "Employments");

            migrationBuilder.AlterColumn<string>(
                name: "EmploymentType",
                schema: "corehr",
                table: "Employments",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);
        }
    }
}
