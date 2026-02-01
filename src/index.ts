import express, { Request, Response } from 'express';
import cors from 'cors';
import { driveStore } from './store';
import { handleBatchRequest } from './batch';

interface AppConfig {
    serverLagBefore?: number;
    serverLagAfter?: number;
}

const createApp = (config: AppConfig = {}) => {
    const app = express();
    app.use(cors());

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
    app.use(express.text({ type: 'multipart/mixed' }));

    // Batch Route
    app.post('/batch', handleBatchRequest);

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
        const authHeader = req.headers.authorization;
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

    // Middleware to simulate some Google API behaviors (optional, can be expanded)

    // About
    app.get('/drive/v3/about', (req: Request, res: Response) => {
        const about = driveStore.getAbout();
        res.json({
            kind: "drive#about",
            ...about
        });
    });

    // Files: List
    app.get('/drive/v3/files', (req: Request, res: Response) => {
        let files = driveStore.listFiles();
        const q = req.query.q as string;

        if (q) {
            // Very basic query parser for Mock
            // Supports: name = '...', trashed = false, mimeType = '...'
            // and combinations joined by 'and'
            const parts = q.split(' and ').map(p => p.trim());

            files = files.filter(file => {
                return parts.every(part => {
                    if (part.startsWith("name = '")) {
                        const name = part.match(/name = '(.*)'/)?.[1];
                        return file.name === name;
                    }
                    if (part === "trashed = false") {
                        // Mock doesn't explicitly store trashed status yet, assume visible implies not trashed?
                        // Or we should add trashed support to store?
                        // For now, let's assume all files in listFiles() are not trashed unless we implement trash.
                        // But wait, the user asked to "only search not in trash folders".
                        // If I don't implement trash, then everything is not trashed.
                        return file.trashed !== true;
                    }
                    if (part === "trashed = true") {
                        return file.trashed === true;
                    }
                    if (part.startsWith("mimeType = '")) {
                        const mime = part.match(/mimeType = '(.*)'/)?.[1];
                        return file.mimeType === mime;
                    }
                    // Ignore unknown filters for now or return true
                    return true;
                });
            });
        }

        res.json({
            kind: "drive#fileList",
            incompleteSearch: false,
            files: files
        });
    });

    // Files: Create
    app.post('/drive/v3/files', (req: Request, res: Response) => {
        const body = req.body;
        if (!body || !body.name) {
            res.status(400).json({ error: { code: 400, message: "Bad Request: Name is required" } });
            return;
        }

        // Enforce Unique Name Constraint (Mock Behavior customization)
        const existing = driveStore.listFiles().find(f => f.name === body.name);
        if (existing) {
            res.status(409).json({ error: { code: 409, message: "Conflict: File with same name already exists" } });
            return;
        }

        const newFile = driveStore.createFile({
            ...body,
            name: body.name,
            mimeType: body.mimeType || "application/octet-stream",
            parents: body.parents || []
        });

        res.status(200).json(newFile);
    });

    // Files: Get
    app.get('/drive/v3/files/:fileId', (req: Request, res: Response) => {
        const fileId = req.params.fileId;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const file = driveStore.getFile(fileId);

        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        const etag = `"${file.version}"`;
        res.setHeader('ETag', etag);

        if (req.headers['if-none-match'] === etag) {
            res.status(304).end();
            return;
        }

        res.json(file);
    });

    // Files: Update
    app.patch('/drive/v3/files/:fileId', (req: Request, res: Response) => {
        const fileId = req.params.fileId;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const updates = req.body;

        if (!updates) {
            res.status(400).json({ error: { code: 400, message: "Bad Request: No updates provided" } });
            return;
        }

        // Check for Precondition (If-Match)
        // Note: Real Google Drive API V3 was observed to allow overwrites (status 200) 
        // on PATCH even with mismatching If-Match headers (likely due to ETag generation nuances).
        // Relaxing Mock to match Real API behavior (Last Write Wins).
        /*
        const existingFile = driveStore.getFile(fileId);
        if (existingFile) {
            const ifMatch = req.headers['if-match'];
            if (ifMatch && ifMatch !== '*' && ifMatch !== `"${existingFile.version}"`) {
                res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                return;
            }
        }
        */

        const updatedFile = driveStore.updateFile(fileId, updates);

        if (!updatedFile) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        res.json(updatedFile);
    });

    // Files: Delete
    app.delete('/drive/v3/files/:fileId', (req: Request, res: Response) => {
        const fileId = req.params.fileId;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        // Check for Precondition (If-Match)
        const existingFile = driveStore.getFile(fileId);
        if (existingFile) {
            const ifMatch = req.headers['if-match'];
            if (ifMatch && ifMatch !== '*' && ifMatch !== `"${existingFile.version}"`) {
                res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                return;
            }
        }

        const deleted = driveStore.deleteFile(fileId);

        if (!deleted) {
            // According to Google API, delete might return 404 if not found, or 204 if successful (or 200). 
            // Docs says "If successful, this method returns an empty response body." usually 204.
            // But if not found:
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        res.status(204).send();
    });

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
