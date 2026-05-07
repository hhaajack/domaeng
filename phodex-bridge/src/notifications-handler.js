// FILE: notifications-handler.js
// Purpose: Intercepts notifications/push/* bridge RPCs and forwards device registration to the configured push service.
// Layer: Bridge handler
// Exports: createNotificationsHandler
// Depends on: none

function createNotificationsHandler({ pushServiceClient, logPrefix = "[remodex]" } = {}) {
  function handleNotificationsRequest(rawMessage, sendResponse) {
    let parsed;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return false;
    }

    const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
    if (!isNotificationsMethod(method)) {
      return false;
    }

    const id = parsed.id;
    const params = parsed.params || {};

    handleNotificationsMethod(method, params)
      .then((result) => {
        sendResponse(JSON.stringify({ id, result }));
      })
      .catch((error) => {
        console.error(`${logPrefix} push notification request failed: ${error.message}`);
        sendResponse(JSON.stringify({
          id,
          error: {
            code: -32000,
            message: error.userMessage || error.message || "Push notification request failed.",
            data: {
              errorCode: error.errorCode || "push_notification_failed",
            },
          },
        }));
      });

    return true;
  }

  async function handleNotificationsMethod(method, params) {
    if (!pushServiceClient?.hasConfiguredBaseUrl) {
      return { ok: false, skipped: true };
    }

    if (method === "notifications/webPush/publicKey") {
      return pushServiceClient.getWebPushPublicKey();
    }

    if (method === "notifications/webPush/register") {
      const subscription = normalizeWebPushSubscription(params.subscription);
      if (!subscription) {
        throw notificationsError(
          "missing_web_push_subscription",
          "notifications/webPush/register requires a valid subscription."
        );
      }

      await pushServiceClient.registerWebPush({
        subscription,
        alertsEnabled: params.alertsEnabled !== false,
      });

      return {
        ok: true,
        alertsEnabled: params.alertsEnabled !== false,
      };
    }

    if (method === "notifications/webPush/unregister") {
      await pushServiceClient.unregisterWebPush({
        endpoint: readString(params.endpoint) || undefined,
      });
      return { ok: true };
    }

    const deviceToken = readString(params.deviceToken);
    const alertsEnabled = Boolean(params.alertsEnabled);
    const apnsEnvironment = readAPNsEnvironment(params.appEnvironment);
    if (!deviceToken) {
      throw notificationsError(
        "missing_device_token",
        "notifications/push/register requires a deviceToken."
      );
    }

    await pushServiceClient.registerDevice({
      deviceToken,
      alertsEnabled,
      apnsEnvironment,
    });

    return {
      ok: true,
      alertsEnabled,
      apnsEnvironment,
    };
  }

  return {
    handleNotificationsRequest,
  };
}

function isNotificationsMethod(method) {
  return method === "notifications/push/register"
    || method === "notifications/webPush/publicKey"
    || method === "notifications/webPush/register"
    || method === "notifications/webPush/unregister";
}

function normalizeWebPushSubscription(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const endpoint = readString(value.endpoint);
  const keys = value.keys && typeof value.keys === "object" && !Array.isArray(value.keys)
    ? value.keys
    : {};
  const p256dh = readString(keys.p256dh);
  const auth = readString(keys.auth);
  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  const subscription = {
    endpoint,
    keys: { p256dh, auth },
  };
  if (typeof value.expirationTime === "number") {
    subscription.expirationTime = value.expirationTime;
  } else if (value.expirationTime === null) {
    subscription.expirationTime = null;
  }
  return subscription;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readAPNsEnvironment(value) {
  return value === "development" ? "development" : "production";
}

function notificationsError(errorCode, userMessage) {
  const error = new Error(userMessage);
  error.errorCode = errorCode;
  error.userMessage = userMessage;
  return error;
}

module.exports = {
  createNotificationsHandler,
};
