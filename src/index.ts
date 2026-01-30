import express, { Request, Response } from 'express';
import { driveStore } from './store';

const createApp = () => {
    const app = express();

    app.use(express.json());

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
        const files = driveStore.listFiles();
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

        const newFile = driveStore.createFile({
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
        const existingFile = driveStore.getFile(fileId);
        if (existingFile) {
            const ifMatch = req.headers['if-match'];
            if (ifMatch && ifMatch !== '*' && ifMatch !== `"${existingFile.version}"`) {
                res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                return;
            }
        }

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

const startServer = (port: number, host: string = 'localhost') => {
    const app = createApp();
    return app.listen(port, host, () => {
        console.log(`Server is running on http://${host}:${port}`);
    });
};

if (require.main === module) {
    startServer(3000);
}

export { createApp, startServer };
