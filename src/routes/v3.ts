import express, { Request, Response } from 'express';
import { driveStore } from '../store';

export const createV3Router = () => {
    const app = express.Router();

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
        if (uploadType !== 'multipart' && uploadType !== 'media') {
            res.status(400).json({ error: { code: 400, message: "Only uploadType=multipart or uploadType=media is supported in this mock route" } });
            return;
        }

        if (uploadType === 'media') {
            const rawBody = req.body;
            // Handle edge case where express.json() parses empty body as {}
            if (req.headers['content-length'] === '0' && JSON.stringify(rawBody) === '{}') {
                // Empty body
            }

            const newFile = driveStore.createFile({
                name: "Untitled",
                mimeType: req.headers['content-type'] || "application/octet-stream",
                parents: [],
                content: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody) // Handle body if parsed
            });
            res.status(200).json(newFile);
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
            res.status(400).json({ error: { code: 400, message: "Invalid multipart body: expected at least metadata and content" } });
            return;
        }

        const parsePart = (rawPart: string) => {
            const splitIndex = rawPart.indexOf('\r\n\r\n');
            if (splitIndex === -1) return null;
            const headers = rawPart.substring(0, splitIndex).trim();
            const body = rawPart.substring(splitIndex + 4);
            return {
                headers,
                body: body.replace(/\r\n$/, '')
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
        try {
            content = JSON.parse(contentPart.body);
        } catch {
            content = contentPart.body;
        }

        const newFile = driveStore.createFile({
            ...metadata,
            content: content
        });

        res.status(200).json(newFile);
    });

    // Upload Files: Update (PATCH)
    app.patch('/upload/drive/v3/files/:fileId', (req: Request, res: Response) => {
        const fileId = req.params.fileId;
        if (typeof fileId !== 'string') {
            res.status(400).send("Invalid file ID");
            return;
        }

        const existingFile = driveStore.getFile(fileId);
        if (!existingFile) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        const uploadType = req.query.uploadType as string;

        if (uploadType === 'media') {
            const rawBody = req.body;
            // V3 update content via media upload
            const updatedFile = driveStore.updateFile(fileId, {
                content: rawBody,
                modifiedTime: new Date().toISOString()
            });
            res.status(200).json(updatedFile!);
            return;
        }

        const contentTypeHeader = req.headers['content-type'];
        const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;

        // Check for multipart
        if (contentType && contentType.includes('multipart/related')) {
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
                res.status(400).json({ error: { code: 400, message: "Invalid multipart body: expected at least metadata and content" } });
                return;
            }

            const parsePart = (rawPart: string) => {
                const splitIndex = rawPart.indexOf('\r\n\r\n');
                if (splitIndex === -1) return null;
                const headers = rawPart.substring(0, splitIndex).trim();
                const body = rawPart.substring(splitIndex + 4);
                return {
                    headers,
                    body: body.replace(/\r\n$/, '') // Remove trailing CRLF from part body
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
            try {
                content = JSON.parse(contentPart.body);
            } catch {
                content = contentPart.body;
            }

            // Perform update
            const updatedFile = driveStore.updateFile(fileId, {
                ...metadata,
                content: content,
                modifiedTime: new Date().toISOString()
            });

            res.status(200).json(updatedFile);
            return;
        }

        res.status(400).json({ error: { code: 400, message: "Only uploadType=media or multipart/related is supported for V3 PATCH upload" } });
    });

    // Files: Create (Standard)
    app.post('/drive/v3/files', (req: Request, res: Response) => {
        const body = req.body || {};
        const name = body.name || "Untitled";

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

        const fields = req.query.fields as string;
        if (fields && (fields.includes('etag') || fields.includes('kind,etag'))) {
            res.status(400).json({ error: { code: 400, message: "Invalid field selection: etag" } });
            return;
        }

        if (req.query.alt === 'media') {
            if (file.mimeType) {
                res.setHeader('Content-Type', file.mimeType);
            }
            if (file.content === undefined) {
                res.send("");
                return;
            }
            if (typeof file.content === 'object') {
                res.json(file.content);
            } else {
                res.send(file.content);
            }
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

        const deleted = driveStore.deleteFile(fileId);

        if (!deleted) {
            res.status(404).json({ error: { code: 404, message: "File not found" } });
            return;
        }

        res.status(204).send();
    });

    return app;
};
