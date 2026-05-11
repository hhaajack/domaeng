// FILE: account-rate-limits-handler.js
// Purpose: Serves account rate-limit reads with a local rollout fallback when live Codex auth is unavailable.
// Layer: Bridge handler
// Exports: handleAccountRateLimitsRequest, handleChatgptAuthTokensRefreshRequest, readAccountRateLimitsWithFallback
// Depends on: ./rollout-watch

const { readLatestRateLimitsFromRollouts } = require("./rollout-watch");

function handleAccountRateLimitsRequest(rawMessage, sendResponse, {
  readLiveRateLimits,
  refreshLiveAccount = null,
  readFallbackRateLimits = readLatestRateLimitsFromRollouts,
  allowFallback = true,
} = {}) {
  const parsed = safeParseJson(rawMessage);
  const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
  if (method !== "account/rateLimits/read") {
    return false;
  }

  const requestId = parsed.id;
  readAccountRateLimitsWithFallback({
    readLiveRateLimits,
    refreshLiveAccount,
    readFallbackRateLimits,
    allowFallback,
  })
    .then((result) => {
      sendResponse(JSON.stringify({ id: requestId, result }));
    })
    .catch((error) => {
      sendResponse(createJsonRpcErrorResponse(requestId, error, "rate_limits_read_failed"));
    });

  return true;
}

async function readAccountRateLimitsWithFallback({
  readLiveRateLimits,
  refreshLiveAccount = null,
  readFallbackRateLimits = readLatestRateLimitsFromRollouts,
  allowFallback = true,
} = {}) {
  if (typeof readLiveRateLimits !== "function") {
    throw accountRateLimitsError("rate_limits_reader_missing", "No live rate-limit reader is configured.");
  }

  try {
    if (typeof refreshLiveAccount === "function") {
      await refreshLiveAccount();
    }
    return await readLiveRateLimits();
  } catch (error) {
    if (!shouldUseRateLimitFallback(error)) {
      throw error;
    }
    if (!rateLimitFallbackAllowed(allowFallback)) {
      throw accountRateLimitsError(
        "rate_limits_refresh_pending",
        "Codex usage is waiting for fresh live account data."
      );
    }

    const fallback = typeof readFallbackRateLimits === "function"
      ? await readFallbackRateLimits()
      : null;
    if (!fallback?.rateLimits) {
      throw error;
    }

    return sanitizeFallbackRateLimits(fallback);
  }
}

function rateLimitFallbackAllowed(allowFallback) {
  if (typeof allowFallback === "function") {
    return allowFallback() !== false;
  }
  return allowFallback !== false;
}

function handleChatgptAuthTokensRefreshRequest(rawMessage, sendCodexMessage) {
  const parsed = safeParseJson(rawMessage);
  const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
  if (method !== "account/chatgptAuthTokens/refresh") {
    return false;
  }

  if (parsed.id != null && typeof sendCodexMessage === "function") {
    sendCodexMessage(JSON.stringify({
      id: parsed.id,
      error: {
        code: -32001,
        message: "Domaeng cannot refresh ChatGPT auth tokens owned by another Codex client.",
        data: {
          errorCode: "chatgpt_auth_token_refresh_unavailable",
        },
      },
    }));
  }

  return true;
}

function sanitizeFallbackRateLimits(fallback) {
  const rateLimits = fallback.rateLimits;
  const rateLimitsByLimitId = fallback.rateLimitsByLimitId || buildRateLimitsByLimitId(rateLimits);
  return {
    rateLimits,
    rateLimitsByLimitId,
    source: "rollout",
  };
}

function buildRateLimitsByLimitId(rateLimits) {
  const limitId = firstNonEmptyString([
    rateLimits?.limitId,
    rateLimits?.limit_id,
    rateLimits?.id,
  ]) || "codex";
  return {
    [limitId]: rateLimits,
  };
}

function shouldUseRateLimitFallback(error) {
  const detail = [
    error?.message,
    error?.code,
    error?.data?.errorCode,
    error?.data?.code,
  ].filter(Boolean).join(" ").toLowerCase();

  if (!detail) {
    return false;
  }

  if (detail.includes("chatgpt_auth_token_refresh_unavailable")) {
    return true;
  }
  if (detail.includes("chatgptauthtokens/refresh") || detail.includes("chatgpt auth tokens")) {
    return true;
  }

  const mentionsRateLimits = detail.includes("rate limit");
  const mentionsAuth = detail.includes("auth")
    || detail.includes("unauthorized")
    || detail.includes("sign in")
    || detail.includes("login")
    || detail.includes("token");

  return mentionsRateLimits && mentionsAuth;
}

function createJsonRpcErrorResponse(requestId, error, defaultErrorCode) {
  return JSON.stringify({
    id: requestId,
    error: {
      code: -32000,
      message: error?.userMessage || error?.message || "Bridge request failed.",
      data: {
        errorCode: error?.errorCode || defaultErrorCode,
      },
    },
  });
}

function accountRateLimitsError(errorCode, userMessage) {
  const error = new Error(userMessage);
  error.errorCode = errorCode;
  error.userMessage = userMessage;
  return error;
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function safeParseJson(rawMessage) {
  try {
    return JSON.parse(rawMessage);
  } catch {
    return null;
  }
}

module.exports = {
  handleAccountRateLimitsRequest,
  handleChatgptAuthTokensRefreshRequest,
  readAccountRateLimitsWithFallback,
  rateLimitFallbackAllowed,
  shouldUseRateLimitFallback,
};
