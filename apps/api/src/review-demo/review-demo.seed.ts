import { BenefitPlanStatus, ContractTemplateStatus, LedgerType, Prisma, StaffRole } from '@prisma/client';
import { toBenefitContentJson } from '../esign/esign.view';
import { REVIEW_DEMO_ORG_NAME, REVIEW_STAFF_PHONE } from './review-demo.constants';

type Tx = Prisma.TransactionClient;

interface DemoMove {
  type: 'RECHARGE' | 'CONSUME';
  amountCent: number;
  store: 0 | 1;
  daysAgo: number;
  remark: string;
  /** 消费对应的九讯云订单（演示单号）和商品应付金额，抵扣不超过 10%。 */
  order?: { no: string; productCent: number };
}

interface DemoMember {
  phone: string;
  name: string;
  moves: DemoMove[];
}

/** 演示会员。手机号是虚构的 139 0000 000x 和审核员自己的号，只存在于演示公司。 */
const DEMO_MEMBERS: DemoMember[] = [
  {
    // 审核员自己的会员卡：工作台点「切到我的会员卡」看到的就是这张。
    phone: REVIEW_STAFF_PHONE,
    name: '审核体验员',
    moves: [
      { type: 'RECHARGE', amountCent: 50000, store: 0, daysAgo: 6, remark: '演示数据：现金充值' },
      {
        type: 'CONSUME',
        amountCent: 3800,
        store: 0,
        daysAgo: 3,
        remark: '演示数据：买耳机抵扣',
        order: { no: 'A1001', productCent: 39900 },
      },
      {
        type: 'CONSUME',
        amountCent: 12900,
        store: 1,
        daysAgo: 1,
        remark: '演示数据：买平板抵扣',
        order: { no: 'A1002', productCent: 129900 },
      },
    ],
  },
  {
    phone: '13900000001',
    name: '王女士（演示）',
    moves: [
      { type: 'RECHARGE', amountCent: 100000, store: 0, daysAgo: 5, remark: '演示数据：转账充值' },
      {
        type: 'CONSUME',
        amountCent: 26800,
        store: 0,
        daysAgo: 2,
        remark: '演示数据：买手机抵扣',
        order: { no: 'A1003', productCent: 299900 },
      },
    ],
  },
  {
    phone: '13900000002',
    name: '李先生（演示）',
    moves: [
      { type: 'RECHARGE', amountCent: 30000, store: 1, daysAgo: 4, remark: '演示数据：现金充值' },
      {
        type: 'CONSUME',
        amountCent: 4500,
        store: 1,
        daysAgo: 1,
        remark: '演示数据：买手表抵扣',
        order: { no: 'A1004', productCent: 49900 },
      },
    ],
  },
  {
    phone: '13900000003',
    name: '张女士（演示）',
    moves: [{ type: 'RECHARGE', amountCent: 20000, store: 1, daysAgo: 2, remark: '演示数据：现金充值' }],
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 建演示公司：两家门店、审核员（两店店长）、四位有余额和流水的会员、一份权益方案和模板。
 * 只在第一次打开审核入口时建，之后一直复用（流水只追加，删不掉，也不需要删）。
 * 演示公司里不能发起真实签署，见 SignFlowsService.create。
 */
export async function createReviewDemoOrg(tx: Tx, realOrgId: string, now: Date): Promise<string> {
  const org = await tx.org.create({
    data: { name: REVIEW_DEMO_ORG_NAME, status: 'ACTIVE', demoOfId: realOrgId },
  });
  const stores = [
    await tx.store.create({
      data: {
        orgId: org.id,
        name: '演示一店',
        address: '四川省成都市锦江区演示路 1 号（演示地址）',
        businessHours: '10:00-21:00',
      },
    }),
    await tx.store.create({
      data: {
        orgId: org.id,
        name: '演示二店',
        address: '四川省成都市武侯区演示路 2 号（演示地址）',
        businessHours: '10:00-21:00',
      },
    }),
  ];
  const staff = await tx.staff.create({
    data: {
      orgId: org.id,
      phone: REVIEW_STAFF_PHONE,
      name: '审核体验员',
      status: 'ACTIVE',
      passwordHash: null,
      mustChangePassword: false,
    },
  });
  for (const store of stores) {
    await tx.staffStoreRole.create({
      data: { staffId: staff.id, storeId: store.id, role: StaffRole.STORE_MANAGER },
    });
  }

  for (const demo of DEMO_MEMBERS) {
    const member = await tx.member.create({
      data: { orgId: org.id, phone: demo.phone, name: demo.name, openStoreId: stores[demo.moves[0].store].id },
    });
    const wallet = await tx.wallet.create({ data: { memberId: member.id, balanceCent: 0, version: 0 } });
    let balance = 0;
    for (const move of demo.moves) {
      const before = balance;
      balance = move.type === 'RECHARGE' ? balance + move.amountCent : balance - move.amountCent;
      const entry = await tx.ledgerEntry.create({
        data: {
          orgId: org.id,
          memberId: member.id,
          walletId: wallet.id,
          storeId: stores[move.store].id,
          operatorStaffId: staff.id,
          type: move.type === 'RECHARGE' ? LedgerType.RECHARGE : LedgerType.CONSUME,
          amountCent: move.amountCent,
          balanceBefore: before,
          balanceAfter: balance,
          remark: move.remark,
          ...(move.order
            ? { orderNo: move.order.no, productAmountCent: move.order.productCent, orderNoTyped: false }
            : {}),
          createdAt: new Date(now.getTime() - move.daysAgo * DAY_MS),
        },
      });
      if (move.order) {
        // 和正式扣款一样占住这张单：审核员拿同一个单号再抵会被拦下。
        await tx.orderRedemption.create({ data: { orgId: org.id, orderNo: move.order.no, consumeEntryId: entry.id } });
      }
    }
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceCent: balance, version: demo.moves.length },
    });
  }

  const plan = await tx.benefitPlan.create({
    data: {
      orgId: org.id,
      title: '演示会员权益',
      status: BenefitPlanStatus.ACTIVE,
      contentJson: toBenefitContentJson({
        summary: '演示用的会员权益，内容为虚构。',
        items: [
          { title: '储值余额全部门店通用', detail: '在任一门店都可以用余额消费' },
          { title: '贴膜免工时费', detail: '演示条目' },
        ],
        rules: '演示数据，不产生真实合同。',
      }),
    },
  });
  await tx.contractTemplate.create({
    data: {
      orgId: org.id,
      benefitPlanId: plan.id,
      // 不对应任何真实的 e签宝 模板；演示公司里发起签署会被直接拒绝。
      esignTemplateId: 'review-demo-template',
      name: '演示会员权益单',
      status: ContractTemplateStatus.ACTIVE,
    },
  });
  return org.id;
}
