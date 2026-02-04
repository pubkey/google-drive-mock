import { DriveFile } from './store';

/**
 * Maps an internal DriveFile (V3 format) to a V2 API File resource.
 */
export function toV2File(file: DriveFile): any {
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
        downloadUrl: `http://localhost/drive/v2/files/${file.id}?alt=media`
    };
}

/**
 * Maps a V2 API File Update/Insert body to a partial Internal DriveFile (V3 format).
 */
export function fromV2Update(body: any): Partial<DriveFile> {
    const update: Partial<DriveFile> = {};

    if (body.title !== undefined) update.name = body.title;
    if (body.mimeType !== undefined) update.mimeType = body.mimeType;
    if (body.modifiedDate !== undefined) update.modifiedTime = body.modifiedDate;

    // Parents in V2 create are typically [{id: '...'}]
    if (body.parents && Array.isArray(body.parents)) {
        update.parents = body.parents.map((p: any) => p.id).filter((id: any) => typeof id === 'string');
    }

    if (body.labels) {
        if (body.labels.starred !== undefined) update.starred = body.labels.starred;
        if (body.labels.trashed !== undefined) update.trashed = body.labels.trashed;
    }

    return update;
}
