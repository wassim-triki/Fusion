namespace EY.HRPlatform.CoreHR.Exceptions;

/// <summary>
/// Thrown when a catalogue change can't happen in the catalogue's current state (deleting a job someone holds,
/// merging a job into itself). Maps to HTTP 409 Conflict; the message says what to do instead.
/// </summary>
public sealed class CatalogConflictException(string message) : Exception(message);
