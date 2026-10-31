using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Infrastructure.Photos;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

/// <summary>
/// Documents on a person (B-180). They are personal details: the person and whoever changes personal details see
/// and add them, the same "You and HR" as the home address. The person removes what they added; HR removes any.
/// Files sit in the tenant-partitioned store photos use, and are checked by their bytes.
/// </summary>
public static class EmployeeDocuments
{
    public const long MaxBytes = 10 * 1024 * 1024;
    public const int MaxPerPerson = 100;

    /// <summary>PDF and images, recognised by their first bytes; anything else is refused whatever it is called.</summary>
    public static (string ContentType, string Extension)? Sniff(ReadOnlySpan<byte> head)
    {
        if (head.Length >= 5 && head[..5].SequenceEqual("%PDF-"u8))
            return ("application/pdf", ".pdf");
        return EmployeePhotos.Sniff(head);
    }
}

public sealed record EmployeeDocumentDto(Guid Id, string Name, string ContentType, long SizeBytes, DateTime AddedAt, string AddedBy, bool CanRemove);

/// <param name="CanAdd">The viewer may add a document for this person.</param>
public sealed record EmployeeDocumentsDto(IReadOnlyList<EmployeeDocumentDto> Documents, bool CanAdd);

public sealed record EmployeeDocumentFile(string StorageKey, string ContentType, string Name);

public sealed record EmployeeDocumentsQuery(string EmployeeKey, PeopleViewer Viewer) : IQuery<Result<EmployeeDocumentsDto>>;

public sealed record EmployeeDocumentFileQuery(string EmployeeKey, Guid DocumentId, PeopleViewer Viewer) : IQuery<Result<EmployeeDocumentFile>>;

public sealed record AddEmployeeDocumentCommand(string EmployeeKey, PeopleViewer Viewer, IFormFile? File, string ActorName)
    : ICommand<Result<EmployeeDocumentDto>>;

public sealed record RemoveEmployeeDocumentCommand(string EmployeeKey, Guid DocumentId, PeopleViewer Viewer) : ICommand<Result>;

public sealed class EmployeeDocumentsQueryHandler(CoreHRDbContext dbContext)
    : IQueryHandler<EmployeeDocumentsQuery, Result<EmployeeDocumentsDto>>
{
    public async Task<Result<EmployeeDocumentsDto>> Handle(EmployeeDocumentsQuery request, CancellationToken cancellationToken)
    {
        var (employee, decision) = await DocumentSupport.OpenAsync(dbContext, request.EmployeeKey, request.Viewer, cancellationToken);
        if (employee is null) return Result.Failure<EmployeeDocumentsDto>(DocumentSupport.NotFound);
        if (decision!.Access != PersonalAccess.Full)
            return Result.Failure<EmployeeDocumentsDto>(PeopleAccess.Forbidden("You can't see this person's documents."));

        var documents = await dbContext.EmployeeDocuments.AsNoTracking()
            .Where(document => document.EmployeeId == employee.Id)
            .OrderByDescending(document => document.AddedAt)
            .ToListAsync(cancellationToken);
        return Result.Success(new EmployeeDocumentsDto(
            documents.Select(document => DocumentSupport.Project(document, request.Viewer)).ToList(),
            decision.CanEdit));
    }
}

public sealed class EmployeeDocumentFileQueryHandler(CoreHRDbContext dbContext)
    : IQueryHandler<EmployeeDocumentFileQuery, Result<EmployeeDocumentFile>>
{
    public async Task<Result<EmployeeDocumentFile>> Handle(EmployeeDocumentFileQuery request, CancellationToken cancellationToken)
    {
        var (employee, decision) = await DocumentSupport.OpenAsync(dbContext, request.EmployeeKey, request.Viewer, cancellationToken);
        if (employee is null) return Result.Failure<EmployeeDocumentFile>(DocumentSupport.NotFound);
        if (decision!.Access != PersonalAccess.Full)
            return Result.Failure<EmployeeDocumentFile>(PeopleAccess.Forbidden("You can't see this person's documents."));

        var document = await dbContext.EmployeeDocuments.AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == request.DocumentId && item.EmployeeId == employee.Id, cancellationToken);
        return document is null
            ? Result.Failure<EmployeeDocumentFile>(DocumentSupport.NotFound)
            : Result.Success(new EmployeeDocumentFile(document.StorageKey, document.ContentType, document.Name));
    }
}

public sealed class AddEmployeeDocumentHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IEmployeePhotoStore store)
    : ICommandHandler<AddEmployeeDocumentCommand, Result<EmployeeDocumentDto>>
{
    public async Task<Result<EmployeeDocumentDto>> Handle(AddEmployeeDocumentCommand command, CancellationToken cancellationToken)
    {
        var (employee, decision) = await DocumentSupport.OpenAsync(dbContext, command.EmployeeKey, command.Viewer, cancellationToken);
        if (employee is null) return Result.Failure<EmployeeDocumentDto>(DocumentSupport.NotFound);
        if (!decision!.CanEdit)
            return Result.Failure<EmployeeDocumentDto>(PeopleAccess.Forbidden("You can't add documents for this person."));

        var file = command.File;
        if (file is null || file.Length <= 0) return Invalid("Choose a file.");
        if (file.Length > EmployeeDocuments.MaxBytes) return Invalid("The file is larger than 10 MB.");
        if (await dbContext.EmployeeDocuments.CountAsync(document => document.EmployeeId == employee.Id, cancellationToken) >= EmployeeDocuments.MaxPerPerson)
            return Invalid("This person already has 100 documents. Remove one first.");

        // Read with a hard cap: the declared length is the client's word, the bytes are not.
        using var content = new MemoryStream();
        await using (var input = file.OpenReadStream())
        {
            var buffer = new byte[81920];
            int read;
            while ((read = await input.ReadAsync(buffer, cancellationToken)) > 0)
            {
                if (content.Length + read > EmployeeDocuments.MaxBytes) return Invalid("The file is larger than 10 MB.");
                await content.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
        }
        if (content.Length == 0) return Invalid("Choose a file.");
        if (EmployeeDocuments.Sniff(content.GetBuffer().AsSpan(0, (int)Math.Min(12, content.Length))) is not { } type)
            return Invalid("Use a PDF, JPEG, PNG or WebP file.");

        content.Position = 0;
        var key = await store.SaveAsync(content, type.Extension, cancellationToken);
        var name = Path.GetFileName(file.FileName ?? string.Empty);
        var document = EmployeeDocument.Add(tenantContext.TenantId, employee.Id,
            string.IsNullOrWhiteSpace(name) ? $"Document{type.Extension}" : name,
            type.ContentType, content.Length, key, command.ActorName, command.Viewer.EmployeeId, DateTime.UtcNow);
        try
        {
            dbContext.EmployeeDocuments.Add(document);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            await store.DeleteAsync(key, CancellationToken.None);
            throw;
        }
        return Result.Success(DocumentSupport.Project(document, command.Viewer));
    }

    private static Result<EmployeeDocumentDto> Invalid(string message)
        => Result.Failure<EmployeeDocumentDto>(new Error("Employee.Validation", message));
}

public sealed class RemoveEmployeeDocumentHandler(
    CoreHRDbContext dbContext,
    IEmployeePhotoStore store,
    ILogger<RemoveEmployeeDocumentHandler> logger)
    : ICommandHandler<RemoveEmployeeDocumentCommand, Result>
{
    public async Task<Result> Handle(RemoveEmployeeDocumentCommand command, CancellationToken cancellationToken)
    {
        var (employee, decision) = await DocumentSupport.OpenAsync(dbContext, command.EmployeeKey, command.Viewer, cancellationToken);
        if (employee is null) return Result.Failure(DocumentSupport.NotFound);
        if (decision!.Access != PersonalAccess.Full)
            return Result.Failure(PeopleAccess.Forbidden("You can't see this person's documents."));

        var document = await dbContext.EmployeeDocuments
            .FirstOrDefaultAsync(item => item.Id == command.DocumentId && item.EmployeeId == employee.Id, cancellationToken);
        if (document is null) return Result.Failure(DocumentSupport.NotFound);
        if (!DocumentSupport.CanRemove(document, command.Viewer))
            return Result.Failure(PeopleAccess.Forbidden("You can't remove this document."));

        dbContext.EmployeeDocuments.Remove(document);
        await dbContext.SaveChangesAsync(cancellationToken);
        await PhotoSupport.DeleteQuietlyAsync(store, document.StorageKey, logger);
        return Result.Success();
    }
}

internal static class DocumentSupport
{
    public static readonly Error NotFound = new("Document.NotFound", "Not found.");

    public static async Task<(Employee? Employee, PeopleAccessDecision? Decision)> OpenAsync(
        CoreHRDbContext dbContext, string employeeKey, PeopleViewer viewer, CancellationToken cancellationToken)
    {
        var key = employeeKey.Trim().ToUpperInvariant();
        var employee = await dbContext.Employees.AsNoTracking().FirstOrDefaultAsync(item => item.StableEmployeeKey == key, cancellationToken);
        return employee is null ? (null, null) : (employee, await PeopleAccess.DecideAsync(dbContext, viewer, employee.Id, cancellationToken));
    }

    /// <summary>HR removes any document; the person removes one they added themselves.</summary>
    public static bool CanRemove(EmployeeDocument document, PeopleViewer viewer)
        => viewer.Personal == PersonalGrant.Change
            || (viewer.UpdatesSelf && viewer.EmployeeId is { } me && document.EmployeeId == me && document.AddedByEmployeeId == me);

    public static EmployeeDocumentDto Project(EmployeeDocument document, PeopleViewer viewer)
        => new(document.Id, document.Name, document.ContentType, document.SizeBytes, document.AddedAt, document.AddedByName, CanRemove(document, viewer));
}
