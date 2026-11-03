// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActivateInvitation } from "./activate-invitation";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("credential=test-credential"),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the first administrator's work choice and conditional job title connected", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          state: "account_creation",
          tenantName: "Test Company",
          invitedEmail: "admin@example.test",
          expiresAt: null,
          firstName: "Test",
          lastName: "Person",
          passwordRequirements: null,
        },
      }),
    })
  );
  render(<ActivateInvitation />);
  const yes = await screen.findByRole("radio", { name: "Yes, I work here" });
  const no = screen.getByRole("radio", {
    name: "No, I'm setting it up for them",
  });
  expect(yes.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByLabelText("Your job title")).toBeTruthy();
  fireEvent.click(no);
  expect(no.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByLabelText("Your job title")).toBeNull();
  fireEvent.click(yes);
  expect(screen.getByLabelText("Your job title")).toBeTruthy();
});
