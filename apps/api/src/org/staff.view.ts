import type { StaffRole } from 'shared';

export interface StaffRoleView {
  storeId: string;
  role: StaffRole;
  storeName?: string;
}

export interface StaffView {
  id: string;
  orgId: string;
  phone: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  wxOpenId: string | null;
  roles: StaffRoleView[];
}

export function toStaffView(
  staff: {
    id: string;
    orgId: string;
    phone: string;
    name: string;
    status: 'ACTIVE' | 'DISABLED';
    wxOpenId: string | null;
  },
  roles: StaffRoleView[],
): StaffView {
  return {
    id: staff.id,
    orgId: staff.orgId,
    phone: staff.phone,
    name: staff.name,
    status: staff.status,
    wxOpenId: staff.wxOpenId,
    roles,
  };
}
