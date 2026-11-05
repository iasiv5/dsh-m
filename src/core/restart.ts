import { spawn } from 'child_process';
import { platform } from 'os';

/**
 * Restarts the application by spawning a helper process.
 * @param command The command to execute.
 * @param args The arguments for the command.
 */
export function restartHelperSource(command: string, args: string[]): void {
  const isWindows = platform() === 'win32';
  
  spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: isWindows
  }).unref();
}