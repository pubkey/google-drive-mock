/* eslint-disable @typescript-eslint/no-explicit-any */
import { driveStore } from './store';
import { Request, Response } from 'express';

interface BatchPart {
    contentId: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
}


interface BatchResponse {
    contentId: string;
    statusCode: number;
    headers?: Record<string, string>;
    body?: any;
}

export const handleBatchRequest = (req: Request, res: Response) => {
    // ... (unchanged)
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/mixed')) {
        return res.status(400).send('Content-Type must be multipart/mixed');
    }

    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
        return res.status(400).send('Multipart boundary missing');
    }
    let boundary = boundaryMatch[1];
    if (boundary.startsWith('"') && boundary.endsWith('"')) {
        boundary = boundary.substring(1, boundary.length - 1);
    }

    const rawBody = req.body;
    if (typeof rawBody !== 'string') {
        return res.status(400).send('Body parsing failed');
    }

    const parts = parseMultipart(rawBody, boundary);
    const responses: BatchResponse[] = [];

    for (const part of parts) {
        const response = processPart(part, req);
        responses.push(response);
    }

    const responseBoundary = `batch_${Math.random().toString(36).substring(2)}`;
    const responseBody = buildMultipartResponse(responses, responseBoundary);

    res.set('Content-Type', `multipart/mixed; boundary=${responseBoundary}`);
    res.end(responseBody);
};

// ... parseMultipart unchanged ...

function processPart(part: BatchPart, req: Request): BatchResponse {
    const fileIdMatch = part.url.match(/\/drive\/v3\/files\/([^/?]+)/);
    const filesListMatch = part.url.match(/\/drive\/v3\/files/);
    const aboutMatch = part.url.match(/\/drive\/v3\/about/);

    // Simple query parser
    const queryIdx = part.url.indexOf('?');
    const query: Record<string, string> = {};
    if (queryIdx !== -1) {
        const queryStr = part.url.substring(queryIdx + 1);
        queryStr.split('&').forEach(pair => {
            const [key, val] = pair.split('=');
            if (key) query[key] = val ? decodeURIComponent(val) : '';
        });
    }

    try {
        // GET File
        if (part.method === 'GET' && fileIdMatch) {
            const fileId = fileIdMatch[1];
            const file = driveStore.getFile(fileId);

            if (!file) return { contentId: part.contentId, statusCode: 404, body: { error: { code: 404, message: 'File not found' } } };

            if (query['alt'] === 'media') {
                // Return 302 Redirect to download URL
                // We construct a fully qualified URL if possible, or relative.
                // The Mock server is running on some port. We can try relative to the batch endpoint?
                // Or better, we just use the path since most clients handle it.
                // Real API returns absolute URL.
                // We'll mimic Real API structure roughly: /drive/v3/files/{id}?alt=media
                // But we need to serve the content on that GET route.
                // `src/routes/v3.ts` already handles `GET /drive/v3/files/:id?alt=media`.

                // We need the host. `req.headers.host` might work if passed through.
                const host = req.headers.host || 'localhost';
                const protocol = req.protocol || 'http';
                const location = `${protocol}://${host}/drive/v3/files/${fileId}?alt=media`;

                return {
                    contentId: part.contentId,
                    statusCode: 302,
                    headers: { 'Location': location },
                    body: null // No body for 302 usually, or empty
                };
            }

            return { contentId: part.contentId, statusCode: 200, body: file };
        }

        // GET Files List
        if (part.method === 'GET' && filesListMatch && !fileIdMatch) {
            const files = driveStore.listFiles();
            return {
                contentId: part.contentId,
                statusCode: 200,
                body: {
                    kind: "drive#fileList",
                    incompleteSearch: false,
                    files: files
                }
            };
        }

        // GET About
        if (part.method === 'GET' && aboutMatch) {
            const about = driveStore.getAbout();
            return {
                contentId: part.contentId,
                statusCode: 200,
                body: {
                    kind: "drive#about",
                    ...about
                }
            };
        }

        // POST Create File
        if (part.method === 'POST' && filesListMatch) {
            if (!part.body || !part.body.name) {
                return { contentId: part.contentId, statusCode: 400, body: { error: { code: 400, message: 'Name required' } } };
            }
            const newFile = driveStore.createFile({
                name: part.body.name,
                mimeType: part.body.mimeType,
                parents: part.body.parents
            });
            return { contentId: part.contentId, statusCode: 200, body: newFile };
        }

        if (part.method === 'PATCH' && fileIdMatch) {
            const fileId = fileIdMatch[1];
            const updated = driveStore.updateFile(fileId, part.body);
            if (!updated) return { contentId: part.contentId, statusCode: 404, body: { error: { code: 404, message: 'File not found' } } };
            return { contentId: part.contentId, statusCode: 200, body: updated };
        }

        if (part.method === 'DELETE' && fileIdMatch) {
            const fileId = fileIdMatch[1];
            const deleted = driveStore.deleteFile(fileId);
            if (!deleted) return { contentId: part.contentId, statusCode: 404, body: { error: { code: 404, message: 'File not found' } } };
            return { contentId: part.contentId, statusCode: 204 }; // No body
        }

        return { contentId: part.contentId, statusCode: 404, body: { error: { message: "Not handler found for batch request url " + part.url } } };

    } catch (e: any) {
        return { contentId: part.contentId, statusCode: 500, body: { error: { message: e.message } } };
    }
}

function buildMultipartResponse(responses: BatchResponse[], boundary: string): string {
    let output = '';

    for (const response of responses) {
        output += `--${boundary}\r\n`;
        output += `Content-Type: application/http\r\n`;
        output += `Content-ID: ${response.contentId}\r\n\r\n`;

        output += `HTTP/1.1 ${response.statusCode} ${(response.statusCode === 200 ? 'OK' : (response.statusCode === 302 ? 'Found' : ''))}\r\n`;
        output += `Content-Type: application/json; charset=UTF-8\r\n`; // Always adding this might be weird for 302/204 but ok for now

        if (response.headers) {
            for (const [key, value] of Object.entries(response.headers)) {
                output += `${key}: ${value}\r\n`;
            }
        }
        output += `\r\n`; // End headers

        if (response.body) {
            output += JSON.stringify(response.body) + '\r\n';
        }
        output += '\r\n';
    }

    output += `--${boundary}--`;
    return output;
}

function parseMultipart(body: string, boundary: string): BatchPart[] {
    const parts: BatchPart[] = [];
    // Split by --boundary
    // Note: The last part ends with --boundary--
    const rawParts = body.split(`--${boundary}`);

    for (const rawPart of rawParts) {
        // Skip empty or end parts
        if (rawPart.trim() === '' || rawPart.trim() === '--') continue;

        // Parse outer headers
        const sections = rawPart.trim().split(/\r?\n\r?\n/);
        const headersSection = sections[0];
        const rest = sections.slice(1);

        let contentId = '';
        const headerLines = headersSection.split(/\r?\n/);
        for (const line of headerLines) {
            if (line.toLowerCase().startsWith('content-id:')) {
                contentId = line.split(':')[1].trim();
            }
        }

        const httpContent = rest.join('\r\n\r\n'); // Reconstruct body if multiple parts? 

        if (!httpContent && sections.length < 2) continue; // No body?

        // Ideally, httpContent is the rest. 
        // But if we split by double newline, we might have split the inner body too.
        // Better: Find first double newline index manually.

        // ... (Rewriting loop to be safer)

        const firstDoubleNewline = rawPart.indexOf('\r\n\r\n');
        const firstDoubleNewlineLF = rawPart.indexOf('\n\n');

        let splitIndex = -1;
        let splitLen = 0;

        if (firstDoubleNewline !== -1) {
            splitIndex = firstDoubleNewline;
            splitLen = 4;
        } else if (firstDoubleNewlineLF !== -1) {
            splitIndex = firstDoubleNewlineLF;
            splitLen = 2;
        }

        if (splitIndex === -1) continue;

        const headersStr = rawPart.substring(0, splitIndex).trim();
        const bodyStr = rawPart.substring(splitIndex + splitLen); // No trim on body?

        // Parse outer headers
        const hLines = headersStr.split(/\r?\n/);
        for (const line of hLines) {
            if (line.toLowerCase().startsWith('content-id:')) {
                contentId = line.split(':')[1].trim();
            }
        }

        if (!bodyStr) continue;

        // Inner HTTP part
        // Same logic for inner split
        const innerSplitIndexCRLF = bodyStr.indexOf('\r\n\r\n');
        const innerSplitIndexLF = bodyStr.indexOf('\n\n');

        let innerSplitIndex = -1;
        let innerSplitLen = 0;

        if (innerSplitIndexCRLF !== -1) {
            innerSplitIndex = innerSplitIndexCRLF;
            innerSplitLen = 4;
        } else if (innerSplitIndexLF !== -1 && (innerSplitIndexCRLF === -1 || innerSplitIndexLF < innerSplitIndexCRLF)) {
            innerSplitIndex = innerSplitIndexLF;
            innerSplitLen = 2;
        }

        // If NO header terminator found in inner body, maybe no headers? (But request line exists)
        // Request line is mandatory.

        let requestLine = '';
        let innerHeadersStr = '';
        let httpBody = '';

        if (innerSplitIndex !== -1) {
            const head = bodyStr.substring(0, innerSplitIndex);
            httpBody = bodyStr.substring(innerSplitIndex + innerSplitLen);
            const lines = head.split(/\r?\n/);
            requestLine = lines[0];
            innerHeadersStr = lines.slice(1).join('\n');
        } else {
            // Maybe no body? Just headers?
            const lines = bodyStr.trim().split(/\r?\n/);
            requestLine = lines[0];
            innerHeadersStr = lines.slice(1).join('\n');
            httpBody = '';
        }

        const [method, url] = requestLine.split(' ');

        // Parse inner headers
        const headers: Record<string, string> = {};
        const innerHLines = innerHeadersStr.split(/\r?\n/);
        for (const line of innerHLines) {
            const [key, ...value] = line.split(':');
            if (key) headers[key.toLowerCase()] = value.join(':').trim();
        }

        let parsedBody;
        if (httpBody && httpBody.trim()) {
            try {
                parsedBody = JSON.parse(httpBody);
            } catch {
                parsedBody = httpBody;
            }
        }

        // Clean URL (remove prefix if present, though clients usually send relative path)
        // Ensure /drive/v3/files...

        parts.push({
            contentId,
            method,
            url,
            headers,
            body: parsedBody
        });
    }

    return parts;
}

