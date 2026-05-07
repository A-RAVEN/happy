## Why

The happy CLI currently has no sleep prevention mechanism on Windows — `caffeinate.ts` is macOS-only (`process.platform !== 'darwin'` short-circuits). When a Windows machine enters sleep, all processes are suspended, WebSocket connections to the cloud server drop, and mobile app users lose communication with their Claude sessions. After wake, the daemon may not recover cleanly (stale lock files, broken auth state), requiring manual intervention to restart.

## What Changes

- Add Windows sleep prevention to `src/utils/caffeinate.ts` using `powercfg /requests` override or `SetThreadExecutionState` via a native Node addon or PowerShell
- The daemon will prevent system sleep while active sessions are running, and release sleep prevention on daemon shutdown
- The existing macOS `caffeinate -im` path remains unchanged

## Capabilities

### New Capabilities

- `windows-sleep-prevention`: Keep the Windows system awake while the happy daemon has active sessions, using OS-native APIs to request sleep inhibition and cleanly release it on shutdown.

### Modified Capabilities

<!-- No existing capabilities have requirement changes -->

## Impact

- **Affected code**: `src/utils/caffeinate.ts` — extend platform check to include Windows sleep prevention via PowerShell or native Windows API call
- **Dependencies**: No new npm dependencies needed if using `child_process.exec` with PowerShell commands; may add `@aspect-build/rules_js` or use `SetThreadExecutionState` via `ffi-napi` if choosing native API path
- **Systems**: Windows daemon process lifecycle (start → prevent sleep → allow sleep on exit)
