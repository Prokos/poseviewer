export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  thumbnailLink?: string;
  md5Checksum?: string;
  modifiedTime?: string;
};

export type DriveFolder = DriveFile & {
  mimeType: 'application/vnd.google-apps.folder';
};

export type DriveImage = DriveFile & {
  mimeType: string;
};
