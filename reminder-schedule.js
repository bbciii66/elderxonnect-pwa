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
  const shortDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function ymd(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function scheduleText(r) {
    const time = r.scheduleTime || r.time || '';
    const timeText = time && window.fmt12 ? window.fmt12(time) : time;
    const type = r.scheduleType || 'daily';
    if (type === 'once' && r.scheduleDate) {
      const target = new Date(`${r.scheduleDate}T12:00:00`);
      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
      const targetDay = new Date(target); targetDay.setHours(0,0,0,0);
      const label = targetDay.getTime() === today.getTime() ? 'Today' : targetDay.getTime() === tomorrow.getTime() ? 'Tomorrow' : target.toLocaleDateString(undefined,{month:'long',day:'numeric',year:target.getFullYear()!==today.getFullYear()?'numeric':undefined});
      return `${label}${timeText ? ` at ${timeText}` : ''}`;
    }
    if (type === 'weekly') {
      const selected = Array.isArray(r.scheduleDays) ? r.scheduleDays.slice().sort((a,b)=>a-b).map(i=>days[i]) : [];
      return `${selected.length ? `Every ${selected.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : 'Weekly'}${timeText ? ` at ${timeText}` : ''}`;
    }
    return timeText ? `Every day at ${timeText}` : 'Every day';
  }
  window.elderXonnectReminderScheduleText = scheduleText;

  function addCalendarStyles() {
    if (document.getElementById('exCalendarStyles')) return;
    const style = document.createElement('style');
    style.id = 'exCalendarStyles';
    style.textContent = `
      .ex-calendar{margin-top:8px;padding:12px;border:1px solid var(--line2);border-radius:16px;background:rgba(0,0,0,.18)}
      .ex-cal-head{display:grid;grid-template-columns:42px 1fr 42px;align-items:center;gap:8px;margin-bottom:10px}
      .ex-cal-head button{border:1px solid var(--line2);border-radius:10px;background:rgba(255,255,255,.05);color:var(--text);font-size:20px;padding:6px;cursor:pointer}
      .ex-cal-title{text-align:center;font-weight:700;font-family:'Lora',serif}
      .ex-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
      .ex-cal-dow{text-align:center;color:var(--muted);font-size:10px;padding:4px 0}
      .ex-cal-day{aspect-ratio:1;border:1px solid transparent;border-radius:10px;background:rgba(255,255,255,.035);color:var(--text);font-size:13px;cursor:pointer;padding:0}
      .ex-cal-day:hover{border-color:rgba(46,204,138,.35)}
      .ex-cal-day.today{border-color:var(--gold);color:var(--gold)}
      .ex-cal-day.selected{background:var(--green);color:#071209;font-weight:800}
      .ex-cal-day:disabled{opacity:.25;cursor:not-allowed}
      .ex-cal-empty{aspect-ratio:1}
      .ex-date-summary{margin-top:8px;text-align:center;color:var(--green);font-size:13px;font-weight:700}
    `;
    document.head.appendChild(style);
  }

  function makeCalendar(input) {
    const calendar = document.getElementById('remCalendar');
    const title = document.getElementById('remCalTitle');
    const grid = document.getElementById('remCalGrid');
    const summary = document.getElementById('remDateSummary');
    let view = input.value ? new Date(`${input.value}T12:00:00`) : new Date();
    view = new Date(view.getFullYear(), view.getMonth(), 1);

    function renderCalendar() {
      const year = view.getFullYear();
      const month = view.getMonth();
      title.textContent = view.toLocaleDateString(undefined,{month:'long',year:'numeric'});
      const firstDay = new Date(year,month,1).getDay();
      const count = new Date(year,month+1,0).getDate();
      const todayKey = ymd(new Date());
      const selectedKey = input.value;
      const pieces = shortDays.map(d=>`<div class="ex-cal-dow">${d}</div>`);
      for(let i=0;i<firstDay;i++) pieces.push('<div class="ex-cal-empty"></div>');
      for(let day=1;day<=count;day++) {
        const date = new Date(year,month,day);
        const key = ymd(date);
        const past = key < todayKey;
        const classes = ['ex-cal-day'];
        if(key===todayKey) classes.push('today');
        if(key===selectedKey) classes.push('selected');
        pieces.push(`<button type="button" class="${classes.join(' ')}" data-date="${key}" ${past?'disabled':''}>${day}</button>`);
      }
      grid.innerHTML = pieces.join('');
      grid.querySelectorAll('[data-date]').forEach(button => {
        button.addEventListener('click', () => {
          input.value = button.dataset.date;
          input.dispatchEvent(new Event('change',{bubbles:true}));
          renderCalendar();
        });
      });
      summary.textContent = input.value ? new Date(`${input.value}T12:00:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}) : 'Tap a date';
    }

    document.getElementById('remCalPrev').onclick = () => { view = new Date(view.getFullYear(),view.getMonth()-1,1); renderCalendar(); };
    document.getElementById('remCalNext').onclick = () => { view = new Date(view.getFullYear(),view.getMonth()+1,1); renderCalendar(); };
    input.addEventListener('change', () => {
      if(input.value) {
        const selected = new Date(`${input.value}T12:00:00`);
        view = new Date(selected.getFullYear(),selected.getMonth(),1);
      }
      renderCalendar();
    });
    calendar.classList.remove('hidden');
    renderCalendar();
  }

  function addFields() {
    const time = document.getElementById('remTime');
    const addButton = document.getElementById('addReminderBtn');
    if (!time || !addButton || document.getElementById('remScheduleType')) return;
    addCalendarStyles();

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
        <div class="sp8"></div><div class="label">Choose date</div>
        <input id="remDate" type="hidden" />
        <div class="ex-calendar" id="remCalendar">
          <div class="ex-cal-head"><button type="button" id="remCalPrev" aria-label="Previous month">‹</button><div class="ex-cal-title" id="remCalTitle"></div><button type="button" id="remCalNext" aria-label="Next month">›</button></div>
          <div class="ex-cal-grid" id="remCalGrid"></div>
          <div class="ex-date-summary" id="remDateSummary">Tap a date</div>
        </div>
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
    const dateInput = document.getElementById('remDate');
    makeCalendar(dateInput);
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
      const scheduleDate = dateInput.value;
      const scheduleDays = [...document.querySelectorAll('.remDay:checked')].map(x=>Number(x.value));
      const cat = document.getElementById('remCat').value;
      const urgent = document.getElementById('remUrgent').checked;
      if (!title) return window.toast?.('⚠️ Enter a reminder title');
      if (!scheduleTime) return window.toast?.('⚠️ Choose a reminder time');
      if (scheduleType === 'once' && !scheduleDate) return window.toast?.('⚠️ Tap a date on the calendar');
      if (scheduleType === 'weekly' && !scheduleDays.length) return window.toast?.('⚠️ Choose at least one day');
      if (window.requestNotifPermission) await window.requestNotifPermission();

      const list = read('reminders', []);
      list.push({title,cat,urgent,created:Date.now(),scheduleType,scheduleTime,scheduleDate:scheduleType==='once'?scheduleDate:'',scheduleDays:scheduleType==='weekly'?scheduleDays:[],time:scheduleType==='daily'?scheduleTime:''});
      write('reminders', list);
      document.getElementById('remTitle').value='';
      document.getElementById('remTime').value='';
      dateInput.value=''; dateInput.dispatchEvent(new Event('change'));
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
    if (type === 'once') return r.scheduleDate === ymd(now);
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
