import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { IntlTestProvider } from "@repo/ds/testing";
import { openTopBarSearch } from "@repo/ds/shell";
import dsEn from "@repo/ds/messages/en.json";
import authEn from "../messages/en.json";
import { TopBarSearch } from "../components/top-bar-search";

vi.mock("@repo/api/react", async (original) => ({
  ...(await original<object>()),
  useFusionViewer: () => ({ viewer: null, isLoading: false }),
}));

function show() {
  render(
    <IntlTestProvider locale="en" messages={{ ...dsEn, ...authEn }}>
      <TopBarSearch />
    </IntlTestProvider>,
  );
}

describe("TopBarSearch", () => {
  it("opens with a click and lists places", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
  });

  it("opens from Ctrl K", () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens when a page asks for it, so there is one search", async () => {
    show();
    const { act } = await import("@testing-library/react");
    act(() => openTopBarSearch());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
