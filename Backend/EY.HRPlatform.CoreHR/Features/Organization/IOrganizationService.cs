namespace EY.HRPlatform.CoreHR.Features.Organization;

public interface IOrganizationService
{
    Task<OrganizationHierarchyDto> GetHierarchyAsync(DateOnly asOf, CancellationToken cancellationToken);
    Task<OrganizationUnitStateDto> GetUnitAsync(Guid id, DateOnly asOf, CancellationToken cancellationToken);
    Task<IReadOnlyList<OrganizationUnitStateDto>> SearchAsync(string query, DateOnly asOf, CancellationToken cancellationToken);
    Task<IReadOnlyList<OrganizationChangeDto>> GetUpcomingChangesAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<OrganizationChangeDto>> GetHistoryAsync(Guid orgUnitId, CancellationToken cancellationToken);
    Task<OrganizationReadinessDto> GetReadinessAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<OrganizationalUnitTypeDto>> GetTypesAsync(CancellationToken cancellationToken);
    Task<OrganizationUnitStateDto> CreateRootAsync(CreateOrganizationRootRequest request, CancellationToken cancellationToken);
    Task<OrganizationUnitStateDto> CreateUnitAsync(CreateOrganizationUnitRequest request, CancellationToken cancellationToken);
    /// <summary>Opens a root nothing has changed since its creation from an earlier date; false when it can't or needn't.</summary>
    Task<bool> OpenRootFromInCurrentTransactionAsync(DateOnly from, CancellationToken cancellationToken);
    Task<IReadOnlyList<OrganizationBatchCreatedNode>> CreateBatchInCurrentTransactionAsync(
        DateOnly effectiveDate,
        IReadOnlyList<OrganizationBatchCreateNode> nodes,
        CancellationToken cancellationToken);
    Task<OrganizationUnitStateDto> ChangeAsync(Guid id, uint expectedVersion, ChangeOrganizationUnitRequest request, CancellationToken cancellationToken);
    Task<OrganizationUnitStateDto> MoveAsync(Guid id, uint expectedVersion, MoveOrganizationUnitRequest request, CancellationToken cancellationToken);
    Task<OrganizationUnitStateDto> InactivateAsync(Guid id, uint expectedVersion, InactivateOrganizationUnitRequest request, CancellationToken cancellationToken);
    Task<OrganizationUnitStateDto> CorrectAsync(Guid id, uint expectedVersion, CorrectOrganizationUnitRequest request, CancellationToken cancellationToken);
    Task<OrganizationUnitStateDto> CorrectCodeAsync(Guid id, uint expectedVersion, CorrectOrganizationCodeRequest request, CancellationToken cancellationToken);
    Task CancelChangeAsync(Guid changeId, uint expectedVersion, CancellationToken cancellationToken);
    Task<OrganizationalUnitTypeDto> CreateTypeAsync(CreateOrganizationalUnitTypeRequest request, CancellationToken cancellationToken);
    Task<OrganizationalUnitTypeDto> RenameTypeAsync(Guid id, RenameOrganizationalUnitTypeRequest request, CancellationToken cancellationToken);
    Task DeleteTypeAsync(Guid id, CancellationToken cancellationToken);
}
