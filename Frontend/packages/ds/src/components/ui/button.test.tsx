import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setWriteLock } from "../../lib/write-lock";
import { AsyncButton } from "../../shell/async-button";
import { Button } from "./button";

afterEach(() => {
  cleanup();
  act(() => setWriteLock(null));
});

describe("Changes locked while seeing Fusion as someone (B-220)", () => {
  it("keeps a button that changes something, greyed, and says why on focus", async () => {
    const save = vi.fn();
    render(<><Button writes onClick={save}>Save</Button><Button onClick={vi.fn()}>Show</Button></>);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    act(() => setWriteLock("You're seeing Fusion as Aicha Bouazizi, so nothing can be changed"));
    const locked = screen.getByRole("button", { name: "Save" });
    expect(locked).toBeDisabled();
    fireEvent.click(locked);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show" })).toBeEnabled();

    act(() => locked.parentElement!.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("You're seeing Fusion as Aicha Bouazizi");
  });

  it("turns a link into its greyed label, and an async action is a change by default", () => {
    act(() => setWriteLock("Locked"));
    render(<><Button writes asChild><a href="/people/add">Add people</a></Button><AsyncButton pending={false}>Send</AsyncButton></>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add people" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
