using System.Data;
using System.Data.Common;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EY.HRPlatform.CoreHR.Features.People;

public sealed class PeopleQueryHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IWorkforceAccountStatusReader? accountStatuses = null) : IQueryHandler<PeopleQuery, Result<PeoplePageDto>>
{
    private const int MaxPageSize = 100;

    /// <summary>One matching person before views, sign-in and paging apply.</summary>
    private sealed record Candidate(Guid EmployeeId, PeopleRowDto Row);

    public async Task<Result<PeoplePageDto>> Handle(PeopleQuery request, CancellationToken cancellationToken)
    {
        if (!dbContext.Database.IsNpgsql())
            return await HandlePortableAsync(request, cancellationToken);

        var page = request.Unpaged ? 1 : Math.Max(1, request.Page);
        var pageSize = request.Unpaged ? int.MaxValue : Math.Clamp(request.PageSize, 1, MaxPageSize);
        var orderBy = BuildOrderBy(request.Sort, request.Direction);
        var cohortKeys = await ResolveImportCohortAsync(request.ImportBatchId, cancellationToken);
        var sql = BuildSql(orderBy);
        var connection = dbContext.Database.GetDbConnection();
        var shouldClose = connection.State != ConnectionState.Open;
        if (shouldClose)
            await connection.OpenAsync(cancellationToken);

        var candidates = new List<Candidate>();
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Transaction = dbContext.Database.CurrentTransaction?.GetDbTransaction();
            AddParameter(command, "tenantId", tenantContext.TenantId, DbType.Guid);
            AddParameter(command, "today", DateTime.UtcNow.Date, DbType.DateTime);
            AddParameter(command, "q", string.IsNullOrWhiteSpace(request.Q) ? DBNull.Value : request.Q.Trim().ToLowerInvariant(), DbType.String);
            AddParameter(command, "state", request.State?.ToString() ?? (object)DBNull.Value, DbType.String);
            AddParameter(command, "orgUnitId", request.OrgUnitId ?? (object)DBNull.Value, DbType.Guid);
            AddParameter(command, "orgScope", request.OrganizationScope.ToString());
            AddParameter(command, "jobId", request.JobId ?? (object)DBNull.Value, DbType.Guid);
            AddParameter(command, "placeId", request.PlaceId ?? (object)DBNull.Value, DbType.Guid);
            AddParameter(command, "managerKey", string.IsNullOrWhiteSpace(request.ManagerKey) ? DBNull.Value : request.ManagerKey.Trim().ToUpperInvariant(), DbType.String);
            // A typed text[] parameter so PostgreSQL can resolve `= ANY(@cohortKeys)` even when null.
            command.Parameters.Add(new Npgsql.NpgsqlParameter("cohortKeys", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Text)
            {
                Value = (object?)cohortKeys ?? DBNull.Value,
            });

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var state = Enum.Parse<PeopleEmploymentState>(reader.GetString(reader.GetOrdinal("EmploymentState")));
                var jobTitle = GetNullableString(reader, "JobTitle");
                var work = jobTitle is null
                    ? null
                    : new PeopleWorkDto(
                        GetNullableGuid(reader, "OrgUnitId"),
                        jobTitle,
                        GetNullableString(reader, "OrganizationName") ?? "Work details unavailable",
                        GetNullableString(reader, "OrganizationPath") ?? "Work details unavailable",
                        GetNullableString(reader, "WorkLocation"),
                        reader.GetDateTime(reader.GetOrdinal("WorkEffectiveFrom")),
                        state == PeopleEmploymentState.Former,
                        GetNullableGuid(reader, "JobId"),
                        GetNullableGuid(reader, "PlaceId"));
                var managerKey = GetNullableString(reader, "ManagerEmployeeKey");
                var manager = managerKey is null
                    ? null
                    : new PeopleManagerDto(
                        managerKey,
                        reader.GetString(reader.GetOrdinal("ManagerDisplayName")),
                        reader.GetString(reader.GetOrdinal("ManagerEmployeeNumber")),
                        EmployeePhotos.UrlFor(managerKey, GetNullableString(reader, "ManagerPhotoKey")));

                var employeeKey = reader.GetString(reader.GetOrdinal("EmployeeKey"));
                var employeeId = reader.GetGuid(reader.GetOrdinal("EmployeeId"));
                candidates.Add(new Candidate(employeeId, new PeopleRowDto(
                    employeeKey,
                    reader.GetString(reader.GetOrdinal("EmployeeNumber")),
                    reader.GetString(reader.GetOrdinal("DisplayName")),
                    reader.GetString(reader.GetOrdinal("FirstName")),
                    reader.GetString(reader.GetOrdinal("LastName")),
                    GetNullableString(reader, "WorkEmail"),
                    state,
                    GetNullableDateTime(reader, "EmploymentStart"),
                    GetNullableDateTime(reader, "EmploymentEnd"),
                    work,
                    manager,
                    work is null ? "WorkDetailsUnavailable" : "Complete",
                    EmployeePhotos.UrlFor(employeeKey, GetNullableString(reader, "PhotoKey")),
                    EmployeeId: employeeId)));
            }
        }
        finally
        {
            if (shouldClose)
                await connection.CloseAsync();
        }

        var facets = request.Unpaged ? null : await FacetsAsync(cancellationToken);
        candidates = await FilterByFieldsAsync(candidates, request.Fields, cancellationToken);
        if (request.IncludeSignIn)
            candidates = await WithSignInAsync(candidates, cancellationToken);

        var views = new PeopleViewCountsDto(
            candidates.Count(item => InView(item.Row, PeopleView.Everyone)),
            candidates.Count(item => InView(item.Row, PeopleView.StartingSoon)),
            candidates.Count(item => InView(item.Row, PeopleView.Leaving)),
            request.IncludeSignIn ? candidates.Count(item => InView(item.Row, PeopleView.NotSignedIn)) : null,
            candidates.Count(item => InView(item.Row, PeopleView.Left)));
        // Without sign-in facts nobody is in Not signed in, rather than everyone.
        var matching = request.View is { } view
            ? candidates.Where(item => InView(item.Row, view)).ToList()
            : candidates;
        var total = matching.Count;
        var skip = (int)Math.Min(int.MaxValue, (long)(page - 1) * pageSize);
        var slice = matching.Skip(skip).Take(pageSize).ToList();
        var leaves = await Changes.LeaveReader.CurrentAsync(
            dbContext, slice.Select(item => item.EmployeeId).ToList(), DateOnly.FromDateTime(DateTime.UtcNow), cancellationToken);
        var items = slice.Select(item => leaves.TryGetValue(item.EmployeeId, out var leave)
            ? item.Row with { Leave = leave.WithoutType() }
            : item.Row).ToList();

        return Result.Success(new PeoplePageDto(
            items,
            total,
            page,
            request.Unpaged ? Math.Max(1, total) : pageSize,
            total == 0 ? 0 : request.Unpaged ? 1 : (int)Math.Ceiling(total / (double)pageSize),
            views,
            facets));
    }

    /// <summary>The company's Tags fields and every value someone holds, for People's filters.</summary>
    private async Task<IReadOnlyList<PeopleFieldFacetDto>> FacetsAsync(CancellationToken cancellationToken)
    {
        var definitions = await dbContext.EmployeeFieldDefinitions.AsNoTracking()
            .Where(item => item.IsActive && item.Visible && item.SourceKey == null && item.Type == EmployeeFieldType.Tags)
            .OrderBy(item => item.Area).ThenBy(item => item.SortOrder)
            .ToListAsync(cancellationToken);
        if (definitions.Count == 0) return [];
        var ids = definitions.Select(item => item.Id).ToList();
        var values = await dbContext.EmployeeFieldValues.AsNoTracking()
            .Where(item => ids.Contains(item.FieldId))
            .Select(item => new { item.FieldId, item.ValueJson })
            .ToListAsync(cancellationToken);
        return definitions.Select(definition => new PeopleFieldFacetDto(
                definition.Key,
                definition.Label,
                values.Where(item => item.FieldId == definition.Id)
                    .SelectMany(item => TagsOf(item.ValueJson))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Order(StringComparer.CurrentCultureIgnoreCase)
                    .ToList()))
            .Where(facet => facet.Values.Count > 0)
            .ToList();
    }

    private static bool InView(PeopleRowDto row, PeopleView view) => view switch
    {
        PeopleView.Everyone => row.EmploymentState != PeopleEmploymentState.Former,
        PeopleView.StartingSoon => row.EmploymentState == PeopleEmploymentState.Scheduled,
        PeopleView.Leaving => row.EmploymentState == PeopleEmploymentState.Active && row.EmploymentEnd is not null,
        PeopleView.NotSignedIn => row.EmploymentState != PeopleEmploymentState.Former
            && row.SignIn is { State: not PeopleSignInState.SignsIn },
        PeopleView.Left => row.EmploymentState == PeopleEmploymentState.Former,
        _ => true,
    };

    /// <summary>Keeps the people whose Tags field holds each asked value (case-insensitive).</summary>
    private async Task<List<Candidate>> FilterByFieldsAsync(
        List<Candidate> candidates, IReadOnlyDictionary<string, string>? fields, CancellationToken cancellationToken)
    {
        if (fields is null || fields.Count == 0 || candidates.Count == 0) return candidates;
        var wanted = fields.ToDictionary(pair => pair.Key.Trim().ToLowerInvariant(), pair => pair.Value.Trim());
        var keys = wanted.Keys.ToList();
        var definitions = await dbContext.EmployeeFieldDefinitions.AsNoTracking()
            .Where(item => item.IsActive && item.SourceKey == null && item.Type == EmployeeFieldType.Tags && keys.Contains(item.Key))
            .ToListAsync(cancellationToken);
        // An unknown field matches nobody, like a filter on a value nobody has.
        if (definitions.Count != keys.Count) return [];
        var fieldIds = definitions.Select(item => item.Id).ToList();
        var values = await dbContext.EmployeeFieldValues.AsNoTracking()
            .Where(item => fieldIds.Contains(item.FieldId))
            .Select(item => new { item.EmployeeId, item.FieldId, item.ValueJson })
            .ToListAsync(cancellationToken);
        var held = values.ToDictionary(item => (item.EmployeeId, item.FieldId), item => TagsOf(item.ValueJson));
        return candidates.Where(candidate => definitions.All(definition =>
                held.TryGetValue((candidate.EmployeeId, definition.Id), out var tags)
                && tags.Contains(wanted[definition.Key], StringComparer.OrdinalIgnoreCase)))
            .ToList();
    }

    internal static IReadOnlyList<string> TagsOf(string json)
    {
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(json);
            return document.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array
                ? document.RootElement.EnumerateArray()
                    .Where(item => item.ValueKind == System.Text.Json.JsonValueKind.String)
                    .Select(item => item.GetString()!)
                    .ToList()
                : [];
        }
        catch (System.Text.Json.JsonException)
        {
            return [];
        }
    }

    /// <summary>Asks Identity once for everyone listed; people without a work email can't be invited.</summary>
    private async Task<List<Candidate>> WithSignInAsync(List<Candidate> candidates, CancellationToken cancellationToken)
    {
        if (accountStatuses is null || candidates.Count == 0) return candidates;
        IReadOnlyDictionary<Guid, WorkforceAccountStatusDto> statuses;
        try
        {
            statuses = await accountStatuses.GetStatusesAsync(
                candidates.Where(item => !string.IsNullOrWhiteSpace(item.Row.WorkEmail))
                    .Select(item => new WorkforceAccountSubjectDto(item.EmployeeId, item.Row.WorkEmail!, item.Row.FirstName, item.Row.LastName))
                    .ToList(),
                cancellationToken);
        }
        catch (HttpRequestException)
        {
            // Identity unreachable: the list still answers, without sign-in.
            return candidates;
        }
        return candidates.Select(item => item with
        {
            Row = item.Row with
            {
                SignIn = string.IsNullOrWhiteSpace(item.Row.WorkEmail)
                    ? new PeopleSignInDto(PeopleSignInState.NoEmail, null)
                    : SignInOf(statuses.GetValueOrDefault(item.EmployeeId)),
            },
        }).ToList();
    }

    internal static PeopleSignInDto SignInOf(WorkforceAccountStatusDto? account) => account?.ProvisioningState switch
    {
        "Active" or "InviteAccepted" => new PeopleSignInDto(PeopleSignInState.SignsIn, account.LastLoginAt, account.SignInMethods ?? []),
        "InvitePending" => new PeopleSignInDto(PeopleSignInState.Invited, account.InviteCreatedAt),
        "InviteExpired" => new PeopleSignInDto(PeopleSignInState.Expired, account.InviteExpiresAt),
        "Inactive" => new PeopleSignInDto(PeopleSignInState.Suspended, null),
        _ => new PeopleSignInDto(PeopleSignInState.NotInvited, null),
    };

    private async Task<Result<PeoplePageDto>> HandlePortableAsync(PeopleQuery request, CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, MaxPageSize);
        var cohortKeys = await ResolveImportCohortAsync(request.ImportBatchId, cancellationToken);
        var baseQuery = dbContext.Employees.AsNoTracking();
        if (cohortKeys is not null)
            baseQuery = baseQuery.Where(employee => cohortKeys.Contains(employee.StableEmployeeKey));
        var employees = await baseQuery
            .OrderBy(employee => employee.LastName)
            .ThenBy(employee => employee.FirstName)
            .ThenBy(employee => employee.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);
        var total = await baseQuery.CountAsync(cancellationToken);
        var rows = employees.Select(employee => new PeopleRowDto(
            employee.StableEmployeeKey,
            employee.EmployeeNumber,
            employee.DisplayName,
            employee.FirstName,
            employee.LastName,
            employee.Email,
            PeopleEmploymentState.Incomplete,
            null,
            null,
            null,
            null,
            "WorkDetailsUnavailable",
            EmployeePhotos.UrlFor(employee.StableEmployeeKey, employee.PhotoKey))).ToList();
        return Result.Success(new PeoplePageDto(rows, total, page, pageSize, total == 0 ? 0 : (int)Math.Ceiling(total / (double)pageSize)));
    }

    private static string BuildOrderBy(PeopleSortField sort, PeopleSortDirection direction)
    {
        var dir = direction == PeopleSortDirection.Desc ? "DESC" : "ASC";
        return sort switch
        {
            PeopleSortField.EmployeeNumber => $"f.\"EmployeeNumber\" {dir}, f.\"EmployeeId\" ASC",
            PeopleSortField.EmploymentDate => $"f.\"EmploymentStart\" {dir} NULLS LAST, f.\"EmployeeId\" ASC",
            // Roster shows "First Last", so "Name A–Z" must sort by the visible display name.
            _ => $"lower(f.\"DisplayName\") {dir}, f.\"EmployeeId\" ASC"
        };
    }

    /// <summary>
    /// Resolve the transient imported-cohort filter to the Employee Keys that import established,
    /// read from canonical CoreHR (the Employment rows stamped with the import batch), never from the
    /// import attempt. Tenant-scoped and non-disclosing: an unknown or cross-tenant batch yields an
    /// empty cohort rather than the full roster.
    /// </summary>
    private async Task<string[]?> ResolveImportCohortAsync(Guid? importBatchId, CancellationToken cancellationToken)
    {
        if (importBatchId is not { } batchId) return null;
        return await dbContext.Employments.AsNoTracking()
            .Where(employment => employment.ImportBatchId == batchId)
            .Join(dbContext.Employees.AsNoTracking(), employment => employment.EmployeeId, employee => employee.Id, (_, employee) => employee.StableEmployeeKey)
            .Distinct()
            .ToArrayAsync(cancellationToken);
    }

    private static string BuildSql(string orderBy) => $$"""
        WITH RECURSIVE ranked_employment AS (
            SELECT em.*,
                ROW_NUMBER() OVER (
                    PARTITION BY em."EmployeeId"
                    ORDER BY
                        CASE
                            WHEN em."EffectiveFrom" <= @today AND (em."EffectiveTo" IS NULL OR @today < em."EffectiveTo") THEN 0
                            WHEN em."EffectiveFrom" > @today THEN 1
                            ELSE 2
                        END,
                        CASE WHEN em."EffectiveFrom" > @today THEN em."EffectiveFrom" END ASC NULLS LAST,
                        CASE WHEN em."EffectiveFrom" <= @today AND em."EffectiveTo" IS NOT NULL THEN em."EffectiveTo" END DESC NULLS LAST,
                        em."EffectiveFrom" DESC,
                        em."Id" ASC) AS rn
            FROM "corehr"."Employments" em
            WHERE em."TenantId" = @tenantId
        ),
        facts AS (
            SELECT e."Id" AS "EmployeeId", e."StableEmployeeKey" AS "EmployeeKey",
                e."EmployeeNumber", e."FirstName", e."LastName", e."Email" AS "WorkEmail", e."PhotoKey",
                COALESCE(NULLIF(e."PreferredName", ''), e."FirstName") || ' ' || e."LastName" AS "DisplayName",
                re."Id" AS "EmploymentId", re."EffectiveFrom" AS "EmploymentStart", re."EffectiveTo" AS "EmploymentEnd",
                CASE
                    WHEN re."Id" IS NULL THEN 'Incomplete'
                    WHEN re."EffectiveFrom" <= @today AND (re."EffectiveTo" IS NULL OR @today < re."EffectiveTo") THEN 'Active'
                    WHEN re."EffectiveFrom" > @today THEN 'Scheduled'
                    ELSE 'Former'
                END AS "EmploymentState",
                CASE
                    WHEN re."Id" IS NULL THEN @today
                    WHEN re."EffectiveFrom" <= @today AND (re."EffectiveTo" IS NULL OR @today < re."EffectiveTo") THEN @today
                    WHEN re."EffectiveFrom" > @today THEN re."EffectiveFrom"
                    ELSE GREATEST(re."EffectiveFrom", re."EffectiveTo" - INTERVAL '1 microsecond')
                END AS "DisplayAt"
            FROM "corehr"."Employees" e
            LEFT JOIN ranked_employment re ON re."EmployeeId" = e."Id" AND re.rn = 1
            WHERE e."TenantId" = @tenantId
        ),
        work_facts AS (
            SELECT f.*, wa."Id" AS "WorkAssignmentId", wa."OrgUnitId", wa."JobTitle", wa."WorkLocation",
                wa."JobId", wa."PlaceId",
                wa."EffectiveFrom" AS "WorkEffectiveFrom", ous."Name" AS "OrganizationName", ous."ParentOrgUnitId"
            FROM facts f
            LEFT JOIN LATERAL (
                SELECT w.* FROM "corehr"."WorkAssignments" w
                WHERE w."TenantId" = @tenantId AND w."EmployeeId" = f."EmployeeId"
                    AND w."EmploymentId" = f."EmploymentId" AND w."IsPrimary" = TRUE
                    AND w."EffectiveFrom" <= f."DisplayAt"
                    AND (w."EffectiveTo" IS NULL OR f."DisplayAt" < w."EffectiveTo")
                ORDER BY w."EffectiveFrom" DESC, w."Id" ASC LIMIT 1
            ) wa ON TRUE
            LEFT JOIN LATERAL (
                SELECT s."Name", s."ParentOrgUnitId" FROM "corehr"."OrgUnitEffectiveStates" s
                WHERE s."TenantId" = @tenantId AND s."OrgUnitId" = wa."OrgUnitId"
                    AND s."EffectiveFrom" <= f."DisplayAt"::date
                    AND (s."EffectiveTo" IS NULL OR f."DisplayAt"::date < s."EffectiveTo")
                ORDER BY s."EffectiveFrom" DESC LIMIT 1
            ) ous ON TRUE
        ),
        org_paths AS (
            SELECT wf."EmployeeId", wf."OrgUnitId" AS "CurrentOrgUnitId", wf."ParentOrgUnitId",
                wf."OrganizationName"::text AS "OrganizationPath", 0 AS depth
            FROM work_facts wf WHERE wf."OrgUnitId" IS NOT NULL AND wf."OrganizationName" IS NOT NULL
            UNION ALL
            SELECT op."EmployeeId", parent."OrgUnitId", parent."ParentOrgUnitId",
                parent."Name" || ' / ' || op."OrganizationPath", op.depth + 1
            FROM org_paths op
            JOIN work_facts wf ON wf."EmployeeId" = op."EmployeeId"
            JOIN "corehr"."OrgUnitEffectiveStates" parent ON parent."TenantId" = @tenantId
                AND parent."OrgUnitId" = op."ParentOrgUnitId"
                AND parent."EffectiveFrom" <= wf."DisplayAt"::date
                AND (parent."EffectiveTo" IS NULL OR wf."DisplayAt"::date < parent."EffectiveTo")
            WHERE op.depth < 100
        ),
        enriched AS (
            SELECT wf.*, path."OrganizationPath",
                me."StableEmployeeKey" AS "ManagerEmployeeKey",
                COALESCE(NULLIF(me."PreferredName", ''), me."FirstName") || ' ' || me."LastName" AS "ManagerDisplayName",
                me."EmployeeNumber" AS "ManagerEmployeeNumber", me."PhotoKey" AS "ManagerPhotoKey"
            FROM work_facts wf
            LEFT JOIN LATERAL (
                SELECT op."OrganizationPath" FROM org_paths op
                WHERE op."EmployeeId" = wf."EmployeeId" ORDER BY op.depth DESC LIMIT 1
            ) path ON TRUE
            LEFT JOIN LATERAL (
                SELECT mr."ManagerEmployeeId" FROM "corehr"."ManagerRelationships" mr
                WHERE mr."TenantId" = @tenantId AND mr."SubjectEmployeeId" = wf."EmployeeId"
                    AND mr."Type" = 'PrimaryManager'
                    AND mr."EffectiveFrom" <= wf."DisplayAt"
                    AND (mr."EffectiveTo" IS NULL OR wf."DisplayAt" < mr."EffectiveTo")
                ORDER BY mr."EffectiveFrom" DESC, mr."Id" ASC LIMIT 1
            ) manager ON TRUE
            LEFT JOIN "corehr"."Employees" me ON me."TenantId" = @tenantId AND me."Id" = manager."ManagerEmployeeId"
        ),
        filtered AS (
            SELECT f.* FROM enriched f
            WHERE (@q IS NULL OR lower(f."DisplayName") LIKE '%' || @q || '%'
                    OR lower(f."EmployeeNumber") LIKE '%' || @q || '%'
                    OR lower(COALESCE(f."WorkEmail", '')) LIKE '%' || @q || '%')
                AND (@state IS NULL OR f."EmploymentState" = @state)
                AND (@orgUnitId IS NULL
                    OR (@orgScope = 'Direct' AND f."OrgUnitId" = @orgUnitId)
                    OR (@orgScope = 'Subtree' AND EXISTS (
                        SELECT 1 FROM org_paths op
                        WHERE op."EmployeeId" = f."EmployeeId" AND op."CurrentOrgUnitId" = @orgUnitId)))
                AND (@cohortKeys IS NULL OR f."EmployeeKey" = ANY(@cohortKeys))
                AND (@jobId IS NULL OR f."JobId" = @jobId)
                AND (@placeId IS NULL OR f."PlaceId" = @placeId)
                AND (@managerKey IS NULL OR f."ManagerEmployeeKey" = @managerKey)
        )
        SELECT f.* FROM filtered f
        ORDER BY {{orderBy}}
        """;

    private static void AddParameter(DbCommand command, string name, object value, DbType? dbType = null)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        if (dbType.HasValue)
            parameter.DbType = dbType.Value;
        command.Parameters.Add(parameter);
    }

    private static string? GetNullableString(DbDataReader reader, string name)
    {
        var ordinal = reader.GetOrdinal(name);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static Guid? GetNullableGuid(DbDataReader reader, string name)
    {
        var ordinal = reader.GetOrdinal(name);
        return reader.IsDBNull(ordinal) ? null : reader.GetGuid(ordinal);
    }

    private static DateTime? GetNullableDateTime(DbDataReader reader, string name)
    {
        var ordinal = reader.GetOrdinal(name);
        return reader.IsDBNull(ordinal) ? null : reader.GetDateTime(ordinal);
    }
}
