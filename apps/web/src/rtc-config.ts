// Device-to-device media transport configuration.
//
// This milestone is LAN-only: no relay and no long-lived credentials. The
// configuration is still explicit and injectable so authenticated TURN can be
// added later without touching call sites — and so the failure copy can say
// honestly that direct connections are all that is configured.

export type IceServerConfig = {urls: string | string[]; username?: string; credential?: string};

export type RtcConfiguration = {
  iceServers: IceServerConfig[];
  iceCandidatePoolSize?: number;
  iceTransportPolicy?: 'all' | 'relay';
};

export const RTC_DEFAULTS = {
  /** A peer connection that has not reached `connected` by now is reported. */
  connectTimeoutMs: 15000,
  /** Bounded backoff for signalling and reconnection attempts. */
  retryDelaysMs: [500, 1500, 4000] as const,
  /** No decoded frame for this long means the picture is not current. */
  frameTimeoutMs: 1500,
};

export const DIRECT_ONLY_COPY =
  'These devices could not connect directly. Same-Wi-Fi connections can still fail on networks that block device-to-device traffic. Try a different network, or connect both devices to the same router.';

/** Parse a JSON array of ICE servers. Malformed input yields no servers. */
export function parseIceServers(raw: string | null | undefined): IceServerConfig[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const servers: IceServerConfig[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const urls = (entry as {urls?: unknown}).urls;
      if (typeof urls !== 'string' && !Array.isArray(urls)) continue;
      const server: IceServerConfig = {urls: urls as string | string[]};
      const username = (entry as {username?: unknown}).username;
      const credential = (entry as {credential?: unknown}).credential;
      if (typeof username === 'string' && username) server.username = username;
      if (typeof credential === 'string' && credential) server.credential = credential;
      servers.push(server);
    }
    return servers;
  } catch {
    return [];
  }
}

function environment(): Record<string, string | undefined> {
  try {
    return (import.meta as {env?: Record<string, string | undefined>}).env ?? {};
  } catch {
    return {};
  }
}

/**
 * Both peers must be built from the same configuration. A relay entry is only
 * ever supplied at runtime; credentials are never baked into the bundle.
 */
export function iceConfiguration(servers?: IceServerConfig[]): RtcConfiguration {
  const configured = servers ?? parseIceServers(environment().VITE_ICE_SERVERS);
  return {iceServers: configured};
}

export function hasRelay(configuration: RtcConfiguration): boolean {
  return configuration.iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => typeof url === 'string' && /^turns?:/i.test(url));
  });
}

/** Actionable copy for a media failure: never promises that LAN will work. */
export function connectionFailureCopy(configuration: RtcConfiguration): string {
  return hasRelay(configuration)
    ? 'The devices could not establish a video connection. Check that both are online, then retry.'
    : DIRECT_ONLY_COPY;
}

export function retryDelay(attempt: number): number {
  const delays = RTC_DEFAULTS.retryDelaysMs;
  const index = Math.min(Math.max(0, attempt), delays.length - 1);
  return delays[index];
}
