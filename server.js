require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');
const stream = require('stream');

const app = express();
app.use(cors());

// Serve static files from the root directory
app.use(express.static('.'));

// Initialize Google Drive API client
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
});

const drive = google.drive({ version: 'v3', auth });

// Helper function to list files in a folder
async function listFiles(folderId) {
    try {
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType, thumbnailLink, imageMediaMetadata)',
            orderBy: 'name'
        });

        // Process files to include thumbnail URLs
        const files = response.data.files.map(file => ({
            ...file,
            thumbnailLink: file.thumbnailLink ? file.thumbnailLink.replace('=s220', '=s400') : null,
            isImage: file.mimeType.startsWith('image/')
        }));

        return files;
    } catch (error) {
        console.error('Error listing files:', error);
        throw error;
    }
}

// Helper function to get folder ID by path
async function getFolderIdByPath(path) {
    if (!path || path === '/') {
        return process.env.GOOGLE_DRIVE_FOLDER_ID;
    }

    const segments = decodeURIComponent(path).split('/').filter(Boolean);
    let currentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    for (const segment of segments) {
        const files = await listFiles(currentFolderId);
        const folder = files.find(f => 
            f.mimeType === 'application/vnd.google-apps.folder' && 
            f.name === segment
        );

        if (!folder) {
            throw new Error(`Folder not found: ${segment}`);
        }

        currentFolderId = folder.id;
    }

    return currentFolderId;
}

// Helper function to check if file is an image
function isImage(mimeType) {
    return mimeType.startsWith('image/');
}

// API endpoint to get files and folders
app.get('/api/files', async (req, res) => {
    try {
        const folderPath = req.query.path || '';
        const folderId = await getFolderIdByPath(folderPath);
        const files = await listFiles(folderId);

        const result = {
            files: [],
            directories: {}
        };

        files.forEach(file => {
            if (file.mimeType === 'application/vnd.google-apps.folder') {
                result.directories[file.name] = {
                    id: file.id,
                    files: [],
                    directories: {}
                };
            } else {
                result.files.push({
                    id: file.id,
                    name: file.name,
                    isImage: isImage(file.mimeType),
                    thumbnailUrl: file.thumbnailLink || null,
                    hasThumbnail: file.hasThumbnail || false
                });
            }
        });

        res.json(result);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to fetch files' });
    }
});

// API endpoint to get a thumbnail
app.get('/api/thumbnail/:fileId', async (req, res) => {
    try {
        const fileId = req.params.fileId;
        
        // Get file metadata with thumbnail
        const metadata = await drive.files.get({
            fileId: fileId,
            fields: 'thumbnailLink'
        });

        if (!metadata.data.thumbnailLink) {
            res.status(404).json({ error: 'No thumbnail available' });
            return;
        }

        // Redirect to the thumbnail URL
        res.redirect(metadata.data.thumbnailLink);

    } catch (error) {
        console.error('Error getting thumbnail:', error);
        res.status(500).json({ error: 'Failed to get thumbnail' });
    }
});

// API endpoint to download a file
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const fileId = req.params.fileId;
        
        // Get file metadata
        const metadata = await drive.files.get({
            fileId: fileId,
            fields: 'name, mimeType'
        });

        // Set response headers
        res.setHeader('Content-Type', metadata.data.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${metadata.data.name}"`);

        // Create a pass-through stream
        const passThrough = new stream.PassThrough();

        // Get the file and pipe it through
        const response = await drive.files.get(
            { fileId: fileId, alt: 'media' },
            { responseType: 'stream' }
        );

        // Handle errors during streaming
        response.data
            .on('error', err => {
                console.error('Error streaming file:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming file' });
                }
            })
            .pipe(passThrough)
            .pipe(res);

    } catch (error) {
        console.error('Error downloading file:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to download file' });
        }
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 