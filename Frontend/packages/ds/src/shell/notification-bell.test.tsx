import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell, notificationDay, relativeStamp, type NotificationBellItem } from "./notification-bell";
import { renderWithIntl } from "../testing/intl";
import fr from "../messages/fr.json";

const now = new Date("2026-10-15T12:00:00Z");
const performance = { key: "performance", label: "Performance", status: "ready" as const };

function item(id: string, readAt: string | null = null): NotificationBellItem {
  return {
    id,
    module: "performance",
    title: `Nour submitted their plan ${id}`,
    context: "Ready for your review",
    actorName: "Nour Ben Ali",
    occurredAt: "2026-10-15T11:30:00Z",
    readAt,
  };
}

describe("NotificationBell", () => {
  it("marks unread notifications on the trigger", () => {
    render(
      <NotificationBell items={[item("1")]} unreadCount={1} modules={[performance]} onOpenItem={vi.fn()} onMarkAllRead={vi.fn()} now={now} />,
    );
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
    expect(screen.getByTestId("notification-unread-mark")).toBeInTheDocument();
  });

  it("shows a one-line empty state and no unread mark", async () => {
    render(<NotificationBell items={[]} unreadCount={0} modules={[performance]} onOpenItem={vi.fn()} onMarkAllRead={vi.fn()} now={now} />);
    expect(screen.queryByTestId("notification-unread-mark")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("No notifications yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
  });

  it("names a module that failed to load", async () => {
    render(
      <NotificationBell
        items={[]}
        unreadCount={0}
        modules={[{ ...performance, status: "error" }]}
        onOpenItem={vi.fn()}
        onMarkAllRead={vi.fn()}
        now={now}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("Performance notifications couldn't be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No notifications yet")).not.toBeInTheDocument();
  });

  it("opens an entry and offers to mark all read", async () => {
    const onOpenItem = vi.fn();
    const onMarkAllRead = vi.fn();
    render(
      <NotificationBell
        items={[item("1"), item("2", "2026-10-15T11:45:00Z")]}
        unreadCount={1}
        modules={[performance]}
        onOpenItem={onOpenItem}
        onMarkAllRead={onMarkAllRead}
        now={now}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await userEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(onMarkAllRead).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByText("Nour submitted their plan 1"));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
  });

  it("filters by module only when several modules serve notifications", async () => {
    const core = { key: "core", label: "Core HR", status: "ready" as const };
    render(
      <NotificationBell
        items={[item("1"), { ...item("2"), module: "core", title: "Core item" }]}
        unreadCount={2}
        modules={[performance, core]}
        onOpenItem={vi.fn()}
        onMarkAllRead={vi.fn()}
        now={now}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Core HR" }));
    expect(screen.getByText("Core item")).toBeInTheDocument();
    expect(screen.queryByText("Nour submitted their plan 1")).not.toBeInTheDocument();
  });

  it("speaks French around the notifications themselves", async () => {
    renderWithIntl(
      <NotificationBell items={[item("1")]} unreadCount={1} modules={[performance]} onOpenItem={vi.fn()} onMarkAllRead={vi.fn()} now={now} />,
      { locale: "fr", messages: fr },
    );
    await userEvent.click(screen.getByRole("button", { name: "Notifications, 1 non lue" }));
    expect(screen.getByRole("button", { name: "Tout marquer comme lu" })).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
    // The notification's own words come from the server and stay as sent until phase 5.
    expect(screen.getByText("Nour submitted their plan 1")).toBeInTheDocument();
  });

  it("groups the panel into Today, Yesterday and Earlier", async () => {
    render(
      <NotificationBell
        items={[
          { ...item("1"), title: "Today's" },
          { ...item("2"), title: "Yesterday's", occurredAt: "2026-10-14T09:00:00Z" },
          { ...item("3"), title: "Older", occurredAt: "2026-10-03T09:00:00Z" },
        ]}
        unreadCount={3}
        modules={[performance]}
        onOpenItem={vi.fn()}
        onMarkAllRead={vi.fn()}
        now={now}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Today", "Yesterday", "Earlier"]);
    expect(notificationDay("2026-10-15T00:30:00", new Date("2026-10-15T23:00:00"))).toBe("today");
  });

  it("pops up what arrives and opens it", async () => {
    const onOpenItem = vi.fn();
    const arrived = { ...item("9"), title: "Hana Belhaj gave you feedback", actorName: "Hana Belhaj", badge: "feedback" as const };
    render(
      <NotificationBell
        items={[arrived, item("1")]}
        unreadCount={2}
        modules={[performance]}
        onOpenItem={onOpenItem}
        onMarkAllRead={vi.fn()}
        arrival={{ seq: 1, items: [arrived] }}
        sound={false}
        now={now}
      />,
    );
    const popup = await screen.findByRole("status");
    expect(popup).toHaveTextContent("Hana Belhaj gave you feedback");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "9" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("collapses a burst into one pop-up that shows the panel", async () => {
    const burst = [
      { ...item("7"), actorName: "Sami Gharbi" },
      { ...item("8"), actorName: "Leila Mansour" },
      { ...item("9"), actorName: "Hana Belhaj" },
    ];
    render(
      <NotificationBell
        items={burst}
        unreadCount={3}
        modules={[performance]}
        onOpenItem={vi.fn()}
        onMarkAllRead={vi.fn()}
        arrival={{ seq: 1, items: burst }}
        sound={false}
        now={now}
      />,
    );
    const popup = await screen.findByRole("status");
    expect(popup).toHaveTextContent("3 new notifications");
    expect(popup).toHaveTextContent("Sami Gharbi, Leila Mansour, and Hana Belhaj");
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeInTheDocument();
  });

  it("stays quiet when pop-ups are off, and puts the count in the tab title", () => {
    document.title = "Home · Fusion";
    const arrived = item("9");
    const { unmount } = render(
      <NotificationBell
        items={[arrived]}
        unreadCount={2}
        modules={[performance]}
        onOpenItem={vi.fn()}
        onMarkAllRead={vi.fn()}
        arrival={{ seq: 1, items: [arrived] }}
        popups={false}
        sound={false}
        now={now}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.title).toBe("(2) Home · Fusion");
    unmount();
    expect(document.title).toBe("Home · Fusion");
  });

  it("stamps time relatively", () => {
    expect(relativeStamp("2026-10-15T11:59:40Z", now)).toBe("now");
    expect(relativeStamp("2026-10-15T11:30:00Z", now)).toBe("30m");
    expect(relativeStamp("2026-10-14T09:00:00Z", now)).toBe("Yesterday");
  });
});
