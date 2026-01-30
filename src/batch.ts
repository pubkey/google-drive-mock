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
    body?: any;
}

export const handleBatchRequest = (req: Request, res: Response) => {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/mixed')) {
        return res.status(400).send('Content-Type must be multipart/mixed');
    }

    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
        return res.status(400).send('Multipart boundary missing');
    }
    let boundary = boundaryMatch[1];
    // Boundaries in header can be quoted
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
        const response = processPart(part);
        responses.push(response);
    }

    const responseBoundary = `batch_${Math.random().toString(36).substring(2)}`;
    const responseBody = buildMultipartResponse(responses, responseBoundary);

    res.set('Content-Type', `multipart/mixed; boundary=${responseBoundary}`);
    res.end(responseBody);
};

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

function processPart(part: BatchPart): BatchResponse {
    // Simple logic dispatch
    // We only support /drive/v3/files operations basically

    // Helper to match URL
    const fileIdMatch = part.url.match(/\/drive\/v3\/files\/([^/?]+)/);
    const filesListMatch = part.url.match(/\/drive\/v3\/files$/) || part.url.match(/\/drive\/v3\/files\?/);

    try {
        if (part.method === 'GET' && fileIdMatch) {
            const fileId = fileIdMatch[1];
            const file = driveStore.getFile(fileId);
            if (!file) return { contentId: part.contentId, statusCode: 404, body: { error: { code: 404, message: 'File not found' } } };
            return { contentId: part.contentId, statusCode: 200, body: file };
        }

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

        // Add more handlers as needed (DELETE, etc.)

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

        output += `HTTP/1.1 ${response.statusCode} OK\r\n`; // Simplified status text
        output += `Content-Type: application/json; charset=UTF-8\r\n\r\n`;

        if (response.body) {
            output += JSON.stringify(response.body) + '\r\n';
        }
        output += '\r\n';
    }

    output += `--${boundary}--`;
    return output;
}
