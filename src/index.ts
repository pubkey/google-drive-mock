import express, { Request, Response } from 'express';
import cors from 'cors';
import { driveStore } from './store';
import { handleBatchRequest } from './batch';
import { toV2File, fromV2Update } from './mappers';

interface AppConfig {
    serverLagBefore?: number;
    apiEndpoint?: string;
    serverLagAfter?: number;
}

const createApp = (config: AppConfig = {}) => {
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
    app.use(express.text({ type: ['multipart/mixed', 'multipart/related'] }));

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

    // V2 Changes: Get Start Page Token
    app.get('/drive/v2/changes/startPageToken', (req: Request, res: Response) => {
        const token = driveStore.getStartPageToken();
        res.json({
            kind: "drive#startPageToken",
            startPageToken: token
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

        const contentTypeHeader = req.headers['content-type'];
        const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;

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
        const body = req.body || {};
        // Real API allows missing name (defaults to "Untitled"?) or just works.
        // Parity: Allow missing name.
        const name = body.name || "Untitled";

        // Enforce Unique Name Constraint (Mock Behavior customization)
        // Real API allows duplicates. Removing constraint for parity.
        /*
        const existing = driveStore.listFiles().find(f => {
            if (f.name !== body.name) return false;
            // ...
            return newParents.some((p: string) => existingParents.includes(p));
        });

        if (existing) {
            res.status(409).json({ error: { code: 409, message: "Conflict: File with same name already exists" } });
            return;
        }
        */

        const newFile = driveStore.createFile({
            ...body,
            name: name,
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

        // Parity: Real V3 API returns 400 if 'etag' is requested in fields
        const fields = req.query.fields as string;
        if (fields && (fields.includes('etag') || fields.includes('kind,etag'))) {
            res.status(400).json({ error: { code: 400, message: "Invalid field selection: etag" } });
            return;
        }

        // Mock does not return ETag header because Real API (v3) does not return it by default/in this context.
        // res.setHeader('ETag', etag);

        // Real API also ignores If-None-Match if ETag is not supported?
        // match behavior: do nothing.
        /*
        if (req.headers['if-none-match'] === etag) {
            res.status(304).end();
            return;
        }
        */

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
        // Real Google Drive API V3 observed behavior: Ignores If-Match on PATCH (Last Write Wins).
        // Mock matches this Parity.
        /*
        const existingFile = driveStore.getFile(fileId);
        if (existingFile) {
            const ifMatch = req.headers['if-match'];
            if (ifMatch && ifMatch !== '*' && ifMatch !== existingFile.etag) {
                // Also support quoted etag if user sends it
                if (ifMatch !== `"${existingFile.etag}"`) {
                    res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                    return;
                }
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
        // Real API behavior: Ignores If-Match (returns 204 even on mismatch)
        /*
        const existingFile = driveStore.getFile(fileId);
        if (existingFile) {
            const ifMatch = req.headers['if-match'];
            if (ifMatch && ifMatch !== '*' && ifMatch !== existingFile.etag) {
                 // Strict logic removed for Parity
            }
        }
        */

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

    // ==========================================
    // Google Drive API V2 Routes
    // ==========================================

    // V2 Files: Create
    app.post('/drive/v2/files', (req: Request, res: Response) => {
        const v2Body = req.body || {};
        const fileData = fromV2Update(v2Body);

        // V2 typical defaults
        const name = fileData.name || v2Body.title || "Untitled"; // Fallback if mapper missed it or explicit

        const newFile = driveStore.createFile({
            ...fileData,
            name: name,
            mimeType: fileData.mimeType || "application/octet-stream",
            parents: fileData.parents || []
        });

        res.status(200).json(toV2File(newFile));
    });

    // V2 Files: Get
    app.get('/drive/v2/files/:fileId', (req: Request, res: Response) => {
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

        // V2 ETag handling - usually sends ETag header
        if (file.etag) {
            res.setHeader('ETag', file.etag);
        }

        if (req.query.alt === 'media') {
            // Return content
            // If content is an object/json, res.send handles it?
            // Should we return raw bytes? For mock, content is likely string or object.
            if (file.content === undefined) {
                res.send(""); // Empty content
                return;
            }
            if (typeof file.content === 'object') {
                res.json(file.content);
            } else {
                res.send(file.content);
            }
            return;
        }

        res.json(toV2File(file));
    });

    // V2 Files: Update (PUT)
    app.put('/drive/v2/files/:fileId', (req: Request, res: Response) => {
        const fileId = req.params.fileId;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const v2Body = req.body || {};
        const updates = fromV2Update(v2Body);

        const existingFile = driveStore.getFile(fileId);
        if (!existingFile) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        // Check for Precondition (If-Match)
        const ifMatchHeader = req.headers['if-match'];
        const ifMatch = Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader;
        if (ifMatch && ifMatch !== '*' && ifMatch !== existingFile.etag) {
            // Also support quoted etag if user sends it
            // Internal etag might be "version", validation needs exact match
            if (ifMatch !== existingFile.etag && ifMatch !== `"${existingFile.etag}"`) {
                res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                return;
            }
        }

        const updatedFile = driveStore.updateFile(fileId, updates);
        res.json(toV2File(updatedFile!));
    });

    // V2 Files: Patch (PATCH)
    app.patch('/drive/v2/files/:fileId', (req: Request, res: Response) => {
        const fileId = req.params.fileId;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const v2Body = req.body || {};
        const updates = fromV2Update(v2Body);

        const existingFile = driveStore.getFile(fileId);
        if (!existingFile) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        // Check for Precondition (If-Match)
        const ifMatchHeader = req.headers['if-match'];
        const ifMatch = Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader;
        if (ifMatch && ifMatch !== '*' && ifMatch !== existingFile.etag) {
            if (ifMatch !== existingFile.etag && ifMatch !== `"${existingFile.etag}"`) {
                res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                return;
            }
        }

        const updatedFile = driveStore.updateFile(fileId, updates);
        res.json(toV2File(updatedFile!));
    });

    // V2 Files: List
    app.get('/drive/v2/files', (req: Request, res: Response) => {
        let files = driveStore.listFiles();
        const q = req.query.q as string;
        // Reuse V3 query logic for now as it's quite generic
        // In real V2, queries are slightly different but basic filters (name =, parent in parents) are compatible.

        if (q) {
            // Enhanced query parser for Mock
            const parts = q.split(' and ').map(p => p.trim());
            files = files.filter(file => {
                return parts.every(part => {
                    // name = '...' (V2 uses title but our parser handles name currently. V2 client might send title = '...')
                    // Let's support title = '...' mapping to name
                    if (part.startsWith("title = '")) {
                        const title = part.match(/title = '(.*)'/)?.[1];
                        return file.name === title;
                    }

                    if (part.startsWith("title contains '")) {
                        const token = part.match(/title contains '(.*)'/)?.[1];
                        return token && file.name.includes(token);
                    }

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
                    return true;
                });
            });
        }

        res.json({
            kind: "drive#fileList",
            etag: `"mock-etag-${Date.now()}"`,
            selfLink: `http://localhost/drive/v2/files`,
            items: files.map(f => toV2File(f))
        });
    });

    // V2 About
    app.get('/drive/v2/about', (req: Request, res: Response) => {
        const about = driveStore.getAbout();
        res.json({
            kind: "drive#about",
            etag: `"mock-about-etag"`,
            selfLink: `http://localhost/drive/v2/about`,
            name: about.user.displayName,
            user: about.user,
            quotaBytesTotal: about.storageQuota.limit,
            quotaBytesUsed: about.storageQuota.usage,
            quotaBytesUsedAggregate: about.storageQuota.usage,
            quotaBytesUsedInTrash: about.storageQuota.usageInDriveTrash,
            rootFolderId: "root" // Simplify
        });
    });

    // V2 Changes
    app.get('/drive/v2/changes', (req: Request, res: Response) => {
        const pageToken = req.query.pageToken as string;
        // V2 changes might differ in structure slightly but let's reuse store logic
        // V2 Change resource: { kind: "drive#change", id: <changeId>, fileId: <fileId>, file: <FileResource>, deleted: boolean }

        // Store returns { newStartPageToken, nextPageToken, changes: [...] }
        // We need to map the changes to V2 format

        const result = driveStore.getChanges(pageToken);

        const v2Changes = result.changes.map(change => ({
            kind: "drive#change",
            id: Math.random().toString(36).substring(7), // Mock change ID
            fileId: change.fileId,
            file: change.file ? toV2File(change.file) : undefined,
            deleted: change.removed,
            modificationDate: change.time
        }));

        res.json({
            kind: "drive#changeList",
            etag: `"mock-changes-etag"`,
            selfLink: `http://localhost/drive/v2/changes`,
            items: v2Changes,
            largestChangeId: result.newStartPageToken ? parseInt(result.newStartPageToken) : 0, // Mock simplification
            nextPageToken: result.nextPageToken
        });
    });


    // V2 Upload (Multipart)
    app.post('/upload/drive/v2/files', (req: Request, res: Response) => {
        // Reuse the logic from /upload/drive/v3/files but map response to V2
        // We can internally call the same handler logic or copy-paste.
        // For simplicity and decoupling, let's copy the multipart parsing logic but adapt for V2 response.

        const uploadType = req.query.uploadType as string;
        if (uploadType !== 'multipart') {
            res.status(400).json({ error: { code: 400, message: "Only uploadType=multipart is supported in this mock route" } });
            return;
        }

        const contentTypeHeader = req.headers['content-type'];
        const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;

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

        const parts = rawBody.split(`--${boundary}`);
        const validParts = parts.filter(p => p.trim() !== '' && p.trim() !== '--');

        if (validParts.length < 2) {
            res.status(400).json({ error: { code: 400, message: "Invalid multipart body" } });
            return;
        }

        const parsePart = (rawPart: string) => {
            let splitIndex = rawPart.indexOf('\r\n\r\n');
            let separatorLength = 4;
            if (splitIndex === -1) {
                splitIndex = rawPart.indexOf('\n\n');
                separatorLength = 2;
            }
            if (splitIndex === -1) {
                console.log('V2 Upload: Could not find header/body separator in part', rawPart.substring(0, 50));
                return null;
            }
            const headers = rawPart.substring(0, splitIndex).trim();
            const body = rawPart.substring(splitIndex + separatorLength);
            return {
                headers,
                body: body.replace(/(\r\n|\n)$/, '')
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

        // V2 Mapping for metadata
        const fileUpdates = fromV2Update(metadata);

        let content;
        try {
            content = JSON.parse(contentPart.body);
        } catch {
            content = contentPart.body;
        }

        const newFile = driveStore.createFile({
            ...fileUpdates,
            name: fileUpdates.name || metadata.title || "Untitled",
            mimeType: fileUpdates.mimeType || "application/octet-stream",
            parents: fileUpdates.parents || [],
            content: content
        });

        res.status(200).json(toV2File(newFile));
    });

    // V2 Trash
    app.post('/drive/v2/files/:fileId/trash', (req: Request, res: Response) => {
        const fileId = req.params.fileId;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const file = driveStore.updateFile(fileId, { trashed: true });
        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }
        res.json(toV2File(file));
    });

    // V2 Untrash
    app.post('/drive/v2/files/:fileId/untrash', (req: Request, res: Response) => {
        const fileId = req.params.fileId as string;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const file = driveStore.updateFile(fileId, { trashed: false });
        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }
        res.json(toV2File(file));
    });

    // V2 Empty Trash
    app.delete('/drive/v2/files/trash', (req: Request, res: Response) => {
        const files = driveStore.listFiles();
        const trashedFiles = files.filter(f => f.trashed);
        trashedFiles.forEach(f => driveStore.deleteFile(f.id));
        res.status(204).send();
    });

    // V2 Copy
    app.post('/drive/v2/files/:fileId/copy', (req: Request, res: Response) => {
        const fileId = req.params.fileId as string;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const existingFile = driveStore.getFile(fileId);
        if (!existingFile) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        const v2Body = req.body || {};
        const updates = fromV2Update(v2Body);

        const newFile = driveStore.createFile({
            ...existingFile, // Copy properties
            ...updates, // Apply overrides
            parents: updates.parents || existingFile.parents || [], // Parents might need special handling
            name: updates.name || v2Body.title || existingFile.name + " Copy", // simplified copy name
            id: undefined, // Create new ID
            createdTime: undefined, // New time
            modifiedTime: undefined // New time
        });

        // createFile handles ID generation and timestamps if undefined

        res.json(toV2File(newFile));
    });

    // V2 Touch
    app.post('/drive/v2/files/:fileId/touch', (req: Request, res: Response) => {
        const fileId = req.params.fileId as string;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const now = new Date().toISOString();
        const file = driveStore.updateFile(fileId, { modifiedTime: now });
        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }
        res.json(toV2File(file));
    });

    // V2 Parents: List
    app.get('/drive/v2/files/:fileId/parents', (req: Request, res: Response) => {
        const fileId = req.params.fileId as string;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const file = driveStore.getFile(fileId);
        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        const parents = (file.parents || []).map(parentId => ({
            kind: "drive#parentReference",
            id: parentId,
            selfLink: `${config.apiEndpoint}/drive/v2/files/${parentId}`,
            parentLink: `${config.apiEndpoint}/drive/v2/files/${parentId}`,
            isRoot: false // Mock Assumption
        }));

        res.json({
            kind: "drive#parentList",
            etag: `"parentList-${file.etag}"`,
            selfLink: `${config.apiEndpoint}/drive/v2/files/${fileId}/parents`,
            items: parents
        });
    });

    // V2 Parents: Get
    app.get('/drive/v2/files/:fileId/parents/:parentId', (req: Request, res: Response) => {
        const { fileId, parentId } = req.params as { fileId: string, parentId: string };
        const file = driveStore.getFile(fileId);
        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        if (!file.parents || !file.parents.includes(parentId)) {
            res.status(404).json({ error: { code: 404, message: "Parent not found" } });
            return;
        }

        res.json({
            kind: "drive#parentReference",
            id: parentId,
            selfLink: `${config.apiEndpoint}/drive/v2/files/${parentId}`,
            parentLink: `${config.apiEndpoint}/drive/v2/files/${parentId}`,
            isRoot: false
        });
    });

    // V2 Parents: Insert
    app.post('/drive/v2/files/:fileId/parents', (req: Request, res: Response) => {
        const fileId = req.params.fileId as string;
        const newParentId = req.body.id;

        if (!newParentId) {
            res.status(400).json({ error: { code: 400, message: "Parent ID required in body" } });
            return;
        }

        const file = driveStore.getFile(fileId);
        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        const currentParents = file.parents || [];
        if (!currentParents.includes(newParentId)) {
            driveStore.updateFile(fileId, { parents: [...currentParents, newParentId] });
        }

        res.json({
            kind: "drive#parentReference",
            id: newParentId,
            selfLink: `${config.apiEndpoint}/drive/v2/files/${newParentId}`,
            parentLink: `${config.apiEndpoint}/drive/v2/files/${newParentId}`,
            isRoot: false
        });
    });

    // V2 Parents: Delete
    app.delete('/drive/v2/files/:fileId/parents/:parentId', (req: Request, res: Response) => {
        const { fileId, parentId } = req.params as { fileId: string, parentId: string };
        const file = driveStore.getFile(fileId);
        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        const currentParents = file.parents || [];
        const newParents = currentParents.filter(p => p !== parentId);

        if (newParents.length === currentParents.length) {
            res.status(404).json({ error: { code: 404, message: "Parent not found" } });
            return;
        }

        driveStore.updateFile(fileId, { parents: newParents });
        res.status(204).send();
    });

    // V2 Revisions: List (Mocked)
    app.get('/drive/v2/files/:fileId/revisions', (req: Request, res: Response) => {
        const fileId = req.params.fileId as string;
        const file = driveStore.getFile(fileId);
        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        // Return a single revision representing "head"
        const revision = {
            kind: "drive#revision",
            etag: file.etag,
            id: "head",
            selfLink: `${config.apiEndpoint}/drive/v2/files/${fileId}/revisions/head`,
            mimeType: file.mimeType,
            modifiedDate: file.modifiedTime,
            published: true,
            lastModifyingUser: {
                kind: "drive#user",
                displayName: "Mock User",
                isAuthenticatedUser: true
            }
        };

        res.json({
            kind: "drive#revisionList",
            etag: `"revisionList-${file.etag}"`,
            selfLink: `${config.apiEndpoint}/drive/v2/files/${fileId}/revisions`,
            items: [revision]
        });
    });

    // V2 Revisions: Get (Mocked)
    app.get('/drive/v2/files/:fileId/revisions/:revisionId', (req: Request, res: Response) => {
        const { fileId, revisionId } = req.params as { fileId: string, revisionId: string };
        const file = driveStore.getFile(fileId);
        if (!file) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        if (revisionId !== 'head' && revisionId !== '1') {
            res.status(404).json({ error: { code: 404, message: "Revision not found" } });
            return;
        }

        const revision = {
            kind: "drive#revision",
            etag: file.etag,
            id: revisionId,
            selfLink: `${config.apiEndpoint}/drive/v2/files/${fileId}/revisions/${revisionId}`,
            mimeType: file.mimeType,
            modifiedDate: file.modifiedTime,
            published: true,
            lastModifyingUser: {
                kind: "drive#user",
                displayName: "Mock User",
                isAuthenticatedUser: true
            }
        };

        res.json(revision);
    });

    // V2 Files: Delete
    app.delete('/drive/v2/files/:fileId', (req: Request, res: Response) => {
        const fileId = req.params.fileId as string;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }
        const existingFile = driveStore.getFile(fileId);

        // V2 specific: often returns 404 for not found, same as V3 check
        if (!existingFile) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        // Check for Precondition (If-Match) - V2 respects this more often
        const ifMatchHeader = req.headers['if-match'];
        const ifMatch = Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader;
        if (ifMatch && ifMatch !== '*' && ifMatch !== existingFile.etag) {
            if (ifMatch !== existingFile.etag && ifMatch !== `"${existingFile.etag}"`) {
                res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                return;
            }
        }

        driveStore.deleteFile(fileId);
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
