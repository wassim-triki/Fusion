// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@repo/api";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { useLanding } from "./use-landing";

function List({ ready, onMissing }: { ready: boolean; onMissing?: (id: string) => void }) {
  useLanding("feedback", ready, onMissing);
  return ready ? (
    <ul>
      <li id="feedback-a">A</li>
      <li id="feedback-b">B</li>
    </ul>
  ) : null;
}

describe("useLanding", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("outlines the item the hash names once its list has loaded, once per mount", () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.replaceState(null, "", "/feedback?tab=received#feedback-b");
    const { rerender } = render(<List ready={false} />);
    rerender(<List ready />);
    expect(screen.getByText("B").classList.contains("animate-land")).toBe(true);
    expect(screen.getByText("A").classList.contains("animate-land")).toBe(false);
    rerender(<List ready />);
    screen.getByText("B").classList.remove("animate-land");
    rerender(<List ready />);
    expect(screen.getByText("B").classList.contains("animate-land")).toBe(false);
    screen.getByText("B").classList.add("animate-land");

    // An animation ending inside the item doesn't cut the outline short; its own end does.
    const inner = document.createElement("span");
    screen.getByText("B").append(inner);
    inner.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(screen.getByText("B").classList.contains("animate-land")).toBe(true);
    screen.getByText("B").dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(screen.getByText("B").classList.contains("animate-land")).toBe(false);
  });

  it("hands over an item that isn't on the page", () => {
    const onMissing = vi.fn();
    window.history.replaceState(null, "", "/feedback#feedback-zz");
    render(<List ready onMissing={onMissing} />);
    expect(onMissing).toHaveBeenCalledWith("zz");
  });
});

describe("ContentUnavailable", () => {
  it("says plainly that something gone is no longer here and goes back to its list, without a retry", () => {
    render(<ContentUnavailable error={new ApiError(404, "Not Found", ["Not found"], null)} onRetry={vi.fn()} list="oneOnOnes" />);
    expect(screen.getByRole("heading", { name: "This is no longer here" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to 1:1s" }).getAttribute("href")).toBe("/performance/one-on-ones");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
