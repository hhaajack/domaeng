// FILE: account-rate-limits-handler.test.js
// Purpose: Verifies rate-limit reads fall back to local rollout snapshots when live account auth is unavailable.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/account-rate-limits-handler

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleChatgptAuthTokensRefreshRequest,
  readAccountRateLimitsWithFallback,
  shouldUseRateLimitFallback,
} = require("../src/account-rate-limits-handler");

test("readAccountRateLimitsWithFallback returns live rate limits when the runtime read succeeds", async () => {
  const result = await readAccountRateLimitsWithFallback({
    readLiveRateLimits: async () => ({
      rateLimits: {
        limit_id: "codex",
        primary: {
          used_percent: 7,
        },
      },
    }),
    readFallbackRateLimits: async () => {
      throw new Error("fallback should not be used");
    },
  });

  assert.equal(result.rateLimits.primary.used_percent, 7);
});

test("readAccountRateLimitsWithFallback refreshes live account state before reading usage", async () => {
  const calls = [];
  const result = await readAccountRateLimitsWithFallback({
    refreshLiveAccount: async () => {
      calls.push("refresh-account");
    },
    readLiveRateLimits: async () => {
      calls.push("read-rate-limits");
      return {
        rateLimits: {
          limit_id: "codex",
          primary: {
            used_percent: 11,
          },
        },
      };
    },
  });

  assert.deepEqual(calls, ["refresh-account", "read-rate-limits"]);
  assert.equal(result.rateLimits.primary.used_percent, 11);
});

test("readAccountRateLimitsWithFallback uses rollout data for auth-gated rate limit errors", async () => {
  const liveError = new Error("codex account authentication required to read rate limits");
  const result = await readAccountRateLimitsWithFallback({
    readLiveRateLimits: async () => {
      throw liveError;
    },
    readFallbackRateLimits: async () => ({
      rolloutPath: "/private/tmp/rollout.jsonl",
      rateLimits: {
        limit_id: "codex",
        primary: {
          used_percent: 34,
          window_minutes: 300,
        },
      },
      rateLimitsByLimitId: {
        codex: {
          limit_id: "codex",
          primary: {
            used_percent: 34,
            window_minutes: 300,
          },
        },
      },
    }),
  });

  assert.deepEqual(result, {
    source: "rollout",
    rateLimits: {
      limit_id: "codex",
      primary: {
        used_percent: 34,
        window_minutes: 300,
      },
    },
    rateLimitsByLimitId: {
      codex: {
        limit_id: "codex",
        primary: {
          used_percent: 34,
          window_minutes: 300,
        },
      },
    },
  });
});

test("readAccountRateLimitsWithFallback blocks stale rollout fallback after account changes", async () => {
  const liveError = new Error("codex account authentication required to read rate limits");

  await assert.rejects(
    readAccountRateLimitsWithFallback({
      readLiveRateLimits: async () => {
        throw liveError;
      },
      readFallbackRateLimits: async () => ({
        rateLimits: {
          limit_id: "codex",
          primary: {
            used_percent: 34,
          },
        },
      }),
      allowFallback: () => false,
    }),
    (error) => error?.errorCode === "rate_limits_refresh_pending"
      && /fresh live account/i.test(error.message)
  );
});

test("readAccountRateLimitsWithFallback preserves non-auth failures", async () => {
  const liveError = new Error("runtime crashed while reading account status");

  await assert.rejects(
    readAccountRateLimitsWithFallback({
      readLiveRateLimits: async () => {
        throw liveError;
      },
      readFallbackRateLimits: async () => ({
        rateLimits: {
          limit_id: "codex",
          primary: {
            used_percent: 10,
          },
        },
      }),
    }),
    (error) => error === liveError
  );
});

test("shouldUseRateLimitFallback recognizes rejected external ChatGPT token refreshes", () => {
  const error = new Error("Codex request failed");
  error.data = {
    errorCode: "chatgpt_auth_token_refresh_unavailable",
  };

  assert.equal(shouldUseRateLimitFallback(error), true);
  assert.equal(
    shouldUseRateLimitFallback(
      new Error("Domaeng cannot refresh ChatGPT auth tokens owned by another Codex client.")
    ),
    true
  );
});

test("handleChatgptAuthTokensRefreshRequest rejects unsupported external token refreshes without forwarding", () => {
  const responses = [];
  const handled = handleChatgptAuthTokensRefreshRequest(JSON.stringify({
    id: "server-auth-refresh-1",
    method: "account/chatgptAuthTokens/refresh",
    params: {
      reason: "unauthorized",
      previousAccountId: "acct_123",
    },
  }), (response) => responses.push(JSON.parse(response)));

  assert.equal(handled, true);
  assert.deepEqual(responses, [{
    id: "server-auth-refresh-1",
    error: {
      code: -32001,
      message: "Domaeng cannot refresh ChatGPT auth tokens owned by another Codex client.",
      data: {
        errorCode: "chatgpt_auth_token_refresh_unavailable",
      },
    },
  }]);
});
