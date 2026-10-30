/* Turns an Open-Meteo forecast into plain words for the home screen. No screen or network code here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeatherLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // WMO weather codes used by Open-Meteo.
  function describe(code) {
    const c = Number(code);
    if (c === 0) return { icon: '☀️', words: 'Clear' };
    if (c === 1) return { icon: '🌤️', words: 'Mostly sunny' };
    if (c === 2) return { icon: '⛅', words: 'Partly cloudy' };
    if (c === 3) return { icon: '☁️', words: 'Cloudy' };
    if (c === 45 || c === 48) return { icon: '🌫️', words: 'Foggy' };
    if (c >= 51 && c <= 57) return { icon: '🌦️', words: 'Drizzle' };
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return { icon: '🌧️', words: 'Rain' };
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { icon: '🌨️', words: 'Snow' };
    if (c >= 95 && c <= 99) return { icon: '⛈️', words: 'Thunderstorms' };
    return { icon: '🌡️', words: 'Weather' };
  }

  function usesFahrenheit(locale) { return /^en-(US|LR|MM)$|^my-MM$/i.test(String(locale || '')); }

  // Coordinates are rounded to about 1 km before they leave the phone.
  function roundCoord(v) { return Math.round(Number(v) * 100) / 100; }

  function forecastUrl(lat, lon, fahrenheit) {
    const q = new URLSearchParams({
      latitude: String(roundCoord(lat)), longitude: String(roundCoord(lon)),
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
      hourly: 'precipitation_probability',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto', forecast_days: '2',
    });
    if (fahrenheit) { q.set('temperature_unit', 'fahrenheit'); q.set('wind_speed_unit', 'mph'); }
    return 'https://api.open-meteo.com/v1/forecast?' + q.toString();
  }
  function geocodeUrl(name) {
    const q = new URLSearchParams({ name: String(name || '').trim().slice(0, 80), count: '5', language: 'en', format: 'json' });
    return 'https://geocoding-api.open-meteo.com/v1/search?' + q.toString();
  }
  function placeLabel(result) {
    if (!result) return '';
    return [result.name, result.admin1, result.country_code === 'US' ? '' : result.country].filter(Boolean).join(', ');
  }

  // When is rain (or snow) likely later today? Looks at the hours left in the forecast's local day.
  function rainLater(data, nowHourIso) {
    const times = data && data.hourly && data.hourly.time || [];
    const probs = data && data.hourly && data.hourly.precipitation_probability || [];
    const today = String(nowHourIso || times[0] || '').slice(0, 10);
    const nowHour = String(nowHourIso || '').slice(0, 13);
    for (let i = 0; i < times.length; i++) {
      if (times[i].slice(0, 10) !== today || times[i].slice(0, 13) < nowHour) continue;
      if (probs[i] >= 50) {
        const h = Number(times[i].slice(11, 13));
        return h < 12 ? 'this morning' : h < 17 ? 'this afternoon' : 'tonight';
      }
    }
    return '';
  }

  function summary(data, unitLabel) {
    if (!data || !data.current || !data.daily) return null;
    const cur = data.current, d = data.daily;
    const now = describe(cur.weather_code);
    const t = (v) => (v == null || Number.isNaN(Number(v)) ? '–' : Math.round(Number(v)) + '°');
    const later = rainLater(data, cur.time);
    const wet = describe(d.weather_code && d.weather_code[0]).words;
    let advice = '';
    if (later) advice = (/Snow/.test(wet) ? 'Snow' : 'Rain') + ' likely ' + later + '.';
    else if (d.precipitation_probability_max && d.precipitation_probability_max[0] < 20) advice = 'Dry today.';
    const feels = cur.apparent_temperature != null && Math.abs(cur.apparent_temperature - cur.temperature_2m) >= 4 ? 'Feels like ' + t(cur.apparent_temperature) : '';
    return {
      icon: now.icon, words: now.words, temp: t(cur.temperature_2m), unit: unitLabel || '',
      high: t(d.temperature_2m_max && d.temperature_2m_max[0]), low: t(d.temperature_2m_min && d.temperature_2m_min[0]),
      feels, advice,
    };
  }

  return { describe, usesFahrenheit, roundCoord, forecastUrl, geocodeUrl, placeLabel, rainLater, summary };
});
