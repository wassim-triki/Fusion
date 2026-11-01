using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

public sealed record CompanyImportUpload(Stream Content, string FileName, string? ContentType);

/// <summary>
/// The import's session: files in, the person's answers and fixes, bring-in asked. Every read derives the proposal
/// again from the files, so what the screens show is what would be brought in. Changes need the version last read.
/// </summary>
public sealed class CompanyImportService(
    CoreHRDbContext db,
    ITenantContext tenant,
    CompanyImportReader reader)
{
    public const int MaxFiles = 12;

    public async Task<Guid?> ActiveAsync(CancellationToken cancellationToken)
        => await db.CompanyImportSessions.AsNoTracking()
            .Where(session => session.Status == CompanyImportStatus.Open || session.Status == CompanyImportStatus.BringingIn || session.Status == CompanyImportStatus.Stopped)
            .OrderByDescending(session => session.CreatedAt).Select(session => (Guid?)session.Id).FirstOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<CompanyImportEarlierDto>> EarlierAsync(CancellationToken cancellationToken)
        => (await db.CompanyImportSessions.AsNoTracking().Include(session => session.Sources)
                .Where(session => session.Status == CompanyImportStatus.BroughtIn)
                .OrderByDescending(session => session.BroughtInAt).Take(10).ToListAsync(cancellationToken))
            .Select(session =>
            {
                var result = CompanyImportJson.Read<CompanyImportResult>(session.ResultJson);
                return new CompanyImportEarlierDto(session.Id, session.BroughtInAt!.Value, result?.BroughtInBy ?? session.StartedByDisplayName,
                    session.Sources.Where(source => source.Problem is null).Select(source => source.FileName).Distinct().ToList(), result?.People ?? 0, result?.Units ?? 0, result?.Changed ?? 0);
            }).ToList();

    public async Task<Guid> StartAsync(IReadOnlyList<CompanyImportUpload> files, string? companyName, ImportActor actor, CancellationToken cancellationToken)
    {
        if (files.Count == 0) throw new CompanyImportException("NoFiles", "Choose at least one file.");
        if (await ActiveAsync(cancellationToken) is not null)
            throw new CompanyImportException("ImportOpen", "An import is already open. Finish it or start over.", 409);
        var read = await ReadAllAsync(files, cancellationToken);
        var session = CompanyImportSession.Start(tenant.TenantId, companyName, actor);
        db.CompanyImportSessions.Add(session);
        Attach(session, read, 0);
        await db.SaveChangesAsync(cancellationToken);
        return session.Id;
    }

    public async Task AddFilesAsync(Guid id, uint version, IReadOnlyList<CompanyImportUpload> files, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        if (session.Sources.Select(source => source.FileId).Distinct().Count() + files.Count > MaxFiles)
            throw new CompanyImportException("TooManyFiles", $"An import takes up to {MaxFiles} files.");
        var read = await ReadAllAsync(files, cancellationToken);
        Attach(session, read, session.Sources.Count == 0 ? 0 : session.Sources.Max(source => source.Order) + 1);
        await SaveAsync(cancellationToken);
    }

    public async Task RemoveFileAsync(Guid id, uint version, Guid fileId, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        var gone = session.Sources.Where(source => source.FileId == fileId).ToList();
        if (gone.Count == 0) throw new CompanyImportException("FileNotFound", "That file isn't in this import.", 404);
        session.RemoveFile(fileId);
        db.CompanyImportSources.RemoveRange(gone);
        await SaveAsync(cancellationToken);
    }

    public async Task SetColumnAsync(Guid id, uint version, SetColumnRequest request, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        var source = session.Sources.FirstOrDefault(item => item.FileId == request.FileId && item.SheetName == request.Sheet)
            ?? throw new CompanyImportException("SheetNotFound", "That sheet isn't in this import.", 404);
        if (source.Readings.All(reading => reading.Index != request.Index))
            throw new CompanyImportException("ColumnNotFound", "That column isn't in the sheet.", 404);
        var kind = session.Decisions.Answers.TryGetValue($"kind|{source.FileId:N}|{source.SheetName}", out var said) && Enum.TryParse<CompanyImportKind>(said, out var parsed) ? parsed : source.Kind;
        if (request.Field is not null && request.Field != CompanyImportFields.Out && !CompanyImportFields.For(kind).Contains(request.Field))
            throw new CompanyImportException("FieldUnknown", "Pick one of the meanings Fusion offers.");
        var decisions = session.Decisions;
        var key = CompanyImportDecisions.ColumnKey(source.FileId, source.SheetName, request.Index);
        if (request.Field is null) decisions.Columns.Remove(key);
        else
        {
            // A meaning belongs to one column of a sheet: giving it here takes it from the other.
            var prefix = $"{source.FileId:N}|{source.SheetName}|";
            foreach (var other in decisions.Columns.Where(item => item.Key.StartsWith(prefix, StringComparison.Ordinal) && item.Value == request.Field && request.Field != CompanyImportFields.Out).ToList())
                decisions.Columns[other.Key] = CompanyImportFields.Out;
            foreach (var reading in source.Readings.Where(reading => reading.Field == request.Field && reading.Index != request.Index && request.Field != CompanyImportFields.Out))
                decisions.Columns.TryAdd(CompanyImportDecisions.ColumnKey(source.FileId, source.SheetName, reading.Index), CompanyImportFields.Out);
            decisions.Columns[key] = request.Field;
        }
        session.SetDecisions(decisions);
        await SaveAsync(cancellationToken);
    }

    public async Task AnswerAsync(Guid id, uint version, AnswerRequest request, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        var proposal = await DeriveAsync(session, cancellationToken);
        var decisions = session.Decisions;
        Answer(decisions, proposal, request.Key, request.Value);
        session.SetDecisions(decisions);
        await SaveAsync(cancellationToken);
    }

    /// <summary>Takes Fusion's lean on every question and check still open.</summary>
    public async Task TakeLeansAsync(Guid id, uint version, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        var decisions = session.Decisions;
        // Answers can open new checks (a merged job, a unit added); settle a few rounds.
        for (var round = 0; round < 3; round++)
        {
            var proposal = CompanyImportDerivation.Derive(CompanyImportSnapshotLoader.Inputs(session), decisions,
                await CompanyImportSnapshotLoader.LoadAsync(db, session.CompanyName, cancellationToken));
            if (proposal.OpenCount == 0) break;
            foreach (var question in proposal.Questions.Where(question => question.Answer is null))
                Answer(decisions, proposal, question.Key, question.Lean);
            foreach (var check in proposal.Checks.Where(check => check.Answer is null))
                if (check.Options.FirstOrDefault(option => option.Lean) is { } lean) Answer(decisions, proposal, check.Key, lean.Key);
        }
        session.SetDecisions(decisions);
        await SaveAsync(cancellationToken);
    }

    public async Task<CompanyImportSaid?> InterpretAsync(Guid id, string text, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, null, cancellationToken);
        if (string.IsNullOrWhiteSpace(text) || text.Length > CompanyImportSaying.MaxLength) return null;
        return CompanyImportSaying.Read(text, await DeriveAsync(session, cancellationToken));
    }

    public async Task AddFixAsync(Guid id, uint version, AddFixRequest request, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        var proposal = await DeriveAsync(session, cancellationToken);
        if (proposal.People.All(person => person.Key != request.PersonKey))
            throw new CompanyImportException("PersonNotFound", "That person isn't in the files.", 404);
        var valid = request.Field switch
        {
            CompanyImportFields.Manager => request.Value == "none" || proposal.People.Any(person => person.Key == request.Value && person.Key != request.PersonKey),
            CompanyImportFields.Unit => proposal.Units.Any(unit => unit.Key == request.Value),
            CompanyImportFields.Place or CompanyImportFields.JobTitle => request.Value.Trim().Length is > 0 and <= 150,
            _ => false,
        };
        if (!valid) throw new CompanyImportException("FixInvalid", "Fusion can't apply that fix.");
        var decisions = session.Decisions;
        decisions.Fixes.RemoveAll(fix => fix.PersonKey == request.PersonKey && fix.Field == request.Field);
        decisions.Fixes.Add(new CompanyImportFix(Guid.NewGuid().ToString("N")[..12], request.PersonKey, request.Field, request.Value.Trim(),
            request.Text.Trim().Length > CompanyImportSaying.MaxLength ? request.Text.Trim()[..CompanyImportSaying.MaxLength] : request.Text.Trim()));
        session.SetDecisions(decisions);
        await SaveAsync(cancellationToken);
    }

    public async Task RemoveFixAsync(Guid id, uint version, string fixId, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        var decisions = session.Decisions;
        if (decisions.Fixes.RemoveAll(fix => fix.Id == fixId) == 0) throw new CompanyImportException("FixNotFound", "That fix is gone.", 404);
        session.SetDecisions(decisions);
        await SaveAsync(cancellationToken);
    }

    /// <summary>Asks for the reviewed proposal to be brought in; the worker brings in only that fingerprint.</summary>
    public async Task BringInAsync(Guid id, uint version, string fingerprint, ImportActor actor, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        var proposal = await DeriveAsync(session, cancellationToken);
        if (!proposal.CanBringIn)
            throw new CompanyImportException("NotReady", proposal.OpenCount > 0 ? "Answer what's left to check first." : "There's nobody to bring in.", 409);
        if (!ImportFingerprint.Matches(proposal.Fingerprint, fingerprint))
            throw new CompanyImportException("Changed", "The company or the files changed since the chart was shown. Look again before bringing it in.", 409);
        session.RequestBringIn(proposal.Fingerprint, actor);
        await SaveAsync(cancellationToken);
    }

    /// <summary>Try again after a bring-in stopped partway: the worker picks up at the batch where it stopped.</summary>
    public async Task ResumeAsync(Guid id, uint version, ImportActor actor, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        session.Resume(actor);
        await SaveAsync(cancellationToken);
    }

    public async Task DiscardAsync(Guid id, uint version, CancellationToken cancellationToken)
    {
        var session = await LoadAsync(id, version, cancellationToken);
        if (!session.Discard()) throw new CompanyImportException("ImportClosed", "This import can't be discarded now.", 409);
        await SaveAsync(cancellationToken);
    }

    public async Task<CompanyImportDto> GetAsync(Guid id, string? viewerEmail, CancellationToken cancellationToken)
    {
        var session = await db.CompanyImportSessions.AsNoTracking().Include(item => item.Sources)
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new CompanyImportException("NotFound", "This import doesn't exist.", 404);
        if (session.Status is CompanyImportStatus.BroughtIn or CompanyImportStatus.Discarded)
            return CompanyImportView.Closed(session);
        if (session.PlanJson is not null) return CompanyImportView.Running(session);
        var proposal = await DeriveAsync(session, cancellationToken);
        return CompanyImportView.Build(session, proposal, viewerEmail,
            session.Status == CompanyImportStatus.BringingIn ? new CompanyImportProgressDto("waiting", 0, 0, 0, 0) : null);
    }

    // ---------- helpers ----------

    private static void Answer(CompanyImportDecisions decisions, CompanyImportProposal proposal, string key, string? value)
    {
        if (key == CompanyImportDerivation.ApplyFromKey)
        {
            if (value is not null && !DateOnly.TryParseExact(value, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out _))
                throw new CompanyImportException("AnswerInvalid", "Pick a date.");
            Set(decisions.Answers, key, value);
            return;
        }
        if (proposal.Questions.FirstOrDefault(question => question.Key == key) is { } question)
        {
            if (question.Kind is "dates" or "noManagers")
            {
                if (value is not null && (question.Kind == "dates" ? value is not ("dmy" or "mdy") : value != question.Lean))
                    throw new CompanyImportException("AnswerInvalid", "Pick one of the choices.");
                Set(decisions.Answers, key, value);
            }
            else
            {
                if (value is not null && value != CompanyImportFields.Out && value != question.Lean)
                    throw new CompanyImportException("AnswerInvalid", "Pick one of the choices.");
                Set(decisions.Columns, key, value);
            }
            return;
        }
        if (key.StartsWith("kind|", StringComparison.Ordinal) && proposal.Sheets.Any(sheet => $"kind|{sheet.FileId:N}|{sheet.Sheet}" == key))
        {
            if (value is not (null or "People" or "Units" or "Unknown")) throw new CompanyImportException("AnswerInvalid", "Pick one of the choices.");
            Set(decisions.Answers, key, value);
            return;
        }
        var check = proposal.Checks.FirstOrDefault(item => item.Key == key)
            ?? throw new CompanyImportException("CheckNotFound", "That's already settled.", 404);
        if (value is not null && check.Options.All(option => option.Key != value))
            throw new CompanyImportException("AnswerInvalid", "Pick one of the choices.");
        Set(decisions.Answers, key, value);
    }

    private static void Set(Dictionary<string, string> map, string key, string? value)
    {
        if (value is null) map.Remove(key);
        else map[key] = value;
    }

    private async Task<CompanyImportProposal> DeriveAsync(CompanyImportSession session, CancellationToken cancellationToken)
        => CompanyImportDerivation.Derive(CompanyImportSnapshotLoader.Inputs(session), session.Decisions,
            await CompanyImportSnapshotLoader.LoadAsync(db, session.CompanyName, cancellationToken));

    private async Task<List<CompanyImportReadFile>> ReadAllAsync(IReadOnlyList<CompanyImportUpload> files, CancellationToken cancellationToken)
    {
        if (files.Count > MaxFiles) throw new CompanyImportException("TooManyFiles", $"An import takes up to {MaxFiles} files.");
        var read = new List<CompanyImportReadFile>();
        foreach (var file in files) read.Add(await reader.ReadAsync(file.Content, file.FileName, file.ContentType, cancellationToken));
        return read;
    }

    private void Attach(CompanyImportSession session, List<CompanyImportReadFile> files, int order)
    {
        foreach (var file in files)
        {
            var fileId = Guid.NewGuid();
            if (file.Problem is { } problem)
            {
                var unusable = CompanyImportSource.Unusable(tenant.TenantId, session.Id, fileId, file.FileName, order++, problem);
                session.AddSource(unusable);
                db.CompanyImportSources.Add(unusable);
                continue;
            }
            foreach (var sheet in file.Sheets)
            {
                var source = CompanyImportSource.Create(tenant.TenantId, session.Id, fileId, file.FileName, file.Format, file.Sha256, file.ByteLength,
                    order++, sheet.SheetName, sheet.Kind, sheet.Readings, sheet.Rows, sheet.Rows.Count);
                session.AddSource(source);
                db.CompanyImportSources.Add(source);
            }
        }
    }

    private async Task<CompanyImportSession> LoadAsync(Guid id, uint? version, CancellationToken cancellationToken)
    {
        var session = await db.CompanyImportSessions.Include(item => item.Sources).SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new CompanyImportException("NotFound", "This import doesn't exist.", 404);
        if (version is { } expected)
        {
            if (session.Version != expected) throw new CompanyImportException("Stale", "Someone changed this import. It has been reloaded.", 409);
            db.Entry(session).Property(item => item.Version).OriginalValue = expected;
        }
        return session;
    }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        try { await db.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateConcurrencyException) { throw new CompanyImportException("Stale", "Someone changed this import. It has been reloaded.", 409); }
    }
}

public sealed record CompanyImportEarlierDto(Guid Id, DateTime BroughtInAt, string By, IReadOnlyList<string> FileNames, int People, int Units, int Changed);
