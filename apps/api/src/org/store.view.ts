export interface StoreView {
  id: string;
  orgId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toStoreView(store: {
  id: string;
  orgId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StoreView {
  return {
    id: store.id,
    orgId: store.orgId,
    name: store.name,
    status: store.status,
    address: store.address,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}
