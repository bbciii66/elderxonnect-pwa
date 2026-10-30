const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../weather-logic.js');

test('weather codes become plain words', () => {
  assert.equal(W.describe(0).words, 'Clear');
  assert.equal(W.describe(63).words, 'Rain');
  assert.equal(W.describe(81).words, 'Rain');
  assert.equal(W.describe(73).words, 'Snow');
  assert.equal(W.describe(95).words, 'Thunderstorms');
  assert.equal(W.describe(999).words, 'Weather');
});

test('Fahrenheit for US English, Celsius elsewhere', () => {
  assert.equal(W.usesFahrenheit('en-US'), true);
  assert.equal(W.usesFahrenheit('en-GB'), false);
  assert.equal(W.usesFahrenheit('fr-FR'), false);
});

test('location is rounded to about 1 km before it leaves the phone', () => {
  const url = new URL(W.forecastUrl(29.951066, -90.071532, true));
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '29.95');
  assert.equal(url.searchParams.get('longitude'), '-90.07');
  assert.equal(url.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(new URL(W.forecastUrl(1, 2, false)).searchParams.get('temperature_unit'), null);
});

test('city search is trimmed and capped', () => {
  const url = new URL(W.geocodeUrl('  New Orleans  '));
  assert.equal(url.hostname, 'geocoding-api.open-meteo.com');
  assert.equal(url.searchParams.get('name'), 'New Orleans');
  assert.equal(new URL(W.geocodeUrl('x'.repeat(500))).searchParams.get('name').length, 80);
  assert.equal(W.placeLabel({ name: 'Metairie', admin1: 'Louisiana', country: 'United States', country_code: 'US' }), 'Metairie, Louisiana');
  assert.equal(W.placeLabel({ name: 'Paris', admin1: 'Île-de-France', country: 'France', country_code: 'FR' }), 'Paris, Île-de-France, France');
});

const sample = (probs, code = 3) => ({
  current: { time: '2026-10-30T10:00', temperature_2m: 71.4, apparent_temperature: 78, weather_code: code },
  daily: { weather_code: [code], temperature_2m_max: [80.2], temperature_2m_min: [62.6], precipitation_probability_max: [Math.max(...probs)] },
  hourly: { time: probs.map((_, i) => `2026-10-30T${String(i).padStart(2, '0')}:00`), precipitation_probability: probs },
});

test('summary: temperatures, feels-like, and when rain is likely', () => {
  const probs = Array(24).fill(0); probs[15] = 70;
  const s = W.summary(sample(probs), 'F');
  assert.equal(s.temp, '71°'); assert.equal(s.high, '80°'); assert.equal(s.low, '63°');
  assert.equal(s.feels, 'Feels like 78°');
  assert.equal(s.advice, 'Rain likely this afternoon.');
});

test('summary: rain earlier in the day does not count; a dry day says so', () => {
  const probs = Array(24).fill(0); probs[6] = 90;
  assert.equal(W.rainLater(sample(probs), '2026-10-30T10:00'), '');
  const dry = W.summary(sample(Array(24).fill(5)), 'F');
  assert.equal(dry.advice, 'Dry today.');
});

test('summary: snow days say snow; missing data gives nothing', () => {
  const probs = Array(24).fill(0); probs[20] = 60;
  assert.equal(W.summary(sample(probs, 73), 'F').advice, 'Snow likely tonight.');
  assert.equal(W.summary({}, 'F'), null);
});
