"use client";

import { useRouter } from "next/navigation";
import { useFusionNotifications, usePhotos } from "@repo/api/query";
import { resolveFusionAttentionModules, useAuth, useNotificationAlerts } from "@repo/auth";
import { NotificationBell } from "@repo/ds/shell";

const BASE_PATH = "/core";

/**
 * The Fusion bell in Core HR's top bar. Opening an entry marks it read, then navigates: inside
 * Core HR with the router, to another app with a full navigation (each app is its own MFE).
 */
export function FusionNotificationBell() {
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
      onOpenSettings={() => window.location.assign("/settings/notifications")}
      onMarkAllRead={() => void notifications.markAllRead()}
      onOpenItem={(item) => {
        const notification = notifications.items.find((candidate) => candidate.id === item.id && candidate.module === item.module);
        if (!notification) return;
        const read = notifications.markRead(notification);
        if (notification.href === BASE_PATH || notification.href.startsWith(`${BASE_PATH}/`)) {
          router.push(notification.href.slice(BASE_PATH.length) || "/");
        } else {
          // A full navigation unloads the page, so let the read land first.
          void read.finally(() => window.location.assign(notification.href));
        }
      }}
    />
  );
}
