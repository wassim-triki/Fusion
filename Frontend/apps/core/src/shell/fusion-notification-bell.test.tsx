// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@repo/auth";
import { FusionNotificationBell } from "./fusion-notification-bell";

const mocks = vi.hoisted(() => ({
  user: null as AuthUser | null,
  push: vi.fn(),
  markRead: vi.fn(async () => {}),
  modules: [] as string[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

vi.mock("@repo/auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: mocks.user, isLoading: false }),
  useNotificationAlerts: () => ({ alerts: { popups: true, sound: true }, save: async () => {}, saving: false }),
}));

vi.mock("@repo/api/query", () => ({
  usePhotos: () => new Map(),
  useFusionNotifications: (modules: string[]) => {
    mocks.modules = modules;
    return {
      items: [
        {
          id: "n1",
          module: "performance",
          kind: "PlanApproved",
          title: "Your plan was approved",
          occurredAt: new Date().toISOString(),
          href: "/performance/cycles/c/plans/p",
          readAt: null,
        },
        {
          id: "n2",
          module: "performance",
          kind: "Other",
          title: "A Core HR page",
          occurredAt: new Date(Date.now() - 60_000).toISOString(),
          href: "/core/people/EMP-1",
          readAt: null,
        },
      ],
      unreadCount: 2,
      modules: [{ key: "performance", label: "Performance", status: "ready" }],
      markRead: mocks.markRead,
      markAllRead: vi.fn(),
    };
  },
}));

const user: AuthUser = {
  userId: "u",
  tenantId: "t",
  tenantMembershipId: "m",
  moduleEntitlements: ["CoreHR", "Performance"],
  email: "lina@example.test",
  fullName: "Lina",
  roles: ["Employee"],
  employeeId: "e",
  accessProfiles: [],
  effectivePermissions: [
    {
      permissionKey: "performance.objective.self.manage",
      scope: "Self",
      label: "",
      group: "",
      helperText: null,
      allowedScopes: ["Self"],
    },
    { permissionKey: "core.profile.self.view", scope: "Self", label: "", group: "", helperText: null, allowedScopes: ["Self"] },
  ],
};

describe("FusionNotificationBell in Core HR", () => {
  beforeEach(() => {
    mocks.user = user;
    mocks.push.mockReset();
    mocks.markRead.mockClear();
  });

  it("renders the bell with the unread count for a tenant user and reads the modules they can enter", () => {
    render(<FusionNotificationBell />);
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
    expect(mocks.modules).toEqual(["core", "performance"]);
  });

  it("isn't shown without a tenant", () => {
    mocks.user = { ...user, tenantId: null };
    const { container } = render(<FusionNotificationBell />);
    expect(container.innerHTML).toBe("");
  });

  it("marks an entry read and routes inside Core HR without a full navigation", async () => {
    render(<FusionNotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    fireEvent.click(await screen.findByText("A Core HR page"));
    expect(mocks.markRead).toHaveBeenCalledWith(expect.objectContaining({ id: "n2" }));
    expect(mocks.push).toHaveBeenCalledWith("/people/EMP-1");
  });
});
