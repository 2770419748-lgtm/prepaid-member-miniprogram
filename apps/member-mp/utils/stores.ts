import type { StoreView } from './api';
import { distanceMeters, formatDistance, Point } from './geo';

export interface StoreCard {
  id: string;
  name: string;
  address: string;
  hours: string;
  /** 只有会员同意定位、门店也有坐标时才有，否则为空，不编距离。 */
  distanceText: string;
  canNavigate: boolean;
  canCall: boolean;
}

interface Measured {
  store: StoreView;
  meters: number | null;
}

/**
 * 门店卡片。没有位置时保持接口顺序；有位置时近的在前，没坐标的门店排最后。
 */
export function toStoreCards(stores: StoreView[], here: Point | null): StoreCard[] {
  const measured: Measured[] = stores.map((store) => ({
    store,
    meters:
      here && store.lat != null && store.lng != null
        ? distanceMeters(here, { latitude: store.lat, longitude: store.lng })
        : null,
  }));
  if (here) {
    measured.sort((a, b) => {
      if (a.meters == null && b.meters == null) return 0;
      if (a.meters == null) return 1;
      if (b.meters == null) return -1;
      return a.meters - b.meters;
    });
  }
  return measured.map(({ store, meters }) => ({
    id: store.id,
    name: store.name,
    address: store.address ?? '',
    hours: store.businessHours ?? '',
    distanceText: meters == null ? '' : formatDistance(meters),
    canNavigate: store.lat != null && store.lng != null,
    canCall: Boolean(store.phone),
  }));
}
