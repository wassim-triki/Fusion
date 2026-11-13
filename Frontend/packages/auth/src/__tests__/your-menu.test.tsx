import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { YourMenu } from "../components/your-menu";

const { mockSetLanguage, mockRefresh, mockLogout, mockSetTheme } = vi.hoisted(() => ({
  mockSetTheme: vi.fn(),
  mockSetLanguage: vi.fn(),
  mockRefresh: vi.fn(),
  mockLogout: vi.fn(),
}));

vi.mock("../language", () => ({ useLanguage: () => ["en", mockSetLanguage, false] }));
vi.mock("../auth-context", () => ({ useAuth: () => ({ logout: mockLogout }) }));
vi.mock("@repo/api/query", () => ({
  useRefreshFusionAttention: () => mockRefresh,
  useFusionNavigation: () => ({ person: { name: "Mariam Gharbi", photo: null, detail: "VP, Product", detailPending: false } }),
}));
vi.mock("@repo/api/react", () => ({
  useFusionViewer: () => ({ viewer: { canOpenOwnProfile: true }, isLoading: false }),
}));
vi.mock("@repo/ds/shell", () => ({
  useTheme: () => ({ theme: "dark", resolvedTheme: "dark", setTheme: mockSetTheme }),
}));

beforeEach(() => {
  mockSetLanguage.mockReset();
  mockRefresh.mockReset();
});

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Your menu" }));
  return screen.getByRole("menu");
}

describe("YourMenu", () => {
  it("opens from your face with your profile, notifications, language, appearance and sign out (D-82)", async () => {
    render(<YourMenu />);
    const menu = await openMenu();
    expect(menu).toHaveTextContent("Mariam Gharbi");
    expect(menu).toHaveTextContent("VP, Product");
    expect(screen.getByRole("menuitem", { name: "Your profile" })).toHaveAttribute("href", "/core/profile");
    expect(screen.getByRole("menuitem", { name: "Notifications" })).toHaveAttribute("href", "/settings/notifications");
    expect(screen.getByRole("menuitem", { name: /Language/ })).toHaveTextContent("English");
    expect(screen.getByRole("switch", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("switches between dark and light from one switch (B-449)", async () => {
    render(<YourMenu />);
    await openMenu();
    await userEvent.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("saves the language on the account, then asks the bell again in it", async () => {
    mockSetLanguage.mockResolvedValue(undefined);
    render(<YourMenu />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /Language/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Français" }));

    expect(mockSetLanguage).toHaveBeenCalledWith("fr");
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("says when the save fails and leaves the bell alone", async () => {
    mockSetLanguage.mockRejectedValue(new Error("offline"));
    render(<YourMenu />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /Language/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Français" }));

    // Picking closes the menu; reopened, the language row says the save failed.
    await waitFor(() => expect(mockSetLanguage).toHaveBeenCalledWith("fr"));
    await openMenu();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /Language/ })).toHaveTextContent("Not saved, try again"));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
