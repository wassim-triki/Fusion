import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../testing/intl";
import { DataTableExport } from "./data-table-export";

afterEach(() => vi.restoreAllMocks());

describe("DataTableExport", () => {
  it("saves a table's only format straight away instead of asking (B-236)", async () => {
    URL.createObjectURL = vi.fn(() => "blob:tenants");
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const onExport = vi.fn(async () => ({
      blob: new Blob(["a,b"]),
      fileName: "fusion-tenants.csv",
    }));

    renderWithIntl(<DataTableExport formats={["csv"]} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export as CSV" }));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith("csv"));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says the file didn't download when building it fails", async () => {
    renderWithIntl(
      <DataTableExport
        formats={["csv"]}
        onExport={() => Promise.reject(new Error("offline"))}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Export as CSV" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
