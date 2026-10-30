/* Home-screen weather card. Free Open-Meteo data, no key and no account.
   The chosen place stays on this phone; only rounded coordinates are sent to Open-Meteo. */
(function () {
  'use strict';
  var W = window.WeatherLogic;
  var $ = function (id) { return document.getElementById(id); };
  if (!W || !$('weatherCard')) return;

  var PLACE_KEY = 'exc_weather_place', CACHE_KEY = 'exc_weather_cache', FRESH_MS = 30 * 60 * 1000;
  var fahrenheit = W.usesFahrenheit(navigator.language);
  var unit = fahrenheit ? 'F' : 'C';

  function read(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function write(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function show(id) { ['weatherSetup', 'weatherView', 'weatherLoading'].forEach(function (x) { var e = $(x); if (e) e.hidden = x !== id; }); }
  function note(text) { var n = $('weatherNote'); if (n) { n.textContent = text || ''; n.hidden = !text; } }

  function render(data, place) {
    var s = W.summary(data, unit);
    if (!s) { note('Weather is not available right now.'); show('weatherSetup'); return; }
    $('wxIcon').textContent = s.icon;
    $('wxTemp').textContent = s.temp;
    $('wxWords').textContent = s.words;
    $('wxHiLo').textContent = 'High ' + s.high + ' · Low ' + s.low;
    $('wxFeels').textContent = s.feels; $('wxFeels').hidden = !s.feels;
    $('wxAdvice').textContent = s.advice; $('wxAdvice').hidden = !s.advice;
    $('wxPlace').textContent = place.label || 'Your location';
    show('weatherView');
  }

  function load(place, force) {
    if (!place) { show('weatherSetup'); return; }
    var key = W.roundCoord(place.lat) + ',' + W.roundCoord(place.lon) + ',' + unit;
    var cache = read(CACHE_KEY);
    if (cache && cache.key === key && cache.data) {
      render(cache.data, place);
      if (!force && Date.now() - cache.at < FRESH_MS) return;
    } else show('weatherLoading');
    if (!navigator.onLine && cache && cache.key === key) return;
    fetch(W.forecastUrl(place.lat, place.lon, fahrenheit))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { write(CACHE_KEY, { key: key, at: Date.now(), data: data }); note(''); render(data, place); })
      .catch(function () {
        if (cache && cache.key === key) note('Showing the last weather we had. Check your internet connection.');
        else { note('Could not get the weather. Check your internet connection and try again.'); show('weatherSetup'); }
      });
  }

  function setPlace(place) { write(PLACE_KEY, place); load(place, true); }

  function useLocation() {
    if (!navigator.geolocation) { note('This phone cannot share its location. Type your town instead.'); openCity(); return; }
    note('Your phone may ask to share your location. Tap Allow.');
    show('weatherLoading');
    navigator.geolocation.getCurrentPosition(function (pos) {
      note('');
      setPlace({ lat: W.roundCoord(pos.coords.latitude), lon: W.roundCoord(pos.coords.longitude), label: 'Your location' });
    }, function () {
      show('weatherSetup');
      note('Location was not shared. You can type your town instead.');
      openCity();
    }, { maximumAge: 60 * 60 * 1000, timeout: 15000 });
  }

  function openCity() { var d = $('weatherCityBox'); if (d) { d.open = true; var i = $('weatherCity'); if (i) i.focus(); } }

  function searchCity() {
    var name = ($('weatherCity').value || '').trim(), list = $('weatherCityResults');
    if (name.length < 2) { note('Type at least two letters of your town.'); return; }
    list.innerHTML = '<p class="small">Searching…</p>';
    fetch(W.geocodeUrl(name)).then(function (r) { return r.json(); }).then(function (data) {
      var results = (data && data.results) || [];
      list.innerHTML = '';
      if (!results.length) { list.innerHTML = '<p class="small">No town found with that name. Check the spelling.</p>'; return; }
      results.forEach(function (res) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'btn ghost wx-choice';
        b.textContent = W.placeLabel(res);
        b.addEventListener('click', function () {
          setPlace({ lat: W.roundCoord(res.latitude), lon: W.roundCoord(res.longitude), label: W.placeLabel(res) });
          list.innerHTML = ''; $('weatherCity').value = '';
          var d = $('weatherCityBox'); if (d) d.open = false;
        });
        list.appendChild(b);
      });
    }).catch(function () { list.innerHTML = '<p class="small">Could not search right now. Check your internet connection.</p>'; });
  }

  function boot() {
    $('weatherUseLocation').addEventListener('click', useLocation);
    $('weatherCityBtn').addEventListener('click', searchCity);
    $('weatherCity').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); searchCity(); } });
    $('weatherChange').addEventListener('click', function () { write(PLACE_KEY, null); write(CACHE_KEY, null); note(''); show('weatherSetup'); });
    $('weatherRefresh').addEventListener('click', function () { load(read(PLACE_KEY), true); });
    load(read(PLACE_KEY), false);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(read(PLACE_KEY), false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
