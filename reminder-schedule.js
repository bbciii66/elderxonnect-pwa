/* ElderXonnect reminder day/date scheduling */
(() => {
  'use strict';

  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function scheduleText(r) {
    const time = r.scheduleTime || r.time || '';
    const timeText = time && window.fmt12 ? window.fmt12(time) : time;
    const type = r.scheduleType || 'daily';
    if (type === 'once' && r.scheduleDate) {
      const target = new Date(`${r.scheduleDate}T12:00:00`);
      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
      const targetDay = new Date(target); targetDay.setHours(0,0,0,0);
      let label = targetDay.getTime() === today.getTime() ? 'Today' : targetDay.getTime() === tomorrow.getTime() ? 'Tomorrow' : target.toLocaleDateString(undefined,{month:'long',day:'numeric',year:target.getFullYear()!==today.getFullYear()?'numeric':undefined});
      return `${label}${timeText ? ` at ${timeText}` : ''}`;
    }
    if (type === 'weekly') {
      const selected = Array.isArray(r.scheduleDays) ? r.scheduleDays.slice().sort((a,b)=>a-b).map(i=>days[i]) : [];
      return `${selected.length ? `Every ${selected.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : 'Weekly'}${timeText ? ` at ${timeText}` : ''}`;
    }
    return `${timeText ? `Every day at ${timeText}` : 'Every day'}`;
  }
  window.elderXonnectReminderScheduleText = scheduleText;

  function addFields() {
    const time = document.getElementById('remTime');
    const addButton = document.getElementById('addReminderBtn');
    if (!time || !addButton || document.getElementById('remScheduleType')) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="sp8"></div>
      <div class="label">When</div>
      <select id="remScheduleType">
        <option value="daily">Every day</option>
        <option value="once">One time — choose a date</option>
        <option value="weekly">Weekly — choose days</option>
      </select>
      <div id="remDateWrap" class="hidden">
        <div class="sp8"></div><div class="label">Date</div>
        <input id="remDate" type="date" />
      </div>
      <div id="remDaysWrap" class="hidden">
        <div class="sp8"></div><div class="label">Days of week</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
          ${days.map((d,i)=>`<label style="display:flex;align-items:center;padding:9px;border:1px solid var(--line2);border-radius:12px;font-size:13px"><input type="checkbox" class="remDay" value="${i}">${d}</label>`).join('')}
        </div>
      </div>`;
    time.insertAdjacentElement('afterend', wrap);

    const type = document.getElementById('remScheduleType');
    const dateWrap = document.getElementById('remDateWrap');
    const daysWrap = document.getElementById('remDaysWrap');
    type.addEventListener('change', () => {
      dateWrap.classList.toggle('hidden', type.value !== 'once');
      daysWrap.classList.toggle('hidden', type.value !== 'weekly');
    });

    const replacement = addButton.cloneNode(true);
    addButton.replaceWith(replacement);
    replacement.addEventListener('click', async () => {
      const title = document.getElementById('remTitle').value.trim();
      const scheduleTime = document.getElementById('remTime').value;
      const scheduleType = type.value;
      const scheduleDate = document.getElementById('remDate').value;
      const scheduleDays = [...document.querySelectorAll('.remDay:checked')].map(x=>Number(x.value));
      const cat = document.getElementById('remCat').value;
      const urgent = document.getElementById('remUrgent').checked;
      if (!title) return window.toast?.('⚠️ Enter a reminder title');
      if (!scheduleTime) return window.toast?.('⚠️ Choose a reminder time');
      if (scheduleType === 'once' && !scheduleDate) return window.toast?.('⚠️ Choose a reminder date');
      if (scheduleType === 'weekly' && !scheduleDays.length) return window.toast?.('⚠️ Choose at least one day');
      if (window.requestNotifPermission) await window.requestNotifPermission();

      const list = read('reminders', []);
      list.push({
        title, cat, urgent, created: Date.now(), scheduleType,
        scheduleTime, scheduleDate: scheduleType === 'once' ? scheduleDate : '',
        scheduleDays: scheduleType === 'weekly' ? scheduleDays : [],
        time: scheduleType === 'daily' ? scheduleTime : ''
      });
      write('reminders', list);
      document.getElementById('remTitle').value='';
      document.getElementById('remTime').value='';
      document.getElementById('remDate').value='';
      document.querySelectorAll('.remDay').forEach(x=>x.checked=false);
      document.getElementById('remUrgent').checked=false;
      type.value='daily'; type.dispatchEvent(new Event('change'));
      render(); window.refreshHomeStats?.(); window.toast?.('🔔 Reminder added!');
    });
  }

  function render() {
    const ul = document.getElementById('remList');
    const empty = document.getElementById('remEmpty');
    if (!ul || !empty) return;
    const list = read('reminders', []);
    ul.innerHTML=''; empty.style.display=list.length?'none':'block';
    list.forEach((r,idx)=>{
      const li=document.createElement('li');
      const left=document.createElement('div'); left.style.cssText='display:flex;align-items:center;gap:10px;flex:1;';
      left.innerHTML=`<span class="rem-item-icon">${esc(r.cat||'⭐')}</span><div><div style="font-weight:600;">${esc(r.title)}${r.urgent?'<span class="urgent-badge">URGENT</span>':''}</div><div class="small">${esc(scheduleText(r))}</div></div>`;
      const del=document.createElement('button'); del.className='btn ghost'; del.style.cssText='width:auto;padding:8px 10px;font-size:12px;flex-shrink:0;'; del.textContent='✕';
      del.addEventListener('click',()=>{const next=read('reminders',[]).filter((_,i)=>i!==idx);write('reminders',next);render();window.refreshHomeStats?.();});
      li.append(left,del); ul.appendChild(li);
    });
  }
  window.renderReminders = render;

  function shouldFire(r, now) {
    const time = r.scheduleTime || r.time;
    if (!time) return false;
    const hm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    if (time !== hm) return false;
    const type = r.scheduleType || 'daily';
    if (type === 'once') {
      const ymd = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      return r.scheduleDate === ymd;
    }
    if (type === 'weekly') return Array.isArray(r.scheduleDays) && r.scheduleDays.includes(now.getDay());
    return true;
  }

  function checkScheduled() {
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    read('reminders', []).forEach(r=>{
      if ((r.scheduleType||'daily') === 'daily' || !shouldFire(r,now)) return;
      const key=`scheduled_fired_${r.created}_${dateKey}`;
      if (read(key,false)) return;
      write(key,true);
      const title=`${r.cat||'⭐'} ${r.title}`;
      const msg=scheduleText(r);
      if(r.urgent){window.showBanner?.(title,msg,true,r.created);window.showUrgentOverlay?.(title,r.title);}
      else {window.showBanner?.(title,msg,false);if(window.notifGranted && 'Notification' in window)new Notification(`ElderXonnect: ${title}`,{body:msg,icon:'/icon-192.png',tag:`rem-${r.created}`});}
    });
  }

  function boot(){addFields();render();setInterval(checkScheduled,30000);setTimeout(checkScheduled,1500);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
