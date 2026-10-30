import {test} from 'node:test';
import assert from 'node:assert/strict';
import {phraseSections} from '../../packages/learning-engine/phrase-sections';
import {validateSections} from '../../packages/lesson-schema/index';
test('manual phrase suggestions cover entire lesson without tiny trailing section',()=>{const result=phraseSections(8.01,120);assert.equal(result.length,2);assert.equal(result[1].end,8.01);assert.equal(validateSections(result,8.01).length,2);assert.throws(()=>phraseSections(8,0));});
