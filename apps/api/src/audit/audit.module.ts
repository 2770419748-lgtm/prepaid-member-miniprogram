import { Global, Module } from '@nestjs/common';
import { AuditLogWriter } from './audit-log.writer';

/** 本里程碑只写入操作记录，不提供查询接口。 */
@Global()
@Module({
  providers: [AuditLogWriter],
  exports: [AuditLogWriter],
})
export class AuditModule {}
