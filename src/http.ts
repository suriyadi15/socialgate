import { getEnv } from './context';
import { HttpError, needsCredential, notFound } from './errors';

const defaultUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

// Several platforms (Threads, Instagram) only serve the full page to requests that look like a browser navigation
const browserHeaders: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
};

export type FetchOptions = {
    method?: string;
    headers?: Record<string, string>;
    body?: string | URLSearchParams | FormData | Uint8Array;
    json?: unknown;
    /** Seconds. */
    timeout?: number;
    retries?: number;
    redirect?: 'follow' | 'manual';
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends a request through the proxy of the running request (PROXY_URI), retrying network errors and 5xx. */
export const request = async (url: string, options: FetchOptions = {}): Promise<Response> => {
    const headers: Record<string, string> = { 'user-agent': defaultUa, ...browserHeaders, ...options.headers };
    let body = options.body;
    if (options.json !== undefined) {
        body = JSON.stringify(options.json);
        headers['content-type'] ??= 'application/json';
    }
    // Callers that write (posting) pass retries: 0, a repeated POST could publish twice
    const retries = options.retries ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const response = await fetch(url, {
                method: options.method ?? (body === undefined ? 'GET' : 'POST'),
                headers,
                body: body as BodyInit | undefined,
                redirect: options.redirect ?? 'follow',
                signal: AbortSignal.timeout((options.timeout ?? 30) * 1000),
                // Bun's own option, undici dispatchers are ignored by Bun
                proxy: getEnv('PROXY_URI'),
            } as RequestInit);
            if (response.status >= 500 && attempt < retries) {
                lastError = new Error(`${response.status} from ${new URL(url).host}`);
                // eslint-disable-next-line no-await-in-loop
                await sleep(300 * (attempt + 1));
                continue;
            }
            return response;
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                // eslint-disable-next-line no-await-in-loop
                await sleep(300 * (attempt + 1));
            }
        }
    }
    throw new HttpError(502, `Request to ${new URL(url).host} failed: ${(lastError as Error)?.message ?? lastError}`);
};

/** Turns a failed response into an error without echoing request headers or credentials. */
export const assertOk = (response: Response, what: string): Response => {
    if (response.ok) {
        return response;
    }
    if (response.status === 401 || response.status === 403) {
        throw needsCredential(`${what}: ${response.status}, the credential is missing, expired or blocked.`);
    }
    if (response.status === 404) {
        throw notFound(`${what}: not found.`);
    }
    throw new HttpError(502, `${what}: upstream answered ${response.status}.`);
};

export const getText = async (url: string, options?: FetchOptions) => (assertOk(await request(url, options), new URL(url).host)).text();
export const getJson = async <T = any>(url: string, options?: FetchOptions) => (assertOk(await request(url, options), new URL(url).host)).json() as Promise<T>;

/** A fetch for libraries that bring their own request logic, it follows the proxy of the running request. */
export const proxiedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    return fetch(url, { method: input instanceof Request ? input.method : undefined, ...init, proxy: getEnv('PROXY_URI') } as RequestInit);
};
