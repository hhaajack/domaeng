self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title = readString(payload.title) || "Remodex";
  const body = readString(payload.body) || "Thread status changed.";
  const tag = readString(payload.tag) || `${readString(payload.kind) || "thread"}:${readString(payload.threadId) || "unknown"}`;
  const iconURL = new URL("favicon.svg", self.registration.scope).toString();

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    icon: iconURL,
    badge: iconURL,
    data: {
      threadId: readString(payload.threadId),
      kind: readString(payload.kind),
      source: readString(payload.source),
      url: appURLForThread(readString(payload.threadId)),
    },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetURL = readString(event.notification.data && event.notification.data.url)
    || appURLForThread(readString(event.notification.data && event.notification.data.threadId));

  event.waitUntil((async () => {
    const windows = await clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of windows) {
      if (sameApp(client.url, targetURL)) {
        await client.focus();
        client.postMessage({
          type: "remodex:openThread",
          threadId: readString(event.notification.data && event.notification.data.threadId),
        });
        return;
      }
    }
    await clients.openWindow(targetURL);
  })());
});

function readPushPayload(event) {
  if (!event.data) {
    return {};
  }
  try {
    return event.data.json();
  } catch {
    return {};
  }
}

function appURLForThread(threadId) {
  const url = new URL(self.registration.scope || "/app/", self.location.origin);
  if (threadId) {
    url.hash = `thread=${encodeURIComponent(threadId)}`;
  }
  return url.toString();
}

function sameApp(candidate, target) {
  try {
    const candidateURL = new URL(candidate);
    const targetURL = new URL(target);
    return candidateURL.origin === targetURL.origin
      && candidateURL.pathname.startsWith(new URL(self.registration.scope).pathname)
      && targetURL.pathname.startsWith(new URL(self.registration.scope).pathname);
  } catch {
    return false;
  }
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
