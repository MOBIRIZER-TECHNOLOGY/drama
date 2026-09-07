"""Remote config for clients: toggles, economy, packs, flags and the user's experiment variants."""

import hashlib
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.ops import Experiment, ExperimentAssignment, FeatureFlag, Language, Setting
from app.services import push

DEFAULT_NAMESPACES: dict[str, dict] = {
    "auth": {
        "email": True,
        "google": True,
        "apple": True,
        "phone": True,
        "facebook": False,
    },
    "economy": {
        "coins_enabled": True,
        "currency": "INR",
        "currency_symbol": "₹",
    },
    "rewards": {"enabled": True},
    "referral": {"enabled": True},
    "mobile": {
        "min_version_code": 1,
        "force_update": False,
        "update_url": None,
        "privacy_policy_url": None,
        "terms_url": None,
        "rate_us_url": None,
    },
    "site": {"name": "Katha", "url": None},
    "payments": {"stripe": True, "razorpay": True},
}


async def namespace(session: AsyncSession, name: str) -> dict:
    row = await session.get(Setting, name)
    data = dict(DEFAULT_NAMESPACES.get(name, {}))
    if row is not None:
        data.update(row.data)
    return data


async def _referral(session: AsyncSession) -> dict:
    """Referral economics, resolved once so the API and the clients cannot disagree about the numbers."""
    s = get_settings()
    data = await namespace(session, "referral")
    data.setdefault("referrer_coins", s.default_referral_reward_coins)
    data.setdefault("referee_coins", s.default_referee_reward_coins)
    return data


async def referral_reward_coins(session: AsyncSession) -> int:
    """Coins the referrer earns when the person they invited first pays."""
    return int((await _referral(session)).get("referrer_coins") or 0)


async def referee_reward_coins(session: AsyncSession) -> int:
    """Coins credited to a new account that arrived through someone's invite link."""
    return int((await _referral(session)).get("referee_coins") or 0)


def _bucket(user_id: uuid.UUID, experiment_key: str) -> int:
    digest = hashlib.sha256(f"{experiment_key}:{user_id}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100


async def variant_map(session: AsyncSession, user_id: uuid.UUID | None) -> dict[str, str]:
    """Sticky assignment: reuse stored rows, otherwise hash the user into the allocation and store it."""
    if user_id is None:
        return {}
    now = datetime.now(UTC)
    experiments = list(
        (
            await session.scalars(
                select(Experiment).where(
                    Experiment.started_at.is_not(None),
                    Experiment.started_at <= now,
                    (Experiment.ended_at.is_(None)) | (Experiment.ended_at > now),
                )
            )
        ).all()
    )
    if not experiments:
        return {}
    assigned = {
        a.experiment_key: a.variant
        for a in (
            await session.scalars(select(ExperimentAssignment).where(ExperimentAssignment.user_id == user_id))
        ).all()
    }
    result: dict[str, str] = {}
    for exp in experiments:
        if exp.key in assigned:
            result[exp.key] = assigned[exp.key]
            continue
        bucket = _bucket(user_id, exp.key)
        cursor = 0
        chosen = next(iter(exp.allocation))
        for variant, pct in exp.allocation.items():
            cursor += int(pct)
            if bucket < cursor:
                chosen = variant
                break
        session.add(ExperimentAssignment(user_id=user_id, experiment_key=exp.key, variant=chosen, assigned_at=now))
        result[exp.key] = chosen
    return result


async def build(session: AsyncSession, *, user_id: uuid.UUID | None, platform: str) -> dict:
    s = get_settings()
    flags = {f.key: f.enabled for f in (await session.scalars(select(FeatureFlag))).all()}
    languages = [
        {"code": lang.code, "name": lang.name, "native_name": lang.native_name, "rtl": lang.is_rtl}
        for lang in (
            await session.scalars(select(Language).where(Language.is_active.is_(True)).order_by(Language.sort_order))
        ).all()
    ]
    economy = await namespace(session, "economy")
    economy.setdefault("episode_price", s.default_episode_price)
    economy.setdefault("free_episodes", s.default_free_episodes)
    economy.setdefault("ad_unlocks_per_day", s.default_ad_unlocks_per_day)
    economy.setdefault("bundle_discount_pct", s.default_bundle_discount_pct)
    rewards = await namespace(session, "rewards")
    rewards.setdefault("daily_rewards", s.default_daily_rewards)
    rewards.setdefault("signup_bonus", s.default_signup_bonus)
    referral = await _referral(session)
    site = await namespace(session, "site")
    site["captcha_site_key"] = s.turnstile_site_key
    pay = await namespace(session, "payments")
    gateways = [
        g
        for g, configured in (
            ("razorpay", bool(s.razorpay_key_id and s.razorpay_key_secret)),
            ("stripe", bool(s.stripe_secret_key)),
        )
        if configured and pay.get(g, True)
    ]
    firebase = {
        "api_key": s.firebase_web_api_key,
        "auth_domain": s.firebase_web_auth_domain,
        "project_id": s.firebase_project_id,
        "app_id": s.firebase_web_app_id,
        "messaging_sender_id": s.firebase_web_messaging_sender_id,
    }
    return {
        "platform": platform,
        "site": site,
        "payments": {"gateways": gateways},
        "firebase": firebase if firebase["api_key"] else None,
        "auth": await namespace(session, "auth"),
        "economy": economy,
        "rewards": rewards,
        "referral": referral,
        "notifications": {"channels": list(push.CHANNELS)},
        "mobile": await namespace(session, "mobile"),
        "languages": languages,
        "flags": flags,
        "variants": await variant_map(session, user_id),
    }
