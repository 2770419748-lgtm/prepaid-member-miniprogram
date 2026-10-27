import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditLogWriter } from './audit-log.writer';
import { AuditQueryService } from './audit-query.service';

/** 操作记录：各业务在自己的事务里经 AuditLogWriter 写入；这里另提供只读查询。 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditLogWriter, AuditQueryService],
  exports: [AuditLogWriter],
})
export class AuditModule {}
