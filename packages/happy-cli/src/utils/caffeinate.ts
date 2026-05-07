/**
 * Caffeinate utility for preventing system sleep
 * - macOS: spawns `caffeinate -im` process
 * - Windows: uses `powercfg` to set standby timeout to Never
 */

import { spawn, execSync, ChildProcess } from 'child_process'
import { logger } from '@/ui/logger'
import { configuration } from '@/configuration'

let caffeinateProcess: ChildProcess | null = null

// Windows: saved original standby timeout values (in seconds) for restoration
let savedAcTimeout: number | null = null
let savedDcTimeout: number | null = null

/**
 * Query the current standby timeout values on Windows
 * Runs `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` and parses hex values
 */
function queryCurrentStandbyTimeout(): { ac: number; dc: number } {
    const output = execSync(
        'powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE',
        { timeout: 5000, encoding: 'utf8' }
    )

    // Match all hex values in output (encoding-robust: hex digits are ASCII-safe)
    const hexMatches = output.match(/0x([0-9a-fA-F]{8})/g)
    if (!hexMatches || hexMatches.length < 2) {
        logger.debug('[caffeinate] Windows: failed to parse powercfg output, using defaults')
        return { ac: 1800, dc: 1800 }
    }

    // Last two hex values are AC and DC power setting indices
    const ac = parseInt(hexMatches[hexMatches.length - 2], 16)
    const dc = parseInt(hexMatches[hexMatches.length - 1], 16)

    return { ac, dc }
}

/**
 * Set standby timeout values on Windows
 * @param acSeconds - AC timeout in seconds (0 = Never)
 * @param dcSeconds - DC timeout in seconds (0 = Never)
 */
function setStandbyTimeout(acSeconds: number, dcSeconds: number): void {
    // powercfg /change takes minutes; round up to nearest minute (0 stays 0 = Never)
    const acMinutes = acSeconds === 0 ? 0 : Math.max(1, Math.round(acSeconds / 60))
    const dcMinutes = dcSeconds === 0 ? 0 : Math.max(1, Math.round(dcSeconds / 60))

    execSync(`powercfg /change standby-timeout-ac ${acMinutes}`, { timeout: 5000, stdio: 'ignore' })
    execSync(`powercfg /change standby-timeout-dc ${dcMinutes}`, { timeout: 5000, stdio: 'ignore' })
}

/**
 * Start caffeinate to prevent system sleep
 * Only works on macOS, silently does nothing on other platforms
 * 
 * @returns true if caffeinate was started, false otherwise
 */
export function startCaffeinate(): boolean {
    // Check if caffeinate is disabled via configuration
    if (configuration.disableCaffeinate) {
        logger.debug('[caffeinate] Caffeinate disabled via HAPPY_DISABLE_CAFFEINATE environment variable')
        return false
    }

    // Windows: use powercfg to set standby timeout to Never
    if (process.platform === 'win32') {
        try {
            const { ac, dc } = queryCurrentStandbyTimeout()
            savedAcTimeout = ac
            savedDcTimeout = dc
            logger.debug(`[caffeinate] Windows: saved standby timeouts AC=${ac}s DC=${dc}s`)

            setStandbyTimeout(0, 0)
            logger.debug('[caffeinate] Windows: standby timeout set to Never')

            setupCleanupHandlers()
            return true
        } catch (error) {
            logger.warn('[caffeinate] Windows: failed to configure power settings, continuing without sleep prevention:', error)
            return false
        }
    }

    // Only run on macOS
    if (process.platform !== 'darwin') {
        logger.debug('[caffeinate] Not on macOS, skipping caffeinate')
        return false
    }

    // Don't start if already running
    if (caffeinateProcess && !caffeinateProcess.killed) {
        logger.debug('[caffeinate] Caffeinate already running')
        return true
    }

    // Kill any orphaned caffeinate -im processes from previous daemon instances
    killOrphanedCaffeinateProcesses()

    try {
        caffeinateProcess = spawn('caffeinate', ['-im'], {
            stdio: 'ignore',
            detached: false
        })

        caffeinateProcess.on('error', (error) => {
            logger.debug('[caffeinate] Error starting caffeinate:', error)
            caffeinateProcess = null
        })

        caffeinateProcess.on('exit', (code, signal) => {
            logger.debug(`[caffeinate] Process exited with code ${code}, signal ${signal}`)
            caffeinateProcess = null
        })

        logger.debug(`[caffeinate] Started with PID ${caffeinateProcess.pid}`)
        
        // Set up cleanup handlers
        setupCleanupHandlers()
        
        return true
    } catch (error) {
        logger.debug('[caffeinate] Failed to start caffeinate:', error)
        return false
    }
}

let isStopping = false

/**
 * Stop the caffeinate process
 */
export async function stopCaffeinate(): Promise<void> {
    // Prevent re-entrant calls during cleanup
    if (isStopping) {
        logger.debug('[caffeinate] Already stopping, skipping')
        return
    }

    // Windows: restore original power settings
    if (process.platform === 'win32') {
        if (savedAcTimeout === null || savedDcTimeout === null) {
            logger.debug('[caffeinate] Windows: no saved timeouts to restore')
            return
        }
        isStopping = true
        try {
            logger.debug(`[caffeinate] Windows: restoring standby timeouts AC=${savedAcTimeout}s DC=${savedDcTimeout}s`)
            setStandbyTimeout(savedAcTimeout, savedDcTimeout)
            savedAcTimeout = null
            savedDcTimeout = null
            isStopping = false
        } catch (error) {
            logger.debug('[caffeinate] Windows: failed to restore power settings:', error)
            isStopping = false
        }
        return
    }

    if (caffeinateProcess && !caffeinateProcess.killed) {
        isStopping = true
        logger.debug(`[caffeinate] Stopping caffeinate process PID ${caffeinateProcess.pid}`)
        
        try {
            caffeinateProcess.kill('SIGTERM')
            
            // Give it a moment to terminate gracefully
            await new Promise(resolve => setTimeout(resolve, 1000))

            if (caffeinateProcess && !caffeinateProcess.killed) {
                logger.debug('[caffeinate] Force killing caffeinate process')
                caffeinateProcess.kill('SIGKILL')
            }
            caffeinateProcess = null
            isStopping = false
        } catch (error) {
            logger.debug('[caffeinate] Error stopping caffeinate:', error)
            isStopping = false
        }
    }
}

/**
 * Check if caffeinate is currently running
 */
export function isCaffeinateRunning(): boolean {
    if (process.platform === 'win32') {
        return savedAcTimeout !== null
    }
    return caffeinateProcess !== null && !caffeinateProcess.killed
}

/**
 * Set up cleanup handlers to ensure caffeinate is stopped on exit
 */
let cleanupHandlersSet = false

function setupCleanupHandlers(): void {
    if (cleanupHandlersSet) {
        return
    }
    
    cleanupHandlersSet = true
    
    // Clean up on various exit conditions
    const cleanup = () => {
        stopCaffeinate()
    }
    
    process.on('exit', cleanup)
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
    process.on('SIGUSR1', cleanup)
    process.on('SIGUSR2', cleanup)
    process.on('uncaughtException', (error) => {
        logger.debug('[caffeinate] Uncaught exception, cleaning up:', error)
        cleanup()
    })
    process.on('unhandledRejection', (reason, promise) => {
        logger.debug('[caffeinate] Unhandled rejection, cleaning up:', reason)
        cleanup()
    })
}

export function killOrphanedCaffeinateProcesses(): void {
    if (process.platform !== 'darwin') return
    try {
        execSync('pkill -f "caffeinate -im"', { timeout: 5000, stdio: 'ignore' })
        logger.debug('[caffeinate] Killed orphaned caffeinate processes')
    } catch {
        // pkill exits with 1 if no processes matched — expected
    }
}