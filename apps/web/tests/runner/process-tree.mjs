/**
 * Bounded termination for the test runner's child process tree.
 *
 * POSIX: the runner child is spawned detached (its own process group), so signals
 * reach the test grandchildren too. SIGTERM is followed by SIGKILL after a short
 * grace period; cleanup clears the escalation timer when the child exits.
 *
 * Windows: `taskkill /T /F` terminates the child and its descendants. It is used for
 * both timeout and Ctrl+C cancellation so grandchildren cannot survive the wrapper.
 */
import {spawn} from 'node:child_process';

const escalations = new Set();
const terminating = new WeakSet();

export function clearEscalationTimers() {
  for (const timer of escalations) clearTimeout(timer);
  escalations.clear();
}

function signalGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
    return;
  } catch { /* not a process-group leader; fall through */ }
  try { child.kill(signal); } catch { /* already gone */ }
}

/**
 * Start bounded tree termination. Returns an idempotent cleanup that clears the
 * escalation timer; the caller must invoke it when the child exits.
 */
export function terminateTree(child, {graceMs = 5000, onEscalation} = {}) {
  if (!child?.pid || terminating.has(child)) return () => {};
  terminating.add(child);

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
    killer.on('error', () => {
      try { child.kill(); } catch { /* already gone */ }
    });
    // If taskkill itself is delayed or blocked, still bound the wrapper's wait by
    // terminating the runner process; the caller exits nonzero on timeout/cancel.
    const timer = setTimeout(() => {
      escalations.delete(timer);
      onEscalation?.();
      try { child.kill(); } catch { /* already gone */ }
    }, Math.max(0, graceMs));
    escalations.add(timer);
    timer.unref?.();
    return () => {
      if (escalations.delete(timer)) clearTimeout(timer);
    };
  }

  signalGroup(child, 'SIGTERM');
  const timer = setTimeout(() => {
    escalations.delete(timer);
    onEscalation?.();
    signalGroup(child, 'SIGKILL');
  }, Math.max(0, graceMs));
  escalations.add(timer);
  timer.unref?.();
  return () => {
    if (escalations.delete(timer)) clearTimeout(timer);
  };
}
