import { randomUUID } from 'crypto';

/**
 * 纸质协议单照片的规则。照片上有顾客姓名、电话、签字，属于个人信息：
 * 只放私有对象存储，只经接口（带登录）给会员本人、开单门店的员工和超管看。
 */

/** 一张照片最大 8MB。小程序选图时已压缩，一般几百 KB；商家后台上传前也会压缩。服务器入口（Caddy）限 10MB。 */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** 一份协议单最多留 9 张照片（小程序一次最多选 9 张）。 */
export const MAX_PHOTOS_PER_AGREEMENT = 9;

/** 传上来没交单的照片，过了这么久就不能再交（防止拿很早以前别人的照片凑数）。 */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export interface DetectedImage {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: 'jpg' | 'png' | 'webp';
}

/** 按文件头认图片类型，不信客户端报的文件名和类型。认不出返回 null（包括 HEIC、PDF、可执行文件）。 */
export function detectImage(bytes: Buffer): DetectedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', ext: 'jpg' };
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { contentType: 'image/png', ext: 'png' };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { contentType: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** 照片在对象存储里的位置。文件名随机，和库里的 id 无关，猜不出来。 */
export function agreementPhotoKey(orgId: string, ext: DetectedImage['ext']): string {
  return `agreements/${orgId}/${randomUUID().replace(/-/g, '')}.${ext}`;
}
