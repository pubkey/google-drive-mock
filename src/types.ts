export interface AppConfig {
    serverLagBefore?: number;
    apiEndpoint?: string;
    serverLagAfter?: number;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            rawBody?: Buffer;
        }
    }
}
