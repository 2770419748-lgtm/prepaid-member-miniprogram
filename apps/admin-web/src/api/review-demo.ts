import { http } from './http';

export interface ReviewDemoStatus {
  enabled: boolean;
  /** 开着时是自动关闭的时间；关着时是上次的截止或关闭时间。 */
  until: string | null;
  account: string;
  days: number;
  demo: { stores: number; members: number } | null;
}

export interface ReviewDemoSecret extends ReviewDemoStatus {
  /** 只在打开、延长和换密码时返回这一次。 */
  password: string;
}

export async function getReviewDemo(): Promise<ReviewDemoStatus> {
  const { data } = await http.get<ReviewDemoStatus>('/review-demo');
  return data;
}

/** 打开 7 天（开着就从现在起再算 7 天），每次都换新密码。 */
export async function openReviewDemo(): Promise<ReviewDemoSecret> {
  const { data } = await http.post<ReviewDemoSecret>('/review-demo/open');
  return data;
}

export async function rotateReviewDemoPassword(): Promise<ReviewDemoSecret> {
  const { data } = await http.post<ReviewDemoSecret>('/review-demo/password');
  return data;
}

export async function closeReviewDemo(): Promise<ReviewDemoStatus> {
  const { data } = await http.post<ReviewDemoStatus>('/review-demo/close');
  return data;
}
