"""Shared policy parity fixtures: one resolver for detail, discovery and editor."""
import json
from pathlib import Path

from apps.api import acts, policy

FIXTURES = json.loads((Path(__file__).resolve().parents[2] / 'packages/lesson-schema/policy-parity-fixtures.json')
                      .read_text(encoding='utf-8'))


class SettingsStub:
    music_challenge_enabled = True


def test_policy_fixtures_match_shared_actions_and_capabilities():
    for scenario in FIXTURES['scenarios']:
        descriptor = acts.descriptor_for(scenario['descriptor'])
        actions = policy.action_set(descriptor, scenario['manifest'],
                                    roles=scenario['roles'], public=scenario['public'])
        assert actions == scenario['expected_actions'], scenario['id']
        caps = policy.capabilities(descriptor, scenario['manifest'], owner=True,
                                   settings=SettingsStub(), roles=scenario['roles'],
                                   public=scenario['public'])
        for name, expected in scenario['expected'].items():
            assert caps[name].available is expected, (scenario['id'], name)


def test_unknown_act_and_version_never_fall_back_to_full_body():
    try:
        acts.descriptor_for('violin')
    except acts.ActError as exc:
        assert 'violin' in str(exc)
    else:
        raise AssertionError('unknown Act was accepted')
    try:
        acts.require_version(999)
    except acts.ActError as exc:
        assert '999' in str(exc)
    else:
        raise AssertionError('unknown descriptor version was accepted')
