import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Loading } from "@/components/ui";

/**
 * Target of the `katha://purchase` success/cancel URLs. The auth session that opened Stripe closes on this
 * deep link, and on Android the OS also routes the link here. `dismissTo` pops back to the wallet that started
 * the purchase when it is on the stack (so we never end up with two wallets), and pushes it on a cold start.
 */
export default function PurchaseReturnScreen() {
  const router = useRouter();
  const { purchase_id } = useLocalSearchParams<{ purchase_id?: string }>();

  useEffect(() => {
    router.dismissTo({ pathname: "/wallet", params: purchase_id ? { purchase_id } : {} });
  }, [router, purchase_id]);

  return <Loading />;
}
