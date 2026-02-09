import express, { Request, Response } from 'express';
import { driveStore } from '../store';
import { toV2File, fromV2Update } from '../mappers';
import { AppConfig } from '../types';

export const createV2Router = (config: AppConfig) => {
    const app = express.Router();

    // V2 Files: Create
    app.post('/drive/v2/files', (req: Request, res: Response) => {
        const v2Body = req.body || {};
        const fileData = fromV2Update(v2Body);

        const name = fileData.name || v2Body.title || "Untitled";

        const newFile = driveStore.createFile({
            ...fileData,
            name: name,
            mimeType: fileData.mimeType || "application/octet-stream",
            parents: fileData.parents || []
        });

        res.status(200).json(toV2File(newFile));
    });

    // V2 Generate IDs (Must come before /:fileId)
    app.get('/drive/v2/files/generateIds', (req: Request, res: Response) => {
        const count = parseInt(req.query.maxResults as string) || 10;
        const ids = [];
        for (let i = 0; i < count; i++) {
            ids.push(Math.random().toString(36).substring(2, 15));
        }
        res.json({
            kind: "drive#generatedIds",
            ids: ids,
            space: req.query.space || 'drive'
        });
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

        if (file.etag) {
            res.setHeader('ETag', file.etag);
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

        res.json(toV2File(file));
    });

    // V2 Export
    app.get('/drive/v2/files/:fileId/export', (req: Request, res: Response) => {
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
        // Mock export: just return content. Real API validates mimeType compatibility.
        res.send(file.content || "");
    });

    // V2 Watch
    app.post('/drive/v2/files/:fileId/watch', (req: Request, res: Response) => {
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

        // Mock Channel response
        res.json({
            kind: "api#channel",
            id: req.body.id || Math.random().toString(36).substring(7),
            resourceId: fileId,
            resourceUri: `${config.apiEndpoint}/drive/v2/files/${fileId}`,
            token: req.body.token,
            expiration: Date.now() + 3600000 // 1 hour
        });
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

        const ifMatchHeader = req.headers['if-match'];
        const ifMatch = Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader;
        if (ifMatch && ifMatch !== '*' && ifMatch !== existingFile.etag) {
            if (ifMatch !== existingFile.etag && ifMatch !== `"${existingFile.etag}"`) {
                res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                return;
            }
        }

        // Handle addParents/removeParents
        let parents = existingFile.parents || [];
        const addParents = req.query.addParents as string;
        const removeParents = req.query.removeParents as string;

        if (addParents) {
            const toAdd = addParents.split(',');
            toAdd.forEach(id => {
                if (!parents.includes(id)) parents.push(id);
            });
        }

        if (removeParents) {
            const toRemove = removeParents.split(',');
            parents = parents.filter(id => !toRemove.includes(id));
        }

        // Merge parents into updates if they were modified
        if (addParents || removeParents) {
            updates.parents = parents;
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

        const ifMatchHeader = req.headers['if-match'];
        const ifMatch = Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader;
        if (ifMatch && ifMatch !== '*' && ifMatch !== existingFile.etag) {
            if (ifMatch !== existingFile.etag && ifMatch !== `"${existingFile.etag}"`) {
                res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                return;
            }
        }

        // Handle addParents/removeParents
        let parents = existingFile.parents || [];
        const addParents = req.query.addParents as string;
        const removeParents = req.query.removeParents as string;

        if (addParents) {
            const toAdd = addParents.split(',');
            toAdd.forEach(id => {
                if (!parents.includes(id)) parents.push(id);
            });
        }

        if (removeParents) {
            const toRemove = removeParents.split(',');
            parents = parents.filter(id => !toRemove.includes(id));
        }

        // Merge parents into updates if they were modified
        if (addParents || removeParents) {
            updates.parents = parents;
        }

        const updatedFile = driveStore.updateFile(fileId, updates);
        res.json(toV2File(updatedFile!));
    });

    // V2 Files: List
    app.get('/drive/v2/files', (req: Request, res: Response) => {
        let files = driveStore.listFiles();
        const q = req.query.q as string;

        if (q) {
            const parts = q.split(' and ').map(p => p.trim());
            files = files.filter(file => {
                return parts.every(part => {
                    if (part.startsWith("title = '")) {
                        const title = part.match(/title = '(.*)'/)?.[1];
                        return file.name === title;
                    }

                    if (part.startsWith("title contains '")) {
                        const token = part.match(/title contains '(.*)'/)?.[1];
                        return token && file.name.includes(token);
                    }

                    if (part.startsWith("name = '")) {
                        const name = part.match(/name = '(.*)'/)?.[1];
                        return file.name === name;
                    }
                    if (part.startsWith("name contains '")) {
                        const token = part.match(/name contains '(.*)'/)?.[1];
                        return token && file.name.includes(token);
                    }
                    if (part.includes(" in parents")) {
                        const parentId = part.match(/'(.*)' in parents/)?.[1];
                        return parentId && file.parents?.includes(parentId);
                    }
                    if (part === "trashed = false") {
                        return file.trashed !== true;
                    }
                    if (part === "trashed = true") {
                        return file.trashed === true;
                    }
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
            rootFolderId: "root"
        });
    });

    // V2 Changes
    app.get('/drive/v2/changes', (req: Request, res: Response) => {
        const pageToken = req.query.pageToken as string;
        const result = driveStore.getChanges(pageToken);

        const v2Changes = result.changes.map(change => ({
            kind: "drive#change",
            id: Math.random().toString(36).substring(7),
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
            largestChangeId: result.newStartPageToken ? parseInt(result.newStartPageToken) : 0,
            nextPageToken: result.nextPageToken
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

    // Helper for multipart parsing
    const parseMultipart = (rawBody: string, boundary: string) => {
        const parts = rawBody.split(`--${boundary}`);
        const validParts = parts.filter(p => p.trim() !== '' && p.trim() !== '--');

        if (validParts.length < 2) {
            return null;
        }

        const parsePart = (rawPart: string) => {
            let splitIndex = rawPart.indexOf('\r\n\r\n');
            let separatorLength = 4;
            if (splitIndex === -1) {
                splitIndex = rawPart.indexOf('\n\n');
                separatorLength = 2;
            }
            if (splitIndex === -1) {
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
            return null;
        }

        let metadata;
        try {
            metadata = JSON.parse(metadataPart.body);
        } catch {
            return null;
        }

        let content;
        try {
            content = JSON.parse(contentPart.body);
        } catch {
            content = contentPart.body;
        }

        return { metadata, content };
    };

    // V2 Upload (POST)
    app.post('/upload/drive/v2/files', (req: Request, res: Response) => {
        const uploadType = req.query.uploadType as string;

        // V2 behavior: If-None-Match on POST seems to check against the collection or just strictly fail if an entity exists contextually.
        // Tests show it returns 412 Precondition Failed when '*' is used.
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch) {
            res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
            return;
        }

        if (uploadType === 'media') {
            const rawBody = req.body;
            // For simple upload, metadata is default
            const name = "Untitled";

            const newFile = driveStore.createFile({
                name: name,
                mimeType: req.headers['content-type'] || "application/octet-stream",
                parents: [],
                content: rawBody
            });
            res.status(200).json(toV2File(newFile));
            return;
        }

        if (uploadType === 'multipart') {
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

            const parsed = parseMultipart(rawBody, boundary);
            if (!parsed) {
                res.status(400).json({ error: { code: 400, message: "Invalid multipart body" } });
                return;
            }

            const { metadata, content } = parsed;
            const fileData = fromV2Update(metadata);
            const name = fileData.name || metadata.title || "Untitled";

            const newFile = driveStore.createFile({
                ...fileData,
                name: name,
                mimeType: fileData.mimeType || "application/octet-stream",
                parents: fileData.parents || [],
                content: content
            });

            res.status(200).json(toV2File(newFile));
            return;
        }

        res.status(400).json({ error: { code: 400, message: "Invalid uploadType" } });
    });

    // V2 Upload (PUT)
    app.put('/upload/drive/v2/files/:fileId', (req: Request, res: Response) => {
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

        const ifMatchHeader = req.headers['if-match'];
        const ifMatch = Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader;
        if (ifMatch && ifMatch !== '*' && ifMatch !== existingFile.etag) {
            if (ifMatch !== existingFile.etag && ifMatch !== `"${existingFile.etag}"`) {
                res.status(412).json({ error: { code: 412, message: "Precondition Failed" } });
                return;
            }
        }

        const uploadType = req.query.uploadType as string;

        if (uploadType === 'media') {
            const rawBody = req.body;
            const updatedFile = driveStore.updateFile(fileId, {
                content: rawBody,
                modifiedTime: new Date().toISOString()
            });
            res.status(200).json(toV2File(updatedFile!));
            return;
        }

        if (uploadType === 'multipart') {
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

            const parsed = parseMultipart(rawBody, boundary);
            if (!parsed) {
                res.status(400).json({ error: { code: 400, message: "Invalid multipart body" } });
                return;
            }

            const { metadata, content } = parsed;
            const fileData = fromV2Update(metadata);

            const updatedFile = driveStore.updateFile(fileId, {
                ...fileData,
                content: content,
                modifiedTime: new Date().toISOString()
            });

            res.status(200).json(toV2File(updatedFile!));
            return;
        }

        res.status(400).json({ error: { code: 400, message: "Invalid uploadType" } });
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
        const title = v2Body.title || `Copy of ${existingFile.name}`;

        const newFile = driveStore.createFile({
            ...existingFile,
            id: undefined,
            name: title,
            parents: existingFile.parents
        });

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
