import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FusionSettingsSection, FusionTenantSummaryDto } from "@repo/api";

const mocks = vi.hoisted(() => ({
  summary: undefined as FusionTenantSummaryDto | undefined,
  save: vi.fn(),
  emailPreview: vi.fn(),
}));

vi.mock("@repo/api/query", async () => {
  const actual = await vi.importActual<typeof import("@repo/api/query")>("@repo/api/query");
  return {
    ...actual,
    useTenantSummary: () => ({ data: mocks.summary, error: null, refetch: vi.fn() }),
  };
});

vi.mock("@repo/api", async () => {
  const actual = await vi.importActual<typeof import("@repo/api")>("@repo/api");
  return {
    ...actual,
    createCompanyBrandApi: () => ({ save: mocks.save, emailPreview: mocks.emailPreview, company: vi.fn() }),
  };
});

vi.mock("@repo/api/react", async () => {
  const actual = await vi.importActual<typeof import("@repo/api/react")>("@repo/api/react");
  return { ...actual, useFusionViewer: () => ({ viewer: { fullName: "Amira Khelifi" }, isLoading: false }) };
});

import { IntlTestProvider } from "@repo/ds/testing";
import dsEn from "@repo/ds/messages/en.json";
import { loadCoreMessages } from "@/i18n/messages";
import { BrandSettings } from "./sections/brand";

const en = await loadCoreMessages("en");

class Observer {
  observe() {}
  disconnect() {}
}

const SUMMARY: FusionTenantSummaryDto = {
  tenantId: "t-carthage",
  name: "Carthage Digital Group",
  slug: "carthage",
  brandColor: null,
  logoUrl: null,
  language: "en",
};

function section(access: "view" | "manage"): FusionSettingsSection {
  return { id: "brand", label: "Brand", order: 1, path: "/core/settings/brand", access, lastChange: null };
}

function renderStudio(access: "view" | "manage") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IntlTestProvider messages={{ ...dsEn, ...en }}>
        <BrandSettings section={section(access)} />
      </IntlTestProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", Observer);
  mocks.summary = SUMMARY;
  mocks.save.mockReset();
  mocks.emailPreview.mockReset();
  mocks.emailPreview.mockResolvedValue({ subject: "s", html: "<p>mail</p>", logoContentId: "company-logo" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Brand studio", () => {
  it("changes nothing until the save, then sends name, colour, language and the logo together", async () => {
    mocks.save.mockResolvedValue({ ...SUMMARY, name: "Carthage", brandColor: "#2f5fd0", language: "ar" });
    const user = userEvent.setup();
    renderStudio("manage");

    const name = screen.getByLabelText("Company name");
    await user.clear(name);
    await user.type(name, "Carthage");
    await user.click(screen.getByRole("button", { name: "#2f5fd0" }));
    await user.click(screen.getByRole("radio", { name: "العربية" }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        name: "Carthage",
        color: "#2f5fd0",
        language: "ar",
        logo: "keep",
        logoPng: null,
      }),
    );
  });

  it("previews Home in the draft language, right to left in Arabic", async () => {
    const user = userEvent.setup();
    renderStudio("manage");
    await user.click(screen.getByRole("radio", { name: "العربية" }));
    const home = screen.getByRole("img", { name: "Home" });
    expect(home.firstElementChild?.nextElementSibling).toHaveAttribute("dir", "rtl");
    expect(home).toHaveTextContent("صباح الخير، Amira");
  });

  it("shows a view-only reader the brand without anything to change", () => {
    renderStudio("view");
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });
});
