## 1. Implement Windows sleep prevention in caffeinate module

- [x] 1.1 Add `queryCurrentStandbyTimeout()` helper that runs `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` and parses the current AC and DC timeout values in seconds
- [x] 1.2 Add `setStandbyTimeout(acSeconds, dcSeconds)` helper that runs `powercfg /change standby-timeout-ac <val>` and `powercfg /change standby-timeout-dc <val>`
- [x] 1.3 Extend `startCaffeinate()` to handle `process.platform === 'win32'`: query current timeouts, save to module-level variables, set both to `0`, return `true`; wrap in try/catch, return `false` on failure
- [x] 1.4 Extend `stopCaffeinate()` to handle Windows: restore saved AC/DC timeout values via `setStandbyTimeout`
- [x] 1.5 Ensure existing cleanup handlers (`setupCleanupHandlers`) cover the Windows restore path (already registered for SIGINT, SIGTERM, exit, uncaughtException, unhandledRejection)

## 2. Verify

- [x] 2.1 Run `pnpm typecheck` in happy-cli to verify no type errors
- [x] 2.2 Manually verify on Windows: start daemon, check `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` shows `0`, then stop daemon, verify original values are restored
