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
    app.use(express.text({ type: ['multipart/mixed', 'multipart/related'] }));

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
        const orderBy = req.query.orderBy as string;

        if (q) {
            // Enhanced query parser for Mock
            // Supports: 
            // - name = '...'
            // - mimeType = '...'
            // - trashed = true/false
            // - 'ID' in parents
            // - name contains '...'
            const parts = q.split(' and ').map(p => p.trim());

            files = files.filter(file => {
                return parts.every(part => {
                    // name = '...'
                    if (part.startsWith("name = '")) {
                        const name = part.match(/name = '(.*)'/)?.[1];
                        return file.name === name;
                    }
                    // name contains '...'
                    if (part.startsWith("name contains '")) {
                        const token = part.match(/name contains '(.*)'/)?.[1];
                        return token && file.name.includes(token);
                    }
                    // 'ID' in parents
                    if (part.includes(" in parents")) {
                        const parentId = part.match(/'(.*)' in parents/)?.[1];
                        return parentId && file.parents?.includes(parentId);
                    }
                    // trashed = ...
                    if (part === "trashed = false") {
                        return file.trashed !== true;
                    }
                    if (part === "trashed = true") {
                        return file.trashed === true;
                    }
                    // mimeType = '...'
                    if (part.startsWith("mimeType = '")) {
                        const mime = part.match(/mimeType = '(.*)'/)?.[1];
                        return file.mimeType === mime;
                    }
                    // mimeType != '...'
                    if (part.startsWith("mimeType != '")) {
                        const mime = part.match(/mimeType != '(.*)'/)?.[1];
                        return file.mimeType !== mime;
                    }
                    // modifiedTime > '...'
                    if (part.startsWith("modifiedTime > '")) {
                        const timeStr = part.match(/modifiedTime > '(.*)'/)?.[1];
                        return timeStr && new Date(file.modifiedTime) > new Date(timeStr);
                    }
                    // modifiedTime < '...'
                    if (part.startsWith("modifiedTime < '")) {
                        const timeStr = part.match(/modifiedTime < '(.*)'/)?.[1];
                        return timeStr && new Date(file.modifiedTime) < new Date(timeStr);
                    }

                    // Ignore unknown filters for now
                    return true;
                });
            });
        }

        // Sorting (orderBy)
        if (orderBy) {
            // Basic support for single keys: 'folder,name', 'modifiedTime desc', etc.
            // Splitting by comma
            const sortKeys = orderBy.split(',').map(k => k.trim());

            files.sort((a, b) => {
                for (const keyDef of sortKeys) {
                    const [key, direction] = keyDef.split(' ');
                    const dir = direction || 'asc';

                    // Handle special virtual key 'folder'
                    if (key === 'folder') {
                        const aIsFolder = a.mimeType === 'application/vnd.google-apps.folder';
                        const bIsFolder = b.mimeType === 'application/vnd.google-apps.folder';
                        if (aIsFolder !== bIsFolder) {
                            // Folders first in 'folder' sort usually? 
                            // Google docs say: "folder sets folders to appear before..."
                            const valA = aIsFolder ? 0 : 1;
                            const valB = bIsFolder ? 0 : 1;
                            if (valA !== valB) return dir === 'desc' ? valB - valA : valA - valB;
                        }
                        continue;
                    }

                    const valA = a[key] as string | number | undefined;
                    const valB = b[key] as string | number | undefined;

                    if (valA === undefined || valB === undefined) return 0;

                    if (valA < valB) return dir === 'desc' ? 1 : -1;
                    if (valA > valB) return dir === 'desc' ? -1 : 1;
                }
                return 0;
            });
        }

        res.json({
            kind: "drive#fileList",
            incompleteSearch: false,
            files: files
        });
    });

    // Changes: Get Start Page Token
    app.get('/drive/v3/changes/startPageToken', (req: Request, res: Response) => {
        const token = driveStore.getStartPageToken();
        res.json({
            kind: "drive#startPageToken",
            startPageToken: token
        });
    });

    // Changes: List
    app.get('/drive/v3/changes', (req: Request, res: Response) => {
        const pageToken = req.query.pageToken as string;
        if (!pageToken) {
            res.status(400).json({ error: { code: 400, message: "Bad Request: pageToken is required" } });
            return;
        }

        const result = driveStore.getChanges(pageToken);
        res.json({
            kind: "drive#changeList",
            newStartPageToken: result.newStartPageToken,
            nextPageToken: result.nextPageToken,
            changes: result.changes
        });
    });

    // Upload Files Route
    app.post('/upload/drive/v3/files', (req: Request, res: Response) => {
        const uploadType = req.query.uploadType;
        if (uploadType !== 'multipart') {
            res.status(400).json({ error: { code: 400, message: "Only uploadType=multipart is supported in this mock route" } });
            return;
        }

        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/related')) {
            res.status(400).json({ error: { code: 400, message: "Content-Type must be multipart/related" } });
            return;
        }

        const boundaryMatch = contentType.match(/boundary=(.+)/);
        if (!boundaryMatch) {
            res.status(400).json({ error: { code: 400, message: "Multipart boundary missing" } });
            return;
        }
        let boundary = boundaryMatch[1];
        if (boundary.startsWith('"') && boundary.endsWith('"')) {
            boundary = boundary.substring(1, boundary.length - 1);
        }

        const rawBody = req.body;
        if (typeof rawBody !== 'string') {
            res.status(400).json({ error: { code: 400, message: "Body parsing failed" } });
            return;
        }

        // Simple Multipart Parsing
        const parts = rawBody.split(`--${boundary}`);
        // Part 0 is usually empty (preamble)
        // Part 1 is Metadata
        // Part 2 is Content
        // Last part is --

        const validParts = parts.filter(p => p.trim() !== '' && p.trim() !== '--');

        if (validParts.length < 2) {
            res.status(400).json({ error: { code: 400, message: "Invalid multipart body: expected at least metadata and content" } });
            return;
        }

        const parsePart = (rawPart: string) => {
            const splitIndex = rawPart.indexOf('\r\n\r\n');
            if (splitIndex === -1) return null;
            const headers = rawPart.substring(0, splitIndex).trim();
            const body = rawPart.substring(splitIndex + 4); // No trim at end to preserve content whitespace?
            // Actually Multipart usually has \r\n at end before boundary, so we might want to trim that.
            // But relying on split --boundary usually leaves the preceding \r\n attached to the body part?
            // split uses the separator. 
            // "Part1\r\n--boundary\r\nPart2"
            // Split by --boundary: ["Part1\r\n", "\r\nPart2"]
            // So Part1 has a trailing \r\n.
            return {
                headers,
                body: body.replace(/\r\n$/, '') // Remove trailing CRLF
            };
        };

        const metadataPart = parsePart(validParts[0]);
        const contentPart = parsePart(validParts[1]);

        if (!metadataPart || !contentPart) {
            res.status(400).json({ error: { code: 400, message: "Failed to parse parts" } });
            return;
        }

        let metadata;
        try {
            metadata = JSON.parse(metadataPart.body);
        } catch {
            res.status(400).json({ error: { code: 400, message: "Invalid JSON in metadata part" } });
            return;
        }

        let content;
        // Try to parse content as JSON if applicable, else keep as string?
        // In the user request, it is JSON content.
        // And store expects 'content' property to be anything.
        try {
            content = JSON.parse(contentPart.body);
        } catch {
            content = contentPart.body;
        }

        // Create File
        // Ensure name uniqueness check if needed (reusing logic from normal create)
        const existing = driveStore.listFiles().find(f => {
            if (f.name !== metadata.name) return false;
            // Filter trashed?
            if (f.trashed) return false;

            const newParents = metadata.parents || [];
            const existingParents = f.parents || [];

            // If both new and existing have NO parents, they are both in root -> Conflict
            if (newParents.length === 0 && existingParents.length === 0) return true;

            // Check intersection of parents
            return newParents.some((p: string) => existingParents.includes(p));
        });

        if (existing) {
            res.status(409).json({ error: { code: 409, message: "Conflict: File with same name already exists" } });
            return;
        }

        const newFile = driveStore.createFile({
            ...metadata,
            content: content
        });

        res.status(200).json(newFile);
    });

    // Files: Create (Standard)
    app.post('/drive/v3/files', (req: Request, res: Response) => {
        const body = req.body;
        if (!body || !body.name) {
            res.status(400).json({ error: { code: 400, message: "Bad Request: Name is required" } });
            return;
        }

        // Enforce Unique Name Constraint (Mock Behavior customization)
        const existing = driveStore.listFiles().find(f => {
            if (f.name !== body.name) return false;
            if (f.trashed) return false;

            const newParents = body.parents || [];
            const existingParents = f.parents || [];

            if (newParents.length === 0 && existingParents.length === 0) return true;

            return newParents.some((p: string) => existingParents.includes(p));
        });

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
