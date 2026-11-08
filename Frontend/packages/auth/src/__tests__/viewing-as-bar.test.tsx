import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@repo/ds";
import { IntlTestProvider } from "@repo/ds/testing";
import dsEn from "@repo/ds/messages/en.json";
import authEn from "../messages/en.json";
import { ViewingAsBar } from "../components/viewing-as-bar";

vi.mock("@repo/api", async (original) => ({
  ...(await original<object>()),
  readViewAs: () => ({ sessionId: "s1", viewerName: "Amira Khelifi", personName: "Aicha Bouazizi", roles: [], returnTo: "/", expiresAt: "2099-01-01T00:00:00Z" }),
}));

describe("Seeing Fusion as someone (B-220)", () => {
  it("locks changes on the page while the bar shows, and lets them go when it leaves", async () => {
    const view = render(
      <IntlTestProvider locale="en" messages={{ ...dsEn, ...authEn }}>
        <ViewingAsBar />
        <Button writes>Save</Button>
      </IntlTestProvider>,
    );
    expect(await screen.findByText("Seeing Fusion as Aicha Bouazizi")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(
      <IntlTestProvider locale="en" messages={{ ...dsEn, ...authEn }}>
        <Button writes>Save</Button>
      </IntlTestProvider>,
    );
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
