import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createObjectStorage, ObjectStorage } from './object-storage';

@Global()
@Module({
  providers: [
    {
      provide: ObjectStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createObjectStorage(config),
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
