"use client";

import { useRouter } from "next/navigation";
import { useFusionNotifications, usePhotos } from "@repo/api/query";
import { resolveFusionAttentionModules, useAuth, useNotificationAlerts } from "@repo/auth";
import { NotificationBell } from "@repo/ds/shell";

/**
 * The Fusion bell on the home. Every notification path belongs to a module app, so opening one
 * marks it read, waits for that to land, then fully navigates.
 */
export function ShellNotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const notifications = useFusionNotifications(resolveFusionAttentionModules(user), { enabled: Boolean(user?.tenantId) });
  const { alerts } = useNotificationAlerts();
  const photos = usePhotos(notifications.items.map((item) => item.actorPhotoUrl));
  if (!user?.tenantId) return null;

  return (
    <NotificationBell
      items={notifications.items}
      unreadCount={notifications.unreadCount}
      modules={notifications.modules}
      arrival={notifications.arrival}
      popups={alerts.popups}
      sound={alerts.sound}
      photos={photos}
      onOpenSettings={() => router.push("/settings/notifications")}
      onMarkAllRead={() => void notifications.markAllRead()}
      onOpenItem={(item) => {
        const notification = notifications.items.find((candidate) => candidate.id === item.id && candidate.module === item.module);
        if (!notification) return;
        void notifications.markRead(notification).finally(() => window.location.assign(notification.href));
      }}
    />
  );
}
