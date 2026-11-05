import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesClipIdentity} from '../src/clip-identity.ts';

test('music resume refuses wrong subjects, versions and missing metadata',()=>{
 const job={subject:'piano',instrument:'piano',preparation:{preparation_version:'music-clip-v1'}};
 const meta={subject:'piano',instrument:'piano',preparationVersion:'music-clip-v1'};
 assert.equal(matchesClipIdentity(meta,job),true);
 assert.equal(matchesClipIdentity(undefined,job),false);
 assert.equal(matchesClipIdentity({...meta,subject:'guitar'},job),false);
 assert.equal(matchesClipIdentity({...meta,preparationVersion:'music-clip-v0'},job),false);
 assert.equal(matchesClipIdentity({...meta,preparationVersion:null},job),false);
});

test('legacy movement resume stays compatible while refusing music cache entries',()=>{
 const job={subject:'dance',instrument:null,preparation:{}};
 assert.equal(matchesClipIdentity({},job),true);
 assert.equal(matchesClipIdentity(undefined,job),true);
 assert.equal(matchesClipIdentity({subject:'dance'},job),true);
 assert.equal(matchesClipIdentity({subject:'boxing'},job),false);
 assert.equal(matchesClipIdentity({subject:'piano',instrument:'piano'},job),false);
});
