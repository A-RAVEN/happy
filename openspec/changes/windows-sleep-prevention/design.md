## Context

The happy CLI daemon runs as a background process on the user's machine, maintaining a persistent Socket.IO WebSocket connection to the cloud server. When active sessions exist, the daemon must keep the machine awake so mobile app users can continue communicating with Claude.

Currently, only macOS has sleep prevention (`caffeinate -im`). Windows has no equivalent mechanism. When Windows enters sleep, all processes suspend, connections drop, and session state may not recover cleanly on wake.

The existing `caffeinate.ts` module already has a clean abstraction: `startCaffeinate()` returns boolean, `stopCaffeinate()` tears down, `isCaffeinateRunning()` checks status. The design extends this module without changing its public API.

## Goals / Non-Goals

**Goals:**
- Prevent Windows system sleep while the daemon has active tracked sessions
- Release sleep prevention when the daemon shuts down
- Keep the existing macOS path unchanged
- No new npm dependencies

**Non-Goals:**
- Screen-off / display sleep prevention (only system sleep)
- Per-session granularity (entire daemon lifecycle is fine)
- Linux sleep prevention (already partially handled by `caffeinate` approach)

## Decisions

### Decision 1: Use PowerShell `powercfg` over native `SetThreadExecutionState`

**Chosen: PowerShell `powercfg /change standby-timeout-ac 0` and equivalent commands**

Alternatives considered:

| Approach | Pros | Cons |
|----------|------|------|
| `SetThreadExecutionState` via `kernel32.dll` (ffi) | Canonical Windows API, per-thread | Requires native Node addon (`ffi-napi` or `koffi`), complex setup, build toolchain dependency |
| PowerShell `powercfg` | Zero dependencies, simple `child_process.exec`, safe | Modifies global power settings temporarily — must restore on exit |
| `powercfg /requests` override | Clean, well-known Windows admin pattern | Same as above |

**Rationale**: PowerShell execution via `child_process` is already used in the codebase (`src/utils/spawnHappyCLI.ts`). The `powercfg` approach is simple, reliable, and adds no build complexity. We set `standby-timeout-ac` to `0` (never) on start, and restore the original value on stop. This is the same pattern used by many developer tools on Windows.

### Decision 2: Save and restore original power settings

On `startCaffeinate()` (Windows):
1. Query current `standby-timeout-ac` and `standby-timeout-dc` values
2. Set both to `0` (never)
3. Store original values for restoration

On `stopCaffeinate()` (Windows):
1. Restore original `standby-timeout-ac` and `standby-timeout-dc` values
2. Kill the PowerShell process if still running

### Decision 3: Handle daemon crash / unexpected exit

Register cleanup handlers (`exit`, `SIGINT`, `SIGTERM`, `uncaughtException`, `unhandledRejection`) to restore power settings. This is already wired up in the existing `setupCleanupHandlers()` function.

## Risks / Trade-offs

- **[Risk] PowerShell not available (Windows Server Core, minimal installs)** → Gracefully log a warning and return `false` — daemon will still run without sleep prevention
- **[Risk] Power settings not restored on hard crash** → Settings are restored on next daemon start (query-then-override pattern is idempotent)
- **[Risk] Admin privileges required for `powercfg`** → `powercfg /change` works without admin on most Windows 10/11 systems; if it fails, log warning and continue
