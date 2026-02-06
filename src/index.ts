import express from 'express';
import cors from 'cors';
import { driveStore } from './store';
import { handleBatchRequest } from './batch';
import { createV2Router } from './routes/v2';
import { createV3Router } from './routes/v3';
import { AppConfig } from './types';

const createApp = (config: AppConfig = {}) => {
    // If apiEndpoint is not provided, default to localhost or empty (relative)
    if (!config.apiEndpoint) {
        config.apiEndpoint = "";
    }

    const app = express();
    app.use(cors({
        exposedHeaders: ['ETag']
    }));
    app.set('etag', false); // Disable default ETag generation to match Real API behavior

    app.use(async (req, res, next) => {
        if (config.serverLagBefore && config.serverLagBefore > 0) {
            await new Promise(resolve => setTimeout(resolve, config.serverLagBefore));
        }

        if (config.serverLagAfter && config.serverLagAfter > 0) {
            const originalSend = res.send;
            res.send = function (...args) {
                setTimeout(() => {
                    originalSend.apply(res, args);
                }, config.serverLagAfter);
                return res;
            };
        }
        next();
    });

    app.use(express.json());
    app.use(express.text({ type: ['multipart/mixed', 'multipart/related', 'text/*', 'application/xml'] }));

    // Batch Route
    app.post('/batch', handleBatchRequest);
    app.post('/batch/drive/v3', handleBatchRequest);

    // Debug Route (for testing)
    app.post('/debug/clear', (req, res) => {
        driveStore.clear();
        res.status(200).send('Cleared');
    });

    // Health Check
    app.get('/', (req, res) => {
        res.status(200).send('OK');
    });

    // Auth Middleware
    const validTokens = ['valid-token', 'another-valid-token'];
    app.use((req, res, next) => {
        const authHeaderVal = req.headers.authorization;
        const authHeader = Array.isArray(authHeaderVal) ? authHeaderVal[0] : authHeaderVal;

        if (!authHeader) {
            res.status(401).json({ error: { code: 401, message: "Unauthorized: No token provided" } });
            return;
        }

        const token = authHeader.split(' ')[1];
        if (!validTokens.includes(token)) {
            res.status(401).json({ error: { code: 401, message: "Unauthorized: Invalid token" } });
            return;
        }
        next();
    });

    // Mount Routers
    app.use(createV3Router());
    app.use(createV2Router(config));

    return app;
};

const startServer = (port: number, host: string = 'localhost', config: AppConfig = {}) => {
    const app = createApp(config);
    return app.listen(port, host, () => {
        console.log(`Server is running on http://${host}:${port}`);
    });
};

if (require.main === module) {
    startServer(3000);
}

export { createApp, startServer };
