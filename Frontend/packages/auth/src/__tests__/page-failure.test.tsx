import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "@repo/api";
import { IntlTestProvider } from "@repo/ds/testing";
import dsEn from "@repo/ds/messages/en.json";
import authEn from "../messages/en.json";
import { PageFailure, PageNotFound, PageRefusal } from "../components/page-failure";

const mocks = vi.hoisted(() => ({
  answer: { isLoading: false, data: undefined as unknown },
  viewer: { tenantId: "t1", moduleEntitlements: ["CoreHR", "Performance"], enterableModules: ["core", "performance"] } as unknown,
}));
vi.mock("@repo/api/query", async (original) => ({
  ...(await original<object>()),
  useCompanyAdministrators: () => mocks.answer,
}));
vi.mock("@repo/api/react", async (original) => ({
  ...(await original<object>()),
  useFusionViewer: () => ({ viewer: mocks.viewer, isLoading: false }),
}));

const failure = (status: number) => new ApiError(status, "", [`secret detail ${status}`], null);

function show(node: React.ReactNode) {
  return render(
    <IntlTestProvider locale="en" messages={{ ...dsEn, ...authEn }}>
      {node}
    </IntlTestProvider>,
  );
}

beforeEach(() => {
  mocks.answer = { isLoading: false, data: undefined };
  window.history.replaceState(null, "", "/performance/reviews");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PageRefusal", () => {
  it("names who can give access, with a way to write to them, and goes to the module's Overview", () => {
    mocks.answer = {
      isLoading: false,
      data: {
        callerIsAdministrator: false,
        administrators: [
          { name: "Amira Khelifi", firstName: "Amira", email: "amira@example.test" },
          { name: "Omar Mansour", firstName: "Omar", email: "omar@example.test" },
        ],
      },
    };
    show(<PageRefusal />);
    expect(screen.getByRole("heading", { name: "You don't have access to this page" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Email Amira" }).getAttribute("href")).toBe("mailto:amira@example.test");
    expect(screen.getByRole("link", { name: "Email Omar" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Overview" }).getAttribute("href")).toBe("/performance");
  });

  it("says your administrator when the read failed", () => {
    show(<PageRefusal />);
    expect(screen.getByText("Your administrator can give you access.")).toBeTruthy();
  });

  it("never tells an administrator to ask themselves", () => {
    mocks.answer = { isLoading: false, data: { callerIsAdministrator: true, administrators: [] } };
    show(<PageRefusal />);
    expect(screen.queryByText(/can give you access/)).toBeNull();
  });
});

describe("PageFailure", () => {
  it("never shows the error's own words", () => {
    show(<PageFailure error={failure(500)} onRetry={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "This page didn't load" })).toBeTruthy();
    expect(screen.queryByText(/secret detail/)).toBeNull();
  });

  it("shows the code when there is one and reads right without it", () => {
    const view = show(<PageFailure error={new Error("x")} onRetry={vi.fn()} digest="F7A3-91C2" />);
    expect(screen.getByText("F7A3-91C2")).toBeTruthy();
    expect(screen.getByText(/send this code to your administrator/)).toBeTruthy();
    view.unmount();
    show(<PageFailure error={new Error("x")} onRetry={vi.fn()} />);
    expect(screen.queryByText(/send this code/)).toBeNull();
    expect(screen.getByText(/tell your administrator/)).toBeTruthy();
  });

  it("offers a module the company has on, and only refreshes once the service answers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const onRetry = vi.fn();
    show(<PageFailure error={failure(503)} onRetry={onRetry} />);

    expect(screen.getByRole("heading", { name: "Performance isn't responding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Core HR" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Performance" })).toBeNull();
    expect(screen.getByText("Trying again in 12s")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/performance/health", expect.anything());
    expect(onRetry).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(onRetry).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("offers no module the company doesn't have", () => {
    mocks.viewer = { tenantId: "t1", moduleEntitlements: ["Performance"], enterableModules: ["performance"] };
    show(<PageFailure error={failure(502)} onRetry={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /^Open / })).toBeNull();
    mocks.viewer = { tenantId: "t1", moduleEntitlements: ["CoreHR", "Performance"], enterableModules: ["core", "performance"] };
  });

  it("tells a dropped connection from a module that's down, and checks when it reconnects", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const onRetry = vi.fn();
    show(<PageFailure error={new TypeError("Failed to fetch")} onRetry={onRetry} />);
    expect(screen.getByRole("heading", { name: "You're offline" })).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRetry).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("refuses on a 403, and on a 404 goes back to the list the link belongs to", () => {
    const view = show(<PageFailure error={failure(403)} />);
    expect(screen.getByRole("heading", { name: "You don't have access to this page" })).toBeTruthy();
    view.unmount();
    show(<PageFailure error={failure(404)} back={{ href: "/performance/reviews", label: "Reviews" }} />);
    expect(screen.getByRole("heading", { name: "This is no longer here" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Reviews" }).getAttribute("href")).toBe("/performance/reviews");
  });

  it("keeps a piece's own title in a card and a row", () => {
    const onRetry = vi.fn();
    const view = show(<PageFailure error={failure(500)} size="card" title="Praise didn't load" onRetry={onRetry} />);
    expect(screen.getByText("Praise didn't load")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.unmount();
    show(<PageFailure error={failure(503)} size="row" title="Your 1:1s didn't load" onRetry={vi.fn()} />);
    expect(screen.getByText("Your 1:1s didn't load")).toBeTruthy();
    expect(screen.queryByText(/isn't responding/)).toBeNull();
  });
});

describe("PageNotFound", () => {
  it("offers the Overview and the search, and never the address", () => {
    window.history.replaceState(null, "", "/performance/reviews/secret-id");
    show(<PageNotFound app="performance" />);
    expect(screen.getByRole("heading", { name: "We can't find this page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Search for a page/ })).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret-id");
  });

  it("has no search where the frame has none", () => {
    show(<PageNotFound app="platform" />);
    expect(screen.queryByRole("button", { name: /Search for a page/ })).toBeNull();
  });
});
