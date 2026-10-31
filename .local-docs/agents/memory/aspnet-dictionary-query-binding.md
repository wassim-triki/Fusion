---
name: aspnet-dictionary-query-binding
description: A [FromQuery] Dictionary<string,string> parameter swallows every query key when its prefix is absent; parse fields[...] keys by hand
metadata:
  type: feedback
---

`[FromQuery] Dictionary<string, string>? fields` on an ASP.NET action binds **every** query key (`view`, `pageSize`, …) when no `fields[...]` key is sent, because model binding falls back to the empty prefix. B-182's People list came back empty in the journey for that reason while unit tests passed.

**Why:** found only by the API journey; controller tests construct arguments directly and never bind.
**How to apply:** for map-shaped filters read `Request.Query` keys matching `fields[key]` (see `EmployeesController.FieldFilters`), and prove such endpoints with a journey. Related: [[aspnet-record-validation-attributes]].
