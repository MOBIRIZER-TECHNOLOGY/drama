import { colors, radii, spacing } from "@katha/tokens";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { SeriesCard } from "@/components/series-card";
import { Button, EmptyState, ErrorState, Loading, Screen, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { errorMessage, unwrap } from "@/lib/errors";
import { formatDate, formatTime } from "@/lib/format";
import type { HistoryItem, SeriesCard as SeriesCardModel } from "@/lib/types";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

type Tab = "favorites" | "history";

export default function MyListScreen() {
  const t = useT();
  const router = useRouter();
  const { lang } = useConfig();
  const { status, requireAuth } = useAuth();
  const signedIn = status === "signed_in";
  const [tab, setTab] = useState<Tab>("favorites");
  const [actionError, setActionError] = useState<string | null>(null);
  const list = useQuery(async () => unwrap(await api.GET("/v1/me/list", { params: { query: { lang } } })), [lang], { enabled: signedIn });

  const refetchList = list.refetch;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (signedIn) void refetchList({ silent: true });
    }, [signedIn, refetchList]),
  );

  const removeFavorite = useCallback(
    async (series: SeriesCardModel) => {
      list.setData((prev) => (prev ? { ...prev, favorites: prev.favorites.filter((s) => s.id !== series.id) } : prev));
      try {
        const out = unwrap(await api.POST("/v1/series/{series_id}/favorite", { params: { path: { series_id: series.id } } }));
        if (out.active) await list.refetch({ silent: true });
      } catch (e) {
        setActionError(errorMessage(e));
        await list.refetch({ silent: true });
      }
    },
    [list],
  );

  const removeHistory = useCallback(
    async (seriesId?: string) => {
      list.setData((prev) => (prev ? { ...prev, history: seriesId ? prev.history.filter((h) => h.series.id !== seriesId) : [] } : prev));
      try {
        unwrap(await api.DELETE("/v1/me/history", { params: { query: seriesId ? { series_id: seriesId } : {} } }));
      } catch (e) {
        setActionError(errorMessage(e));
        await list.refetch({ silent: true });
      }
    },
    [list],
  );

  if (!signedIn) {
    return (
      <Screen>
        <Header tab={tab} onTab={setTab} />
        <EmptyState
          title={t("me.guest_title")}
          body="Favourites and watch history are stored with your account."
          action={<Button title={t("common.sign_in")} onPress={() => requireAuth()} disabled={status === "loading"} />}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        tab={tab}
        onTab={setTab}
        right={
          tab === "history" && (list.data?.history.length ?? 0) > 0 ? (
            <Pressable onPress={() => removeHistory()} accessibilityRole="button" hitSlop={8}>
              <Text variant="caption" color={colors.accent}>
                {t("list.clear")}
              </Text>
            </Pressable>
          ) : null
        }
      />
      {actionError ? (
        <Text variant="caption" color={colors.danger} style={styles.error}>
          {actionError}
        </Text>
      ) : null}
      {list.loading ? (
        <Loading />
      ) : list.error && !list.data ? (
        <ErrorState message={list.error} onRetry={() => list.refetch({ silent: false })} retryLabel={t("common.retry")} />
      ) : tab === "favorites" ? (
        (list.data?.favorites.length ?? 0) === 0 ? (
          <EmptyState title={t("list.empty_favorites")} />
        ) : (
          <FlashList
            data={list.data?.favorites ?? []}
            numColumns={3}
            keyExtractor={(s) => s.id}
            renderItem={({ item }) => (
              <View style={styles.cell}>
                <SeriesCard series={item} width={104} />
                <Pressable onPress={() => removeFavorite(item)} accessibilityRole="button" accessibilityLabel={`Remove ${item.title}`} style={styles.remove} hitSlop={6}>
                  <Icon name="close" size={14} />
                </Pressable>
              </View>
            )}
            contentContainerStyle={styles.grid}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => list.refetch({ silent: true })} tintColor={colors.accent} />}
          />
        )
      ) : (list.data?.history.length ?? 0) === 0 ? (
        <EmptyState title={t("list.empty_history")} />
      ) : (
        <FlashList
          data={list.data?.history ?? []}
          keyExtractor={(h) => `${h.series.id}:${h.episode_id}`}
          renderItem={({ item }) => (
            <HistoryRow
              item={item}
              onPress={() => router.push({ pathname: "/player/[seriesId]", params: { seriesId: item.series.id, episode: String(item.episode_number) } })}
              onRemove={() => removeHistory(item.series.id)}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => list.refetch({ silent: true })} tintColor={colors.accent} />}
        />
      )}
    </Screen>
  );
}

function Header({ tab, onTab, right }: { tab: Tab; onTab: (t: Tab) => void; right?: React.ReactNode }) {
  const t = useT();
  return (
    <View style={styles.header}>
      <View style={styles.tabs}>
        {(["favorites", "history"] as const).map((k) => (
          <Pressable key={k} onPress={() => onTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[styles.tab, tab === k && styles.tabActive]}>
            <Text variant="label" color={tab === k ? colors.accentInk : colors.ink}>
              {k === "favorites" ? t("list.favorites") : t("list.history")}
            </Text>
          </Pressable>
        ))}
      </View>
      {right}
    </View>
  );
}

function HistoryRow({ item, onPress, onRemove }: { item: HistoryItem; onPress: () => void; onRemove: () => void }) {
  const progress = item.duration_sec ? Math.min(1, item.position_sec / item.duration_sec) : item.completed ? 1 : 0;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.historyRow, pressed && { opacity: 0.8 }]}>
      <Image source={item.series.cover_url} style={styles.thumb} contentFit="cover" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={1}>
          {item.series.title}
        </Text>
        <Text variant="caption">
          Episode {item.episode_number} · {item.completed ? "Completed" : `${formatTime(item.position_sec)} watched`}
        </Text>
        <Text variant="caption">{formatDate(item.updated_at)}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </View>
      <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel="Remove from history" hitSlop={8} style={styles.removeInline}>
        <Icon name="close" size={18} color={colors.muted} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tabs: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radii.pill, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  tab: { paddingHorizontal: spacing.lg, paddingVertical: 6, borderRadius: radii.pill },
  tabActive: { backgroundColor: colors.accent },
  error: { paddingHorizontal: spacing.lg },
  grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  cell: { padding: spacing.sm, alignItems: "center" },
  remove: { position: "absolute", top: spacing.md, right: spacing.md, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: spacing.xxl },
  historyRow: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: "center" },
  thumb: { width: 56, height: 84, borderRadius: radii.sm, backgroundColor: colors.surface2 },
  track: { height: 3, backgroundColor: colors.line, borderRadius: 2, marginTop: 4, overflow: "hidden" },
  fill: { height: 3, backgroundColor: colors.accent },
  removeInline: { padding: spacing.xs },
});
