import { Prisma } from '@prisma/client';

export interface StoreView {
  id: string;
  orgId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  businessHours: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberStoreView {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  businessHours: string | null;
}

export interface StoreRecord {
  id: string;
  orgId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  address: string | null;
  lat: Prisma.Decimal | null;
  lng: Prisma.Decimal | null;
  contactPhone: string | null;
  businessHours: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function coord(value: Prisma.Decimal | null): number | null {
  return value == null ? null : value.toNumber();
}

export function toStoreView(store: StoreRecord): StoreView {
  return {
    id: store.id,
    orgId: store.orgId,
    name: store.name,
    status: store.status,
    address: store.address,
    lat: coord(store.lat),
    lng: coord(store.lng),
    phone: store.contactPhone,
    businessHours: store.businessHours,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}

export function toMemberStoreView(store: StoreRecord): MemberStoreView {
  return {
    id: store.id,
    name: store.name,
    address: store.address,
    lat: coord(store.lat),
    lng: coord(store.lng),
    phone: store.contactPhone,
    businessHours: store.businessHours,
  };
}
