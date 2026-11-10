using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EY.HRPlatform.CoreHR.Features.Organization;

public sealed class OrganizationService(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext) : IOrganizationService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private Guid TenantId => tenantContext.TenantId;
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    public async Task<OrganizationHierarchyDto> GetHierarchyAsync(DateOnly asOf, CancellationToken cancellationToken)
    {
        var states = await GetActiveStatesAsync(asOf, cancellationToken);
        await ValidateHierarchyAsync(asOf, states, cancellationToken);
        var roots = states.Where(state => state.ParentOrgUnitId is null).OrderBy(state => state.Name).ToList();
        var byParent = states.Where(state => state.ParentOrgUnitId is not null)
            .GroupBy(state => state.ParentOrgUnitId!.Value)
            .ToDictionary(group => group.Key, group => group.OrderBy(state => state.Name).ToList());
        var context = new Dictionary<Guid, OrganizationUnitStateDto>();
        OrganizationHierarchyNodeDto Build(OrgUnitEffectiveState state, IReadOnlyList<string> path)
        {
            var dto = ToDto(state, context, path);
            context[state.OrgUnitId] = dto;
            var children = byParent.TryGetValue(state.OrgUnitId, out var childStates)
                ? childStates.Select(child => Build(child, [.. path, state.Name])).ToList()
                : [];
            return new OrganizationHierarchyNodeDto(dto, children);
        }

        return new OrganizationHierarchyDto(asOf, roots.Select(root => Build(root, [])).ToList());
    }

    public async Task<OrganizationUnitStateDto> GetUnitAsync(Guid id, DateOnly asOf, CancellationToken cancellationToken)
    {
        var state = await ResolveStateAsync(id, asOf, cancellationToken)
            ?? throw new EntityNotFoundException("Organizational Unit", id);
        var resolved = await GetResolvedStatesAsync(asOf, cancellationToken);
        var byId = resolved.ToDictionary(item => item.OrgUnitId);
        var path = new Stack<string>();
        var cursor = state;
        while (cursor.ParentOrgUnitId is Guid parentId && byId.TryGetValue(parentId, out var parent))
        {
            path.Push(parent.Name);
            cursor = parent;
        }
        var context = resolved.ToDictionary(item => item.OrgUnitId, item => new OrganizationUnitStateDto(
            item.OrgUnitId, item.OrgUnit.Code, item.Name, item.OrganizationalUnitTypeId,
            item.OrganizationalUnitType.DisplayName, item.ParentOrgUnitId, null, string.Empty,
            item.LifecycleState, item.EffectiveFrom, item.OrgUnit.Version));
        return ToDto(state, context, path.ToList());
    }

    public async Task<IReadOnlyList<OrganizationUnitStateDto>> SearchAsync(string query, DateOnly asOf, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(query))
            return [];

        var hierarchy = await GetHierarchyAsync(asOf, cancellationToken);
        return Flatten(hierarchy.Roots)
            .Select(node => node.Unit)
            .Where(unit => unit.Name.Contains(query.Trim(), StringComparison.OrdinalIgnoreCase)
                || unit.Code.Contains(query.Trim(), StringComparison.OrdinalIgnoreCase)
                || unit.TypeName.Contains(query.Trim(), StringComparison.OrdinalIgnoreCase))
            .OrderBy(unit => unit.Name)
            .ToList();
    }

    public async Task<IReadOnlyList<OrganizationChangeDto>> GetUpcomingChangesAsync(CancellationToken cancellationToken)
        => await BuildBusinessChangeDtosAsync(
            change => change.EffectiveDate > Today,
            ascending: true,
            cancellationToken: cancellationToken);

    public async Task<IReadOnlyList<OrganizationChangeDto>> GetHistoryAsync(Guid orgUnitId, CancellationToken cancellationToken)
    {
        if (!await dbContext.OrgUnits.AnyAsync(unit => unit.Id == orgUnitId, cancellationToken))
            throw new EntityNotFoundException("Organizational Unit", orgUnitId);
        return await BuildBusinessChangeDtosAsync(
            change => change.OrgUnitId == orgUnitId,
            ascending: false,
            cancellationToken: cancellationToken);
    }

    public async Task<OrganizationReadinessDto> GetReadinessAsync(CancellationToken cancellationToken)
    {
        var root = await dbContext.OrgUnits.SingleOrDefaultAsync(unit => unit.IsRoot, cancellationToken);
        var rootFirstEffectiveDate = root is null
            ? null
            : await dbContext.OrgUnitEffectiveStates
                .Where(state => state.OrgUnitId == root.Id)
                .MinAsync(state => (DateOnly?)state.EffectiveFrom, cancellationToken);
        var rootIsEffective = rootFirstEffectiveDate is not null && rootFirstEffectiveDate <= Today;
        try
        {
            var states = await GetActiveStatesAsync(Today, cancellationToken);
            await ValidateHierarchyAsync(Today, states, cancellationToken);
            var isReady = rootIsEffective && states.Count != 0;
            return new OrganizationReadinessDto(
                isReady,
                isReady ? null : root is null ? "The permanent root has not been created." : "The permanent root is not yet effective.",
                root is not null,
                root?.Id,
                rootFirstEffectiveDate,
                rootIsEffective);
        }
        catch (ArgumentException exception)
        {
            return new OrganizationReadinessDto(false, exception.Message, root is not null, root?.Id, rootFirstEffectiveDate, rootIsEffective);
        }
    }

    private async Task<IReadOnlyList<OrganizationChangeDto>> BuildBusinessChangeDtosAsync(
        Func<OrganizationChange, bool> include,
        bool ascending,
        CancellationToken cancellationToken)
    {
        var operations = await dbContext.OrganizationChanges
            .Where(change => !change.IsCancelled)
            .Include(change => change.OrgUnit)
            .OrderBy(change => change.EffectiveDate)
            .ThenBy(change => change.CreatedAt)
            .ThenBy(change => change.Id)
            .ToListAsync(cancellationToken);
        var states = await dbContext.OrgUnitEffectiveStates
            .Include(state => state.OrgUnit)
            .Include(state => state.OrganizationalUnitType)
            .ToListAsync(cancellationToken);
        var stateTimelines = states.GroupBy(state => state.OrgUnitId)
            .ToDictionary(group => group.Key, group => group.OrderBy(state => state.EffectiveFrom).ToList());
        var types = states.Select(state => state.OrganizationalUnitType)
            .GroupBy(type => type.Id).ToDictionary(group => group.Key, group => group.First());
        var result = new List<OrganizationChangeDto>();

        foreach (var unitOperations in operations.GroupBy(change => change.OrgUnitId))
        {
            StateAccumulator? state = null;
            foreach (var change in unitOperations)
            {
                var patch = JsonSerializer.Deserialize<OrganizationPatch>(change.PayloadJson, JsonOptions) ?? OrganizationPatch.Empty;
                var beforeState = state;
                state = change.Kind == OrganizationChangeKind.CodeCorrection ? state : ApplyPatch(state, patch, change.Kind);
                var eventKinds = GetBusinessEventKinds(change.Kind, patch);
                if (eventKinds.Count == 0 || !include(change))
                    continue;
                result.Add(new OrganizationChangeDto(
                    change.Id,
                    change.OrgUnitId,
                    state?.Name ?? change.OrgUnit.Name,
                    change.OrgUnit.Code,
                    change.EffectiveDate,
                    change.Kind,
                    change.Summary,
                    change.IsCancelled,
                    eventKinds,
                    ToEventContext(beforeState, change.EffectiveDate, stateTimelines, types),
                    ToEventContext(state, change.EffectiveDate, stateTimelines, types)));
            }
        }

        return ascending
            ? result.OrderBy(change => change.EffectiveDate).ThenBy(change => change.Id).ToList()
            : result.OrderByDescending(change => change.EffectiveDate).ThenByDescending(change => change.Id).ToList();
    }

    private static IReadOnlyList<OrganizationBusinessEventKind> GetBusinessEventKinds(OrganizationChangeKind operationKind, OrganizationPatch patch)
        => operationKind switch
        {
            OrganizationChangeKind.Create => [OrganizationBusinessEventKind.Created],
            OrganizationChangeKind.Move => [OrganizationBusinessEventKind.Moved],
            OrganizationChangeKind.Inactivate => [OrganizationBusinessEventKind.Inactivated],
            OrganizationChangeKind.Change => new[]
            {
                patch.NameChanged ? OrganizationBusinessEventKind.Renamed : (OrganizationBusinessEventKind?)null,
                patch.TypeIdChanged ? OrganizationBusinessEventKind.TypeChanged : null,
            }.Where(kind => kind is not null).Select(kind => kind!.Value).ToList(),
            _ => [],
        };

    private static OrganizationBusinessEventContextDto? ToEventContext(
        StateAccumulator? state,
        DateOnly effectiveDate,
        IReadOnlyDictionary<Guid, List<OrgUnitEffectiveState>> stateTimelines,
        IReadOnlyDictionary<Guid, OrganizationalUnitType> types)
    {
        if (state is null || !types.TryGetValue(state.TypeId, out var type))
            return null;
        OrganizationUnitReferenceDto? parent = null;
        if (state.ParentId is Guid parentId
            && stateTimelines.TryGetValue(parentId, out var parentTimeline))
        {
            var parentState = parentTimeline.LastOrDefault(item => item.EffectiveFrom <= effectiveDate
                && (item.EffectiveTo is null || effectiveDate < item.EffectiveTo));
            if (parentState is not null)
                parent = new OrganizationUnitReferenceDto(parentId, parentState.Name, parentState.OrgUnit.Code);
        }
        return new OrganizationBusinessEventContextDto(
            state.Name,
            new OrganizationTypeReferenceDto(type.Id, type.DisplayName),
            parent,
            state.LifecycleState);
    }

    public async Task<IReadOnlyList<OrganizationalUnitTypeDto>> GetTypesAsync(CancellationToken cancellationToken)
    {
        await EnsureBuiltInsAsync(cancellationToken);
        return await dbContext.OrganizationalUnitTypes
            .Where(type => type.IsBuiltIn || type.TenantId == TenantId)
            .OrderByDescending(type => type.IsBuiltIn)
            .ThenBy(type => type.DisplayName)
            .Select(type => new OrganizationalUnitTypeDto(type.Id, type.DisplayName, type.IsBuiltIn))
            .ToListAsync(cancellationToken);
    }

    public async Task<OrganizationUnitStateDto> CreateRootAsync(CreateOrganizationRootRequest request, CancellationToken cancellationToken)
    {
        await EnsureBuiltInsAsync(cancellationToken);
        await using var transaction = await BeginOrganizationWriteAsync(cancellationToken);
        if (await dbContext.OrgUnits.AnyAsync(unit => unit.IsRoot, cancellationToken))
            throw new DuplicateEntityException("Organization root");

        var normalizedCode = NormalizeCode(request.Code);
        await EnsureCodeAvailableAsync(normalizedCode, null, cancellationToken);
        var unit = OrgUnit.CreateCanonical(TenantId, normalizedCode, isRoot: true);
        var payload = OrganizationPatch.Create(request.Name, OrganizationalUnitTypeCatalog.OrganizationId, null, OrgUnitLifecycleState.Active);
        var change = NewChange(unit, request.EffectiveDate, OrganizationChangeKind.Create, null, "Organization created", payload);
        dbContext.OrgUnits.Add(unit);
        dbContext.OrganizationChanges.Add(change);
        dbContext.OrgUnitCodeReservations.Add(OrgUnitCodeReservation.Create(TenantId, unit.Id, normalizedCode));
        await RebuildStatesAsync(unit.Id, cancellationToken);
        await SaveAndValidateAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return await GetUnitAsync(unit.Id, request.EffectiveDate, cancellationToken);
    }

    public async Task<OrganizationUnitStateDto> CreateUnitAsync(CreateOrganizationUnitRequest request, CancellationToken cancellationToken)
    {
        await EnsureBuiltInsAsync(cancellationToken);
        await using var transaction = await BeginOrganizationWriteAsync(cancellationToken);
        var normalizedCode = NormalizeCode(request.Code);
        await EnsureCodeAvailableAsync(normalizedCode, null, cancellationToken);
        await EnsureTypeAvailableAsync(request.TypeId, cancellationToken);
        var parent = await ResolveStateAsync(request.ParentId, request.EffectiveDate, cancellationToken)
            ?? throw new ArgumentException("Parent must be active on the unit effective date.");
        if (parent.LifecycleState != OrgUnitLifecycleState.Active)
            throw new ArgumentException("Parent must be active on the unit effective date.");

        var unit = OrgUnit.CreateCanonical(TenantId, normalizedCode, isRoot: false);
        var payload = OrganizationPatch.Create(request.Name, request.TypeId, request.ParentId, OrgUnitLifecycleState.Active);
        dbContext.OrgUnits.Add(unit);
        dbContext.OrganizationChanges.Add(NewChange(unit, request.EffectiveDate, OrganizationChangeKind.Create, null, "Unit created", payload));
        dbContext.OrgUnitCodeReservations.Add(OrgUnitCodeReservation.Create(TenantId, unit.Id, normalizedCode));
        await RebuildStatesAsync(unit.Id, cancellationToken);
        await SaveAndValidateAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return await GetUnitAsync(unit.Id, request.EffectiveDate, cancellationToken);
    }

    public async Task<bool> OpenRootFromInCurrentTransactionAsync(DateOnly from, CancellationToken cancellationToken)
    {
        if (dbContext.Database.IsRelational() && dbContext.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Opening the root earlier requires the caller's write transaction.");
        var root = await dbContext.OrgUnits.SingleOrDefaultAsync(unit => unit.IsRoot, cancellationToken);
        if (root is null) return false;
        var changes = await dbContext.OrganizationChanges.Where(change => change.OrgUnitId == root.Id && !change.IsCancelled).ToListAsync(cancellationToken);
        if (changes is not [{ Kind: OrganizationChangeKind.Create } creation] || creation.EffectiveDate <= from) return false;
        creation.OpenFrom(from);
        await RebuildStatesAsync(root.Id, cancellationToken);
        await SaveAndValidateAsync(cancellationToken);
        return true;
    }

    public async Task<IReadOnlyList<OrganizationBatchCreatedNode>> CreateBatchInCurrentTransactionAsync(
        DateOnly effectiveDate,
        IReadOnlyList<OrganizationBatchCreateNode> nodes,
        CancellationToken cancellationToken)
    {
        if (dbContext.Database.IsRelational() && dbContext.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Canonical Organization batch creation requires the caller's write transaction.");
        await EnsureBuiltInsAsync(cancellationToken);
        var existingRoot = await dbContext.OrgUnits.AnyAsync(unit => unit.IsRoot, cancellationToken);
        if (existingRoot && nodes.Any(node => node.IsRoot))
            throw new DuplicateEntityException("Organization root");
        if (!existingRoot && nodes.Count > 0 && nodes.Count(node => node.IsRoot) != 1)
            throw new ArgumentException("A fresh Organization batch must create exactly one permanent root.");

        var pending = nodes.ToDictionary(node => node.ProposalNodeId, StringComparer.Ordinal);
        var created = new Dictionary<string, OrganizationBatchCreatedNode>(StringComparer.Ordinal);
        var stagedUnits = new List<OrgUnit>();
        while (pending.Count > 0)
        {
            var ready = pending.Values
                .Where(node => node.ParentProposalNodeId is null || created.ContainsKey(node.ParentProposalNodeId))
                .OrderByDescending(node => node.IsRoot)
                .ThenBy(node => node.ProposalNodeId, StringComparer.Ordinal)
                .ToList();
            if (ready.Count == 0) throw new ArgumentException("The Organization create plan contains a parent cycle.");
            foreach (var node in ready)
            {
                var normalizedCode = NormalizeCode(node.Code);
                await EnsureCodeAvailableAsync(normalizedCode, null, cancellationToken);
                if (created.Values.Any(item => item.Code.Equals(normalizedCode, StringComparison.Ordinal)))
                    throw new DuplicateEntityException("Organizational Unit code");
                await EnsureTypeAvailableAsync(node.TypeId, cancellationToken);
                var parentId = node.ParentProposalNodeId is not null
                    ? created[node.ParentProposalNodeId].OrgUnitId
                    : node.ParentCanonicalId;
                if (!node.IsRoot)
                {
                    if (parentId is null) throw new ArgumentException("A non-root Organizational Unit requires a parent.");
                    if (node.ParentProposalNodeId is null)
                    {
                        var parent = await ResolveStateAsync(parentId.Value, effectiveDate, cancellationToken)
                            ?? throw new ArgumentException("Parent must be active on the unit effective date.");
                        if (parent.LifecycleState != OrgUnitLifecycleState.Active)
                            throw new ArgumentException("Parent must be active on the unit effective date.");
                    }
                }
                var unit = OrgUnit.CreateCanonical(TenantId, normalizedCode, node.IsRoot);
                var payload = OrganizationPatch.Create(node.Name, node.TypeId, parentId, OrgUnitLifecycleState.Active);
                dbContext.OrgUnits.Add(unit);
                dbContext.OrganizationChanges.Add(NewChange(unit, effectiveDate, OrganizationChangeKind.Create, null, "Unit created by Organization import", payload));
                dbContext.OrgUnitCodeReservations.Add(OrgUnitCodeReservation.Create(TenantId, unit.Id, normalizedCode));
                created.Add(node.ProposalNodeId, new(node.ProposalNodeId, unit.Id, normalizedCode, node.Name.Trim()));
                stagedUnits.Add(unit);
                pending.Remove(node.ProposalNodeId);
            }
        }
        foreach (var unit in stagedUnits)
            await RebuildStatesAsync(unit.Id, cancellationToken);
        await SaveAndValidateAsync(cancellationToken);
        return nodes.Select(node => created[node.ProposalNodeId]).ToList();
    }

    public Task<OrganizationUnitStateDto> ChangeAsync(Guid id, uint expectedVersion, ChangeOrganizationUnitRequest request, CancellationToken cancellationToken)
        => MutateAsync(id, expectedVersion, request.EffectiveDate, OrganizationChangeKind.Change, request.Reason, "Details changed",
            new OrganizationPatch(request.Name is not null, request.Name, request.TypeId.HasValue, request.TypeId, false, null, false, null), cancellationToken);

    public Task<OrganizationUnitStateDto> MoveAsync(Guid id, uint expectedVersion, MoveOrganizationUnitRequest request, CancellationToken cancellationToken)
        => MutateAsync(id, expectedVersion, request.EffectiveDate, OrganizationChangeKind.Move, request.Reason, "Unit moved",
            new OrganizationPatch(false, null, false, null, true, request.TargetParentId, false, null), cancellationToken);

    public Task<OrganizationUnitStateDto> InactivateAsync(Guid id, uint expectedVersion, InactivateOrganizationUnitRequest request, CancellationToken cancellationToken)
        => MutateAsync(id, expectedVersion, request.EffectiveDate, OrganizationChangeKind.Inactivate, request.Reason, "Unit inactivated",
            new OrganizationPatch(false, null, false, null, false, null, true, OrgUnitLifecycleState.Inactive), cancellationToken);

    public Task<OrganizationUnitStateDto> CorrectAsync(Guid id, uint expectedVersion, CorrectOrganizationUnitRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Reason))
            throw new ArgumentException("A correction reason is required.", nameof(request));
        if (request.EffectiveDate > Today)
            throw new ArgumentException("A Correction applies to current or historical Organization truth, not a future planned change.", nameof(request));
        return MutateAsync(id, expectedVersion, request.EffectiveDate, OrganizationChangeKind.Correction, request.Reason, "Record corrected",
            new OrganizationPatch(request.Name is not null, request.Name, request.TypeId.HasValue, request.TypeId,
                request.ParentId.HasValue, request.ParentId, request.LifecycleState.HasValue, request.LifecycleState), cancellationToken);
    }

    public async Task<OrganizationUnitStateDto> CorrectCodeAsync(Guid id, uint expectedVersion, CorrectOrganizationCodeRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Reason))
            throw new ArgumentException("A correction reason is required.", nameof(request));
        await using var transaction = await BeginOrganizationWriteAsync(cancellationToken);
        var unit = await GetUnitForMutationAsync(id, expectedVersion, cancellationToken);
        var code = NormalizeCode(request.Code);
        await EnsureCodeAvailableAsync(code, id, cancellationToken);
        unit.CorrectCode(code);
        if (!await dbContext.OrgUnitCodeReservations.AnyAsync(reservation => reservation.NormalizedCode == code && reservation.OrgUnitId == id, cancellationToken))
            dbContext.OrgUnitCodeReservations.Add(OrgUnitCodeReservation.Create(TenantId, id, code));
        dbContext.OrganizationChanges.Add(NewChange(unit, Today, OrganizationChangeKind.CodeCorrection, request.Reason, "Business code corrected", OrganizationPatch.Empty));
        unit.Touch();
        await SaveAndValidateAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return await GetUnitAsync(id, Today, cancellationToken);
    }

    public async Task CancelChangeAsync(Guid changeId, uint expectedVersion, CancellationToken cancellationToken)
    {
        await using var transaction = await BeginOrganizationWriteAsync(cancellationToken);
        var change = await dbContext.OrganizationChanges.Include(item => item.OrgUnit)
            .FirstOrDefaultAsync(item => item.Id == changeId, cancellationToken)
            ?? throw new EntityNotFoundException("Organization change", changeId);
        if (change.EffectiveDate <= Today || change.Kind == OrganizationChangeKind.CodeCorrection || change.OrgUnit.IsRoot)
            throw new ArgumentException("Only a cancellable never-effective non-root scheduled operation can be cancelled.");
        if (change.OrgUnit.Version != expectedVersion)
            throw new ConcurrencyException("Organizational Unit", change.OrgUnitId);
        if (change.Kind == OrganizationChangeKind.Create)
        {
            if (await dbContext.OrgUnitEffectiveStates.AnyAsync(state => state.OrgUnitId == change.OrgUnitId && state.EffectiveFrom <= Today, cancellationToken))
                throw new ArgumentException("An Organizational Unit that has become effective cannot be cancelled.");
            dbContext.OrgUnits.Remove(change.OrgUnit);
        }
        else
        {
            change.Cancel();
            change.OrgUnit.Touch();
            await RebuildStatesAsync(change.OrgUnitId, cancellationToken);
        }
        await SaveAndValidateAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
    }

    public async Task<OrganizationalUnitTypeDto> CreateTypeAsync(CreateOrganizationalUnitTypeRequest request, CancellationToken cancellationToken)
    {
        await EnsureBuiltInsAsync(cancellationToken);
        var normalized = NormalizeTypeName(request.Name);
        if (await dbContext.OrganizationalUnitTypes.AnyAsync(type => type.NormalizedName == normalized && (type.IsBuiltIn || type.TenantId == TenantId), cancellationToken))
            throw new DuplicateEntityException("Organizational Unit Type", "name", request.Name);
        var type = OrganizationalUnitType.CreateCustom(TenantId, request.Name);
        dbContext.OrganizationalUnitTypes.Add(type);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new OrganizationalUnitTypeDto(type.Id, type.DisplayName, false);
    }

    public async Task<OrganizationalUnitTypeDto> RenameTypeAsync(Guid id, RenameOrganizationalUnitTypeRequest request, CancellationToken cancellationToken)
    {
        var type = await dbContext.OrganizationalUnitTypes.FirstOrDefaultAsync(item => item.Id == id && item.TenantId == TenantId, cancellationToken)
            ?? throw new EntityNotFoundException("Organizational Unit Type", id);
        var normalized = NormalizeTypeName(request.Name);
        if (await dbContext.OrganizationalUnitTypes.AnyAsync(item => item.Id != id && item.NormalizedName == normalized && (item.IsBuiltIn || item.TenantId == TenantId), cancellationToken))
            throw new DuplicateEntityException("Organizational Unit Type", "name", request.Name);
        type.Rename(request.Name);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new OrganizationalUnitTypeDto(type.Id, type.DisplayName, false);
    }

    public async Task DeleteTypeAsync(Guid id, CancellationToken cancellationToken)
    {
        var type = await dbContext.OrganizationalUnitTypes.FirstOrDefaultAsync(item => item.Id == id && item.TenantId == TenantId, cancellationToken)
            ?? throw new EntityNotFoundException("Organizational Unit Type", id);
        if (await dbContext.OrgUnitEffectiveStates.AnyAsync(state => state.OrganizationalUnitTypeId == id, cancellationToken))
            throw new ArgumentException("A type used by Organization history cannot be deleted.");
        dbContext.OrganizationalUnitTypes.Remove(type);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task<OrganizationUnitStateDto> MutateAsync(Guid id, uint expectedVersion, DateOnly effectiveDate, OrganizationChangeKind kind, string? reason, string summary, OrganizationPatch patch, CancellationToken cancellationToken)
    {
        await using var transaction = await BeginOrganizationWriteAsync(cancellationToken);
        var unit = await GetUnitForMutationAsync(id, expectedVersion, cancellationToken);
        if (kind is OrganizationChangeKind.Change or OrganizationChangeKind.Correction
            && await ResolveStateAsync(id, effectiveDate, cancellationToken) is { } current)
            patch = patch with
            {
                NameChanged = patch.NameChanged && patch.Name != current.Name,
                TypeIdChanged = patch.TypeIdChanged && patch.TypeId != current.OrganizationalUnitTypeId,
                ParentIdChanged = patch.ParentIdChanged && patch.ParentId != current.ParentOrgUnitId,
                LifecycleStateChanged = patch.LifecycleStateChanged && patch.LifecycleState != current.LifecycleState,
            };
        if (unit.IsRoot && (kind == OrganizationChangeKind.Move || kind == OrganizationChangeKind.Inactivate || patch.TypeIdChanged || patch.ParentIdChanged))
            throw new ArgumentException("The permanent root cannot be moved, retyped, or inactivated.");
        if (kind == OrganizationChangeKind.Move && patch.ParentId is not Guid parentId)
            throw new ArgumentException("Move requires a target parent.");
        if (patch.TypeIdChanged)
            await EnsureTypeAvailableAsync(patch.TypeId!.Value, cancellationToken);
        if (patch.ParentIdChanged && patch.ParentId is Guid parent)
        {
            if (parent == id)
                throw new ArgumentException("A unit cannot be its own parent.");
            var parentState = await ResolveStateAsync(parent, effectiveDate, cancellationToken);
            if (parentState is null || parentState.LifecycleState != OrgUnitLifecycleState.Active)
                throw new ArgumentException("Target parent must be active on the effective date.");
        }

        dbContext.OrganizationChanges.Add(NewChange(unit, effectiveDate, kind, reason, summary, patch));
        unit.Touch();
        await RebuildStatesAsync(id, cancellationToken);
        await SaveAndValidateAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return await GetUnitAsync(id, effectiveDate, cancellationToken);
    }

    private async Task RebuildStatesAsync(Guid orgUnitId, CancellationToken cancellationToken)
    {
        var persistedOperations = await dbContext.OrganizationChanges
            .Where(change => change.OrgUnitId == orgUnitId)
            .ToListAsync(cancellationToken);
        var pendingOperations = dbContext.ChangeTracker.Entries<OrganizationChange>()
            .Where(entry => entry.State == EntityState.Added && entry.Entity.OrgUnitId == orgUnitId)
            .Select(entry => entry.Entity);
        var operations = persistedOperations.Concat(pendingOperations)
            .DistinctBy(change => change.Id)
            .Where(change => !change.IsCancelled && change.Kind != OrganizationChangeKind.CodeCorrection)
            .OrderBy(change => change.EffectiveDate).ThenBy(change => change.CreatedAt).ThenBy(change => change.Id)
            .ToList();
        var existing = await dbContext.OrgUnitEffectiveStates.Where(state => state.OrgUnitId == orgUnitId).ToListAsync(cancellationToken);
        dbContext.OrgUnitEffectiveStates.RemoveRange(existing);
        var pendingStates = dbContext.ChangeTracker.Entries<OrgUnitEffectiveState>()
            .Where(entry => entry.State == EntityState.Added && entry.Entity.OrgUnitId == orgUnitId)
            .Select(entry => entry.Entity)
            .ToList();
        if (pendingStates.Count != 0)
            dbContext.OrgUnitEffectiveStates.RemoveRange(pendingStates);

        StateAccumulator? accumulator = null;
        var snapshots = new List<(DateOnly Date, StateAccumulator State)>();
        foreach (var dateGroup in operations.GroupBy(operation => operation.EffectiveDate))
        {
            foreach (var operation in dateGroup)
            {
                var patch = JsonSerializer.Deserialize<OrganizationPatch>(operation.PayloadJson, JsonOptions) ?? OrganizationPatch.Empty;
                accumulator = ApplyPatch(accumulator, patch, operation.Kind);
            }
            if (accumulator is not null)
                snapshots.Add((dateGroup.Key, accumulator));
        }

        if (snapshots.Zip(snapshots.Skip(1), (left, right) =>
                left.State.LifecycleState == OrgUnitLifecycleState.Inactive
                && right.State.LifecycleState == OrgUnitLifecycleState.Active).Any(value => value))
            throw new ArgumentException("Organizational Unit inactivation is terminal and cannot be followed by reactivation.");

        for (var index = 0; index < snapshots.Count; index++)
        {
            var next = index + 1 < snapshots.Count ? snapshots[index + 1].Date : (DateOnly?)null;
            var snapshot = snapshots[index];
            dbContext.OrgUnitEffectiveStates.Add(OrgUnitEffectiveState.Create(
                TenantId, orgUnitId, snapshot.State.TypeId, snapshot.State.ParentId, snapshot.State.Name,
                snapshot.State.LifecycleState, snapshot.Date, next));
        }

        var current = snapshots.LastOrDefault(snapshot => snapshot.Date <= Today).State;
        if (current is not null)
        {
            var typeName = await dbContext.OrganizationalUnitTypes
                .Where(type => type.Id == current.TypeId)
                .Select(type => type.DisplayName)
                .SingleAsync(cancellationToken);
            var unit = dbContext.OrgUnits.Local.FirstOrDefault(item => item.Id == orgUnitId)
                ?? await dbContext.OrgUnits.SingleAsync(item => item.Id == orgUnitId, cancellationToken);
            unit.SynchronizeCurrentProjection(current.Name, typeName, current.ParentId,
                current.LifecycleState == OrgUnitLifecycleState.Active);
        }
    }

    private static StateAccumulator ApplyPatch(StateAccumulator? current, OrganizationPatch patch, OrganizationChangeKind kind)
    {
        if (kind == OrganizationChangeKind.Create)
        {
            if (!patch.NameChanged || !patch.TypeIdChanged || !patch.LifecycleStateChanged)
                throw new ArgumentException("Create operation must provide a complete Organization state.");
            return new StateAccumulator(patch.Name!, patch.TypeId!.Value, patch.ParentId, patch.LifecycleState!.Value);
        }
        if (current is null)
            throw new ArgumentException("Organization operation has no created unit state to modify.");
        if (current.LifecycleState == OrgUnitLifecycleState.Inactive
            && patch.LifecycleStateChanged
            && patch.LifecycleState == OrgUnitLifecycleState.Active)
            throw new ArgumentException("Organizational Unit inactivation is terminal and cannot be followed by reactivation.");
        return current with
        {
            Name = patch.NameChanged ? patch.Name! : current.Name,
            TypeId = patch.TypeIdChanged ? patch.TypeId!.Value : current.TypeId,
            ParentId = patch.ParentIdChanged ? patch.ParentId : current.ParentId,
            LifecycleState = patch.LifecycleStateChanged ? patch.LifecycleState!.Value : current.LifecycleState,
        };
    }

    private async Task SaveAndValidateAsync(CancellationToken cancellationToken)
    {
        await dbContext.SaveChangesAsync(cancellationToken);
        var boundaries = await dbContext.OrgUnitEffectiveStates.Select(state => state.EffectiveFrom).Distinct().ToListAsync(cancellationToken);
        foreach (var boundary in boundaries)
            await ValidateHierarchyAsync(boundary, await GetActiveStatesAsync(boundary, cancellationToken), cancellationToken);
    }

    private async Task<IDbContextTransaction?> BeginOrganizationWriteAsync(CancellationToken cancellationToken)
        => await OrganizationWriteTransaction.BeginAsync(dbContext, TenantId, cancellationToken);

    private async Task ValidateHierarchyAsync(DateOnly asOf, IReadOnlyList<OrgUnitEffectiveState> states, CancellationToken cancellationToken)
    {
        var units = await dbContext.OrgUnits.ToDictionaryAsync(unit => unit.Id, cancellationToken);
        if (states.Count == 0)
        {
            var root = units.Values.SingleOrDefault(unit => unit.IsRoot);
            if (root is null)
                return;
            var rootFirst = await dbContext.OrgUnitEffectiveStates.Where(state => state.OrgUnitId == root.Id).MinAsync(state => (DateOnly?)state.EffectiveFrom, cancellationToken);
            if (rootFirst is null || asOf < rootFirst.Value)
                return;
            throw new ArgumentException("The effective Organization hierarchy is missing its permanent root.");
        }

        var statesByUnit = states.ToDictionary(state => state.OrgUnitId);
        var roots = states.Where(state => units.TryGetValue(state.OrgUnitId, out var unit) && unit.IsRoot).ToList();
        if (roots.Count != 1 || roots[0].ParentOrgUnitId is not null || roots[0].LifecycleState != OrgUnitLifecycleState.Active)
            throw new ArgumentException("The effective Organization hierarchy must have exactly one active permanent root.");
        foreach (var state in states)
        {
            if (state.LifecycleState != OrgUnitLifecycleState.Active)
                continue;
            if (state.OrgUnitId == roots[0].OrgUnitId)
                continue;
            if (state.ParentOrgUnitId is not Guid parentId || !statesByUnit.TryGetValue(parentId, out var parent) || parent.LifecycleState != OrgUnitLifecycleState.Active)
                throw new ArgumentException("Every active non-root unit must have one active same-tenant parent.");
            var visited = new HashSet<Guid> { state.OrgUnitId };
            var cursor = state;
            while (cursor.ParentOrgUnitId is Guid cursorParent)
            {
                if (!visited.Add(cursorParent) || !statesByUnit.TryGetValue(cursorParent, out cursor!))
                    throw new ArgumentException("The effective Organization hierarchy contains a cycle or orphan.");
            }
            if (cursor.OrgUnitId != roots[0].OrgUnitId)
                throw new ArgumentException("Every active unit must be reachable from the permanent root.");
        }
    }

    private async Task<List<OrgUnitEffectiveState>> GetActiveStatesAsync(DateOnly asOf, CancellationToken cancellationToken)
        => (await GetResolvedStatesAsync(asOf, cancellationToken))
            .Where(state => state.LifecycleState == OrgUnitLifecycleState.Active)
            .ToList();

    private async Task<List<OrgUnitEffectiveState>> GetResolvedStatesAsync(DateOnly asOf, CancellationToken cancellationToken)
        => await dbContext.OrgUnitEffectiveStates
            .Include(state => state.OrgUnit)
            .Include(state => state.OrganizationalUnitType)
            .Where(state => state.EffectiveFrom <= asOf && (state.EffectiveTo == null || asOf < state.EffectiveTo))
            .ToListAsync(cancellationToken);

    private async Task<OrgUnitEffectiveState?> ResolveStateAsync(Guid unitId, DateOnly asOf, CancellationToken cancellationToken)
        => await dbContext.OrgUnitEffectiveStates
            .Include(state => state.OrgUnit)
            .Include(state => state.OrganizationalUnitType)
            .FirstOrDefaultAsync(state => state.OrgUnitId == unitId && state.EffectiveFrom <= asOf && (state.EffectiveTo == null || asOf < state.EffectiveTo), cancellationToken);

    private async Task<OrgUnit> GetUnitForMutationAsync(Guid id, uint expectedVersion, CancellationToken cancellationToken)
    {
        var unit = await dbContext.OrgUnits.FirstOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new EntityNotFoundException("Organizational Unit", id);
        if (unit.Version != expectedVersion)
            throw new ConcurrencyException("Organizational Unit", id);
        return unit;
    }

    private async Task EnsureBuiltInsAsync(CancellationToken cancellationToken)
    {
        var existing = await dbContext.OrganizationalUnitTypes.Where(type => type.IsBuiltIn).Select(type => type.Id).ToListAsync(cancellationToken);
        var added = false;
        foreach (var builtIn in OrganizationalUnitTypeCatalog.BuiltIns.Where(item => !existing.Contains(item.Id)))
        {
            dbContext.OrganizationalUnitTypes.Add(OrganizationalUnitType.CreateBuiltIn(builtIn.Id, builtIn.Name));
            added = true;
        }
        if (added)
            await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureTypeAvailableAsync(Guid typeId, CancellationToken cancellationToken)
    {
        if (!await dbContext.OrganizationalUnitTypes.AnyAsync(type => type.Id == typeId && (type.IsBuiltIn || type.TenantId == TenantId), cancellationToken))
            throw new EntityNotFoundException("Organizational Unit Type", typeId);
    }

    private async Task EnsureCodeAvailableAsync(string code, Guid? sameUnitId, CancellationToken cancellationToken)
    {
        if (await dbContext.OrgUnits.AnyAsync(unit => unit.Code == code && unit.Id != sameUnitId, cancellationToken)
            || await dbContext.OrgUnitCodeReservations.AnyAsync(reservation => reservation.NormalizedCode == code && reservation.OrgUnitId != sameUnitId, cancellationToken))
            throw new DuplicateEntityException("Organizational Unit", "code", code);
    }

    private OrganizationChange NewChange(OrgUnit unit, DateOnly effectiveDate, OrganizationChangeKind kind, string? reason, string summary, OrganizationPatch patch)
        => OrganizationChange.Create(TenantId, unit.Id, effectiveDate, kind, reason, summary, JsonSerializer.Serialize(patch, JsonOptions));

    private static string NormalizeCode(string code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Trim().Length > 50)
            throw new ArgumentException("A business code of at most 50 characters is required.", nameof(code));
        return code.Trim().ToUpperInvariant();
    }

    private static string NormalizeTypeName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 100)
            throw new ArgumentException("A type name of at most 100 characters is required.", nameof(name));
        return name.Trim().ToUpperInvariant();
    }

    private static OrganizationUnitStateDto ToDto(OrgUnitEffectiveState state, IReadOnlyDictionary<Guid, OrganizationUnitStateDto> context, IReadOnlyList<string> path)
    {
        context.TryGetValue(state.ParentOrgUnitId ?? Guid.Empty, out var parent);
        return new OrganizationUnitStateDto(state.OrgUnitId, state.OrgUnit.Code, state.Name,
            state.OrganizationalUnitTypeId, state.OrganizationalUnitType.DisplayName, state.ParentOrgUnitId,
            parent?.Name, string.Join(" / ", path.Append(state.Name)), state.LifecycleState, state.EffectiveFrom, state.OrgUnit.Version);
    }

    private static IEnumerable<OrganizationHierarchyNodeDto> Flatten(IEnumerable<OrganizationHierarchyNodeDto> nodes)
        => nodes.SelectMany(node => new[] { node }.Concat(Flatten(node.Children)));

    private sealed record StateAccumulator(string Name, Guid TypeId, Guid? ParentId, OrgUnitLifecycleState LifecycleState);
    private sealed record OrganizationPatch(bool NameChanged, string? Name, bool TypeIdChanged, Guid? TypeId, bool ParentIdChanged, Guid? ParentId, bool LifecycleStateChanged, OrgUnitLifecycleState? LifecycleState)
    {
        public static OrganizationPatch Empty { get; } = new(false, null, false, null, false, null, false, null);
        public static OrganizationPatch Create(string name, Guid typeId, Guid? parentId, OrgUnitLifecycleState lifecycleState)
            => new(true, name, true, typeId, true, parentId, true, lifecycleState);
    }
}
