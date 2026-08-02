import { Global, Module } from '@nestjs/common';
import { S3StorageService } from './storage.service';

@Global()
@Module({
  providers: [S3StorageService],
  exports: [S3StorageService],
})
export class StorageModule {}
