import assert from 'node:assert/strict';
import {test} from 'node:test';
import {selectRows, selectionSearch} from './selection.ts';
const ids=[1n,2n,3n,4n,5n];
test('ordinary selection replaces, additive selection toggles without mutating',()=>{
 const original=new Set([2n,3n]);
 assert.deepEqual([...selectRows(ids,original,5n,2n,false,false)],[5n]);
 assert.deepEqual([...selectRows(ids,original,2n,2n,false,true)],[3n]);
 assert.deepEqual([...original],[2n,3n]);
});
test('shift selects inclusive range in either direction',()=>{
 assert.deepEqual([...selectRows(ids,new Set(),4n,2n,true,false)],[2n,3n,4n]);
 assert.deepEqual([...selectRows(ids,new Set([5n]),2n,4n,true,true)],[5n,2n,3n,4n]);
});
test('stale anchors fall back to single selection',()=>{
 assert.deepEqual([...selectRows(ids,new Set([5n]),2n,9n,true,false)],[2n]);
});
test('selection searches preserve exact ids and reject empty selection',()=>{
 assert.equal(selectionSearch([9007199254740993n,2n],false),'cid:9007199254740993,2');
 assert.equal(selectionSearch([1n],true),'nid:1');
 assert.throws(()=>selectionSearch([],true));
});
