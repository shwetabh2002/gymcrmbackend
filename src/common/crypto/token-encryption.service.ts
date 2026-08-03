import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM encryption for Razorpay tokens / API secrets at rest.
 * Key from PAYMENT_TOKEN_ENCRYPTION_KEY (32+ chars recommended).
 */
@Injectable()
export class TokenEncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const raw =
      this.config.get<string>('PAYMENT_TOKEN_ENCRYPTION_KEY') ||
      this.config.get<string>('JWT_ACCESS_SECRET') ||
      'dev-only-payment-token-key-change-me';
    this.key = createHash('sha256').update(raw).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ver, ivB64, tagB64, dataB64] = payload.split(':');
    if (ver !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Invalid encrypted payload');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
