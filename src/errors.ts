/** An error with an HTTP status that can be sent to the client as it is. */
export class HttpError extends Error {
    constructor(
        readonly status: 400 | 401 | 404 | 409 | 413 | 422 | 429 | 502 | 503,
        message: string
    ) {
        super(message);
    }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);
/** The platform refused the request: missing, expired or blocked credentials. */
export const needsCredential = (message: string) => new HttpError(503, message);
