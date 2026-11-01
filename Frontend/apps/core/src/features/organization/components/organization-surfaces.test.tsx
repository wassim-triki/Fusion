// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type {
  OrganizationalUnitTypeDto,
  OrganizationUnitStateDto,
} from "@repo/api";
import { buildOrganizationHierarchy } from "../model/hierarchy";
import type { MoveProposal } from "../model/workspace-state";
import { asteriaHierarchy, organizationChange } from "../test/fixtures";
import {
  CorrectionPanel,
  InactivateDialog,
  ManageTypesPanel,
  MoveReviewDialog,
  RootEstablishment,
  UnitFormPanel,
  UpcomingChangesSheet,
} from "./organization-surfaces";

// The panels internally read a temporal hierarchy only for non-Today dates; all
// tests use Today so the passed model is used and no real query runs.
vi.mock("../api/use-organization", () => ({
  useOrganizationHierarchy: () => ({
    data: undefined,
    isFetching: false,
    error: null,
  }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const TODAY = "2026-08-09";
const model = buildOrganizationHierarchy(asteriaHierarchy);
const unit = (id: string): OrganizationUnitStateDto => model.byId.get(id)!;

const types: OrganizationalUnitTypeDto[] = [
  { id: "division", displayName: "Division", isBuiltIn: true },
  { id: "team", displayName: "Team", isBuiltIn: true },
  { id: "organization", displayName: "Organization", isBuiltIn: true },
  { id: "chapter", displayName: "Chapter", isBuiltIn: false },
];

type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isLoading: boolean;
  error: unknown;
};
function stub(resolved: unknown = { id: "new", version: 2 }): MutationStub {
  return { mutateAsync: vi.fn().mockResolvedValue(resolved), isLoading: false, error: null };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMutations(): any {
  return {
    createRoot: stub(),
    createUnit: stub({ id: "created", version: 1 }),
    changeUnit: stub({ id: "technology", version: 2 }),
    moveUnit: stub({ id: "technology", version: 2 }),
    inactivateUnit: stub(),
    correctUnit: stub({ id: "technology", version: 2 }),
    correctCode: stub({ id: "technology", version: 2 }),
    cancelChange: stub(),
    createType: stub(),
    renameType: stub(),
    deleteType: stub(),
  };
}

describe("RootEstablishment", () => {
  it("keeps manual root creation visible beside the prominent import alternative", () => {
    render(
      <RootEstablishment
        canManage
        today={TODAY}
        tenantName="Asteria"
        mutations={makeMutations()}
        onCreated={vi.fn()}
      />
    );
    expect(screen.getByRole("link", { name: "Import an existing structure" })).toHaveAttribute(
      "href",
      "/import"
    );
    expect(screen.getByRole("button", { name: "Create organization" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("does not expose root-establishment actions to View-only callers", () => {
    render(
      <RootEstablishment
        canManage={false}
        today={TODAY}
        tenantName="Asteria"
        mutations={makeMutations()}
        onCreated={vi.fn()}
      />
    );
    expect(screen.getByText("Organization has not been established")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import an existing structure" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create organization" })).not.toBeInTheDocument();
  });
});

describe("UnitFormPanel", () => {
  it("hides the parent picker and states the parent for a contextual Add child", () => {
    render(
      <UnitFormPanel
        mode={{ kind: "add", parentId: "technology" }}
        today={TODAY}
        model={model}
        types={types}
        createdTypeId={null}
        mutations={makeMutations()}
        onClose={vi.fn()}
        onCreateType={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByText("Add unit under Technology")).toBeInTheDocument();
    expect(screen.getByText("Business code")).toBeInTheDocument();
    expect(screen.queryByText("Parent")).not.toBeInTheDocument();
  });

  it("shows the parent picker for a global Add unit", () => {
    render(
      <UnitFormPanel
        mode={{ kind: "add", parentId: null }}
        today={TODAY}
        model={model}
        types={types}
        createdTypeId={null}
        mutations={makeMutations()}
        onClose={vi.fn()}
        onCreateType={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Add unit" })).toBeInTheDocument();
    expect(screen.getByText("Parent")).toBeInTheDocument();
  });

  it("edits name and type only, without business code or parent", () => {
    render(
      <UnitFormPanel
        mode={{ kind: "edit", unit: unit("technology") }}
        today={TODAY}
        model={model}
        types={types}
        createdTypeId={null}
        mutations={makeMutations()}
        onClose={vi.fn()}
        onCreateType={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByText("Edit Technology")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.queryByText("Business code")).not.toBeInTheDocument();
    expect(screen.queryByText("Parent")).not.toBeInTheDocument();
  });

  it("limits root edit to name and effective date", () => {
    render(
      <UnitFormPanel
        mode={{ kind: "edit", unit: unit("asteria") }}
        today={TODAY}
        model={model}
        types={types}
        createdTypeId={null}
        mutations={makeMutations()}
        onClose={vi.fn()}
        onCreateType={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByText("Edit organization")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Effective date")).toBeInTheDocument();
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
    expect(screen.queryByText("Business code")).not.toBeInTheDocument();
  });
});

describe("ManageTypesPanel", () => {
  it("separates read-only built-ins from custom types and offers creation", () => {
    const onCreateType = vi.fn();
    render(
      <ManageTypesPanel
        types={[
          { id: "division", displayName: "Division", isBuiltIn: true },
          { id: "team", displayName: "Team", isBuiltIn: true },
        ]}
        mutations={makeMutations()}
        onClose={vi.fn()}
        onCreateType={onCreateType}
      />
    );
    expect(screen.getByText("Built-in types")).toBeInTheDocument();
    expect(screen.getByText("No custom types yet.")).toBeInTheDocument();
    // Built-in labels are plain text, not actionable controls.
    expect(screen.queryByRole("button", { name: "Division" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /New type/i }));
    expect(onCreateType).toHaveBeenCalled();
  });
});

describe("MoveReviewDialog", () => {
  const dragProposal: MoveProposal = {
    sourceId: "technology",
    fromParentId: "consulting",
    toParentId: "commercial",
    effectiveDate: TODAY,
    version: 1,
    subordinateCount: 1,
    entry: "drag",
    error: null,
  };

  it("keeps the dragged destination and moves the whole branch", async () => {
    const mutations = makeMutations();
    const onMoved = vi.fn();
    render(
      <MoveReviewDialog
        proposal={dragProposal}
        today={TODAY}
        model={model}
        mutations={mutations}
        onChange={vi.fn()}
        onOpenChange={vi.fn()}
        onMoved={onMoved}
      />
    );
    expect(screen.getByText("Review move")).toBeInTheDocument();
    // Destination is already known; no picker is offered.
    expect(screen.queryByText("New parent")).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Move branch" });
    fireEvent.click(confirm);
    expect(mutations.moveUnit.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "technology",
        request: expect.objectContaining({ targetParentId: "commercial" }),
      })
    );
  });

  it("requires a destination when Move is started explicitly", () => {
    render(
      <MoveReviewDialog
        proposal={{ ...dragProposal, entry: "explicit", toParentId: null }}
        today={TODAY}
        model={model}
        mutations={makeMutations()}
        onChange={vi.fn()}
        onOpenChange={vi.fn()}
        onMoved={vi.fn()}
      />
    );
    expect(screen.getByText("New parent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move branch" })).toBeDisabled();
  });
});

describe("InactivateDialog", () => {
  it("routes a blocked unit to the deepest actionable descendant", () => {
    const onSelectDescendant = vi.fn();
    render(
      <InactivateDialog
        unit={unit("technology")}
        today={TODAY}
        model={model}
        mutations={makeMutations()}
        onOpenChange={vi.fn()}
        onDone={vi.fn()}
        onSelectDescendant={onSelectDescendant}
      />
    );
    expect(
      screen.getByText("Move the units under Technology first")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Go to blocking unit/i }));
    expect(onSelectDescendant).toHaveBeenCalledWith("data-ai");
  });

  it("inactivates a leaf unit through the terminal confirmation", () => {
    const mutations = makeMutations();
    render(
      <InactivateDialog
        unit={unit("data-ai")}
        today={TODAY}
        model={model}
        mutations={mutations}
        onOpenChange={vi.fn()}
        onDone={vi.fn()}
        onSelectDescendant={vi.fn()}
      />
    );
    expect(screen.getByText("Inactivate Data & AI?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inactivate unit" }));
    expect(mutations.inactivateUnit.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "data-ai" })
    );
  });
});

describe("CorrectionPanel", () => {
  it("exposes the full correction fieldset and warns on business-code change", () => {
    render(
      <CorrectionPanel
        unit={unit("technology")}
        effectiveDate={TODAY}
        model={model}
        types={types}
        mutations={makeMutations()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(screen.getByText("Correct recorded data")).toBeInTheDocument();
    expect(screen.getByText("Reason for correction")).toBeInTheDocument();
    // Correcting the code raises a stable-reference warning.
    fireEvent.change(screen.getByLabelText("Business code"), {
      target: { value: "TECHX" },
    });
    expect(
      screen.getByText(/Imports and integrations may still reference TECH/i)
    ).toBeInTheDocument();
    // Correction cannot be submitted without a reason.
    expect(screen.getByRole("button", { name: "Correct data" })).toBeDisabled();
  });
});

describe("UpcomingChangesSheet", () => {
  it("groups scheduled changes and exposes cancel and view", () => {
    const onCancel = vi.fn();
    const onViewDate = vi.fn();
    render(
      <UpcomingChangesSheet
        open
        changes={[organizationChange({ effectiveDate: "2026-09-01" })]}
        canManage
        today={TODAY}
        mutations={makeMutations()}
        onOpenChange={vi.fn()}
        onViewDate={onViewDate}
        onCancel={onCancel}
      />
    );
    expect(screen.getByText("Upcoming changes")).toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    const section = screen.getByText("2026-09-01").closest("section")!;
    fireEvent.click(within(section).getByRole("button", { name: "View structure" }));
    expect(onViewDate).toHaveBeenCalledWith("2026-09-01");
    fireEvent.click(within(section).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
