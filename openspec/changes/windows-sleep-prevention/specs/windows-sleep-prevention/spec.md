## ADDED Requirements

### Requirement: Daemon prevents Windows sleep during active sessions

The daemon SHALL prevent Windows from entering system sleep while the daemon process is running. Sleep prevention SHALL be released when the daemon shuts down.

#### Scenario: Daemon starts on Windows

- **WHEN** the daemon starts on a Windows platform (`process.platform === 'win32'`)
- **THEN** the daemon SHALL set the system standby timeout to `0` (never sleep) using `powercfg /change standby-timeout-ac 0` and `powercfg /change standby-timeout-dc 0`
- **AND** SHALL save the original timeout values before overriding them

#### Scenario: Daemon shuts down on Windows

- **WHEN** the daemon shuts down cleanly (SIGINT, SIGTERM, or `/stop` endpoint)
- **THEN** the daemon SHALL restore the original `standby-timeout-ac` and `standby-timeout-dc` values via `powercfg`

#### Scenario: Power settings not available

- **WHEN** `powercfg` is not available on the system (PowerShell missing, restricted environment)
- **THEN** the daemon SHALL log a warning and continue without sleep prevention
- **AND** `startCaffeinate()` SHALL return `false`

#### Scenario: Daemon crashes unexpectedly

- **WHEN** the daemon process terminates unexpectedly (crash, kill)
- **THEN** cleanup handlers registered via `process.on('exit')` SHALL attempt to restore original power settings
- **AND** if restoration fails, the next daemon start SHALL fetch current values before overriding (making the operation idempotent)

### Requirement: Existing macOS caffeinate behavior is preserved

The existing macOS sleep prevention SHALL continue to work as before, with no changes to its behavior or API.

#### Scenario: macOS daemon start

- **WHEN** the daemon starts on macOS
- **THEN** `caffeinate -im` SHALL be spawned as before
- **AND** the public API (`startCaffeinate`, `stopCaffeinate`, `isCaffeinateRunning`) SHALL remain unchanged
