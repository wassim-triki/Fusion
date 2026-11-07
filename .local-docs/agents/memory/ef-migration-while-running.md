---
name: ef-migration-while-running
description: Add an EF Core migration without stopping the running service — env-var artifacts output recipe (B-202)
metadata:
  node_type: memory
  type: reference
  originSessionId: 2752cc6a-3764-4c09-a0e0-57e9834ea224
  modified: 2026-11-07T12:12:56.202Z
---

A running service locks its `bin/`, so `dotnet ef migrations add` fails. Worked 2026-11-07 (B-287) with CoreHR up:

```
export UseArtifactsOutput=true ArtifactsPath="<scratch>/ef-artifacts"
dotnet restore EY.HRPlatform.CoreHR
dotnet ef migrations add <Name> --project EY.HRPlatform.CoreHR --startup-project EY.HRPlatform.CoreHR --output-dir Infrastructure/Persistence/Migrations
```

Environment variables become MSBuild properties for both the build and ef's project evaluation; the restore into the artifacts folder is needed first. Run `dotnet build-server shutdown` after, since the build servers hold memory. B-202 is the board item to wrap it in a `fusion-dev` script. See [[fusion-dev-skill]], [[machine-memory-checks]].
