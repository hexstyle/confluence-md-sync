/**
 * Configuration and authentication for the Confluence REST client.
 *
 * Supports both deployment flavours:
 *  - Data Center / Server: Personal Access Token via `Authorization: Bearer`.
 *  - Cloud: email + API token via `Authorization: Basic`.
 */

export type ConfluenceAuthType = 'bearer' | 'basic';

export interface ConfluenceConfig {
  /** Base URL of the Confluence instance, e.g. `https://confluence.example.com` or `https://your.atlassian.net/wiki`. */
  baseUrl: string;
  /** Personal Access Token (Data Center) or API token (Cloud). */
  token: string;
  /**
   * Username / e-mail. Required for `basic` auth (Cloud); for `bearer`
   * it is optional and used only for logging.
   */
  username?: string;
  /**
   * Authentication scheme. Defaults to `bearer` (Data Center PAT).
   * Set to `basic` for Confluence Cloud (username = Atlassian account e-mail).
   */
  authType?: ConfluenceAuthType;
}

/** Builds the `Authorization` header value for the given config. */
export function authHeader(cfg: ConfluenceConfig): string {
  const authType = cfg.authType ?? 'bearer';
  if (authType === 'basic') {
    if (!cfg.username) {
      throw new Error("ConfluenceConfig: username is required for authType 'basic'");
    }
    return `Basic ${Buffer.from(`${cfg.username}:${cfg.token}`).toString('base64')}`;
  }
  // Confluence DC принимает Personal Access Token через Bearer-схему.
  // Basic с username:PAT тоже формально поддерживается, но требует точного
  // совпадения логина (LDAP/AD), что капризно — Bearer этим не страдает.
  return `Bearer ${cfg.token}`;
}

export interface LoadConfigOptions {
  /**
   * Extra env var names to try for the token, before the standard ones.
   * Useful for legacy CI setups with non-standard variable names.
   */
  tokenEnvVars?: string[];
}

/**
 * Loads Confluence config from environment variables:
 *
 *  - `CONFLUENCE_BASE_URL` (required)
 *  - `CONFLUENCE_TOKEN` or `CONFLUENCE_PAT` (required)
 *  - `CONFLUENCE_USERNAME` (optional; required for basic auth)
 *  - `CONFLUENCE_AUTH_TYPE` (`bearer` | `basic`, optional, default `bearer`)
 */
export function loadConfigFromEnv(opts: LoadConfigOptions = {}): ConfluenceConfig {
  const tokenVars = [...(opts.tokenEnvVars ?? []), 'CONFLUENCE_TOKEN', 'CONFLUENCE_PAT'];
  let token: string | undefined;
  for (const name of tokenVars) {
    token = process.env[name];
    if (token) break;
  }
  if (!token) {
    throw new Error(
      `Required env var for Confluence token is not set (tried: ${tokenVars.join(', ')})`,
    );
  }
  const baseUrl = process.env.CONFLUENCE_BASE_URL;
  if (!baseUrl) throw new Error("Required env var 'CONFLUENCE_BASE_URL' is not set");
  const authType = process.env.CONFLUENCE_AUTH_TYPE as ConfluenceAuthType | undefined;
  if (authType && authType !== 'bearer' && authType !== 'basic') {
    throw new Error(`CONFLUENCE_AUTH_TYPE must be 'bearer' or 'basic', got '${authType}'`);
  }
  return {
    baseUrl,
    token,
    username: process.env.CONFLUENCE_USERNAME,
    authType,
  };
}
