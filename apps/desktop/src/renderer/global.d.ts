export {};

declare global {
  interface Window {
    branchy: {
      ping: () => Promise<{
        ok: boolean;
        appName: string;
        electron: string;
        node: string;
        platform: string;
      }>;
    };
  }
}
