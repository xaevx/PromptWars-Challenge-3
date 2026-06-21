const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

// ─── Load & sandbox the app script ───────────────────────────────────────────
const html = fs.readFileSync('index.html', 'utf8');

const scriptRegex = /<script>([\s\S]*?)<\/script>/;
const match = html.match(scriptRegex);
if (!match) throw new Error('Could not find <script> tag in index.html');

// Append export hooks to pull lexically-scoped vars out of the VM context
let scriptCode = match[1];
scriptCode += `
  globalThis._testState                       = state;
  globalThis._testFormatValue                 = formatValue;
  globalThis._testEscapeHTML                  = escapeHTML;
  globalThis._testCalculateCategoryEmissions  = calculateCategoryEmissions;
  globalThis._testGetUnitSuffix               = getUnitSuffix;
  globalThis._testGetSimpleWeightUnit         = getSimpleWeightUnit;
  globalThis._testDefaultActions              = defaultActions;
`;

const createMockElement = () => ({
  addEventListener: () => {},
  removeEventListener: () => {},
  setAttribute: () => {},
  removeAttribute: () => {},
  getAttribute: () => null,
  appendChild: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  style: {},
  classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
  dataset: {},
  value: '',
  textContent: '',
  innerHTML: ''
});

const sandbox = {
  window: { addEventListener: () => {} },
  document: {
    documentElement: { setAttribute: () => {}, getAttribute: () => {} },
    addEventListener: () => {},
    getElementById: () => createMockElement(),
    querySelectorAll: () => [createMockElement()],
    querySelector: () => createMockElement(),
    createElement: () => createMockElement(),
    createElementNS: () => createMockElement()
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout, setInterval, clearInterval,
  console: { log: () => {}, error: () => {}, warn: () => {} },
  Math, parseFloat, parseInt, isNaN, JSON
};

vm.createContext(sandbox);
vm.runInContext(scriptCode, sandbox);

const state                       = sandbox._testState;
const calculateCategoryEmissions  = sandbox._testCalculateCategoryEmissions;
const formatValue                 = sandbox._testFormatValue;
const escapeHTML                  = sandbox._testEscapeHTML;
const getUnitSuffix               = sandbox._testGetUnitSuffix;
const getSimpleWeightUnit         = sandbox._testGetSimpleWeightUnit;
const defaultActions              = sandbox._testDefaultActions;

// ─── Shared baseline inputs ───────────────────────────────────────────────────
const baseInputs = {
  carDist: 160, carType: 'hybrid', busDist: 30, trainDist: 60, activeDist: 20,
  rideShareTrips: 3, flightsShort: 2, flightsLong: 1,
  electricity: 280, renewableRatio: 15, acHours: 6, heatingFuel: 'gas', applianceEfficiency: 'standard',
  dietType: 'mixed', dairyFreq: 'medium', localFood: 'some', deliveryFreq: 4, foodWaste: 'medium',
  clothingNew: 3, clothingSecondHand: 20, electronicsYear: 2, onlineOrders: 6, fastFashion: true,
  wasteBags: 3, recyclingRate: 'partial', composting: false, singleUsePlastic: 'weekly'
};

// ─── Test 1: Baseline calculation returns correct structure ───────────────────
test('Emissions calculation returns all five category properties', (t) => {
  const result = calculateCategoryEmissions(baseInputs);
  ['transport', 'energy', 'food', 'shopping', 'waste', 'total'].forEach(key => {
    assert.ok(typeof result[key] === 'number', `${key} should be a number`);
    assert.ok(!isNaN(result[key]), `${key} should not be NaN`);
  });
  // total should equal sum of parts
  const sum = result.transport + result.energy + result.food + result.shopping + result.waste;
  assert.ok(Math.abs(result.total - sum) < 0.0001, 'total should equal sum of category values');
});

// ─── Test 2: Electric car has lower emissions than petrol ─────────────────────
test('Electric vehicle emits less than petrol vehicle', (t) => {
  const petrol   = calculateCategoryEmissions({ ...baseInputs, carType: 'petrol' });
  const electric = calculateCategoryEmissions({ ...baseInputs, carType: 'electric' });
  assert.ok(electric.transport < petrol.transport, 'EV should emit less than petrol');
});

// ─── Test 3: Vegan diet emits less than heavy-meat diet ──────────────────────
test('Vegan diet has lower food emissions than heavy-meat diet', (t) => {
  const heavyMeat = calculateCategoryEmissions({ ...baseInputs, dietType: 'heavy-meat', dairyFreq: 'high' });
  const vegan     = calculateCategoryEmissions({ ...baseInputs, dietType: 'vegan', dairyFreq: 'none' });
  assert.ok(vegan.food < heavyMeat.food, 'Vegan should emit less food CO2 than heavy-meat');
});

// ─── Test 4: Composting reduces waste emissions ───────────────────────────────
test('Composting reduces waste emissions compared to no composting', (t) => {
  const withComposting    = calculateCategoryEmissions({ ...baseInputs, composting: true });
  const withoutComposting = calculateCategoryEmissions({ ...baseInputs, composting: false });
  assert.ok(withComposting.waste < withoutComposting.waste, 'Composting should reduce waste emissions');
});

// ─── Test 5: Full recycling reduces waste vs none ────────────────────────────
test('Full recycling reduces waste more than no recycling', (t) => {
  const fullRecycle = calculateCategoryEmissions({ ...baseInputs, recyclingRate: 'full' });
  const noRecycle   = calculateCategoryEmissions({ ...baseInputs, recyclingRate: 'none' });
  assert.ok(fullRecycle.waste < noRecycle.waste, 'Full recycling should emit less waste');
});

// ─── Test 6: 100% renewable energy reduces electricity component ─────────────
test('100% renewable energy reduces energy emissions vs 0%', (t) => {
  const full100  = calculateCategoryEmissions({ ...baseInputs, renewableRatio: 100, heatingFuel: 'none' });
  const none0    = calculateCategoryEmissions({ ...baseInputs, renewableRatio: 0,   heatingFuel: 'none' });
  assert.ok(full100.energy < none0.energy, 'Full renewable should emit less energy CO2');
});

// ─── Test 7: Coefficients scaling check ──────────────────────────────────────
test('Car transport emissions scale linearly with emission factor', (t) => {
  const zeroDietInputs = { ...baseInputs, busDist:0, trainDist:0, rideShareTrips:0, flightsShort:0, flightsLong:0,
    electricity:0, renewableRatio:0, acHours:0, heatingFuel:'none', dietType:'vegan', dairyFreq:'none',
    localFood:'most', deliveryFreq:0, foodWaste:'none', clothingNew:0, clothingSecondHand:0,
    electronicsYear:0, onlineOrders:0, fastFashion:false, wasteBags:0, recyclingRate:'full',
    composting:true, singleUsePlastic:'rarely', carDist:100, carType:'petrol' };

  const savedFactor = state.factors.carPetrol;
  state.factors.carPetrol = 0.20;
  const r1 = calculateCategoryEmissions(zeroDietInputs);
  state.factors.carPetrol = 0.40;
  const r2 = calculateCategoryEmissions(zeroDietInputs);
  state.factors.carPetrol = savedFactor;
  assert.strictEqual(r2.transport, r1.transport * 2, 'Transport should scale proportionally with factor');
});

// ─── Test 8: Weekly timeframe (identity conversion) ──────────────────────────
test('Weekly formatValue is identity conversion', (t) => {
  const saved = state.timeframe;
  state.timeframe = 'weekly';
  state.units = 'metric';
  assert.strictEqual(formatValue(70), 70, 'Weekly metric should return unchanged value');
  state.timeframe = saved;
});

// ─── Test 9: Daily conversion divides by 7 ───────────────────────────────────
test('Daily formatValue divides weekly value by 7', (t) => {
  const saved = state.timeframe;
  const savedUnits = state.units;
  state.timeframe = 'daily';
  state.units = 'metric';
  assert.strictEqual(formatValue(70), 10, 'Daily should equal weekly / 7');
  state.timeframe = saved;
  state.units = savedUnits;
});

// ─── Test 10: Monthly conversion multiplies by 4.345 ─────────────────────────
test('Monthly formatValue multiplies by 4.345', (t) => {
  const saved = state.timeframe;
  const savedUnits = state.units;
  state.timeframe = 'monthly';
  state.units = 'metric';
  const expected = 70 * 4.345;
  assert.strictEqual(formatValue(70), expected, 'Monthly should multiply by 4.345');
  state.timeframe = saved;
  state.units = savedUnits;
});

// ─── Test 11: Imperial conversion multiplies by 2.20462 ──────────────────────
test('Imperial unit conversion multiplies by 2.20462', (t) => {
  const saved = state.timeframe;
  const savedUnits = state.units;
  state.timeframe = 'weekly';
  state.units = 'imperial';
  assert.strictEqual(formatValue(100), 100 * 2.20462, 'Imperial should multiply by 2.20462');
  state.timeframe = saved;
  state.units = savedUnits;
});

// ─── Test 12: getSimpleWeightUnit returns correct strings ────────────────────
test('getSimpleWeightUnit returns kg for metric and lbs for imperial', (t) => {
  const saved = state.units;
  state.units = 'metric';
  assert.strictEqual(getSimpleWeightUnit(), 'kg', 'Metric should return kg');
  state.units = 'imperial';
  assert.strictEqual(getSimpleWeightUnit(), 'lbs', 'Imperial should return lbs');
  state.units = saved;
});

// ─── Test 13: getUnitSuffix returns correct compound strings ─────────────────
test('getUnitSuffix returns correctly composed string for weekly metric', (t) => {
  const saved = state.timeframe;
  const savedUnits = state.units;
  state.timeframe = 'weekly';
  state.units = 'metric';
  assert.strictEqual(getUnitSuffix(), 'kg CO2e/wk', 'Weekly metric suffix should be kg CO2e/wk');
  state.timeframe = saved;
  state.units = savedUnits;
});

// ─── Test 14: XSS escaping handles all dangerous chars ───────────────────────
test('escapeHTML sanitizes all HTML special characters', (t) => {
  const unsafe  = '<script>alert("XSS\'s")</script> & "test"';
  const safe    = escapeHTML(unsafe);
  assert.ok(!safe.includes('<'), 'Should not contain raw <');
  assert.ok(!safe.includes('>'), 'Should not contain raw >');
  assert.ok(!safe.includes('"'), 'Should not contain raw "');
  assert.ok(!safe.includes("'"), "Should not contain raw '");
  assert.ok(!safe.includes('&alert'), 'Should not have unescaped & before alert');
  assert.strictEqual(escapeHTML(null),      '', 'Should handle null');
  assert.strictEqual(escapeHTML(undefined), '', 'Should handle undefined');
  assert.strictEqual(escapeHTML(''),        '', 'Should handle empty string');
  assert.strictEqual(escapeHTML('safe text'), 'safe text', 'Safe text should pass through unchanged');
});

// ─── Test 15: Default actions list is well-formed ────────────────────────────
test('Default actions list contains valid action objects', (t) => {
  assert.ok(Array.isArray(defaultActions), 'defaultActions should be an array');
  assert.ok(defaultActions.length > 0, 'defaultActions should not be empty');
  defaultActions.forEach((act, i) => {
    assert.ok(typeof act.id        === 'string' && act.id.length > 0,       `Action ${i} id must be non-empty string`);
    assert.ok(typeof act.title     === 'string' && act.title.length > 0,    `Action ${i} title must be non-empty string`);
    assert.ok(typeof act.category  === 'string',                             `Action ${i} category must be a string`);
    assert.ok(typeof act.savings   === 'number' && act.savings >= 0,        `Action ${i} savings must be non-negative number`);
    assert.ok(['easy','medium','hard'].includes(act.difficulty),             `Action ${i} difficulty must be easy/medium/hard`);
    assert.ok(['free','low','medium','high'].includes(act.cost),             `Action ${i} cost must be free/low/medium/high`);
  });
});

// ─── Test 16: Waste is bounded to minimum 0.5 ────────────────────────────────
test('Waste emissions have a minimum floor of 0.5 kg/wk', (t) => {
  // Zero bags, full recycling, composting, rarely plastic → should hit floor
  const result = calculateCategoryEmissions({
    ...baseInputs,
    wasteBags: 0, recyclingRate: 'full', composting: true, singleUsePlastic: 'rarely'
  });
  assert.ok(result.waste >= 0.5, `Waste floor should be at least 0.5, got ${result.waste}`);
});

// ─── Test 17: Fast fashion penalty is additive ────────────────────────────────
test('Fast fashion flag adds to shopping emissions', (t) => {
  const withFF    = calculateCategoryEmissions({ ...baseInputs, fastFashion: true  });
  const withoutFF = calculateCategoryEmissions({ ...baseInputs, fastFashion: false });
  assert.ok(withFF.shopping > withoutFF.shopping, 'Fast fashion should increase shopping emissions');
});

// ─── Test 18: Total equals sum of all categories ─────────────────────────────
test('Total emissions are exactly the sum of all 5 categories', (t) => {
  const r   = calculateCategoryEmissions(baseInputs);
  const sum = r.transport + r.energy + r.food + r.shopping + r.waste;
  assert.ok(
    Math.abs(r.total - sum) < 0.00001,
    `Total (${r.total}) should equal sum of categories (${sum})`
  );
});
