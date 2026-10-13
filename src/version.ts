// The package's version, for the CLI's --version, the MCP server's handshake and the browser
// loader's default CDN URL. A constant, so the browser entry needs no file read; tests/version.test.ts
// fails when it differs from package.json.
export const PACKAGE_VERSION = "0.8.0";

export function packageVersion(): string {
  return PACKAGE_VERSION;
}
