import { colors, radii, spacing } from "@katha/tokens";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Card, EmptyState, ErrorState, Pill, Screen, Skeleton, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { errorMessage, unwrap } from "@/lib/errors";
import type { RewardTask } from "@/lib/types";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

export default function RewardsScreen() {
  const t = useT();
  const router = useRouter();
  const { config } = useConfig();
  const { status, requireAuth, setBalance } = useAuth();
  const signedIn = status === "signed_in";
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  const checkin = useQuery(async () => unwrap(await api.GET("/v1/rewards/checkin")), [], { enabled: signedIn });
  const tasks = useQuery(async () => unwrap(await api.GET("/v1/rewards/tasks")), [], { enabled: signedIn });


  const doCheckin = useCallback(async () => {
    setCheckingIn(true);
    setMessage(null);
    try {
      const out = unwrap(await api.POST("/v1/rewards/checkin"));
      setBalance(out.coin_balance);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setMessage({ tone: "success", text: `+${out.coins} coins for day ${out.streak_day}` });
      await checkin.refetch({ silent: true });
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setMessage({ tone: "error", text: errorMessage(e) });
    } finally {
      setCheckingIn(false);
    }
  }, [checkin, setBalance]);

  const claim = useCallback(
    async (task: RewardTask) => {
      setMessage(null);
      try {
        const out = unwrap(await api.POST("/v1/rewards/tasks/{task_id}/claim", { params: { path: { task_id: task.id } }, body: {} }));
        setBalance(out.coin_balance);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setMessage({ tone: "success", text: `+${out.coins} coins · ${task.title}` });
        tasks.setData((prev) => prev?.map((x) => (x.id === task.id ? { ...x, claimed: true } : x)) ?? prev);
      } catch (e) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setMessage({ tone: "error", text: errorMessage(e) });
      }
    },
    [setBalance, tasks],
  );

  const onRefresh = useCallback(() => {
    void checkin.refetch({ silent: true });
    void tasks.refetch({ silent: true });
  }, [checkin, tasks]);

  const rewardsDisabled = config.rewards.enabled === false;

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/me"))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
        <Icon name="back" size={30} />
      </Pressable>
      <Text variant="title">{t("rewards.title")}</Text>
      <View style={{ width: 30 }} />
    </View>
  );

  if (!signedIn) {
    return (
      <Screen>
        {header}
        <EmptyState
          title="Sign in to earn coins"
          body="Daily check-ins and tasks add coins to your account."
          action={<Button title={t("common.sign_in")} onPress={() => requireAuth()} disabled={status === "loading"} />}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={checkin.refreshing || tasks.refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {rewardsDisabled ? <EmptyState title="Rewards are paused" body="Check back later." /> : null}

        {message ? (
          <Text variant="body" color={message.tone === "success" ? colors.success : colors.danger} style={{ textAlign: "center" }}>
            {message.text}
          </Text>
        ) : null}

        <Card style={styles.checkinCard}>
          <View style={styles.cardHead}>
            <Text variant="heading">{t("rewards.checkin")}</Text>
            {checkin.data ? <Text variant="caption">Day {checkin.data.streak_day} streak</Text> : null}
          </View>
          {checkin.loading ? (
            <Skeleton height={64} />
          ) : checkin.error && !checkin.data ? (
            <ErrorState message={checkin.error} onRetry={() => checkin.refetch({ silent: false })} retryLabel={t("common.retry")} />
          ) : checkin.data ? (
            <>
              <View style={styles.strip}>
                {checkin.data.rewards.map((coins, i) => {
                  const day = i + 1;
                  const claimed = day <= checkin.data!.streak_day;
                  const isNext = !checkin.data!.checked_in_today && day === checkin.data!.next_streak_day;
                  return (
                    <View key={day} style={[styles.day, claimed && styles.dayClaimed, isNext && styles.dayNext]}>
                      <Text variant="caption" color={claimed ? colors.accentInk : colors.muted}>
                        D{day}
                      </Text>
                      <Icon name="coin" size={12} />
                      <Text variant="caption" color={claimed ? colors.accentInk : colors.ink}>
                        {coins}
                      </Text>
                      {claimed ? <Icon name="check" size={10} color={colors.accentInk} /> : null}
                    </View>
                  );
                })}
              </View>
              <Button
                title={checkin.data.checked_in_today ? "Checked in today" : t("rewards.claim")}
                onPress={doCheckin}
                loading={checkingIn}
                disabled={checkin.data.checked_in_today || rewardsDisabled}
              />
            </>
          ) : null}
        </Card>

        <Text variant="heading" style={styles.sectionTitle}>
          Tasks
        </Text>
        {tasks.loading ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton height={88} />
            <Skeleton height={88} />
          </View>
        ) : tasks.error && !tasks.data ? (
          <ErrorState message={tasks.error} onRetry={() => tasks.refetch({ silent: false })} retryLabel={t("common.retry")} />
        ) : (tasks.data?.length ?? 0) === 0 ? (
          <EmptyState title="No tasks right now" body="New ways to earn coins show up here." />
        ) : (
          tasks.data?.map((task) => <TaskCard key={task.id} task={task} onClaim={() => claim(task)} disabled={rewardsDisabled} />)
        )}
      </ScrollView>
    </Screen>
  );
}

function TaskCard({ task, onClaim, disabled }: { task: RewardTask; onClaim: () => Promise<void>; disabled: boolean }) {
  const t = useT();
  const [started, setStarted] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(task.timer_seconds);
  const [claiming, setClaiming] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = useCallback(() => {
    if (started === null) return;
    const left = Math.max(0, task.timer_seconds - Math.floor((Date.now() - started) / 1000));
    setRemaining(left);
    if (left === 0 && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, [started, task.timer_seconds]);

  // The countdown runs on a timer and re-syncs when the app returns to the foreground (link tasks leave the app).
  useEffect(() => {
    if (started === null) return;
    timer.current = setInterval(tick, 1000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") tick();
    });
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      sub.remove();
    };
  }, [started, tick]);

  const open = useCallback(async () => {
    if (task.url) {
      try {
        await Linking.openURL(task.url);
      } catch {
        // Unsupported URL; still allow the countdown so the user is not stuck.
      }
    }
    setRemaining(task.timer_seconds);
    setStarted(Date.now());
  }, [task.url, task.timer_seconds]);

  const doClaim = useCallback(async () => {
    setClaiming(true);
    try {
      await onClaim();
    } finally {
      setClaiming(false);
    }
  }, [onClaim]);

  const isAd = task.kind === "rewarded_ad";
  const needsTimer = task.timer_seconds > 0;
  const ready = !needsTimer || (started !== null && remaining === 0);

  return (
    <Card style={styles.task}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.taskHead}>
          <Text variant="label">{task.title}</Text>
          <Pill label={task.frequency === "daily" ? "Daily" : "Once"} />
        </View>
        {task.description ? <Text variant="caption">{task.description}</Text> : null}
        <View style={styles.taskCoins}>
          <Icon name="coin" size={12} />
          <Text variant="caption" color={colors.gold}>
            +{task.coins}
          </Text>
        </View>
      </View>
      {task.claimed ? (
        <Pill label={t("rewards.claimed")} tone="success" />
      ) : isAd ? (
        // Phase 2: rewarded ads need the ad SDK to produce an ad_event_id.
        <Button title="Soon" variant="ghost" small disabled />
      ) : ready ? (
        <Button title={t("rewards.claim")} small onPress={doClaim} loading={claiming} disabled={disabled} />
      ) : started === null ? (
        <Button title={task.kind === "link" || task.url ? "Open" : "Start"} variant="secondary" small onPress={open} disabled={disabled} />
      ) : (
        <View style={styles.countdown}>
          <Text variant="label">{remaining}s</Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  checkinCard: { gap: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  day: {
    width: 44,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface2,
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderColor: "transparent",
  },
  dayClaimed: { backgroundColor: colors.gold },
  dayNext: { borderColor: colors.accent },
  sectionTitle: { marginTop: spacing.sm },
  task: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  taskHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  taskCoins: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  countdown: { minWidth: 56, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.surface2 },
});
