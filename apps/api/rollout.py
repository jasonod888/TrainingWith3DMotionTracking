"""Temporary rollout flags.

These are deliberately few, environment-overridable, and each carries the condition
that lets us delete it. They gate *surfaces*, never stored data: switching a flag off
must not rewrite revisions, accepted releases, likes or jobs.
"""
import os
from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class RolloutFlag:
    name: str
    env: str
    default: bool
    summary: str
    remove_when: str


FLAGS: tuple[RolloutFlag, ...] = (
    RolloutFlag(
        'act_drawing_enabled', 'ACT_DRAWING_ENABLED', True,
        'Expose drawing authoring, discovery and public detail.',
        'Remove once drawing has completed one production release cycle and no client '
        'older than the drawing-compatible build remains in the support window.',
    ),
    RolloutFlag(
        'public_music_enabled', 'PUBLIC_MUSIC_ENABLED', True,
        'Expose music releases in public discovery/detail/assets.',
        'Remove once piano and guitar public playback and asset projection have passed '
        'browser acceptance and the Phase 5 compatibility window has closed.',
    ),
    RolloutFlag(
        'social_likes_enabled', 'SOCIAL_LIKES_ENABLED', True,
        'Accept like PUT/DELETE and return like state.',
        'Remove when the like table has been stable for one full migration cycle and no '
        'rollback to a like-less release is supported.',
    ),
    RolloutFlag(
        'social_recommendations_enabled', 'SOCIAL_RECOMMENDATIONS_ENABLED', True,
        'Serve deterministic recommendations.',
        'Remove once the deterministic policy has been accepted for two release cycles '
        'and the recommendation response is covered by the public API contract.',
    ),
)

_BY_NAME = {flag.name: flag for flag in FLAGS}


def _bool(raw: str | None, default: bool) -> bool:
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')


def enabled(name: str) -> bool:
    flag = _BY_NAME[name]
    return _bool(os.environ.get(flag.env), flag.default)


def status() -> list[dict]:
    return [{'name': flag.name, 'enabled': enabled(flag.name), 'env': flag.env,
             'default': flag.default, 'summary': flag.summary,
             'remove_when': flag.remove_when} for flag in FLAGS]


def values() -> dict[str, bool]:
    return {flag.name: enabled(flag.name) for flag in FLAGS}


def require(name: str, detail: str = 'This feature is not enabled on this deployment.'):
    if not enabled(name):
        raise HTTPException(404, detail)
