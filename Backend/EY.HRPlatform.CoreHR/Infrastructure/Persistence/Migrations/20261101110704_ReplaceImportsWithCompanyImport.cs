using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ReplaceImportsWithCompanyImport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ImportSemanticConsents",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "OrganizationImportSemanticAttempts",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "OrganizationImportSources",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "WorkforceImportApplyOperations",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "WorkforceImportRows",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "WorkforceImportSemanticAttempts",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "WorkforceImportSources",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "OrganizationImportSessions",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "WorkforceImportSessions",
                schema: "corehr");

            migrationBuilder.CreateTable(
                name: "CompanyImportSessions",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CompanyName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    StartedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    DecisionsJson = table.Column<string>(type: "jsonb", nullable: false),
                    RequestedFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    BringInByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    BringInByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    BringInRequestedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LockedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LockedBy = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    LastFailure = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    BroughtInAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ResultJson = table.Column<string>(type: "jsonb", nullable: true),
                    ProvenanceJson = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompanyImportSessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CompanyImportSources",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    FileId = table.Column<Guid>(type: "uuid", nullable: false),
                    FileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Format = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ByteLength = table.Column<long>(type: "bigint", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    SheetName = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    RowCount = table.Column<int>(type: "integer", nullable: false),
                    ReadingsJson = table.Column<string>(type: "jsonb", nullable: false),
                    CellsJson = table.Column<string>(type: "jsonb", nullable: true),
                    CellsPurgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompanyImportSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CompanyImportSources_CompanyImportSessions_SessionId",
                        column: x => x.SessionId,
                        principalSchema: "corehr",
                        principalTable: "CompanyImportSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CompanyImportSessions_TenantId_Status",
                schema: "corehr",
                table: "CompanyImportSessions",
                columns: new[] { "TenantId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_CompanyImportSources_SessionId",
                schema: "corehr",
                table: "CompanyImportSources",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_CompanyImportSources_TenantId_SessionId",
                schema: "corehr",
                table: "CompanyImportSources",
                columns: new[] { "TenantId", "SessionId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CompanyImportSources",
                schema: "corehr");

            migrationBuilder.DropTable(
                name: "CompanyImportSessions",
                schema: "corehr");

            migrationBuilder.CreateTable(
                name: "ImportSemanticConsents",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    DataContractVersion = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    GrantedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    GrantedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    GrantedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportSemanticConsents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "OrganizationImportSessions",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AppliedMappingPlanJson = table.Column<string>(type: "jsonb", nullable: true),
                    CommitResultJson = table.Column<string>(type: "jsonb", nullable: true),
                    CommittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CommittedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    CommittedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    CreationFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreationToken = table.Column<Guid>(type: "uuid", nullable: false),
                    DecisionRevision = table.Column<int>(type: "integer", nullable: false),
                    DecisionsJson = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
                    DecisionsUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecisionsUpdatedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    DecisionsUpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DiscardedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DiscardedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    EffectiveDate = table.Column<DateOnly>(type: "date", nullable: false),
                    FinalProvenanceJson = table.Column<string>(type: "jsonb", nullable: true),
                    FinalSemanticDigest = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    LastUpdatedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    LastUpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    MappingConfirmationJson = table.Column<string>(type: "jsonb", nullable: true),
                    StartedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    StartedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrganizationImportSessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "WorkforceImportApplyOperations",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    FailureReason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    LockedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LockedBy = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Phase = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ProcessedCount = table.Column<int>(type: "integer", nullable: false),
                    QueuedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResultJson = table.Column<string>(type: "jsonb", nullable: true),
                    ReviewOutdatedJson = table.Column<string>(type: "jsonb", nullable: true),
                    ReviewedProposalFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false, defaultValue: ""),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TotalCount = table.Column<int>(type: "integer", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkforceImportApplyOperations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "WorkforceImportSessions",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BaselineDate = table.Column<DateOnly>(type: "date", nullable: false),
                    BlockedCount = table.Column<int>(type: "integer", nullable: false),
                    CommitResultJson = table.Column<string>(type: "jsonb", nullable: true),
                    CommittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CommittedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    CommittedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreateCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    CreationFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreationToken = table.Column<Guid>(type: "uuid", nullable: false),
                    DecisionRevision = table.Column<int>(type: "integer", nullable: false),
                    DecisionsUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecisionsUpdatedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    DecisionsUpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DiscardedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DiscardedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ExistingCount = table.Column<int>(type: "integer", nullable: false),
                    FinalProposalFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    FinalProvenanceJson = table.Column<string>(type: "jsonb", nullable: true),
                    LastUpdatedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    LastUpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    MappingPlanJson = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
                    MatchComplete = table.Column<bool>(type: "boolean", nullable: false),
                    NotImportedCount = table.Column<int>(type: "integer", nullable: false),
                    PayloadPurgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ProposalFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    PublishingStartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ResolutionsJson = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
                    SelectedSheetName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    StartedByDisplayName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    StartedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    WarningCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkforceImportSessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "OrganizationImportSemanticAttempts",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Abstentions = table.Column<int>(type: "integer", nullable: false),
                    AttemptOrdinal = table.Column<int>(type: "integer", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    DataContractVersion = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    DiagnosticCode = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    EligibleIssueKeysJson = table.Column<string>(type: "jsonb", nullable: false),
                    FailureCategory = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    InputFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    InputTokens = table.Column<int>(type: "integer", nullable: true),
                    LatencyMilliseconds = table.Column<int>(type: "integer", nullable: true),
                    Model = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    OutputTokens = table.Column<int>(type: "integer", nullable: true),
                    PromptVersion = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Provider = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ProviderResponseId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    ProviderSystemFingerprint = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    QuestionsSubmitted = table.Column<int>(type: "integer", nullable: false),
                    RequestedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResultContractVersion = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    RetryAfter = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RetryCount = table.Column<int>(type: "integer", nullable: false),
                    ReusedFromAttemptId = table.Column<Guid>(type: "uuid", nullable: true),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceFingerprint = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SuggestionsAccepted = table.Column<int>(type: "integer", nullable: false),
                    SuggestionsApplied = table.Column<int>(type: "integer", nullable: false),
                    SuggestionsJson = table.Column<string>(type: "jsonb", nullable: false),
                    SuggestionsOverridden = table.Column<int>(type: "integer", nullable: false),
                    SuggestionsRejected = table.Column<int>(type: "integer", nullable: false),
                    SuggestionsReturned = table.Column<int>(type: "integer", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Trigger = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrganizationImportSemanticAttempts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrganizationImportSemanticAttempts_OrganizationImportSessio~",
                        column: x => x.SessionId,
                        principalSchema: "corehr",
                        principalTable: "OrganizationImportSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrganizationImportSources",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ByteLength = table.Column<long>(type: "bigint", nullable: false),
                    ColumnCount = table.Column<int>(type: "integer", nullable: false),
                    ContentType = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    OriginalFileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    PayloadPurgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RawBytes = table.Column<byte[]>(type: "bytea", nullable: true),
                    RowCount = table.Column<int>(type: "integer", nullable: false),
                    SelectedRange = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SelectedSheetName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SourceFormat = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SourceTableJson = table.Column<string>(type: "jsonb", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrganizationImportSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrganizationImportSources_OrganizationImportSessions_Sessio~",
                        column: x => x.SessionId,
                        principalSchema: "corehr",
                        principalTable: "OrganizationImportSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkforceImportRows",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CandidateEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Classification = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    HasWarning = table.Column<bool>(type: "boolean", nullable: false),
                    IssueStateJson = table.Column<string>(type: "jsonb", nullable: true),
                    NormalizedProposalJson = table.Column<string>(type: "jsonb", nullable: true),
                    PayloadPurgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ResolvedManagerKey = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    ResolvedOrgUnitId = table.Column<Guid>(type: "uuid", nullable: true),
                    SearchText = table.Column<string>(type: "text", nullable: true),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceCellsJson = table.Column<string>(type: "jsonb", nullable: true),
                    SourceRowNumber = table.Column<int>(type: "integer", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkforceImportRows", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkforceImportRows_WorkforceImportSessions_SessionId",
                        column: x => x.SessionId,
                        principalSchema: "corehr",
                        principalTable: "WorkforceImportSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkforceImportSemanticAttempts",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Abstentions = table.Column<int>(type: "integer", nullable: false),
                    AttemptOrdinal = table.Column<int>(type: "integer", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    DataContractVersion = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    DiagnosticCode = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    EligibleIssueKeysJson = table.Column<string>(type: "jsonb", nullable: false),
                    FailureCategory = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    InputFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    InputTokens = table.Column<int>(type: "integer", nullable: true),
                    LatencyMilliseconds = table.Column<int>(type: "integer", nullable: true),
                    Model = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    OutputTokens = table.Column<int>(type: "integer", nullable: true),
                    PromptVersion = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Provider = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ProviderResponseId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    ProviderSystemFingerprint = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    QuestionsSubmitted = table.Column<int>(type: "integer", nullable: false),
                    RequestedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResultContractVersion = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    RetryAfter = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RetryCount = table.Column<int>(type: "integer", nullable: false),
                    ReusedFromAttemptId = table.Column<Guid>(type: "uuid", nullable: true),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceFingerprint = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SuggestionsAccepted = table.Column<int>(type: "integer", nullable: false),
                    SuggestionsApplied = table.Column<int>(type: "integer", nullable: false),
                    SuggestionsJson = table.Column<string>(type: "jsonb", nullable: false),
                    SuggestionsOverridden = table.Column<int>(type: "integer", nullable: false),
                    SuggestionsRejected = table.Column<int>(type: "integer", nullable: false),
                    SuggestionsReturned = table.Column<int>(type: "integer", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Trigger = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkforceImportSemanticAttempts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkforceImportSemanticAttempts_WorkforceImportSessions_Ses~",
                        column: x => x.SessionId,
                        principalSchema: "corehr",
                        principalTable: "WorkforceImportSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkforceImportSources",
                schema: "corehr",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ByteLength = table.Column<long>(type: "bigint", nullable: false),
                    ColumnCount = table.Column<int>(type: "integer", nullable: false),
                    ColumnsJson = table.Column<string>(type: "jsonb", nullable: true),
                    ContentType = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    OriginalFileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    PayloadPurgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RawBytes = table.Column<byte[]>(type: "bytea", nullable: true),
                    RowCount = table.Column<int>(type: "integer", nullable: false),
                    SelectedRange = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SelectedSheetName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SourceFormat = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkforceImportSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkforceImportSources_WorkforceImportSessions_SessionId",
                        column: x => x.SessionId,
                        principalSchema: "corehr",
                        principalTable: "WorkforceImportSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UX_ImportSemanticConsents_Session_Provider_Contract_Active",
                schema: "corehr",
                table: "ImportSemanticConsents",
                columns: new[] { "TenantId", "SessionId", "Provider", "DataContractVersion" },
                unique: true,
                filter: "\"RevokedAt\" IS NULL AND \"SessionId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "UX_ImportSemanticConsents_Tenant_Provider_Contract_Active",
                schema: "corehr",
                table: "ImportSemanticConsents",
                columns: new[] { "TenantId", "Provider", "DataContractVersion" },
                unique: true,
                filter: "\"RevokedAt\" IS NULL AND \"SessionId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_OrganizationImportSemanticAttempts_SessionId",
                schema: "corehr",
                table: "OrganizationImportSemanticAttempts",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_OrganizationImportSemanticAttempts_Tenant_Input_Status",
                schema: "corehr",
                table: "OrganizationImportSemanticAttempts",
                columns: new[] { "TenantId", "InputFingerprint", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_OrganizationImportSemanticAttempts_Tenant_Session_Status",
                schema: "corehr",
                table: "OrganizationImportSemanticAttempts",
                columns: new[] { "TenantId", "SessionId", "Status" });

            migrationBuilder.CreateIndex(
                name: "UX_OrganizationImportSemanticAttempts_Tenant_Session_Fingerprint_Ordinal",
                schema: "corehr",
                table: "OrganizationImportSemanticAttempts",
                columns: new[] { "TenantId", "SessionId", "InputFingerprint", "AttemptOrdinal" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrganizationImportSessions_Tenant_Status_UpdatedAt",
                schema: "corehr",
                table: "OrganizationImportSessions",
                columns: new[] { "TenantId", "Status", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "UX_OrganizationImportSessions_Tenant_CreationToken",
                schema: "corehr",
                table: "OrganizationImportSessions",
                columns: new[] { "TenantId", "CreationToken" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrganizationImportSources_SessionId",
                schema: "corehr",
                table: "OrganizationImportSources",
                column: "SessionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrganizationImportSources_TenantId",
                schema: "corehr",
                table: "OrganizationImportSources",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkforceImportApplyOperations_Status",
                schema: "corehr",
                table: "WorkforceImportApplyOperations",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "UX_WorkforceImportApplyOperations_Tenant_Session",
                schema: "corehr",
                table: "WorkforceImportApplyOperations",
                columns: new[] { "TenantId", "SessionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkforceImportRows_SessionId",
                schema: "corehr",
                table: "WorkforceImportRows",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkforceImportRows_Tenant_Session_Classification",
                schema: "corehr",
                table: "WorkforceImportRows",
                columns: new[] { "TenantId", "SessionId", "Classification" });

            migrationBuilder.CreateIndex(
                name: "UX_WorkforceImportRows_Tenant_Session_SourceRowNumber",
                schema: "corehr",
                table: "WorkforceImportRows",
                columns: new[] { "TenantId", "SessionId", "SourceRowNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkforceImportSemanticAttempts_SessionId",
                schema: "corehr",
                table: "WorkforceImportSemanticAttempts",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkforceImportSemanticAttempts_Tenant_Input_Status",
                schema: "corehr",
                table: "WorkforceImportSemanticAttempts",
                columns: new[] { "TenantId", "InputFingerprint", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkforceImportSemanticAttempts_Tenant_Session_Status",
                schema: "corehr",
                table: "WorkforceImportSemanticAttempts",
                columns: new[] { "TenantId", "SessionId", "Status" });

            migrationBuilder.CreateIndex(
                name: "UX_WorkforceImportSemanticAttempts_Tenant_Session_Fingerprint_Ordinal",
                schema: "corehr",
                table: "WorkforceImportSemanticAttempts",
                columns: new[] { "TenantId", "SessionId", "InputFingerprint", "AttemptOrdinal" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkforceImportSessions_Tenant_Status_UpdatedAt",
                schema: "corehr",
                table: "WorkforceImportSessions",
                columns: new[] { "TenantId", "Status", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "UX_WorkforceImportSessions_Tenant_CreationToken",
                schema: "corehr",
                table: "WorkforceImportSessions",
                columns: new[] { "TenantId", "CreationToken" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkforceImportSources_SessionId",
                schema: "corehr",
                table: "WorkforceImportSources",
                column: "SessionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkforceImportSources_TenantId",
                schema: "corehr",
                table: "WorkforceImportSources",
                column: "TenantId");
        }
    }
}
