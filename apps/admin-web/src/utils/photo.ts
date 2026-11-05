/**
 * 协议单照片上传前在浏览器里压一下：长边最多 2000 像素、JPEG 质量 0.85，一般几百 KB。
 * 手机拍的原图常有五六 MB，服务端单张限 8MB；压过的也更快传完。
 * 浏览器认不出的格式（比如 iPhone 的 HEIC 在 Chrome 里）返回 null，页面提示换 JPG / PNG。
 */
export const PHOTO_MAX_SIDE = 2000;
export const PHOTO_QUALITY = 0.85;

/** 等比缩小到长边不超过 maxSide，本来就小的不放大。 */
export function fitSize(width: number, height: number, maxSide = PHOTO_MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) {
    return { width, height };
  }
  const scale = maxSide / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function loadImage(file: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

export async function compressPhoto(file: Blob): Promise<Blob | null> {
  const image = await loadImage(file);
  if (!image || !image.naturalWidth || !image.naturalHeight) {
    return null;
  }
  const size = fitSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  // PNG 透明底压成 JPEG 会变黑，先铺白。
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(image, 0, 0, size.width, size.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', PHOTO_QUALITY));
}
