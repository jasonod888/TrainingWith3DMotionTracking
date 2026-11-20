import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildLessonContext} from '../src/app/lesson-context';
import {actSupportFor, implementationFor} from '../src/acts/registry';
import type {LessonDocument} from '../../../packages/lesson-schema/index';

const fixtures = JSON.parse(readFileSync(new URL(
  '../../../packages/lesson-schema/policy-parity-fixtures.json', import.meta.url), 'utf8'));

function documentFor(scenario: typeof fixtures.scenarios[number]): LessonDocument {
  const manifest = {...scenario.manifest, lesson_id: scenario.id, revision_id: `${scenario.id}-rev`,
    title: scenario.id, duration: 1, section_set: {id: 's', revision: 1, duration: 1,
      sections: [{id: 'whole', label: 'Whole', start: 0, end: 1}]}};
  if (scenario.descriptor === 'piano' || scenario.descriptor === 'guitar') {
    return {kind: 'music', value: {...manifest, subject: scenario.descriptor,
      instrument: {instrument: scenario.descriptor}} as never};
  }
  if (scenario.descriptor === 'drawing') {
    return {kind: 'drawing', value: {...manifest, schema_version: 3,
      experience_family: 'visual', subject: 'drawing', medium: 'pencil',
      assessment: 'none', warnings: [], steps: [{id: 's1', title: 'Step', instruction: 'Draw.'}]} as never};
  }
  return {kind: 'body', value: manifest as never};
}

test('server policy fixtures match the client capability ceiling', () => {
  for (const scenario of fixtures.scenarios) {
    const context = buildLessonContext({
      document: documentFor(scenario), audience: scenario.public ? 'public' : 'owner',
      accountScope: 'acct', challengeEnabled: true,
    });
    assert.equal(context.capabilities.canPractice.available,
      scenario.expected_actions.practice, `${scenario.id} practice`);
    assert.equal(context.capabilities.canChallenge.available,
      scenario.expected_actions.challenge, `${scenario.id} challenge`);
    for (const name of ['canPractice', 'canChallenge', 'canAssess',
      ...(scenario.public ? [] : ['canPublishPublicly'])]) {
      assert.equal(context.capabilities[name].available, scenario.expected[name],
        `${scenario.id} ${name}`);
    }
  }
});

test('unknown Acts and versions fail explicitly rather than falling back', () => {
  assert.equal(actSupportFor('violin'), null);
  assert.equal(implementationFor('violin'), null);
  assert.throws(() => buildLessonContext({
    document: documentFor(fixtures.scenarios[0]), audience: 'owner',
    accountScope: 'acct', actId: 'violin',
  }));
});

test('generated descriptors are the shared catalogue artifact', () => {
  const source = readFileSync(new URL('../src/acts/registry.ts', import.meta.url), 'utf8');
  assert.match(source, /act-descriptors\.json/);
  assert.match(source, /serverActDescriptors\.acts/);
});
