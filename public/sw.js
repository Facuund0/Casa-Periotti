/*
 * Service worker de Casa Periotti. Hoy hace una sola cosa: recibir las
 * notificaciones push de los empleados y abrir la pantalla del panel
 * donde se resuelve el aviso. No cachea nada: el panel necesita datos
 * frescos, y el catálogo ya lo maneja Next.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Casa Periotti";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/admin";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // Agrupa por tipo: un aviso nuevo del mismo tipo reemplaza al anterior.
      tag: data.tag || "casa-periotti",
      renotify: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/admin";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Si el panel ya está abierto, se enfoca esa pestaña y se la lleva
      // a la pantalla del aviso, en vez de abrir otra.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
