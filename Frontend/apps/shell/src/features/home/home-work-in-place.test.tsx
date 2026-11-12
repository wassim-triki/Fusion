// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { HomeWorkInPlace, answersInPlace } from "./home-work-in-place";

const m = vi.hoisted(() => ({ post: vi.fn(), invalidate: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: m.invalidate }) }));
vi.mock("@repo/api", async (original) => ({ ...(await original<object>()), createPlatformApiClient: () => ({ post: m.post }) }));

const offTrack = {
  id: "performance:goals-off-track:p", module: "performance", kind: "goals-off-track", title: "Fares Ayadi has 2 goals off track",
  context: "Last updated 7 Oct", href: "/performance/cycles/c/plans/p", subject: { displayName: "Fares Ayadi", employeeId: "fares" },
  lines: [{ text: "Launch the self-service portal", meta: "Off track", tone: "bad" as const }],
  quote: "Lost two people to the client escalation.",
  actions: [
    { label: "Talk it over", path: "/cycles/c/plans/p/attention/talk-it-over" },
    { label: "Ask for an update", path: "/cycles/c/plans/p/attention/ask-for-update", primary: true },
  ],
};
const booking = {
  id: "performance:one-on-one-book:aicha", module: "performance", kind: "one-on-one-book", title: "No 1:1s with Aicha Bouazizi yet",
  context: "Times you're both free", href: "/performance/one-on-ones", subject: { displayName: "Aicha Bouazizi", employeeId: "aicha" },
  booking: { slots: ["2099-11-12T10:00:00Z", "2099-11-12T15:30:00Z", "2099-11-13T10:00:00Z"], path: "/one-on-ones/with/aicha/book" },
};
const view = (item: object) => render(
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><HomeWorkInPlace item={item as never} /></NextIntlClientProvider>,
);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.post.mockResolvedValue(undefined);
});

describe("Needs you, answered in place", () => {
  it("shows the goals and the person's words, and asks for an update in one click", async () => {
    expect(answersInPlace(offTrack as never)).toBe(true);
    view(offTrack);
    expect(screen.getByText("Launch the self-service portal")).toBeTruthy();
    expect(screen.getByText("Lost two people to the client escalation.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask for an update" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/performance/cycles/c/plans/p/attention/ask-for-update", {}));
    expect(m.invalidate).toHaveBeenCalled();
  });

  it("books the time picked from those both are free", async () => {
    view(booking);
    fireEvent.click(within(screen.getByRole("group", { name: "Times you're both free" })).getAllByRole("button")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Book it" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/performance/one-on-ones/with/aicha/book", { at: "2099-11-12T15:30:00Z" }));
  });

  it("leaves a plain row alone", () => {
    expect(answersInPlace({ id: "x", module: "performance", title: "Write it", href: "/x" })).toBe(false);
  });
});
