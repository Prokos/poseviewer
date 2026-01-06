# Pose Viewer

Pose Viewer is a lightweight React + TypeScript app for browsing pose reference images in Google Drive. It scans a root folder, lets you define sets, stores metadata in `metadata.txt`, and renders the library on desktop or mobile.

## Setup

1. Create a Google Cloud project and enable the **Google Drive API**.
2. Create an OAuth client ID for a **Web application**.
3. Add `http://localhost:5173` to **Authorized JavaScript origins**.
4. Copy `.env.example` to `.env` and set your client ID:

```bash
cp .env.example .env
```

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_ROOT_FOLDER_ID=1-3_0DhIrYRZQC1FhvQ_Eu-UfSRvcLaMn
```

5. Install dependencies and run the app:

```bash
npm install
npm run dev
```

## Metadata format

`metadata.txt` is stored in the root Drive folder as JSON:

```json
{
  "version": 1,
  "sets": [
    {
      "id": "uuid",
      "name": "1000+ Male Poses",
      "rootFolderId": "drive-folder-id",
      "rootPath": "Male/Clothed/1000+ Male Poses",
      "tags": ["male", "clothed"],
      "thumbnailFileId": "drive-file-id"
    }
  ]
}
```

## Notes

- The app requests `https://www.googleapis.com/auth/drive` so it can list folders and update `metadata.txt`.
- Image rendering uses authenticated downloads, so viewing is limited to the signed-in user.
