import { colors, spacing } from "@katha/tokens";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, EmptyState, ErrorState, Loading, Screen, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import type { LedgerRow } from "@/lib/types";
import { useAuth } from "@/providers/auth";

const PAGE = 50;

const KIND_LABEL: Record<LedgerRow["kind"], string> = {
  signup_bonus: "Welcome bonus",
  purchase: "Top up",
  unlock: "Episode unlock",
  ad_unlock: "Ad unlock",
  checkin: "Daily check-in",
  task: "Task reward",
  referral: "Referral",
  admin_adjust: "Adjustment",
  refund: "Refund",
};

export default function LedgerScreen() {
  const t = useT();
  const router = useRouter();
  const { status, requireAuth } = useAuth();
  const ledger = useQuery(async () => unwrap(await api.GET("/v1/wallet/ledger", { params: { query: { limit: PAGE } } })), [], { enabled: status === "signed_in" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);


  const loadMore = useCallback(async () => {
    const rows = ledger.data;
    if (!rows || rows.length < PAGE || loadingMore || done) return;
    setLoadingMore(true);
    try {
      const more = unwrap(await api.GET("/v1/wallet/ledger", { params: { query: { limit: PAGE, before: rows[rows.length - 1].created_at } } }));
      if (more.length === 0) setDone(true);
      ledger.setData((prev) => [...(prev ?? []), ...more.filter((m) => !prev?.some((p) => p.id === m.id))]);
    } catch {
      // keep what we have; the user can pull to refresh
    } finally {
      setLoadingMore(false);
    }
  }, [ledger, loadingMore, done]);

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/wallet"))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
          <Icon name="back" size={30} />
        </Pressable>
        <Text variant="title">{t("wallet.ledger")}</Text>
        <View style={{ width: 30 }} />
      </View>
      {status === "loading" ? (
        <Loading />
      ) : status === "guest" ? (
        <EmptyState title="Sign in to see your history" action={<Button title={t("common.sign_in")} onPress={() => requireAuth()} />} />
      ) : ledger.loading ? (
        <Loading />
      ) : ledger.error && !ledger.data ? (
        <ErrorState message={ledger.error} onRetry={() => ledger.refetch({ silent: false })} retryLabel={t("common.retry")} />
      ) : (ledger.data?.length ?? 0) === 0 ? (
        <EmptyState title="No transactions yet" body="Coins you earn or spend will be listed here." />
      ) : (
        <FlashList
          data={ledger.data ?? []}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => <Row row={item} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={ledger.refreshing}
              onRefresh={() => {
                setDone(false);
                void ledger.refetch({ silent: true });
              }}
              tintColor={colors.accent}
            />
          }
          ListFooterComponent={loadingMore ? <Loading /> : null}
        />
      )}
    </Screen>
  );
}

function Row({ row }: { row: LedgerRow }) {
  const positive = row.delta > 0;
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label">{KIND_LABEL[row.kind] ?? row.kind}</Text>
        <Text variant="caption">
          {formatDate(row.created_at)}
          {row.note ? ` · ${row.note}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text variant="label" color={positive ? colors.success : colors.ink}>
          {positive ? "+" : ""}
          {row.delta}
        </Text>
        <Text variant="caption">Balance {row.balance_after}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  list: { paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: spacing.lg },
});
