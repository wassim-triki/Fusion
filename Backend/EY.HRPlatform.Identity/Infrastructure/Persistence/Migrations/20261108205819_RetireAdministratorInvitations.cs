using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RetireAdministratorInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The TenantAdministrator purpose is gone: its rows (pending or accepted) can no longer be read, so they go,
            // with their delivery attempts and any successor's link back to them.
            migrationBuilder.Sql("""
                UPDATE identity."InviteTokens" SET "PredecessorInvitationId" = NULL
                WHERE "PredecessorInvitationId" IN (SELECT "Id" FROM identity."InviteTokens" WHERE "Purpose" = 'TenantAdministrator');
                DELETE FROM identity."InvitationDeliveryAttempts"
                WHERE "InvitationId" IN (SELECT "Id" FROM identity."InviteTokens" WHERE "Purpose" = 'TenantAdministrator');
                DELETE FROM identity."InviteTokens" WHERE "Purpose" = 'TenantAdministrator';
                """);

            migrationBuilder.DropIndex(
                name: "IX_InviteTokens_TenantId_Email_AdministrativePending",
                schema: "identity",
                table: "InviteTokens");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_InviteTokens_TenantId_Email_AdministrativePending",
                schema: "identity",
                table: "InviteTokens",
                columns: new[] { "TenantId", "Email" },
                unique: true,
                filter: "\"Purpose\" IN ('TenantAdministrator', 'TenantAdministratorRecovery') AND \"AcceptedAt\" IS NULL AND \"IsRevoked\" = false AND \"SupersededAt\" IS NULL");
        }
    }
}
