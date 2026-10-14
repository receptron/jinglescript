// Fetching one recorded sample and checking it, for both loaders (Node and browser). Only the
// first `bytes` are asked for (a range request) and kept; when a SHA-256 is known they must match it.

/** A sample could not be fetched or did not match its checksum. */
export class SampleDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleDownloadError";
  }
}

export interface SampleDownload {
  url: string;
  /** Only these first bytes are fetched and kept. Absent: the whole file. */
  bytes?: number;
  /** SHA-256 (hex) the kept bytes must have. Absent: not checked. */
  sha256?: string;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether `bytes` are exactly what `download` describes (its length and checksum, when known). */
export async function matches(bytes: Uint8Array, download: SampleDownload): Promise<boolean> {
  if (download.bytes !== undefined && bytes.length !== download.bytes) return false;
  return download.sha256 === undefined || (await sha256Hex(bytes)) === download.sha256;
}

/** The sample's bytes from the network, checked. Throws SampleDownloadError saying what went wrong. */
export async function fetchSample(download: SampleDownload, get: typeof fetch): Promise<Uint8Array> {
  const { url, bytes: wanted } = download;
  let response: Response;
  try {
    // A server that ignores Range sends the whole file; the prefix is cut below.
    response = await get(url, wanted === undefined ? {} : { headers: { Range: `bytes=0-${wanted - 1}` } });
  } catch (error) {
    throw new SampleDownloadError(`Could not download ${url}: ${error instanceof Error ? error.message : String(error)}. Check the network connection.`);
  }
  if (!response.ok) throw new SampleDownloadError(`Could not download ${url}: HTTP ${response.status}.`);
  const body = new Uint8Array(await response.arrayBuffer());
  const bytes = wanted === undefined ? body : body.subarray(0, wanted);
  if (!(await matches(bytes, download))) {
    throw new SampleDownloadError(`${url} did not match its checksum (got ${bytes.length} of ${wanted} bytes); nothing was cached. Try again.`);
  }
  return bytes;
}
