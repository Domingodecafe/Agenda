/* Ana / Supabase: conexao administrativa e transferencia MANUAL, sem sincronizacao em segundo plano.
   A agenda continua local ate que a migracao seja testada. */
(() => {
  'use strict';
  const CONFIG_KEY = 'ana-supabase-config-v1';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';
  let api = null;
  let client = null;
  let revision = null;
  let locked = false;
  const $ = (id) => document.getElementById(id);
  const config = () => { try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { return {}; } };
  const setStatus = (message) => { $('ana-cloud-status').textContent = message; };
  const asError = error => (error && error.message) || String(error || 'Erro desconhecido');
  function button(label, action) {
    const b = document.createElement('button'); b.type='button'; b.textContent=label;
    b.className='secondary-button'; b.addEventListener('click', action); return b;
  }
  function field(title, type, value='', placeholder='') {
    const label = document.createElement('label'); label.style.display='grid'; label.style.gap='4px'; label.style.margin='8px 0';
    const span = document.createElement('span'); span.textContent=title;
    const input = document.createElement('input'); input.type=type; input.value=value; input.placeholder=placeholder;
    input.style.cssText='width:100%;padding:10px;color:inherit;background:transparent;border:1px solid #888;border-radius:8px';
    label.append(span,input); return {label,input};
  }
  async function getClient() {
    if (client) return client;
    const c=config();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c.url||'') || !/^sb_publishable_[\w-]+$/.test(c.key||'')) {
      throw new Error('Informe a URL de projeto Supabase e a chave pública (sb_publishable_...).');
    }
    const {createClient}=await import(SDK_URL);
    client=createClient(c.url,c.key,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:false}});
    return client;
  }
  async function requireUser() {
    const c=await getClient();
    const {data,error}=await c.auth.getUser();
    if (error || !data?.user) throw new Error('Entre com seu e-mail e senha do Supabase Auth.');
    return {c,user:data.user};
  }
  async function open() {
    $('ana-cloud-dialog').showModal();
    try {
      const {c,user}=await requireUser();
      setStatus('Autenticado: '+user.email+' · Rev. '+(revision??'não carregada'));
    } catch { setStatus('Não conectado. Configure um projeto dedicado e entre com sua conta.'); }
  }
  async function run(operation) {
    if(locked) return; locked=true;
    try { await operation(); }
    catch(error) { setStatus('Erro: '+asError(error)); }
    finally { locked=false; }
  }
  function install({getState,replaceState,saveState,downloadBackup}) {
    api={getState,replaceState,saveState,downloadBackup};
    const header=document.querySelector('.app-header') || document.querySelector('header') || document.body;
    header.append(button('Nuvem / Ana',open));
    const dlg=document.createElement('dialog'); dlg.id='ana-cloud-dialog'; dlg.className='modal';
    dlg.style.cssText='max-width:490px;width:calc(100% - 24px);max-height:85vh;overflow:auto;padding:20px;border-radius:16px';
    const heading=document.createElement('h2'); heading.textContent='Conectar Agenda ao Supabase';
    const explain=document.createElement('p'); explain.textContent='Transferência manual e segura. Não é sincronização automática. Use somente um projeto dedicado à Agenda.';
    const stored=config();
    const url=field('URL do projeto','url',stored.url||'','https://projeto.supabase.co');
    const key=field('Chave publishable (nunca secret/service_role)','text',stored.key||'','sb_publishable_...');
    const email=field('E-mail administrador','email','','voce@email.com');
    const password=field('Senha','password');
    const status=document.createElement('p'); status.id='ana-cloud-status'; status.setAttribute('role','status'); status.textContent='Aguardando conexão.';
    status.style.cssText='font-size:13px;white-space:pre-wrap';
    const controls=document.createElement('div'); controls.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';
    controls.append(
      button('Salvar configuração',()=>run(async()=>{
        const u=url.input.value.trim().replace(/\/$/,'');
        const k=key.input.value.trim();
        if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(u)) throw new Error('URL inválida.');
        if(!/^sb_publishable_[\w-]+$/.test(k)) throw new Error('Use chave sb_publishable_...');
        localStorage.setItem(CONFIG_KEY,JSON.stringify({url:u,key:k})); client=null; revision=null;
        setStatus('Configuração salva neste navegador. Faça login.');
      })),
      button('Entrar',()=>run(async()=>{
        const c=await getClient();
        const {data,error}=await c.auth.signInWithPassword({email:email.input.value.trim(),password:password.input.value});
        password.input.value='';
        if(error) throw error; revision=null; setStatus('Conectado: '+data.user.email);
      })),
      button('Exportar backup local',()=>api.downloadBackup()),
      button('Ver estado remoto',()=>run(async()=>{
        const {c,user}=await requireUser();
        const {data,error}=await c.from('agenda_snapshots').select('revision,updated_at').eq('owner_id',user.id).maybeSingle();
        if(error) throw error;
        revision=data?.revision??0;
        setStatus(data ? 'Já existe agenda remota. Revisão '+data.revision+' · '+data.updated_at : 'Ainda não existe agenda remota para sua conta.');
      })),
      button('Enviar cópia local',()=>run(async()=>{
        const {c,user}=await requireUser();
        const {data,error}=await c.from('agenda_snapshots').select('revision').eq('owner_id',user.id).maybeSingle();
        if(error) throw error;
        if(data) throw new Error('Existe agenda remota. Envio bloqueado para evitar sobrescrita.');
        if(!confirm('Fez backup local e está usando conta dedicada? Enviar cópia integral, incluindo dados financeiros, para o projeto Supabase?')) return;
        api.downloadBackup();
        const {data:newRevision,error:writeError}=await c.rpc('write_agenda_snapshot',{p_expected_revision:0,p_payload:api.getState()});
        if(writeError) throw writeError; revision=newRevision;
        setStatus('Cópia enviada! Revisão '+newRevision+'. A edição continua LOCAL, sem sincronização automática.');
      })),
      button('Baixar cópia da nuvem',()=>run(async()=>{
        const {c,user}=await requireUser();
        const {data,error}=await c.from('agenda_snapshots').select('revision,payload').eq('owner_id',user.id).maybeSingle();
        if(error) throw error;
        if(!data) throw new Error('Nenhum backup remoto disponível.');
        if(!data.payload || !Array.isArray(data.payload.clients) || !Array.isArray(data.payload.appointments)) throw new Error('Documento remoto inválido.');
        const blob=new Blob([JSON.stringify(data.payload,null,2)],{type:'application/json'});
        const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='agenda-nuvem-revisao-'+data.revision+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
        revision=data.revision; setStatus('Cópia remota exportada como arquivo; NÃO substituiu seus dados locais.');
      })),
      button('Sair',()=>run(async()=>{const c=await getClient();await c.auth.signOut();revision=null;setStatus('Sessão encerrada.');})),
      button('Fechar',()=>dlg.close())
    );
    const note=document.createElement('p');note.textContent='IMPORTANTE: envio e download não criam sincronização. Não edite o aplicativo e a base remota em paralelo. Nunca use dados reais em testes.';note.style.cssText='font-size:12px;opacity:.8';
    dlg.append(heading,explain,url.label,key.label,email.label,password.label,controls,status,note);
    document.body.append(dlg);
  }
  window.AnaCloud={install};
})();
