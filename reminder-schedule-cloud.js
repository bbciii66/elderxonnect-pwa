/* Sync reminder schedule metadata alongside the base cloud sync */
(() => {
  'use strict';
  const CFG_KEY='elderxonnect_supabase_config';
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
  let client=null,session=null,timer=null;

  async function getClient(){
    if(client)return client;
    const cfg=read(CFG_KEY,{});
    if(!cfg.url||!cfg.key||!window.supabase?.createClient)return null;
    client=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true}});
    const r=await client.auth.getSession();session=r.data.session;
    client.auth.onAuthStateChange((_e,s)=>{session=s;if(s)setTimeout(pull,800)});
    return client;
  }

  async function push(){
    const c=await getClient(); if(!c||!session)return;
    const reminders=read('reminders',[]).filter(r=>r.clientId);
    for(const r of reminders){
      const scheduleTime=r.scheduleTime||r.time||null;
      const payload={
        schedule_type:r.scheduleType||'daily',
        schedule_date:(r.scheduleType==='once'&&r.scheduleDate)||null,
        schedule_days:r.scheduleType==='weekly'&&Array.isArray(r.scheduleDays)?r.scheduleDays:[],
        schedule_time:scheduleTime
      };
      const result=await c.from('reminders').update(payload).eq('user_id',session.user.id).eq('client_id',r.clientId);
      if(result.error && !String(result.error.message||'').includes('column'))console.error(result.error);
    }
  }

  async function pull(){
    const c=await getClient(); if(!c||!session)return;
    const result=await c.from('reminders').select('client_id,schedule_type,schedule_date,schedule_days,schedule_time').eq('user_id',session.user.id);
    if(result.error){
      if(!String(result.error.message||'').includes('column'))console.error(result.error);
      return;
    }
    const map=new Map((result.data||[]).map(x=>[x.client_id,x]));
    const reminders=read('reminders',[]);
    let changed=false;
    reminders.forEach(r=>{
      const cloud=map.get(r.clientId);if(!cloud)return;
      r.scheduleType=cloud.schedule_type||'daily';
      r.scheduleDate=cloud.schedule_date||'';
      r.scheduleDays=cloud.schedule_days||[];
      r.scheduleTime=cloud.schedule_time?.slice(0,5)||r.time||'';
      if(r.scheduleType!=='daily')r.time='';
      changed=true;
    });
    if(changed){localStorage.setItem('reminders',JSON.stringify(reminders));window.renderReminders?.();}
  }

  function schedulePush(){clearTimeout(timer);timer=setTimeout(push,1400)}
  const original=Storage.prototype.setItem;
  if(!window.__elderScheduleStoragePatched){
    window.__elderScheduleStoragePatched=true;
    Storage.prototype.setItem=function(k,v){original.call(this,k,v);if(this===localStorage&&k==='reminders')schedulePush()};
  }
  window.addEventListener('focus',()=>setTimeout(pull,400));
  setTimeout(async()=>{await getClient();await pull();},1800);
})();
