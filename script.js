(()=>{'use strict';
// 1) Remplacez ces deux valeurs par celles de Supabase > Project Settings > API.
// Utilisez UNIQUEMENT la clé publique anon / publishable. Jamais service_role ou secret.
const SUPABASE_URL = 'https://dgpupquqkclqhvhhatcy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_hLQ_NaIzvWF3UKwRBRXLZQ_whQkw71y';
const CLOUD_READY=!SUPABASE_URL.includes('VOTRE-PROJET')&&!SUPABASE_PUBLISHABLE_KEY.includes('VOTRE_CLE');
const cloud=CLOUD_READY&&window.supabase?window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY):null;
let cloudUser=null,cloudEnabled=false,cloudChannel=null,cloudSaveTimer=null,cloudSaving=false,cloudDirty=false;
let cloudBaseline=null,cloudConflict=false,cloudGeneration=0;
const syncLabel=(s)=>{const el=document.getElementById('syncStatus');if(el)el.textContent=s};

const $=id=>document.getElementById(id),K='budgetflow.transactions.v2',CK='budgetflow.categories.v2',SK='budgetflow.schedule.v1',GK='budgetflow.goals.v1';
const defaults=['Logement','Courses','Transport','Loisirs','Santé','Abonnements','Salaire','Autres'];
const read=(key,fallback)=>{try{const x=JSON.parse(localStorage.getItem(key));return Array.isArray(x)?x:fallback}catch{return fallback}};
let editingScheduleId=null;
let transactions=read(K,[]),categories=read(CK,defaults.slice());if(!categories.length)categories=defaults.slice();let schedules=read(SK,[]),goals=read(GK,[]);
const euro=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}),fmt=n=>euro.format(Number(n)||0);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const sum=(arr,type)=>arr.filter(t=>!type||t.type===type).reduce((n,t)=>n+Number(t.amount||0),0);
const year=t=>Number(String(t.date).slice(0,4)),month=t=>Number(String(t.date).slice(5,7))-1;
const save=()=>{if(!cloudEnabled)return;cloudDirty=true;syncLabel(cloudConflict?'Conflit de sauvegarde — rechargez après avoir conservé vos modifications':'Modifications en attente…');if(cloudConflict)return;clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(flushCloud,220)};
const cloudSnapshot=()=>({transactions,categories,schedules,goals});
async function flushCloud(){
 if(!cloudEnabled||!cloudUser||!cloudDirty||cloudSaving||cloudConflict)return;
 cloudSaving=true;cloudDirty=false;syncLabel('Synchronisation…');
 const snapshot=JSON.parse(JSON.stringify(cloudSnapshot()));
 const expected=cloudBaseline===null?null:JSON.parse(JSON.stringify(cloudBaseline));
 const generation=cloudGeneration,userId=cloudUser.id;
 try{
  let error,accepted=false;
  if(expected===null){
   // Une seule creation autorisee : ne jamais ecraser une ligne creee ailleurs.
   const response=await cloud.from('budget_state').insert({user_id:userId,data:snapshot,updated_at:new Date().toISOString()});
   error=response.error;
   if(error&&error.code==='23505'){error=null;accepted=false}else accepted=!error;
  }else{
   const response=await cloud.rpc('budgetflow_save_if_unchanged',{expected_data:expected,new_data:snapshot});
   error=response.error;accepted=response.data===true;
  }
  if(generation!==cloudGeneration)return;
  if(error)throw error;
  if(!accepted){
   cloudConflict=true;cloudDirty=true;
   syncLabel('Conflit : sauvegarde bloquee. Conservez vos modifications avant de recharger.');
   return;
  }
  cloudBaseline=snapshot;
  syncLabel(cloudDirty?'Modifications en attente…':'Synchronisé ✓');
 }catch(err){
  if(generation!==cloudGeneration)return;
  // Ne pas boucler sur une erreur de RPC ou de droits.
  cloudConflict=true;cloudDirty=true;
  syncLabel('Sauvegarde bloquee — contactez le support avant de recharger');
  console.error('BudgetFlow cloud:',err);
 }finally{
  cloudSaving=false;
  if(cloudDirty&&cloudEnabled&&!cloudConflict){clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(flushCloud,220)}
 }
}
function applyCloud(data){
 transactions=Array.isArray(data?.transactions)?data.transactions:[];
 categories=Array.isArray(data?.categories)&&data.categories.length?data.categories:defaults.slice();
 schedules=Array.isArray(data?.schedules)?data.schedules:[];
 goals=Array.isArray(data?.goals)?data.goals:[];
 render();updateDemoStatus();
}
let cloudStartPromise=null;
function startCloud(user){
 if(cloudStartPromise)return cloudStartPromise;
 cloudStartPromise=startCloudInternal(user).finally(()=>{cloudStartPromise=null});
 return cloudStartPromise;
}
async function startCloudInternal(user){
 cloudEnabled=false;cloudUser=user;syncLabel('Chargement de vos données…');
 if(cloudChannel){await cloud.removeChannel(cloudChannel);cloudChannel=null}
 try{
  const {data,error}=await cloud.from('budget_state').select('data').eq('user_id',user.id).maybeSingle();
  if(error)throw error;
  // Une nouvelle session commence vide : aucune démo ni anciennes données locales importées automatiquement.
  transactions=[];categories=defaults.slice();schedules=[];goals=[];
  cloudBaseline=data?.data?JSON.parse(JSON.stringify(data.data)):null;
  cloudConflict=false;cloudDirty=false;cloudGeneration++;
  cloudEnabled=true;
  if(data?.data)applyCloud(data.data);else{render();updateDemoStatus()}
  document.getElementById('authScreen').hidden=true;
  document.getElementById('budgetApp').hidden=false;
  showPage(location.hash.slice(1));requestChart();syncLabel('Synchronisé ✓');
  cloudChannel=cloud.channel('budgetflow-'+user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'budget_state',filter:'user_id=eq.'+user.id},async()=>{
      if(cloudDirty||cloudSaving)return;
      const {data:latest,error:e}=await cloud.from('budget_state').select('data').eq('user_id',user.id).maybeSingle();
      if(!e&&latest?.data&&!cloudDirty&&!cloudSaving){cloudBaseline=JSON.parse(JSON.stringify(latest.data));applyCloud(latest.data);syncLabel('Mis à jour en temps réel ✓')}
    }).subscribe();
 }catch(err){cloudEnabled=false;document.getElementById('authScreen').hidden=false;document.getElementById('budgetApp').hidden=true;document.getElementById('authMessage').textContent='Connexion aux données impossible : '+err.message;console.error(err)}
}
async function stopCloud(){cloudGeneration++;cloudBaseline=null;cloudConflict=false;cloudEnabled=false;cloudUser=null;cloudDirty=false;clearTimeout(cloudSaveTimer);if(cloudChannel){await cloud.removeChannel(cloudChannel);cloudChannel=null}document.getElementById('budgetApp').hidden=true;document.getElementById('authScreen').hidden=false;transactions=[];categories=defaults.slice();schedules=[];goals=[]}
async function initializeCloud(){
 const authMessage=document.getElementById('authMessage');
 if(!cloud){authMessage.textContent='Configurez SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY dans script.js, puis rechargez la page.';return}
 document.getElementById('authForm').addEventListener('submit',async e=>{
  e.preventDefault();authMessage.textContent='Connexion…';const {error}=await cloud.auth.signInWithPassword({email:document.getElementById('authEmail').value.trim(),password:document.getElementById('authPassword').value});authMessage.textContent=error?error.message:'';
 });
 document.getElementById('signUpBtn').addEventListener('click',async()=>{
  const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;
  if(!email||password.length<8){authMessage.textContent='Indiquez un e-mail et un mot de passe de 8 caractères minimum.';return}
  const {error}=await cloud.auth.signUp({email,password});authMessage.textContent=error?error.message:'Compte créé. Vérifiez votre e-mail si une confirmation est demandée.';
 });
 document.getElementById('signOutBtn').addEventListener('click',async()=>{await cloud.auth.signOut();await stopCloud()});
 document.getElementById('importLocalBtn').addEventListener('click',()=>{
  const oldT=read(K,[]),oldC=read(CK,defaults.slice()),oldS=read(SK,[]),oldG=read(GK,[]);
  const real=oldT.filter(t=>!t.demoBatch);const examples=oldT.length-real.length;
  if(!confirm(`Importer ${real.length} transaction(s) personnelles, ${oldS.length} échéance(s) et ${oldG.length} objectif(s) depuis CE navigateur ? ${examples} transaction(s) de démonstration seront ignorées. Les éléments portant le même identifiant ne seront pas dupliqués.`))return;
  const byId=new Map(transactions.map(t=>[String(t.id),t]));real.forEach(t=>{if(t.id!=null&&!byId.has(String(t.id)))byId.set(String(t.id),t)});transactions=[...byId.values()];
  categories=[...new Set([...categories,...oldC])];
  const sch=new Map(schedules.map(x=>[String(x.id),x]));oldS.forEach(x=>{if(x.id!=null&&!sch.has(String(x.id)))sch.set(String(x.id),x)});schedules=[...sch.values()];
  const gl=new Map(goals.map(x=>[String(x.id),x]));oldG.forEach(x=>{if(x.id!=null&&!gl.has(String(x.id)))gl.set(String(x.id),x)});goals=[...gl.values()];
  save();render();updateDemoStatus();alert('Importation préparée. Vérifiez l’indicateur « Synchronisé » avant de quitter la page.');
 });
 cloud.auth.onAuthStateChange((_event,session)=>{if(session?.user){if(!cloudEnabled||cloudUser?.id!==session.user.id)startCloud(session.user)}else if(cloudEnabled)stopCloud()});
 const {data:{session}}=await cloud.auth.getSession();if(session?.user&&!cloudEnabled)await startCloud(session.user);
}

const message=(s,error=false)=>{const el=$('formMessage');el.textContent=s;el.style.color=error?'var(--red)':'var(--green)'};
function options(){const selected=$('category').value;$('category').innerHTML=categories.map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('');if(categories.includes(selected))$('category').value=selected}
function years(id){const el=$(id),current=Number(el.value)||new Date().getFullYear(),list=[...new Set([new Date().getFullYear(),...transactions.map(year).filter(Number.isFinite)])].sort((a,b)=>b-a);el.innerHTML=list.map(y=>`<option value="${y}">${y}</option>`).join('');el.value=String(list.includes(current)?current:list[0])}
function stats(){const inc=sum(transactions,'income'),exp=sum(transactions,'expense'),capital=sum(transactions,'saving');$('incomeTotal').textContent=fmt(inc);$('expenseTotal').textContent=fmt(exp);$('balanceTotal').textContent=fmt(inc-exp);$('balanceTotal').style.color=inc-exp<0?'var(--red)':'var(--text)';$('savingRate').textContent=inc>0?`${Math.round(capital/inc*100)} %`:'0 %'}
function list(){const q=$('searchTransactions').value.trim().toLowerCase(),type=$('typeFilter').value;const rows=transactions.filter(t=>(type==='all'||t.type===type)&&`${t.description} ${t.category} ${t.date}`.toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date));$('transactionCount').textContent=`${rows.length} transaction${rows.length===1?'':'s'}`;$('transactionRows').innerHTML=rows.map(t=>{const income=t.type==='income',saving=t.type==='saving';const date=new Date(`${t.date}T12:00:00`);return `<tr><td class="name">${escape(t.description)}</td><td><span class="tag">${escape(t.category)}</span></td><td>${Number.isNaN(date.getTime())?escape(t.date):date.toLocaleDateString('fr-FR')}</td><td class="${income?'income-text':'expense-text'}">${saving?'◉ Épargne':income?'↗ Revenu':'↘ Dépense'}</td><td class="right ${income?'income-text':'expense-text'}">${saving?'◉ ':income?'+':'−'}${fmt(t.amount)}</td><td class="right"><button class="action-btn" data-edit="${escape(t.id)}" type="button">Modifier</button><button class="action-btn" data-delete="${escape(t.id)}" type="button">Supprimer</button></td></tr>`}).join('');$('emptyTransactions').classList.toggle('hidden',rows.length>0)}
const groups=arr=>{const out=new Map();arr.forEach(t=>out.set(t.category,(out.get(t.category)||0)+Number(t.amount||0)));return [...out].map(([category,amount])=>({category,amount})).sort((a,b)=>b.amount-a.amount)};
function breakdown(){const exp=transactions.filter(t=>t.type==='expense'),total=sum(exp),colors=['#a093ff','#53d6a7','#ffb86b','#ff8394','#73baff','#db9aff'];$('categoryExpenseTotal').textContent=fmt(total);$('categoryBreakdown').innerHTML=total?groups(exp).map((g,i)=>`<div><div class="breakdown-label"><span>${escape(g.category)}</span><strong>${fmt(g.amount)} · ${Math.round(g.amount/total*100)}%</strong></div><div class="progress"><div class="progress-fill" style="width:${Math.min(100,g.amount/total*100)}%;background:${colors[i%colors.length]}"></div></div></div>`).join(''):'<p class="muted">Aucune dépense enregistrée.</p>'}
function annual(){const exp=transactions.filter(t=>t.type==='expense'&&year(t)===Number($('annualYear').value)),total=sum(exp),data=groups(exp);$('annualRows').innerHTML=data.map(g=>`<tr><td>${escape(g.category)}</td><td class="right">${fmt(g.amount)}</td><td class="right">${Math.round(g.amount/total*100)}%</td></tr>`).join('')+(total?`<tr><td><strong>Total</strong></td><td class="right"><strong>${fmt(total)}</strong></td><td class="right">100%</td></tr>`:'');$('annualEmpty').classList.toggle('hidden',data.length>0)}

function analysis(){
  const selectedYear=Number($('analysisYear').value),selectedMonth=$('analysisMonth').value;
  const scoped=transactions.filter(t=>year(t)===selectedYear&&(selectedMonth==='all'||month(t)===Number(selectedMonth)));
  const expenses=scoped.filter(t=>t.type==='expense'),income=sum(scoped,'income'),expense=sum(expenses);
  $('analysisExpenses').textContent=fmt(expense);$('analysisIncome').textContent=fmt(income);
  $('analysisBalance').textContent=fmt(income-expense);$('analysisBalance').style.color=income-expense<0?'var(--red)':'var(--text)';
  const monthNames=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const byCategory=groups(expenses);
  const yearly=transactions.filter(t=>t.type==='expense'&&year(t)===selectedYear);
  const categoryNames=[...new Set([...categories,...yearly.map(t=>t.category)])];
  const matrix=categoryNames.map(category=>{
    const values=Array(12).fill(0);yearly.forEach(t=>{if(t.category===category&&month(t)>=0&&month(t)<12)values[month(t)]+=Number(t.amount)||0});
    return {category,values,total:values.reduce((a,b)=>a+b,0)};
  }).filter(g=>g.total>0).sort((a,b)=>b.total-a.total);
  const totals=Array(12).fill(0);matrix.forEach(g=>g.values.forEach((v,i)=>totals[i]+=v));
  const cell=v=>`<td class="right">${v?fmt(v):'—'}</td>`;
  $('analysisMatrixRows').innerHTML=matrix.map(g=>`<tr><td>${escape(g.category)}</td>${g.values.map(cell).join('')}<td class="right analysis-strong">${fmt(g.total)}</td></tr>`).join('')+`<tr class="analysis-total"><td>Total</td>${totals.map(cell).join('')}<td class="right">${fmt(totals.reduce((a,b)=>a+b,0))}</td></tr>`;
}


const VIS_COLORS=['#a093ff','#53d6a7','#ffb86b','#ff8394','#73baff','#db9aff','#80d8df','#d9d36f'];
let visualMode='bars';
const shortMoney=n=>new Intl.NumberFormat('fr-FR',{notation:'compact',maximumFractionDigits:1}).format(n);
function renderVisuals(){
  const evolutionYear=$('evolutionYear'),availableYears=[...new Set([new Date().getFullYear(),...transactions.map(t=>year(t)).filter(Number.isFinite)])].sort((a,b)=>b-a);
  evolutionYear.innerHTML=availableYears.map(y=>`<option value="${y}">${y}</option>`).join('');
  evolutionYear.value=$('analysisYear').value;
  const selectedYear=Number($('analysisYear').value),selectedMonth=$('analysisMonth').value;
  const expenses=transactions.filter(t=>t.type==='expense'&&year(t)===selectedYear&&(selectedMonth==='all'||month(t)===Number(selectedMonth)));
  const data=groups(expenses).slice(0,12),total=sum(expenses);
  $('chartViewBars').classList.toggle('active',visualMode==='bars');$('chartViewDonut').classList.toggle('active',visualMode==='donut');
  $('chartViewBars').setAttribute('aria-pressed',String(visualMode==='bars'));$('chartViewDonut').setAttribute('aria-pressed',String(visualMode==='donut'));
  if(!total){$('categoryVisual').innerHTML='<p class="graphic-empty">Aucune dépense pour cette période.</p>'}
  else if(visualMode==='bars'){
    const max=Math.max(...data.map(d=>d.amount));
    const height=Math.max(220,data.length*32+24);
    const bars=data.map((d,i)=>{const y=10+i*32,w=Math.max(2,d.amount/max*260);return `<g><title>${escape(d.category)} : ${escape(fmt(d.amount))}</title><text x="3" y="${y+14}" fill="#d4d8e9" font-size="11">${escape(d.category.length>17?d.category.slice(0,16)+'…':d.category)}</text><rect x="136" y="${y+2}" width="260" height="15" rx="5" fill="#272b40"/><rect x="136" y="${y+2}" width="${w}" height="15" rx="5" fill="${VIS_COLORS[i%VIS_COLORS.length]}"/><text x="404" y="${y+14}" fill="#e4e7f5" font-size="10">${escape(fmt(d.amount))}</text></g>`}).join('');
    $('categoryVisual').innerHTML=`<svg viewBox="0 0 490 ${height}" role="img" aria-label="Dépenses par catégorie en barres">${bars}</svg>`;
  }else{
    let start=-Math.PI/2;const cx=180,cy=150,r=95,inner=60;
    const paths=data.map((d,i)=>{const end=start+d.amount/total*Math.PI*2;const x1=cx+r*Math.cos(start),y1=cy+r*Math.sin(start),x2=cx+r*Math.cos(end-.000001),y2=cy+r*Math.sin(end-.000001);const xi1=cx+inner*Math.cos(start),yi1=cy+inner*Math.sin(start),xi2=cx+inner*Math.cos(end-.000001),yi2=cy+inner*Math.sin(end-.000001);const large=end-start>Math.PI?1:0;let shape;if(data.length===1){shape=`<circle cx="${cx}" cy="${cy}" r="${(r+inner)/2}" fill="none" stroke="${VIS_COLORS[i%VIS_COLORS.length]}" stroke-width="${r-inner}"/>`}else{shape=`<path d="M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z" fill="${VIS_COLORS[i%VIS_COLORS.length]}"/>`}start=end;return `<g><title>${escape(d.category)} : ${escape(fmt(d.amount))} (${Math.round(d.amount/total*100)} %)</title>${shape}</g>`}).join('');
    const legend=data.map((d,i)=>`<span><i style="background:${VIS_COLORS[i%VIS_COLORS.length]}"></i>${escape(d.category)} ${Math.round(d.amount/total*100)} %</span>`).join('');
    $('categoryVisual').innerHTML=`<div style="width:100%"><svg viewBox="0 0 360 300" style="max-height:265px" role="img" aria-label="Répartition des dépenses par catégorie en anneau">${paths}<text x="180" y="146" text-anchor="middle" fill="#999fb9" font-size="12">Total</text><text x="180" y="169" text-anchor="middle" fill="#f3f4fb" font-size="18" font-weight="700">${escape(shortMoney(total))} €</text></svg><div class="graphic-legend">${legend}</div></div>`;
  }
  const yearly=transactions.filter(t=>t.type==='expense'&&year(t)===selectedYear);
  const names=[...new Set(yearly.map(t=>t.category))].sort((a,b)=>a.localeCompare(b,'fr'));
  const select=$('visualCategory'),prior=select.value;
  select.innerHTML='<option value="all">Toutes les catégories</option>'+names.map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('');
  select.value=names.includes(prior)?prior:'all';
  const monthly=Array(12).fill(0);
  yearly.forEach(t=>{const m=month(t);if(m>=0&&m<12&&(select.value==='all'||t.category===select.value))monthly[m]+=Number(t.amount)||0});
  if(!monthly.some(Boolean)){$('monthlyCategoryVisual').innerHTML='<p class="graphic-empty">Aucune dépense à comparer pour cette année.</p>';return}
  const max=Math.max(...monthly,1),months=['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  const w=680,h=285,left=50,right=20,top=30,bottom=45,plotH=h-top-bottom,plotW=w-left-right,step=plotW/11;
  const coords=monthly.map((value,i)=>({x:left+i*step,y:top+plotH-value/max*plotH,value,i}));
  let svg='<defs><linearGradient id="expenseLineArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a093ff" stop-opacity=".24"/><stop offset="100%" stop-color="#a093ff" stop-opacity="0"/></linearGradient></defs>';
  for(let i=0;i<=4;i++){const y=top+plotH-i*plotH/4;svg+=`<line x1="${left}" x2="${w-right}" y1="${y}" y2="${y}" stroke="#303449"/><text x="${left-9}" y="${y+4}" text-anchor="end" font-size="10" fill="#959cb5">${escape(shortMoney(max*i/4))}</text>`}
  const path=coords.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  svg+=`<path d="${path} L ${coords[11].x} ${top+plotH} L ${coords[0].x} ${top+plotH} Z" fill="url(#expenseLineArea)"/>`;
  svg+=`<path d="${path}" fill="none" stroke="#a093ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  coords.forEach(p=>{const active=selectedMonth===String(p.i),color=active?'#53d6a7':'#a093ff';
    svg+=`<g class="visual-month" tabindex="0" role="button" aria-label="Afficher ${months[p.i]} : ${escape(fmt(p.value))}" data-month="${p.i}"><title>${months[p.i]} ${selectedYear} : ${escape(fmt(p.value))} — cliquer pour filtrer</title><circle cx="${p.x}" cy="${p.y}" r="15" fill="transparent"/><circle cx="${p.x}" cy="${p.y}" r="${active?6:4.5}" fill="${color}" stroke="#171a2b" stroke-width="2"/><text x="${p.x}" y="${Math.max(13,p.y-14)}" text-anchor="middle" font-size="10" fill="#e9e4ff">${p.value?escape(shortMoney(p.value))+' €':''}</text><text x="${p.x}" y="${h-17}" text-anchor="middle" font-size="11" fill="${active?'#53d6a7':'#aeb4c9'}">${months[p.i]}</text></g>`});
  $('monthlyCategoryVisual').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Courbe des dépenses mensuelles pour ${escape(select.value==='all'?'toutes les catégories':select.value)} en ${selectedYear}">${svg}</svg>`;
}

function chips(){$('categoryChips').innerHTML=categories.map(c=>`<span class="chip">${escape(c)}${transactions.some(t=>t.category===c)?'':`<button type="button" data-category="${escape(c)}" title="Supprimer ${escape(c)}" aria-label="Supprimer ${escape(c)}">×</button>`}</span>`).join('')}
let frame=0;function requestChart(){if($('overview').hidden)return;if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;drawChart()})}
function drawChart(){const canvas=$('monthlyChart'),box=canvas.parentElement,w=Math.max(280,box.clientWidth),h=Math.max(180,box.clientHeight),ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);const inc=Array(12).fill(0),exp=Array(12).fill(0),selected=Number($('chartYear').value);transactions.forEach(t=>{const m=month(t);if(year(t)===selected&&m>=0&&m<12)(t.type==='income'?inc:exp)[m]+=Number(t.amount)||0});const max=Math.max(1,...inc,...exp),left=45,top=10,bottom=30,right=10,ph=h-top-bottom,pw=w-left-right;ctx.font='10px system-ui';for(let i=0;i<=4;i++){const y=top+ph-i*ph/4;ctx.strokeStyle='#2a2e43';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle='#959cb5';ctx.textAlign='right';ctx.fillText(Math.round(max*i/4).toLocaleString('fr-FR'),left-8,y+3)}const labels=['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'],gw=pw/12,bw=Math.min(11,gw*.28);for(let m=0;m<12;m++){const x=left+(m+.5)*gw;ctx.fillStyle='#a093ff';const ih=inc[m]/max*ph;ctx.fillRect(x-bw-1,top+ph-ih,bw,ih);ctx.fillStyle='#53d6a7';const eh=exp[m]/max*ph;ctx.fillRect(x+1,top+ph-eh,bw,eh);ctx.fillStyle='#d6cfff';ctx.textAlign='center';if(inc[m]>0)ctx.fillText(shortMoney(inc[m])+' €',x-bw/2-1,Math.max(9,top+ph-ih-5));if(exp[m]>0)ctx.fillText(shortMoney(exp[m])+' €',x+bw/2+1,Math.max(19,top+ph-eh-5));ctx.fillStyle='#959cb5';ctx.textAlign='center';ctx.fillText(labels[m],x,h-9)}$('chartEmpty').classList.toggle('hidden',inc.some(Boolean)||exp.some(Boolean))}
function render(){transferDueSchedules();renderSavings();renderSchedules();stats();options();years('chartYear');years('annualYear');years('analysisYear');list();breakdown();annual();analysis();renderVisuals();chips();requestChart()}
function reset(){ $('transactionForm').reset();$('editingId').value='';$('date').value=today();$('formTitle').textContent='Ajouter une transaction';$('submitButton').textContent='Ajouter la transaction';$('cancelEdit').classList.add('hidden');updateSavingType();message('')}

function updateSavingType(){
 const saving=document.querySelector('input[name="type"]:checked')?.value==='saving';
 $('savingGoalField').classList.toggle('hidden',!saving);
 $('transactionCategoryField').classList.toggle('hidden',saving);
 $('category').required=!saving;$('savingGoalSelect').required=saving;
 const prior=$('savingGoalSelect').value;
 $('savingGoalSelect').innerHTML=goals.map(g=>`<option value="${escape(g.name)}">${escape(g.name)}</option>`).join('');
 if(goals.some(g=>g.name===prior))$('savingGoalSelect').value=prior;
 if(saving&&!goals.length)message('Créez d’abord un objectif dans la page Épargne.',true);
}
function renderSavings(){
 const total=sum(transactions,'saving');
 $('savingGoals').innerHTML=goals.length?goals.map(g=>{
  const capital=sum(transactions.filter(t=>t.type==='saving'&&t.category===g.name));
  const pct=Math.min(100,Math.max(0,capital/Number(g.target)*100));
  return `<div class="goal-row"><div class="goal-info"><strong>${escape(g.name)}</strong><span>${fmt(capital)} / ${fmt(g.target)}</span></div><div class="savings-cylinder" role="progressbar" aria-label="${escape(g.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="savings-liquid" style="height:${pct}%"></div><span class="savings-percent">${Math.round(pct)} %</span></div><p class="muted">Capital disponible : ${fmt(capital)} · Reste à constituer : ${fmt(Math.max(0,g.target-capital))}</p><button class="btn secondary-btn" data-delete-goal="${escape(g.id)}" type="button">Supprimer l’objectif</button></div>`;
 }).join(''):'<p class="muted">Créez votre premier objectif de capital.</p>';
 updateSavingType();
}
// La date d'échéance est une date locale ISO (AAAA-MM-JJ).
function addMonthsISO(iso, count, anchorDay){
 const [y,m]=iso.split('-').map(Number);
 const first=new Date(y,m-1+count,1);
 const day=Math.min(anchorDay,new Date(first.getFullYear(),first.getMonth()+1,0).getDate());
 return `${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function addYearsISO(iso,count,anchorMonth,anchorDay){
 const y=Number(iso.slice(0,4))+count;
 const day=Math.min(anchorDay,new Date(y,anchorMonth,0).getDate());
 return `${y}-${String(anchorMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function nextDueDate(s, iso){
 const anchor=s.originalDate||s.date;
 const day=Number(anchor.slice(8,10));
 if(s.repeat==='monthly')return addMonthsISO(iso,1,day);
 if(s.repeat==='yearly')return addYearsISO(iso,1,Number(anchor.slice(5,7)),day);
 return null;
}
// Appelé à l'ouverture et au retour sur l'onglet : pas de serveur nécessaire.
// Une occurrence = un identifiant stable, pour empêcher tout doublon.
function transferDueSchedules(){
 if(!cloudEnabled)return false;
 const now=today();let changed=false;const kept=[];
 for(const item of schedules){
  const s={...item};let current=s.date;let count=0;
  while(current&&current<=now&&count<1200){
   const transferId=`echeance-${s.id}-${current}`;
   if(!transactions.some(t=>t.id===transferId||t.scheduleOccurrenceId===transferId)){
    transactions.push({id:transferId,scheduleOccurrenceId:transferId,scheduleId:s.id,
     automatic:true,type:'expense',description:s.name,category:s.category,
     amount:Number(s.amount),date:current,createdAt:Date.now()});changed=true;
   }
   count++;
   current=nextDueDate(s,current);
  }
  if(!current){changed=true;continue}
  if(current!==s.date){s.date=current;changed=true}
  kept.push(s);
 }
 if(changed){schedules=kept;save()}
 return changed;
}
function renderSchedules(){
 const items=schedules.slice().sort((a,b)=>a.date.localeCompare(b.date));
 $('scheduleTotal').textContent=fmt(items.reduce((v,s)=>v+Number(s.amount),0));
 const nextDate=items.length?items[0].date:null;
 $('scheduleRows').innerHTML=items.length?items.map(s=>{
  const isNext=s.date===nextDate;
  return `<div class="schedule-row${isNext?' schedule-row-next':''}"><div><strong>${escape(s.name)}</strong>${isNext?'<span class="schedule-next-label">Prochaine échéance</span>':''}<p class="muted">${escape(s.category)} · ${escape(s.date)} · ${s.repeat==='monthly'?'Mensuel':s.repeat==='yearly'?'Annuel':'Unique'}</p></div><div><strong class="schedule-price${isNext?' schedule-price-next':''}">${fmt(s.amount)}</strong><button class="btn secondary-btn" data-edit-schedule="${escape(s.id)}" type="button">Modifier</button><button class="btn secondary-btn" data-delete-schedule="${escape(s.id)}" type="button">Supprimer</button></div></div>`;
 }).join(''):'<p class="muted">Aucune échéance à venir.</p>';
 $('scheduleCategory').innerHTML=categories.map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('');
}
$('goalForm').addEventListener('submit',e=>{
 e.preventDefault();const name=$('goalName').value.trim(),target=Number($('goalTarget').value);
 if(!name||!(target>0)||goals.some(g=>g.name.toLowerCase()===name.toLowerCase())){alert('Vérifiez le nom et le montant de votre objectif.');return}
 goals.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),name,target});save();$('goalForm').reset();render();
});
$('savingGoals').addEventListener('click',e=>{
 const b=e.target.closest('[data-delete-goal]');if(!b)return;
 const g=goals.find(x=>x.id===b.dataset.deleteGoal);if(!g)return;
 if(transactions.some(t=>t.type==='saving'&&t.category===g.name)){alert('Cet objectif contient des versements. Supprimez ou réaffectez-les avant de supprimer l’objectif.');return}
 if(confirm(`Supprimer l’objectif « ${g.name} » ?`)){goals=goals.filter(x=>x!==g);save();render()}
});
function resetScheduleForm(){
 editingScheduleId=null;
 $('scheduleForm').reset();
 $('scheduleDate').value=today();
 const submit=$('scheduleForm').querySelector('[type="submit"]');
 submit.textContent='Enregistrer l’échéance';
 const cancel=$('cancelScheduleEdit');
 if(cancel)cancel.hidden=true;
}
const scheduleCancel=document.createElement('button');
scheduleCancel.id='cancelScheduleEdit';scheduleCancel.type='button';scheduleCancel.className='btn secondary-btn';
scheduleCancel.textContent='Annuler la modification';scheduleCancel.hidden=true;
$('scheduleForm').appendChild(scheduleCancel);
scheduleCancel.addEventListener('click',resetScheduleForm);
$('scheduleForm').addEventListener('submit',e=>{
 e.preventDefault();
 const name=$('scheduleName').value.trim(),amount=Number($('scheduleAmount').value),date=$('scheduleDate').value;
 if(!name||!Number.isFinite(amount)||!(amount>0)||!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
 const values={name,amount,date,category:$('scheduleCategory').value,repeat:$('scheduleRepeat').value};
 if(editingScheduleId){
  const i=schedules.findIndex(x=>String(x.id)===String(editingScheduleId));
  if(i<0){resetScheduleForm();return}
  schedules[i]={...schedules[i],...values,originalDate:date};
 }else{
  schedules.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),...values,originalDate:date});
 }
 save();resetScheduleForm();render();
});
$('scheduleRows').addEventListener('click',e=>{
 const edit=e.target.closest('[data-edit-schedule]'),del=e.target.closest('[data-delete-schedule]');
 if(edit){
  const item=schedules.find(x=>String(x.id)===edit.dataset.editSchedule);if(!item)return;
  editingScheduleId=String(item.id);
  $('scheduleName').value=item.name;$('scheduleAmount').value=item.amount;$('scheduleDate').value=item.date;
  $('scheduleCategory').value=item.category;$('scheduleRepeat').value=item.repeat;
  $('scheduleForm').querySelector('[type="submit"]').textContent='Enregistrer la modification';
  scheduleCancel.hidden=false;
  $('scheduleForm').scrollIntoView({behavior:'auto',block:'center'});
 }else if(del){
  const item=schedules.find(x=>String(x.id)===del.dataset.deleteSchedule);if(!item)return;
  if(confirm('Supprimer cette échéance ?')){
   schedules=schedules.filter(x=>x!==item);
   if(String(editingScheduleId)===String(item.id))resetScheduleForm();
   save();render();
  }
 }
});
document.querySelectorAll('input[name="type"]').forEach(input=>input.addEventListener('change',updateSavingType));
$('scheduleDate').value=today();

// Les transactions fictives portent une marque dédiée : la suppression ne cible jamais les vraies opérations.
const DEMO_MARK='budgetflow-demo-12m-v1';
function demoItems(){
  const y=new Date().getFullYear();
  const templates=[
    {type:'income',category:'Salaire',description:'Salaire (démo)',base:2650,step:45,day:3},
    {type:'expense',category:'Logement',description:'Loyer (démo)',base:850,step:0,day:5},
    {type:'expense',category:'Courses',description:'Courses alimentaires (démo)',base:355,step:17,day:9},
    {type:'expense',category:'Transport',description:'Transport (démo)',base:105,step:9,day:12},
    {type:'expense',category:'Loisirs',description:'Loisirs (démo)',base:120,step:14,day:16},
    {type:'expense',category:'Santé',description:'Santé (démo)',base:35,step:8,day:20},
    {type:'expense',category:'Abonnements',description:'Abonnements (démo)',base:58,step:2,day:24}
  ];
  const items=[];
  for(let m=0;m<12;m++)templates.forEach((t,i)=>{
    const variation=((m*7+i*3)%9)-4;
    const amount=Math.round((t.base+variation*t.step)*100)/100;
    items.push({id:`demo-${DEMO_MARK}-${m}-${i}`,demoBatch:DEMO_MARK,type:t.type,category:t.category,description:t.description,amount,date:`${y}-${String(m+1).padStart(2,'0')}-${String(t.day).padStart(2,'0')}`});
  });
  return items;
}
function demoCount(){return transactions.filter(t=>t.demoBatch===DEMO_MARK).length}
function updateDemoStatus(){
  const count=demoCount();
  $('demoStatus').textContent=count?`${count} transactions fictives chargées pour ${new Date().getFullYear()}. Elles sont identifiées par « (démo) ».`:'Aucune transaction de démonstration chargée.';
  $('clearDemo').disabled=count===0;
  $('loadDemo').disabled=count>0;
}
$('loadDemo').addEventListener('click',()=>{
  if(demoCount())return;
  try { localStorage.removeItem('budgetflow.demo.removed.v3'); } catch(_) {}
  const items=demoItems();
  for(const category of new Set(items.map(t=>t.category)))if(!categories.includes(category))categories.push(category);
  transactions.push(...items);
  save();render();updateDemoStatus();
  $('analysisYear').value=String(new Date().getFullYear());
  $('analysisMonth').value='all';
  analysis();renderVisuals();
});
$('clearDemo').addEventListener('click',()=>{
  const count=demoCount();if(!count)return;
  if(!confirm(`Supprimer uniquement les ${count} transactions fictives ? Vos vraies transactions seront conservées.`))return;
  transactions=transactions.filter(t=>t.demoBatch!==DEMO_MARK);
  try { localStorage.setItem('budgetflow.demo.removed.v3','1'); } catch(_) {}
  if($('editingId').value.startsWith('demo-'+DEMO_MARK))reset();
  save();render();updateDemoStatus();
});
$('transactionForm').addEventListener('submit',e=>{e.preventDefault();const amount=Number($('amount').value),description=$('description').value.trim(),category=document.querySelector('input[name="type"]:checked').value==='saving'?$('savingGoalSelect').value:$('category').value,date=$('date').value,type=document.querySelector('input[name="type"]:checked').value,id=$('editingId').value;if(!(amount>0)||!Number.isFinite(amount)||!description||!category||!/^\d{4}-\d{2}-\d{2}$/.test(date)){message('Veuillez vérifier les informations saisies.',true);return}if(id){const i=transactions.findIndex(t=>String(t.id)===id);if(i<0){message('Transaction introuvable : rechargez la page.',true);return}transactions[i]={...transactions[i],amount,description,category,date,type}}else if(type==='expense'&&date>today()){schedules.push({id:crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`,name:description,amount,date,originalDate:date,category,repeat:'once'})}else transactions.push({id:typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`,amount,description,category,date,type});save();render();reset();message(id?'Transaction modifiée.':type==='expense'&&date>today()?'Dépense future ajoutée à l’échéancier.':'Transaction ajoutée.')});
$('cancelEdit').addEventListener('click',reset);
$('transactionRows').addEventListener('click',e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit){const t=transactions.find(x=>String(x.id)===edit.dataset.edit);if(!t)return;$('editingId').value=t.id;$('amount').value=t.amount;$('description').value=t.description;$('category').value=t.category;$('date').value=t.date;document.querySelector(`input[name="type"][value="${t.type}"]`).checked=true;updateSavingType();if(t.type==='saving')$('savingGoalSelect').value=t.category;$('formTitle').textContent='Modifier la transaction';$('submitButton').textContent='Enregistrer';$('cancelEdit').classList.remove('hidden');$('transactionForm').scrollIntoView({behavior:'auto',block:'center'});}if(del){const t=transactions.find(x=>String(x.id)===del.dataset.delete);if(t&&confirm(`Supprimer « ${t.description} » ?`)){transactions=transactions.filter(x=>x!==t);save();render();updateDemoStatus();if($('editingId').value===String(t.id))reset()}}});
$('searchTransactions').addEventListener('input',list);$('typeFilter').addEventListener('change',list);$('chartYear').addEventListener('change',requestChart);$('annualYear').addEventListener('change',annual);$('analysisYear').addEventListener('change',()=>{analysis();renderVisuals()});$('evolutionYear').addEventListener('change',()=>{$('analysisYear').value=$('evolutionYear').value;analysis();renderVisuals()});$('analysisMonth').addEventListener('change',()=>{analysis();renderVisuals()});
$('visualCategory').addEventListener('change',renderVisuals);$('visualResetMonth').addEventListener('click',()=>{$('analysisMonth').value='all';analysis();renderVisuals()});
$('chartViewBars').addEventListener('click',()=>{visualMode='bars';renderVisuals()});$('chartViewDonut').addEventListener('click',()=>{visualMode='donut';renderVisuals()});
$('monthlyCategoryVisual').addEventListener('click',e=>{const item=e.target.closest('[data-month]');if(item){$('analysisMonth').value=item.dataset.month;analysis();renderVisuals()}});
$('monthlyCategoryVisual').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const item=e.target.closest('[data-month]');if(item){e.preventDefault();$('analysisMonth').value=item.dataset.month;analysis();renderVisuals()}}});
$('categoryForm').addEventListener('submit',e=>{e.preventDefault();const name=$('newCategory').value.trim();if(!name)return;if(categories.some(c=>c.toLowerCase()===name.toLowerCase())){message('Cette catégorie existe déjà.',true);return}categories.push(name);save();$('newCategory').value='';render();$('category').value=name;message('Catégorie ajoutée.')});
$('categoryChips').addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(!b)return;const c=b.dataset.category;if(transactions.some(t=>t.category===c))return;categories=categories.filter(x=>x!==c);if(!categories.length)categories=['Autres'];save();render()});
$('exportCsv').addEventListener('click',()=>{const rows=[['Date','Type','Description','Catégorie','Montant'],...transactions.map(t=>[t.date,t.type==='saving'?'Épargne':t.type==='income'?'Revenu':'Dépense',t.description,t.category,Number(t.amount).toFixed(2)])];const csv='\uFEFF'+rows.map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`budgetflow-${today()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
function showPage(pageId){
  const pages=['overview','transactions','categories','annual','schedule','savings'];
  const target=pages.includes(pageId)?pageId:'overview';
  pages.forEach(id=>{$(id).hidden=id!==target});
  document.querySelectorAll('.nav-link').forEach(link=>{
    const active=link.getAttribute('href')==='#'+target;
    link.classList.toggle('active',active);
    link.setAttribute('aria-current',active?'page':'false');
  });
  $('mainContent').scrollTop=0;
  if(target==='overview')requestChart();
}
window.addEventListener('hashchange',()=>{if(transferDueSchedules())render();showPage(location.hash.slice(1))});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&transferDueSchedules())render()});
window.addEventListener('focus',()=>{if(transferDueSchedules())render()});
document.querySelectorAll('.quick-card').forEach(a=>a.addEventListener('click',()=>{
  if(location.hash===a.getAttribute('href'))showPage(location.hash.slice(1));
}));
showPage(location.hash.slice(1));
if(typeof ResizeObserver!=='undefined')new ResizeObserver(requestChart).observe($('monthlyChart').parentElement);else window.addEventListener('resize',requestChart,{passive:true});
// Aucune donnée fictive ajoutée automatiquement en mode cloud.
const todayLabel=$('todayLabel');if(todayLabel)todayLabel.textContent=new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});$('date').value=today();initializeCloud();
})();
