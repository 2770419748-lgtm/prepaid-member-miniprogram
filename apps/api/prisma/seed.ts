import { PrismaClient, StaffRole } from '@prisma/client';
import { hash } from 'bcryptjs';

/** 本地种子账号的初始密码。第一次登录网页后台必须修改。 */
const INITIAL_PASSWORD = 'Init12345';

const prisma = new PrismaClient();

const ORG_NAME = '示例组织';
const STORE_NAME = '示例门店';
const STAFF_PHONE = '13800000000';

async function main(): Promise<void> {
  const org =
    (await prisma.org.findFirst({ where: { name: ORG_NAME } })) ??
    (await prisma.org.create({
      data: { name: ORG_NAME, status: 'ACTIVE' },
    }));

  const store =
    (await prisma.store.findFirst({
      where: { orgId: org.id, name: STORE_NAME },
    })) ??
    (await prisma.store.create({
      data: {
        orgId: org.id,
        name: STORE_NAME,
        status: 'ACTIVE',
        address: '示例地址',
      },
    }));

  const staff =
    (await prisma.staff.findUnique({
      where: { orgId_phone: { orgId: org.id, phone: STAFF_PHONE } },
    })) ??
    (await prisma.staff.create({
      data: {
        orgId: org.id,
        phone: STAFF_PHONE,
        name: '超级管理员',
        status: 'ACTIVE',
        passwordHash: await hash(INITIAL_PASSWORD, 10),
        mustChangePassword: true,
      },
    }));
  if (!staff.passwordHash) {
    await prisma.staff.update({
      where: { id: staff.id },
      data: {
        passwordHash: await hash(INITIAL_PASSWORD, 10),
        mustChangePassword: true,
      },
    });
  }

  await prisma.staffStoreRole.upsert({
    where: { staffId_storeId: { staffId: staff.id, storeId: store.id } },
    update: { role: StaffRole.SUPER_ADMIN },
    create: {
      staffId: staff.id,
      storeId: store.id,
      role: StaffRole.SUPER_ADMIN,
    },
  });

  console.log(
    `seed ok org=${org.id} store=${store.id} staff=${staff.id} role=SUPER_ADMIN`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
