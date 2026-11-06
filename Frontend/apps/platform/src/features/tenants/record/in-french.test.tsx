import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/test/intl";
import { aTenant, anEvent } from "@/test/fixtures";
import { RecentActivity } from "./recent-activity";
import { TenantProducts } from "./products-summary";
import { TenantProfile } from "./tenant-profile";

const record = vi.hoisted(() => ({ tenant: null as unknown }));

vi.mock("./record-shell", () => ({
  useTenantRecord: () => ({ tenant: record.tenant, query: "", from: null, refresh: () => {}, isRefreshing: false }),
}));
vi.mock("../queries", () => ({
  useRenameTenant: () => ({ mutateAsync: vi.fn(), isLoading: false }),
}));

describe("The tenant record in French", () => {
  it("reads the Overview cards in French", () => {
    record.tenant = aTenant({
      industry: "Financial Services",
      locale: "fr-FR",
      modules: ["CoreHR", "Performance"],
      history: [anEvent("TenantProvisioned", "2026-08-01T09:00:00Z")],
    });

    renderInFrench(
      <>
        <TenantProducts />
        <TenantProfile />
        <RecentActivity />
      </>
    );

    expect(screen.getByRole("heading", { name: "Produits" })).toBeInTheDocument();
    expect(screen.getAllByText("Inclus")).toHaveLength(1);
    expect(screen.getAllByText("Désactivé")).toHaveLength(3);
    expect(screen.getByText("Secteur d’activité").nextSibling).toHaveTextContent("Services financiers");
    expect(screen.getByText("Langue par défaut").nextSibling).toHaveTextContent("Français");
    expect(screen.getByText("Créée le").nextSibling).toHaveTextContent("1 août 2026");
    expect(screen.getByText("Organisation créée")).toBeInTheDocument();
    expect(screen.getByText("Organisation créée et configurée.")).toBeInTheDocument();
  });
});
