"""Phase-A0 rights preflight for datasets, checkpoints and renderer assets.

The manifest is the machine-readable projection of
``docs/piano-reconstruction-rights-register.md``. A use is permitted only when its
decision is ``approved``. A missing decision, ``unresolved``, ``prohibited`` and
``not_applicable`` all deny, so an omission cannot silently become permission.

A derived artifact inherits any ``prohibited`` or ``unresolved`` decision from every
ancestor it declares in ``derived_from``. ``not_applicable`` describes a node's own
role (a corpus is never hosted) and is not inherited, otherwise a calibration derived
from a corpus could never be hosted.

This module deliberately contains no policy editing path. Callers pass an intended use;
they cannot pass a decision.
"""
import argparse
import hashlib
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA = 'piano-rights-manifest-1'
SCHEMA_VERSION = 1
DEFAULT_MANIFEST_PATH = Path(__file__).resolve().parents[1] / 'docs' / 'piano-reconstruction-rights-manifest.json'

APPROVED = 'approved'
PROHIBITED = 'prohibited'
UNRESOLVED = 'unresolved'
NOT_APPLICABLE = 'not_applicable'
MISSING = 'missing'
DECISION_VALUES = (APPROVED, PROHIBITED, UNRESOLVED, NOT_APPLICABLE)
RESTRICTING_VALUES = (PROHIBITED, UNRESOLVED)
SEVERITY = {APPROVED: 0, NOT_APPLICABLE: 1, UNRESOLVED: 2, PROHIBITED: 3}


class RightsError(ValueError):
    """A rights question could not be answered from the manifest."""


class ManifestError(RightsError):
    """The manifest is structurally invalid."""


class RightsDenied(RightsError):
    """An intended use is not cleared.

    ``status`` is the aggregate decision, ``blockers`` enumerates the individual
    source/use decisions that deny it, and ``conditions`` carries the obligations that
    apply if it is later approved.
    """

    def __init__(self, message, *, source_ids, use, status, blockers, conditions=()):
        super().__init__(message)
        self.source_ids = tuple(source_ids)
        self.use = use
        self.status = status
        self.blockers = tuple(blockers)
        self.conditions = tuple(conditions)


@dataclass(frozen=True)
class Decision:
    """The resolved decision for one or more sources and a single intended use."""

    source_ids: tuple
    use: str
    status: str
    blockers: tuple = ()
    conditions: tuple = ()
    attributions: tuple = ()

    @property
    def approved(self):
        return self.status == APPROVED

    def __bool__(self):
        return self.approved


@dataclass(frozen=True)
class _Node:
    identifier: str
    decisions: dict
    derived_from: tuple = field(default_factory=tuple)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def load_manifest(path=None):
    """Load and validate a rights manifest. Raises ManifestError on any defect."""
    path = Path(path) if path is not None else DEFAULT_MANIFEST_PATH
    try:
        manifest = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError as error:
        raise ManifestError(f'rights manifest not found: {path}') from error
    except json.JSONDecodeError as error:
        raise ManifestError(f'rights manifest is not valid JSON: {error}') from error
    validate_manifest(manifest)
    return manifest


def manifest_sha256(manifest):
    return hashlib.sha256(canonical(manifest).encode('utf-8')).hexdigest()


def _index(manifest):
    return {source['id']: _Node(source['id'], dict(source.get('decisions') or {}),
                                tuple(source.get('derived_from') or ()))
            for source in manifest['sources']}


def validate_manifest(manifest):
    """Validate structure and return the use vocabulary. Idempotent and side-effect free."""
    if not isinstance(manifest, dict):
        raise ManifestError('manifest must be a JSON object')
    if manifest.get('schema') != SCHEMA:
        raise ManifestError(f'unsupported manifest schema: {manifest.get("schema")!r}')
    if manifest.get('schema_version') != SCHEMA_VERSION:
        raise ManifestError(f'unsupported manifest version: {manifest.get("schema_version")!r}')

    uses = manifest.get('uses')
    if not isinstance(uses, dict) or not uses:
        raise ManifestError('manifest must declare a non-empty "uses" vocabulary')
    for name, description in uses.items():
        if not isinstance(name, str) or not name:
            raise ManifestError(f'invalid use name: {name!r}')
        if not isinstance(description, str) or not description.strip():
            raise ManifestError(f'use {name!r} needs a description')

    sources = manifest.get('sources')
    if not isinstance(sources, list) or not sources:
        raise ManifestError('manifest must declare a non-empty "sources" list')

    seen = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ManifestError('each source must be a JSON object')
        identifier = source.get('id')
        if not isinstance(identifier, str) or not identifier.strip():
            raise ManifestError('each source needs a non-empty string "id"')
        if identifier in seen:
            raise ManifestError(f'duplicate source id: {identifier}')
        seen.add(identifier)
        if not isinstance(source.get('kind'), str) or not source['kind'].strip():
            raise ManifestError(f'source {identifier} needs a "kind"')

        decisions = source.get('decisions')
        if not isinstance(decisions, dict) or not decisions:
            raise ManifestError(f'source {identifier} needs "decisions"')
        for use, value in decisions.items():
            if use not in uses:
                raise ManifestError(f'source {identifier} decides undeclared use {use!r}')
            if value not in DECISION_VALUES:
                raise ManifestError(
                    f'source {identifier} use {use} has invalid decision {value!r}')
        missing = sorted(set(uses) - set(decisions))
        if missing:
            raise ManifestError(
                f'source {identifier} is missing explicit decisions for {missing}')

        if source.get('license') is None:
            notes = list(source.get('conditions') or []) + list(source.get('notes') or [])
            if not notes:
                raise ManifestError(
                    f'source {identifier} has no license; record conditions or notes explaining the gap')
        if source.get('attribution_required') and not str(source.get('attribution') or '').strip():
            raise ManifestError(f'source {identifier} requires attribution but declares none')

        derived = source.get('derived_from') or []
        if not isinstance(derived, list) or not all(isinstance(item, str) for item in derived):
            raise ManifestError(f'source {identifier} has an invalid "derived_from" list')

    by_id = {source['id']: source for source in sources}
    for source in sources:
        for parent in source.get('derived_from') or []:
            if parent not in by_id:
                raise ManifestError(f'source {source["id"]} derives from unknown {parent!r}')
            if parent == source['id']:
                raise ManifestError(f'source {source["id"]} derives from itself')

    _assert_acyclic(by_id)
    return tuple(uses)


def _assert_acyclic(by_id):
    state = {}

    def visit(identifier, trail):
        status = state.get(identifier)
        if status == 'done':
            return
        if status == 'active':
            cycle = ' -> '.join(trail + [identifier])
            raise ManifestError(f'derived_from cycle: {cycle}')
        state[identifier] = 'active'
        for parent in by_id[identifier].get('derived_from') or []:
            visit(parent, trail + [identifier])
        state[identifier] = 'done'

    for identifier in by_id:
        visit(identifier, [])


def _ancestry(nodes, identifier):
    """Yield (identifier, decision) for the node and every ancestor, parents first."""
    visited = set()
    ordered = []

    def walk(current):
        if current in visited:
            return
        visited.add(current)
        for parent in nodes[current].derived_from:
            walk(parent)
        ordered.append(current)

    walk(identifier)
    return ordered


def decide(manifest, source_ids, use):
    """Resolve one intended use for one or more sources without raising."""
    uses = validate_manifest(manifest)
    if use not in uses:
        raise ManifestError(f'unknown intended use {use!r}; declared uses are {sorted(uses)}')

    identifiers = (source_ids,) if isinstance(source_ids, str) else tuple(source_ids)
    if not identifiers:
        raise ManifestError('at least one source id is required')

    nodes = _index(manifest)
    blockers = []
    conditions = []
    attributions = []
    statuses = []

    for identifier in identifiers:
        if identifier not in nodes:
            raise ManifestError(f'unknown source id {identifier!r}')
        node = nodes[identifier]
        own = node.decisions.get(use, MISSING)
        node_status = own if own != MISSING else UNRESOLVED
        if own != APPROVED:
            blockers.append(f'{identifier}:{use}={own}')

        restricting = []
        for ancestor in _ancestry(nodes, identifier):
            if ancestor == identifier:
                continue
            inherited = nodes[ancestor].decisions.get(use, MISSING)
            if inherited in RESTRICTING_VALUES or inherited == MISSING:
                restricting.append((ancestor, inherited if inherited != MISSING else MISSING))
        for ancestor, inherited in restricting:
            blockers.append(f'{ancestor}:{use}={inherited}')

        if any(inherited == PROHIBITED for _, inherited in restricting):
            node_status = PROHIBITED
        elif restricting:
            node_status = UNRESOLVED

        source = next(item for item in manifest['sources'] if item['id'] == identifier)
        conditions.extend(source.get('conditions') or [])
        attribution = str(source.get('attribution') or '').strip()
        if attribution:
            attributions.append(attribution)
        statuses.append(node_status)

    if all(status == APPROVED for status in statuses):
        status = APPROVED
    elif any(status == PROHIBITED for status in statuses):
        status = PROHIBITED
    elif any(status == UNRESOLVED for status in statuses):
        status = UNRESOLVED
    else:
        status = NOT_APPLICABLE
        blockers = list(blockers) + [f'{identifier}:{use}={NOT_APPLICABLE}'
                                     for identifier, status_value in zip(identifiers, statuses)
                                     if status_value == NOT_APPLICABLE]

    return Decision(source_ids=identifiers, use=use, status=status,
                    blockers=tuple(dict.fromkeys(blockers)),
                    conditions=tuple(dict.fromkeys(conditions)),
                    attributions=tuple(attributions))


def require(manifest, source_ids, use):
    """Return the Decision, or raise RightsDenied when the use is not cleared."""
    decision = decide(manifest, source_ids, use)
    if not decision.approved:
        detail = '; '.join(decision.blockers) or decision.status
        raise RightsDenied(
            f'intended use {use!r} is not cleared for {", ".join(decision.source_ids)}: {detail}',
            source_ids=decision.source_ids, use=use, status=decision.status,
            blockers=decision.blockers, conditions=decision.conditions)
    return decision


def approved_sources(manifest, use):
    """Every source id whose own decision for ``use`` is approved."""
    validate_manifest(manifest)
    return tuple(source['id'] for source in manifest['sources']
                 if source['decisions'].get(use) == APPROVED)


def unresolved_pairs(manifest):
    """Every (source id, use, status) that is not approved, for reporting."""
    validate_manifest(manifest)
    pairs = []
    for source in manifest['sources']:
        for use, value in source['decisions'].items():
            if value != APPROVED:
                pairs.append((source['id'], use, value))
    return tuple(pairs)


def clearance_record(manifest, source_ids, use):
    """Provenance entry to embed beside a derived artifact or profile.

    Raises when the use is not cleared, so a record cannot document an unapproved use.
    """
    decision = require(manifest, source_ids, use)
    return {
        'source_ids': list(decision.source_ids),
        'use': decision.use,
        'status': decision.status,
        'manifest_sha256': manifest_sha256(manifest),
        'attributions': list(decision.attributions),
        'conditions': list(decision.conditions),
    }


def report(manifest):
    uses = validate_manifest(manifest)
    return {
        'schema': 'piano-rights-report-1',
        'manifest_sha256': manifest_sha256(manifest),
        'reviewed_on': manifest.get('reviewed_on'),
        'uses': list(uses),
        'sources': {source['id']: {'kind': source['kind'],
                                   'license': source.get('license'),
                                   'decisions': dict(source['decisions'])}
                    for source in manifest['sources']},
        'unresolved': [{'source': identifier, 'use': use, 'decision': value}
                       for identifier, use, value in unresolved_pairs(manifest)],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Phase-A0 rights preflight for piano reconstruction inputs.')
    parser.add_argument('--manifest', type=Path, default=DEFAULT_MANIFEST_PATH)
    parser.add_argument('--check', nargs='+', metavar='SOURCE',
                        help='source ids whose intended use must be cleared')
    parser.add_argument('--use', help='intended use, for example internal_evaluation')
    parser.add_argument('--report', action='store_true', help='print the whole matrix as JSON')
    parser.add_argument('--unresolved', action='store_true', help='list non-approved decisions')
    arguments = parser.parse_args(argv)

    manifest = load_manifest(arguments.manifest)
    if arguments.report:
        print(json.dumps(report(manifest), indent=2, sort_keys=True))
        return 0
    if arguments.unresolved:
        print(json.dumps([{'source': identifier, 'use': use, 'decision': value}
                          for identifier, use, value in unresolved_pairs(manifest)],
                         indent=2))
        return 0
    if not arguments.check or not arguments.use:
        parser.error('--check requires --use (or use --report / --unresolved)')
    try:
        decision = require(manifest, arguments.check, arguments.use)
    except RightsDenied as error:
        print(f'DENIED {error.status}: {error}', file=sys.stderr)
        for condition in error.conditions:
            print(f'  condition: {condition}', file=sys.stderr)
        return 1
    print(json.dumps({'source_ids': list(decision.source_ids), 'use': decision.use,
                      'status': decision.status,
                      'attributions': list(decision.attributions)},
                     indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
