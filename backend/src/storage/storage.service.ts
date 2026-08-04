import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3StorageService {
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const credentials = {
      accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
      secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
    };
    const base = {
      region: config.get<string>('S3_REGION') ?? 'us-east-1',
      credentials,
      forcePathStyle: true,
    };
    this.internalClient = new S3Client({
      ...base,
      endpoint: config.getOrThrow<string>('S3_ENDPOINT_INTERNAL'),
    });
    this.publicClient = new S3Client({
      ...base,
      endpoint: config.getOrThrow<string>('S3_ENDPOINT_PUBLIC'),
    });
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
  }

  createUploadUrl(objectKey: string, contentType: string) {
    const expiresIn = Number(this.config.get<string>('S3_UPLOAD_URL_TTL_SECONDS') ?? 600);
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
      }),
      { expiresIn },
    );
  }

  createDownloadUrl(objectKey: string, fileName: string) {
    const expiresIn = Number(this.config.get<string>('S3_DOWNLOAD_URL_TTL_SECONDS') ?? 300);
    const safeName = fileName.replace(/[^\p{L}\p{N}._ -]/gu, '_');
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      }),
      { expiresIn },
    );
  }

  head(objectKey: string) {
    return this.internalClient.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }

  delete(objectKey: string) {
    return this.internalClient.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }

  checkBucket() {
    return this.internalClient.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
