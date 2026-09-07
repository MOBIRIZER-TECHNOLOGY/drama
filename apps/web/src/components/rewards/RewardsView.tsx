"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { clientApi } from "@/lib/client-api";
import { call, type ApiError } from "@/lib/errors";
import { useLoader } from "@/lib/use-loader";
import { useToast } from "@/lib/toast";
import type { CheckinStatus, TaskOut } from "@/lib/types";
import { PageTitle, RequireAuth } from "../RequireAuth";
import { Button } from "../ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../ui/states";
import { IconCheck, IconCoin, IconExternal, IconGift } from "../ui/icons";

export function RewardsView() {
  return (
    <RequireAuth>
      <RewardsInner />
    </RequireAuth>
  );
}

function RewardsInner() {
  const t = useT();
  const toast = useToast();
  const { config } = useApp();
  const { setBalance } = useAuth();
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [tasks, setTasks] = useState<TaskOut[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [claiming, setClaiming] = useState(false);
  const rewardedAds = config?.flags?.rewarded_ads === true;

  const load = useCallback(async () => {
    const [c, tk] = await Promise.all([call(() => clientApi.GET("/v1/rewards/checkin")), call(() => clientApi.GET("/v1/rewards/tasks"))]);
    if (c.error) return setError(c.error);
    if (tk.error) return setError(tk.error);
    setError(null);
    setCheckin(c.data);
    setTasks(tk.data);
  }, []);

  useLoader(load);

  const claimCheckin = async () => {
    setClaiming(true);
    const { data, error } = await call(() => clientApi.POST("/v1/rewards/checkin"));
    setClaiming(false);
    if (error) return toast(error.message, "error");
    setBalance(data.coin_balance);
    setCheckin((c) => (c ? { ...c, checked_in_today: true, streak_day: data.streak_day, coin_balance: data.coin_balance } : c));
    toast(t("rewards.checkin_claimed", "+{n} coins — day {d} streak!", { n: data.coins, d: data.streak_day }), "gold");
  };

  const visibleTasks = tasks?.filter((task) => task.kind !== "rewarded_ad" || rewardedAds) ?? null;

  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div>
      <PageTitle sub={t("rewards.subtitle", "Free coins every day for showing up.")}>{t("rewards.title", "Rewards")}</PageTitle>

      {/* Check-in strip */}
      <section aria-labelledby="checkin-heading" className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="checkin-heading" className="font-display text-lg font-semibold text-ink">
              {t("rewards.checkin", "Daily check-in")}
            </h2>
            {checkin && (
              <p className="text-sm text-muted">
                {checkin.checked_in_today
                  ? t("rewards.checked_in", "Checked in today. Come back tomorrow for day {d}.", { d: Math.min(checkin.streak_day + 1, 7) })
                  : t("rewards.streak", "Day {d} of 7", { d: checkin.next_streak_day })}
              </p>
            )}
          </div>
          {checkin ? (
            <Button variant="gold" onClick={claimCheckin} loading={claiming} disabled={checkin.checked_in_today}>
              {checkin.checked_in_today ? (
                <>
                  <IconCheck size={16} />
                  {t("rewards.claimed", "Claimed")}
                </>
              ) : (
                <>
                  <IconCoin size={16} />
                  {t("rewards.claim", "Claim")}
                </>
              )}
            </Button>
          ) : (
            <Skeleton className="h-10 w-24 rounded-pill" />
          )}
        </div>
        <ol className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-3" aria-label={t("rewards.week", "Streak")}>
          {(checkin?.rewards ?? Array.from({ length: 7 }).map(() => 0)).slice(0, 7).map((coins, i) => {
            const day = i + 1;
            const done = checkin ? day <= checkin.streak_day && (checkin.checked_in_today || day < checkin.next_streak_day) : false;
            const isNext = checkin ? !checkin.checked_in_today && day === checkin.next_streak_day : false;
            return (
              <li
                key={day}
                aria-current={isNext ? "step" : undefined}
                className={`flex flex-col items-center gap-1 rounded-md border py-2 text-center text-xs sm:py-3 ${
                  isNext ? "border-gold bg-gold/10 text-ink" : done ? "border-success/40 bg-success/10 text-ink2" : "border-line bg-ground text-muted"
                }`}
              >
                <span className="uppercase tracking-wide">{t("rewards.day", "Day")} {day}</span>
                {checkin ? (
                  done ? (
                    <IconCheck size={18} className="text-success" />
                  ) : (
                    <span className={`inline-flex items-center gap-0.5 font-display text-base font-semibold ${isNext ? "text-gold" : ""}`}>
                      <IconCoin size={14} className="text-gold" />
                      {coins}
                    </span>
                  )
                ) : (
                  <Skeleton className="h-5 w-8" />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Tasks */}
      <section aria-labelledby="tasks-heading" className="mt-8">
        <h2 id="tasks-heading" className="font-display text-lg font-semibold text-ink">
          {t("rewards.tasks", "Tasks")}
        </h2>
        {!visibleTasks ? (
          <div className="mt-3 flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : visibleTasks.length === 0 ? (
          <EmptyState className="mt-3" icon={<IconGift size={32} />} title={t("rewards.no_tasks", "No tasks right now")} message={t("rewards.no_tasks_hint", "New ways to earn coins appear here.")} />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {visibleTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onClaimed={(coins, balance) => {
                  setBalance(balance);
                  setTasks((list) => list?.map((x) => (x.id === task.id ? { ...x, claimed: true } : x)) ?? null);
                  toast(t("rewards.task_claimed", "+{n} coins", { n: coins }), "gold");
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TaskRow({ task, onClaimed }: { task: TaskOut; onClaimed: (coins: number, balance: number) => void }) {
  const t = useT();
  const toast = useToast();
  const [phase, setPhase] = useState<"idle" | "timer" | "ready" | "claiming">(task.timer_seconds > 0 && task.url ? "idle" : "ready");
  const [left, setLeft] = useState(task.timer_seconds);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const start = () => {
    if (task.url) window.open(task.url, "_blank", "noopener,noreferrer");
    if (task.timer_seconds <= 0) {
      setPhase("ready");
      return;
    }
    setPhase("timer");
    setLeft(task.timer_seconds);
    const endAt = Date.now() + task.timer_seconds * 1000;
    timer.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining <= 0) {
        if (timer.current) clearInterval(timer.current);
        setPhase("ready");
      }
    }, 250);
  };

  const claim = async () => {
    setPhase("claiming");
    const { data, error } = await call(() =>
      clientApi.POST("/v1/rewards/tasks/{task_id}/claim", { params: { path: { task_id: task.id } }, body: {} }),
    );
    if (error) {
      setPhase("ready");
      toast(error.message, "error");
      return;
    }
    onClaimed(data.coins, data.coin_balance);
  };

  return (
    <li className={`flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4 ${task.claimed ? "opacity-60" : ""}`}>
      <span className="rounded-pill bg-surface2 p-2 text-gold">
        <IconGift size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{task.title}</p>
        {task.description && <p className="text-sm text-muted">{task.description}</p>}
        <p className="mt-0.5 text-xs text-muted">
          {task.frequency === "daily" ? t("rewards.daily", "Daily") : t("rewards.once", "One time")}
          {task.timer_seconds > 0 && task.url ? ` · ${t("rewards.timer_hint", "Stay for {s}s", { s: task.timer_seconds })}` : ""}
        </p>
      </div>
      <span className="inline-flex items-center gap-1 font-display text-lg font-semibold text-gold">
        <IconCoin size={18} />+{task.coins}
      </span>
      {task.claimed ? (
        <span className="inline-flex items-center gap-1 text-sm text-success">
          <IconCheck size={16} />
          {t("rewards.claimed", "Claimed")}
        </span>
      ) : phase === "idle" ? (
        <Button size="sm" variant="secondary" onClick={start}>
          <IconExternal size={14} />
          {t("rewards.open", "Open")}
        </Button>
      ) : phase === "timer" ? (
        <Button size="sm" variant="secondary" disabled>
          {left}s
        </Button>
      ) : (
        <Button size="sm" variant="gold" onClick={claim} loading={phase === "claiming"}>
          {t("rewards.claim", "Claim")}
        </Button>
      )}
    </li>
  );
}
