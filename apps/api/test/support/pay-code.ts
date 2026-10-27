import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PayCodeService } from '../../src/pay-code/pay-code.service';

/**
 * 测试里走一遍「会员出示会员码 → 店员扫码」，返回扫到的码，扣款时带上。
 * 会员取码直接调服务，省去每位会员都要登录。同一位会员要一次准备好几张码时请依次调用：
 * 取新码会作废这位会员还没被扫的旧码。
 */
export async function scanPayCode(
  app: INestApplication,
  orgId: string,
  staffToken: string,
  memberId: string,
  storeId: string,
): Promise<string> {
  const issued = await app
    .get(PayCodeService)
    .issue({ sub: memberId, orgId, principalType: 'MEMBER', roles: [] });
  const response = await request(app.getHttpServer())
    .post('/pay-codes/scan')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ code: issued.code, storeId });
  if (response.status !== 200) {
    throw new Error(`扫码失败：${response.status} ${JSON.stringify(response.body)}`);
  }
  return issued.code;
}
