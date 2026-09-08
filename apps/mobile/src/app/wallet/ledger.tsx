import { colors, radii, spacing } from "@katha/tokens";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, EmptyState, ErrorState, Loading, Screen, SkeletonRows, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import type { LedgerRow } from "@/lib/types";
import { useAuth } from "@/providers/auth";

const PAGE = 50;

/**
 * Shared with web through the `ledger.*` keys.
 *
 * These were a private English map, so the same transaction was called "Top up" on the phone and "Purchase" on
 * the site: a viewer's own history renamed itself between their devices, and neither name was translated.
 */
const KIND_KEY: Record<LedgerRow["kind"], string> = {
  signup_bonus: "ledger.signup_bonus",
  purchase: "ledger.purchase",
  unlock: "ledger.unlock",
  ad_unlock: "ledger.ad_unlock",
  checkin: "ledger.checkin",
  task: "ledger.task",
  referral: "ledger.referral",
  admin_adjust: "ledger.admin_adjust",
  refund: "ledger.refund",
};

export default function LedgerScreen() {
  const t = useT();
  const router = useRouter();
  const { status, requireAuth } = useAuth();
  const ledger = useQuery(async () => unwrap(await api.GET("/v1/wallet/ledger", { params: { query: { limit: PAGE } } })), [], { enabled: status === "signed_in" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  /**
   * Earned or spent.
   *
   * A wallet history is opened for one of two questions — "where did my coins go" or "did that top-up land" —
   * and an undifferentiated list answers neither without scrolling. Filtered client-side over what is loaded,
   * which is what the website does too; the page size is fifty and paging keeps its own order.
   */
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");


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

  const rows = (ledger.data ?? []).filter((r) => (filter === "all" ? true : filter === "in" ? r.delta > 0 : r.delta < 0));

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
        <SkeletonRows count={8} />
      ) : status === "guest" ? (
        <EmptyState title={t("wallet.signin_history")} action={<Button title={t("common.sign_in")} onPress={() => requireAuth()} />} />
      ) : ledger.loading ? (
        <SkeletonRows count={8} />
      ) : ledger.error && !ledger.data ? (
        <ErrorState message={ledger.error} onRetry={() => ledger.refetch({ silent: false })} retryLabel={t("common.retry")} />
      ) : (ledger.data?.length ?? 0) === 0 ? (
        <EmptyState title={t("ledger.empty")} body={t("ledger.empty_hint")} />
      ) : (
        <FlashList
          data={rows}
          ListHeaderComponent={
            <View style={styles.filters}>
              {(["all", "in", "out"] as const).map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setFilter(key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === key }}
                  style={[styles.filter, filter === key && styles.filterOn]}
                >
                  <Text variant="caption" color={filter === key ? colors.ink : colors.muted}>
                    {t(`ledger.filter_${key}` as "ledger.filter_all")}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
          ListEmptyComponent={<EmptyState title={t("ledger.empty_filter")} />}
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
  const t = useT();
  const positive = row.delta > 0;
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label">{t(KIND_KEY[row.kind] ?? row.kind)}</Text>
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
        <Text variant="caption">{t("wallet.balance_after", { n: row.balance_after })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  list: { paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  filters: { flexDirection: "row", gap: spacing.xs, paddingBottom: spacing.md },
  filter: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface },
  filterOn: { backgroundColor: colors.surface2 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: spacing.lg },
});
