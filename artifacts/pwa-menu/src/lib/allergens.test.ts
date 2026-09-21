import { aggregateAllergens } from './allergens';
import assert from 'node:assert';

function runTests() {
  console.log('Running aggregateAllergens tests...');

  // Test 1: handles empty input gracefully
  {
    const result = aggregateAllergens(null, []);
    assert.deepStrictEqual(result.vsebuje, []);
    assert.deepStrictEqual(result.sledi, []);
    assert.strictEqual(result.potrjen, false);
    assert.deepStrictEqual(result.opozorila, []);
  }

  // Test 2: aggregates base allergens correctly
  {
    const base = {
      alergeni: [{ koda: 'A', naziv: 'Alergen A' }],
      alergeniSledi: [{ koda: 'B', naziv: 'Sled B' }],
      potrjen: true,
      opozorila: [],
    };
    const result = aggregateAllergens(base, []);
    assert.deepStrictEqual(result.vsebuje, [{ koda: 'A', naziv: 'Alergen A' }]);
    assert.deepStrictEqual(result.sledi, [{ koda: 'B', naziv: 'Sled B' }]);
    assert.strictEqual(result.potrjen, true);
  }

  // Test 3: vsebuje overrides sledi when same koda is present
  {
    const base = {
      alergeni: [{ koda: 'A', naziv: 'Alergen A' }],
      alergeniSledi: [{ koda: 'A', naziv: 'Alergen A' }, { koda: 'B', naziv: 'Sled B' }],
    };
    const modifiers = [
      { alergeni: [{ koda: 'B', naziv: 'Sled B' }] }
    ];
    
    const result = aggregateAllergens(base, modifiers);
    
    // Both A and B are now in vsebuje, sledi should be empty
    assert.strictEqual(result.vsebuje.length, 2);
    assert.ok(result.vsebuje.find(a => a.koda === 'A'));
    assert.ok(result.vsebuje.find(a => a.koda === 'B'));
    assert.deepStrictEqual(result.sledi, []);
  }

  // Test 4: merges opozorila without duplicates
  {
    const base = { opozorila: ['Opozorilo 1', 'Opozorilo 2'] };
    const modifiers = [{ opozorila: ['Opozorilo 2', 'Opozorilo 3'] }];
    
    const result = aggregateAllergens(base, modifiers);
    const opozorilaSorted = [...result.opozorila].sort();
    assert.deepStrictEqual(opozorilaSorted, ['Opozorilo 1', 'Opozorilo 2', 'Opozorilo 3'].sort());
  }

  // Test 5: sets potrjen to false if any source is unconfirmed
  {
    const base = { potrjen: true };
    const modifiers = [{ potrjen: false }, { potrjen: true }];
    
    const result = aggregateAllergens(base, modifiers);
    assert.strictEqual(result.potrjen, false);
  }

  console.log('All tests passed!');
}

runTests();
