import { Module } from '@nestjs/common';
import { ReviewDemoController } from './review-demo.controller';
import { ReviewDemoService } from './review-demo.service';

@Module({
  controllers: [ReviewDemoController],
  providers: [ReviewDemoService],
})
export class ReviewDemoModule {}
