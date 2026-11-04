/**
 * 正式环境第一次装好后建公司、第一家门店和超级管理员（只能跑一次）。
 * 由 deploy/prepaid.sh init-company 调用，参数走环境变量（避免中文在命令行里被转义）：
 *
 *   ORG_NAME     公司名称（以营业执照为准）
 *   STORE_NAME   第一家门店名称，其余门店登录商家后台再建
 *   ADMIN_PHONE  超级管理员手机号（网页后台用它登录；小程序里用它的微信手机号登录进工作台）
 *   ADMIN_NAME   超级管理员称呼
 *
 * 打印一次随机初始密码，第一次登录商家后台必须改掉。库里已经有公司时拒绝，不会覆盖任何数据。
 */
import { PrismaClient, StaffRole } from '@prisma/client';
import { randomInt } from 'crypto';
import { hashPassword } from '../auth/password';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function initialPassword(): string {
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

function required(name: string, max: number): string {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`缺少 ${name}`);
  }
  if (value.length > max) {
    throw new Error(`${name} 太长（最多 ${max} 个字）`);
  }
  return value;
}

async function main(): Promise<void> {
  const orgName = required('ORG_NAME', 60);
  const storeName = required('STORE_NAME', 40);
  const adminName = required('ADMIN_NAME', 20);
  const adminPhone = required('ADMIN_PHONE', 11).replace(/\s|-/g, '');
  if (!/^1[3-9]\d{9}$/.test(adminPhone)) {
    throw new Error('ADMIN_PHONE 要是 11 位大陆手机号');
  }

  const prisma = new PrismaClient();
  try {
    const password = initialPassword();
    const passwordHash = await hashPassword(password);
    const created = await prisma.$transaction(async (tx) => {
      // 演示公司（微信审核用）不算。
      const existing = await tx.org.count({ where: { demoOfId: null } });
      if (existing > 0) {
        throw new Error('库里已经有公司了，不能再初始化。要加门店或管理员，请登录商家后台操作');
      }
      const org = await tx.org.create({ data: { name: orgName, status: 'ACTIVE' } });
      const store = await tx.store.create({ data: { orgId: org.id, name: storeName, status: 'ACTIVE' } });
      const staff = await tx.staff.create({
        data: {
          orgId: org.id,
          phone: adminPhone,
          name: adminName,
          status: 'ACTIVE',
          passwordHash,
          mustChangePassword: true,
          storeRoles: { create: { storeId: store.id, role: StaffRole.SUPER_ADMIN } },
        },
      });
      await tx.auditLog.create({
        data: {
          orgId: org.id,
          actorStaffId: null,
          action: 'STAFF_CREATE',
          targetType: 'Staff',
          targetId: staff.id,
          payloadJson: { name: adminName, phone: adminPhone, storeId: store.id, role: 'SUPER_ADMIN', source: 'init-company' },
        },
      });
      return { org, store };
    });
    console.log('初始化完成');
    console.log(`  公司：${created.org.name}`);
    console.log(`  门店：${created.store.name}`);
    console.log(`  超级管理员：${adminName} ${adminPhone}`);
    console.log(`  初始密码：${password}`);
    console.log('请马上用这个手机号和初始密码登录商家后台，按提示改成自己的密码。初始密码只显示这一次。');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`初始化失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
