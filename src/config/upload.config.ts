/**
 * Upload policy — change here once; every upload path (logo, stamp, member photo)
 * reads from this file. Not env-driven.
 */
export type UploadLimits = {
  maxFileBytes: number;
  maxFileMb: number;
  allowedMimeTypes: string[];
};

/** Max image size for branding + member photos */
export const UPLOAD_MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB

export const UPLOAD_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
] as const;

export function getUploadLimits(): UploadLimits {
  return {
    maxFileBytes: UPLOAD_MAX_FILE_BYTES,
    maxFileMb: Math.round((UPLOAD_MAX_FILE_BYTES / (1024 * 1024)) * 100) / 100,
    allowedMimeTypes: [...UPLOAD_ALLOWED_MIME_TYPES],
  };
}
