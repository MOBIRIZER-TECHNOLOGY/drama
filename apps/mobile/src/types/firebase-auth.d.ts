/**
 * `firebase/auth` resolves to `@firebase/auth/dist/rn` at runtime (Metro's `react-native` export condition),
 * but the `types` condition wins for TypeScript and omits the React Native persistence helper.
 */
import type { Persistence } from "firebase/auth";

declare module "firebase/auth" {
  export interface ReactNativeAsyncStorage {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
  }
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
