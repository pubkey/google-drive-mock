import { DriveFile } from './store';

/**
 * Maps an internal DriveFile (V3 format) to a V2 API File resource.
 */
export function toV2File(file: DriveFile): Record<string, unknown> {
    return {
        kind: 'drive#file',
        id: file.id,
        etag: file.etag || `"${file.version}"`, // V2 uses etags frequently
        selfLink: `http://localhost/drive/v2/files/${file.id}`, // Mock link
        title: file.name,
        mimeType: file.mimeType,
        labels: {
            starred: file.starred || false,
            hidden: false,
            trashed: file.trashed || false,
            restricted: false,
            viewed: true
        },
        createdDate: file.createdTime,
        modifiedDate: file.modifiedTime,
        parents: (file.parents || []).map(parentId => ({
            kind: 'drive#parentReference',
            id: parentId,
            selfLink: `http://localhost/drive/v2/files/${parentId}`,
            parentLink: `http://localhost/drive/v2/files/${parentId}`,
            isRoot: false // Mock simplification
        })),
        version: file.version,
        fileSize: file.size,
        md5Checksum: file.md5Checksum,
        downloadUrl: `http://localhost/drive/v2/files/${file.id}?alt=media`
    };
}

/**
 * Maps a V2 API File Update/Insert body to a partial Internal DriveFile (V3 format).
 */
export function fromV2Update(body: Record<string, unknown>): Partial<DriveFile> {
    const update: Partial<DriveFile> = {};

    if (typeof body.title === 'string') update.name = body.title;
    if (typeof body.mimeType === 'string') update.mimeType = body.mimeType;
    if (typeof body.modifiedDate === 'string') update.modifiedTime = body.modifiedDate;

    // Parents in V2 create are typically [{id: '...'}]
    if (body.parents && Array.isArray(body.parents)) {
        update.parents = body.parents
            .map((p: unknown) => (p as Record<string, unknown>).id)
            .filter((id: unknown): id is string => typeof id === 'string');
    }

    if (body.labels && typeof body.labels === 'object') {
        const labels = body.labels as Record<string, unknown>;
        if (typeof labels.starred === 'boolean') update.starred = labels.starred;
        if (typeof labels.trashed === 'boolean') update.trashed = labels.trashed;
    }

    return update;
}


/**
 * Filters an object based on the Google Drive API `fields` parameter.
 * Supports nested fields like "files(id,name,parents)".
 * 
 * @param data The object to filter
 * @param fields The fields selection string
 */
export function applyFields(data: unknown, fields: string): unknown {
    if (!fields || fields === '*') return data;

    // Parse top-level fields
    const parsedFields: { key: string, subFields?: string }[] = [];

    let depth = 0;
    let currentStart = 0;

    for (let i = 0; i < fields.length; i++) {
        const char = fields[i];
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (char === ',' && depth === 0) {
            // Split
            parseFieldPart(fields.substring(currentStart, i), parsedFields);
            currentStart = i + 1;
        }
    }
    // Last part
    parseFieldPart(fields.substring(currentStart), parsedFields);

    if (Array.isArray(data)) {
        // If data is array, apply to each item?
        // Usually fields selection on array applies to the object WRAPPING the array, 
        // e.g. "files(id)" on { files: [...] }.
        // But if we are called RESURSIVELY on an array value, we should map it.
        return data.map(item => applyFields(item, fields));
    }

    if (typeof data !== 'object' || data === null) {
        return data;
    }

    const dataObj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const field of parsedFields) {
        if (field.key === '*') {
            // Wildcard at this level - copy everything? 
            // Logic can be complex. For now, strict parity with requested use case.
            return data;
        }

        if (Object.prototype.hasOwnProperty.call(dataObj, field.key)) {
            const value = dataObj[field.key];
            if (field.subFields) {
                // Recursive apply
                if (Array.isArray(value)) {
                    result[field.key] = value.map((item: unknown) => applyFields(item, field.subFields!));
                } else {
                    result[field.key] = applyFields(value, field.subFields!);
                }
            } else {
                result[field.key] = value;
            }
        }
    }

    return result;
}

function parseFieldPart(part: string, result: { key: string, subFields?: string }[]) {
    const trimmed = part.trim();
    if (!trimmed) return;

    const parenStart = trimmed.indexOf('(');
    if (parenStart !== -1 && trimmed.endsWith(')')) {
        const key = trimmed.substring(0, parenStart);
        const subFields = trimmed.substring(parenStart + 1, trimmed.length - 1);
        result.push({ key, subFields });
    } else {
        result.push({ key: trimmed });
    }
}
