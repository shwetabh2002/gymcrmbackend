import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { getUploadLimits, UploadLimits } from '../config/upload.config';

export type UploadedAsset = {
  key: string;
  url: string;
  driver: 's3';
};

/** Brand + profile image folders under companies/{companyId}/… */
export type AssetFolder =
  | 'logos'
  | 'favicons'
  | 'stamps'
  | 'members'
  | 'employees'
  | 'payments'
  | 'misc';

/**
 * S3 key layout (always scoped by company):
 *   companies/{companyId}/branding/{logos|favicons|stamps}/{uuid}.ext
 *   companies/{companyId}/members/{memberId}/{uuid}.ext
 *   companies/{companyId}/employees/{employeeId}/{uuid}.ext
 *   companies/{companyId}/payments/{paymentId}/{uuid}.ext
 *   companies/{companyId}/misc/{uuid}.ext
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;
  private readonly limits: UploadLimits;

  constructor(private config: ConfigService) {
    this.limits = getUploadLimits();

    const driver = (config.get<string>('STORAGE_DRIVER') || 's3').toLowerCase();
    if (driver !== 's3') {
      throw new Error(
        `STORAGE_DRIVER="${driver}" is not supported. Use STORAGE_DRIVER=s3.`,
      );
    }

    const region = config.get<string>('AWS_REGION') || 'ap-south-1';
    const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = config.get<string>('AWS_SECRET_ACCESS_KEY')?.trim();
    const bucket = config.get<string>('S3_BUCKET')?.trim();
    const publicBase = (
      config.get<string>('S3_PUBLIC_BASE_URL') ||
      (bucket ? `https://${bucket}.s3.${region}.amazonaws.com` : '')
    ).replace(/\/$/, '');

    if (
      !accessKeyId ||
      !secretAccessKey ||
      !bucket ||
      accessKeyId.startsWith('DUMMY_') ||
      secretAccessKey.startsWith('DUMMY_') ||
      secretAccessKey === 'PASTE_SECRET_ACCESS_KEY_HERE'
    ) {
      throw new Error(
        'S3 is required: set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, S3_PUBLIC_BASE_URL in .env',
      );
    }

    this.bucket = bucket;
    this.publicBase = publicBase;
    this.s3 = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    this.logger.log(
      `Storage: S3 only · bucket=${this.bucket} · region=${region} · base=${this.publicBase}`,
    );
    this.logger.log(
      `Upload limits: max=${this.limits.maxFileBytes} bytes (~${this.limits.maxFileMb}MB)`,
    );
  }

  getLimits(): UploadLimits {
    return this.limits;
  }

  /** Shared validation for logos, stamps, member photos, etc. */
  assertValidImageFile(file?: Express.Multer.File | null): Express.Multer.File {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (!this.limits.allowedMimeTypes.includes(mime)) {
      throw new BadRequestException(
        `Only ${this.limits.allowedMimeTypes.join(', ')} images are allowed`,
      );
    }
    if (file.size > this.limits.maxFileBytes) {
      throw new BadRequestException(
        `Image must be under ${this.limits.maxFileMb}MB`,
      );
    }
    return file;
  }

  async uploadCompanyAsset(opts: {
    companyId: string;
    folder: AssetFolder;
    buffer: Buffer;
    mimeType: string;
    originalName?: string;
    /** Required for member photos — nests under companies/{id}/members/{memberId}/ */
    entityId?: string;
  }): Promise<UploadedAsset> {
    const companyId = String(opts.companyId || '').trim();
    if (!companyId) {
      throw new BadRequestException('companyId is required for uploads');
    }

    const ext = this.extFromMime(opts.mimeType, opts.originalName);
    const key = this.buildKey({
      companyId,
      folder: opts.folder,
      entityId: opts.entityId,
      ext,
    });

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: opts.buffer,
          ContentType: opts.mimeType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (err: any) {
      this.logger.error(`S3 upload failed key=${key}: ${err?.message}`);
      throw new ServiceUnavailableException(
        `Image upload to S3 failed: ${err?.message || 'unknown error'}`,
      );
    }

    return {
      key,
      url: `${this.publicBase}/${key}`,
      driver: 's3',
    };
  }

  private buildKey(opts: {
    companyId: string;
    folder: AssetFolder;
    entityId?: string;
    ext: string;
  }): string {
    const file = `${randomUUID()}${opts.ext}`;
    const cid = opts.companyId;

    if (
      opts.folder === 'members' ||
      opts.folder === 'employees' ||
      opts.folder === 'payments'
    ) {
      const entityId = String(opts.entityId || '').trim();
      if (!entityId) {
        throw new BadRequestException(
          `entityId is required for ${opts.folder} uploads`,
        );
      }
      return `companies/${cid}/${opts.folder}/${entityId}/${file}`;
    }

    if (
      opts.folder === 'logos' ||
      opts.folder === 'favicons' ||
      opts.folder === 'stamps'
    ) {
      return `companies/${cid}/branding/${opts.folder}/${file}`;
    }

    return `companies/${cid}/misc/${file}`;
  }

  private extFromMime(mime: string, name?: string): string {
    const fromName = name
      ? name.includes('.')
        ? `.${name.split('.').pop()!.toLowerCase()}`
        : ''
      : '';
    if (fromName && fromName.length <= 5 && /^\.[a-z0-9]+$/.test(fromName)) {
      return fromName;
    }
    if (mime === 'image/png') return '.png';
    if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
    if (mime === 'image/webp') return '.webp';
    if (mime === 'image/svg+xml') return '.svg';
    return '.bin';
  }
}
