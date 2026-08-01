/* Enhance caregiver reminder display with day/date schedules */
(() => {
  'use strict';
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtTime=(value)=>{
    if(!value)return '';
    const [h,m]=String(value).slice(0,5).split(':').map(Number);
    return new Date(2000,0,1,h,m).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  };
  function text(r){
    const time=fmtTime(r.schedule_time||r.reminder_time);
    const type=r.schedule_type||'daily';
    if(type==='once'&&r.schedule_date){
      const d=new Date(`${r.schedule_date}T12:00:00`);
      return `${d.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})}${time?` at ${time}`:''}`;
    }
    if(type==='weekly'){
      const selected=(r.schedule_days||[]).map(i=>days[i]);
      const label=selected.join(', ').replace(/, ([^,]*)$/,' and $1');
      return `${label?`Every ${label}`:'Weekly'}${time?` at ${time}`:''}`;
    }
    return time?`Every day at ${time}`:'Every day';
  }

  function patch(){
    if(typeof window.renderReminders!=='function'||window.__caregiverSchedulePatched)return false;
    window.__caregiverSchedulePatched=true;
    window.renderReminders=function(items){
      const target=document.getElementById('reminders');if(!target)return;
      target.innerHTML=items.length?items.map(r=>`<div class="row"><div><strong>${esc(r.category||'⭐')} ${esc(r.title)}</strong>${r.urgent?'<span class="badge urgent">Urgent</span>':''}</div><div class="key">${esc(text(r))}</div></div>`).join(''):'<div class="empty">No reminders are saved.</div>';
    };
    return true;
  }
  let tries=0;const id=setInterval(()=>{tries++;if(patch()||tries>30)clearInterval(id)},100);
})();
