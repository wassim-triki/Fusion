using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSingleSignOn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AllowGoogleSignIn",
                schema: "identity",
                table: "Tenants",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "AllowMicrosoftSignIn",
                schema: "identity",
                table: "Tenants",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "Method",
                schema: "identity",
                table: "RefreshTokens",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "password");

            migrationBuilder.CreateTable(
                name: "DataProtectionKeys",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    FriendlyName = table.Column<string>(type: "text", nullable: true),
                    Xml = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DataProtectionKeys", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SsoConnections",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Issuer = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    EntraTenantId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ClientId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ProtectedClientSecret = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    SecretSetAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    LastTestAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastTestByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    LastTestOutcome = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    LastTestEmail = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    LastTestMessage = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RequiredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RequiredByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    RequiredEndedSessions = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SsoConnections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SsoConnections_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "identity",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SsoFlows",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BindingHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Purpose = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Provider = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ConnectionId = table.Column<Guid>(type: "uuid", nullable: true),
                    ExpectedIssuer = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    State = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Nonce = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ProtectedCodeVerifier = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    InvitationKind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    ProtectedInvitationCredential = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    LoginHint = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    ReturnTo = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ResultUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ResultCode = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: true),
                    ResultJson = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ResultMethod = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ConsumedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SsoFlows", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ExternalLogins",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ConnectionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Issuer = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    Subject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    EmailAtLink = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    LinkedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExternalLogins", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExternalLogins_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ExternalLogins_SsoConnections_ConnectionId",
                        column: x => x.ConnectionId,
                        principalSchema: "identity",
                        principalTable: "SsoConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SsoDomains",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConnectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Domain = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: false),
                    AddedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AddedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ProvedByUserId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SsoDomains", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SsoDomains_SsoConnections_ConnectionId",
                        column: x => x.ConnectionId,
                        principalSchema: "identity",
                        principalTable: "SsoConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ExternalLogins_ConnectionId",
                schema: "identity",
                table: "ExternalLogins",
                column: "ConnectionId");

            migrationBuilder.CreateIndex(
                name: "IX_ExternalLogins_Provider_ConnectionId_Issuer_Subject",
                schema: "identity",
                table: "ExternalLogins",
                columns: new[] { "Provider", "ConnectionId", "Issuer", "Subject" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_ExternalLogins_UserId_Provider_ConnectionId",
                schema: "identity",
                table: "ExternalLogins",
                columns: new[] { "UserId", "Provider", "ConnectionId" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_SsoConnections_TenantId",
                schema: "identity",
                table: "SsoConnections",
                column: "TenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SsoDomains_ConnectionId",
                schema: "identity",
                table: "SsoDomains",
                column: "ConnectionId");

            migrationBuilder.CreateIndex(
                name: "IX_SsoDomains_Domain_ProvedUnique",
                schema: "identity",
                table: "SsoDomains",
                column: "Domain",
                unique: true,
                filter: "\"ProvedAt\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SsoDomains_TenantId_Domain",
                schema: "identity",
                table: "SsoDomains",
                columns: new[] { "TenantId", "Domain" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SsoFlows_ActorUserId_Purpose",
                schema: "identity",
                table: "SsoFlows",
                columns: new[] { "ActorUserId", "Purpose" });

            migrationBuilder.CreateIndex(
                name: "IX_SsoFlows_BindingHash",
                schema: "identity",
                table: "SsoFlows",
                column: "BindingHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SsoFlows_ExpiresAt",
                schema: "identity",
                table: "SsoFlows",
                column: "ExpiresAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DataProtectionKeys",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "ExternalLogins",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "SsoDomains",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "SsoFlows",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "SsoConnections",
                schema: "identity");

            migrationBuilder.DropColumn(
                name: "AllowGoogleSignIn",
                schema: "identity",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "AllowMicrosoftSignIn",
                schema: "identity",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "Method",
                schema: "identity",
                table: "RefreshTokens");
        }
    }
}
