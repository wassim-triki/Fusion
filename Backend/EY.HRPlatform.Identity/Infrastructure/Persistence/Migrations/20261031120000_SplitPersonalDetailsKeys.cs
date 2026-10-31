using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Personal details get their own keys (B-214). Every role keeps exactly what it had: seeing jobs for a team or
    /// everyone carried the same reach of personal details, and managing jobs carried managing them.
    /// </summary>
    public partial class SplitPersonalDetailsKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                INSERT INTO identity."AccessProfileGrants" ("AccessProfileId", "PermissionKey", "Scope", "TenantId")
                SELECT g."AccessProfileId", 'core.personal.view', g."Scope", g."TenantId"
                FROM identity."AccessProfileGrants" g
                WHERE g."PermissionKey" = 'core.employee.view' AND g."Scope" IN ('DirectReports', 'OrgUnit', 'Tenant')
                ON CONFLICT DO NOTHING;

                INSERT INTO identity."AccessProfileGrants" ("AccessProfileId", "PermissionKey", "Scope", "TenantId")
                SELECT g."AccessProfileId", 'core.personal.manage', 'Tenant', g."TenantId"
                FROM identity."AccessProfileGrants" g
                WHERE g."PermissionKey" = 'core.employee.manage' AND g."Scope" = 'Tenant'
                ON CONFLICT DO NOTHING;

                UPDATE identity."AccessProfileGrants" SET "Scope" = 'DirectReports'
                WHERE "PermissionKey" = 'core.personal.view' AND "Scope" = 'OrgUnit';

                INSERT INTO identity."AccessProfileGrants" ("AccessProfileId", "PermissionKey", "Scope", "TenantId")
                SELECT g."AccessProfileId", 'core.personal.view', 'Tenant', g."TenantId"
                FROM identity."AccessProfileGrants" g
                WHERE g."PermissionKey" = 'core.personal.manage'
                ON CONFLICT ("AccessProfileId", "PermissionKey") DO UPDATE SET "Scope" = 'Tenant';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM identity."AccessProfileGrants"
                WHERE "PermissionKey" IN ('core.personal.view', 'core.personal.manage');
                """);
        }
    }
}
