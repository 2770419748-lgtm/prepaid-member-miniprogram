// 用内存模拟 wx 的本地存储和跳转。要在被测模块之前 import。
export const storage = new Map<string, unknown>();
export const relaunched: string[] = [];
export const fake = { pages: [] as { route: string }[] };

Object.assign(globalThis, {
  wx: {
    getStorageSync: (key: string) => (storage.has(key) ? storage.get(key) : ''),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    reLaunch: ({ url }: { url: string }) => relaunched.push(url),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  },
  getCurrentPages: () => fake.pages,
});
