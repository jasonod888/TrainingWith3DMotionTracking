"""Act-neutral publication: publishability, allowed roles and public projection.

Publication is deliberate. A public release names the exact representation roles
it exposes; anything not named stays private. The raw source video, transcript
analysis, internal reports and original media are never part of a public response.

Role map:
  poster             an approved image (currently music public_poster)
  playable_preview   an approved video/audio derivative (never source media)
  instructor_media   reserved; not publicly allowed in Phase 5
  reference          the reviewed interactive reference (notation), when allowed
  interactive_data   the 3D GLB + landmarks
"""
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select

from . import acts
from .database import LessonAcceptance

RoleName = Literal['poster', 'playable_preview', 'instructor_media', 'reference', 'interactive_data']
Audience = Literal['invited', 'link', 'group', 'public']

ROLE_ORDER: tuple[RoleName, ...] = (
    'poster', 'playable_preview', 'instructor_media', 'reference', 'interactive_data')

# At least one of these must be present for a public page to be usable.
PLAYABLE_ROLES = frozenset({'playable_preview', 'interactive_data', 'reference'})

ROLE_FIELDS: dict[str, tuple[str, ...]] = {
    'poster': ('public_poster', 'poster'),
    'playable_preview': ('preview_video', 'focused_video'),
    'instructor_media': (),
    'reference': ('reference',),
    'interactive_data': ('animation', 'landmarks'),
}

REPRESENTATION_FOR_ROLE = {
    'interactive_data': 'interactive_3d',
    'playable_preview': 'video',
    'reference': 'interactive_notation',
    'poster': 'poster',
}


class PublishabilityResult(BaseModel):
    lesson_id: str
    revision_id: str | None
    audience: Audience
    publishable: bool
    roles: list[str] = Field(default_factory=list)
    allowed_roles: list[str] = Field(default_factory=list)
    representations: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)


def role_assets(manifest: dict | None, roles) -> dict[str, dict]:
    """Assets that satisfy each requested role, in role order."""
    manifest = manifest or {}
    found: dict[str, dict] = {}
    for role in ROLE_ORDER:
        if role not in roles:
            continue
        assets = {}
        for field in ROLE_FIELDS[role]:
            asset = manifest.get(field)
            if asset:
                assets[field] = asset
        if role == 'interactive_data' and 'animation' not in assets:
            continue
        if role == 'instructor_media':
            continue  # reserved; not an approved public representation yet
        if not assets and role == 'reference' and manifest.get('steps'):
            # Drawing's reviewed reference is its ordered step document, inline.
            assets = {'steps': list(manifest['steps'])}
        if assets:
            found[role] = assets
    return found


def default_roles(policy: acts.PublicationPolicy, manifest: dict | None) -> list[str]:
    """Legacy-compatible default only where the Act already had one."""
    if not policy.default_roles:
        return []
    return [role for role in policy.default_roles if role in role_assets(manifest, [role])]


def effective_roles(publication, manifest: dict | None) -> list[str]:
    """Stored roles win; legacy body listings default to interactive data."""
    roles = getattr(publication, 'roles', None) if publication is not None else None
    if roles:
        return [role for role in roles if role in ROLE_ORDER]
    # Only pre-Phase-5 body 3D listings have no stored roles.
    return ['interactive_data'] if (manifest or {}).get('animation') else []


def _resolve_roles(policy: acts.PublicationPolicy, manifest: dict | None,
                   requested: list[str] | None, existing: list[str] | None) -> tuple[list[str], list[str], list[str]]:
    """Return (valid_roles, missing_codes, reasons)."""
    if requested is None:
        requested = existing if existing else default_roles(policy, manifest)
    requested = list(dict.fromkeys(requested))
    allowed = set(policy.allowed_roles)
    missing: list[str] = []
    reasons: list[str] = []
    valid: list[str] = []
    for role in requested:
        if role not in ROLE_ORDER:
            missing.append(f'unknown_role:{role}')
            reasons.append(f'"{role}" is not a public representation.')
            continue
        if role not in allowed:
            missing.append(f'role_not_allowed:{role}')
            reasons.append(f'{role.replace("_", " ")} is not approved for this Act.')
            continue
        if role not in role_assets(manifest, [role]):
            missing.append(f'missing_asset:{role}')
            reasons.append(f'This lesson has no prepared {role.replace("_", " ")} yet.')
            continue
        valid.append(role)
    if not valid:
        missing.append('missing_public_representation')
        reasons.append('Choose an approved public representation before publishing.')
    elif not (set(valid) & PLAYABLE_ROLES):
        missing.append('missing_playable_representation')
        reasons.append('A public lesson needs more than a poster; add a playable or interactive representation.')
    return valid, missing, reasons


def descriptor_for(lesson, revision):
    act_id = getattr(lesson, 'act_id', None) or getattr(revision, 'act_id', None)
    subject = getattr(revision, 'subject', None) or getattr(lesson, 'subject', None)
    return acts.resolve_act(act_id, subject)


def publishability(session, lesson, revision, audience: Audience,
                   requested_roles: list[str] | None = None,
                   rights_acknowledged: bool = False,
                   existing_roles: list[str] | None = None) -> PublishabilityResult:
    """One answer for every Act and audience. Stricter metadata checks stay in the route."""
    missing: list[str] = []
    reasons: list[str] = []
    allowed_roles: list[str] = []
    roles: list[str] = []
    try:
        descriptor = descriptor_for(lesson, revision)
        policy = acts.publication_policy(descriptor.id)
    except acts.ActError as exc:
        return PublishabilityResult(
            lesson_id=lesson.id, revision_id=getattr(revision, 'id', None), audience=audience,
            publishable=False, missing=['unsupported_act'], reasons=[str(exc)],
            allowed_roles=[], roles=[], representations=[])

    allowed_roles = [role for role in policy.allowed_roles if role in ROLE_ORDER]
    accepted = bool(revision and session.scalar(select(LessonAcceptance).where(
        LessonAcceptance.lesson_id == lesson.id,
        LessonAcceptance.revision_id == revision.id)))
    if not accepted:
        missing.append('revision_not_accepted')
        reasons.append('Check this revision before publishing it.')
    if audience == 'public' and not policy.public:
        missing.append('audience_not_allowed')
        reasons.append('This Act cannot be published publicly yet.')

    roles, role_missing, role_reasons = _resolve_roles(
        policy, revision.manifest if revision else None, requested_roles, existing_roles)
    missing.extend(role_missing)
    reasons.extend(role_reasons)

    if audience == 'public' and not rights_acknowledged:
        missing.append('rights_not_acknowledged')
        reasons.append('Confirm you have the right to share this lesson publicly.')

    publishable = accepted and not missing
    return PublishabilityResult(
        lesson_id=lesson.id,
        revision_id=getattr(revision, 'id', None),
        audience=audience,
        publishable=publishable,
        roles=roles if publishable or roles else [],
        allowed_roles=allowed_roles,
        representations=sorted({REPRESENTATION_FOR_ROLE[role] for role in roles}),
        missing=missing,
        reasons=reasons,
    )


def _public_key(asset: dict, lesson_id: str) -> dict:
    from pathlib import Path
    return {**asset, 'key': f"public/{lesson_id}/{Path(asset['key']).name}"}


def project_manifest(manifest: dict, lesson_id: str, roles, *, title: str,
                     creator: str, tags: list[str]) -> dict:
    """Public response with only the approved roles, and every private slot nulled."""
    roles = [role for role in roles if role in ROLE_ORDER]
    assets = role_assets(manifest, roles)
    value = dict(manifest)

    # Nothing private survives by accident; absent slots are explicitly null.
    for field in ('source_video', 'focused_video', 'thumbnail', 'piano_preview',
                  'preview_video', 'waveform', 'midi_export', 'analysis', 'public_poster',
                  'reference_guide', 'poster', 'steps'):
        value[field] = None
    value['animation'] = None
    value['landmarks'] = None
    value['reference'] = None
    # Avatar presentation derivatives are safe, but internal reports are not.
    value['presentation'] = {
        name: _public_key(asset, lesson_id)
        for name, asset in (manifest.get('presentation') or {}).items()
        if name in ('male', 'female')}

    representations: dict[str, dict] = {}
    for role, fields in assets.items():
        representations[role] = {
            field: (_public_key(asset, lesson_id)
                    if isinstance(asset, dict) and 'key' in asset else asset)
            for field, asset in fields.items()}

    if 'interactive_data' in assets:
        for field in ('animation', 'landmarks'):
            if field in assets['interactive_data']:
                value[field] = _public_key(assets['interactive_data'][field], lesson_id)
    if 'playable_preview' in assets:
        preview = next(iter(assets['playable_preview'].values()))
        value['playable_preview'] = _public_key(preview, lesson_id)
    if 'reference' in assets:
        fields = assets['reference']
        if 'reference' in fields:
            value['reference'] = _public_key(fields['reference'], lesson_id)
        elif 'steps' in fields:
            # Drawing reference: ordered steps stay inline, no fake media asset.
            value['steps'] = fields['steps']
    if 'poster' in assets:
        poster_asset = assets['poster'].get('public_poster') or assets['poster'].get('poster')
        if poster_asset:
            value['poster'] = _public_key(poster_asset, lesson_id)
            value['public_poster'] = _public_key(poster_asset, lesson_id)

    value['representations'] = representations
    value['public_roles'] = roles
    value['title'] = title
    value['public_tags'] = tags
    value['public_creator'] = creator
    return value


def allowed_asset_names(manifest: dict, roles) -> set[str]:
    """Basenames the public asset route may serve for this role map."""
    from pathlib import Path
    assets = role_assets(manifest, roles)
    names = {Path(asset['key']).name for fields in assets.values()
             for asset in fields.values() if isinstance(asset, dict) and 'key' in asset}
    # Presentation derivatives are safe and were already public before Phase 5.
    names.update(Path(asset['key']).name
                 for name, asset in (manifest.get('presentation') or {}).items()
                 if name in ('male', 'female'))
    return names
