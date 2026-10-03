import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
const requireFrontend = createRequire(resolve('artifacts/tastekin/package.json'));
const { build } = createRequire(requireFrontend.resolve('vite/package.json'))('esbuild');
const directory = resolve('artifacts/tastekin/dist/public');
await mkdir(directory, { recursive: true });
const result = await build({
  stdin: {
    resolveDir: resolve('artifacts/tastekin'),
    loader: 'tsx',
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {AdminModerationActions} from './src/components/AdminModerationActions';
      const params=new URLSearchParams(location.search);
      const target={targetType:params.get('type')||'edit',targetId:'review-fixture-edit',creatorId:'fixture-creator',
        ownerUserId:'fixture-author',hidden:false,suspended:false,protectedAccount:params.has('protected'),
        data:{title:'Reported Edit',caption:'Original content remains intact.'}};
      const fixture={calls:[],queueRefreshes:0,target,history:[],failNext:false};
      window.__moderationFixture=fixture;
      window.fetch=async(url,options={})=>{
        const path=String(url);
        fixture.calls.push({url:path,method:options.method||'GET',body:options.body});
        await new Promise(resolve=>setTimeout(resolve,120));
        if(!path.startsWith('/api/admin/reports/')) throw new Error('Non-fixture network access forbidden');
        if(options.method==='POST'){
          if(fixture.failNext){fixture.failNext=false;return Response.json({error:'Fixture action failed'}, {status:503});}
          const body=JSON.parse(options.body);
          if(!body.reason?.trim()||body.confirmed!==true)return Response.json({error:'Required reason and confirmation'}, {status:400});
          const account=body.action.endsWith('_user');
          if(account&&target.protectedAccount)return Response.json({error:'Protected account'}, {status:403});
          const previousState=account?{suspended:target.suspended}:{hidden:target.hidden,creatorId:target.creatorId};
          if(account)target.suspended=body.action==='suspend_user';else target.hidden=body.action.startsWith('hide_');
          const newState=account?{suspended:target.suspended}:{hidden:target.hidden,creatorId:target.creatorId};
          fixture.history.unshift({id:crypto.randomUUID(),reportId:'fixture-report',adminUserId:'fixture-moderator',
            action:body.action,note:body.reason,createdAt:new Date().toISOString(),previousState,newState});
          return Response.json({action:body.action,hidden:target.hidden,suspended:target.suspended,audit:fixture.history[0]});
        }
        return Response.json({target,history:fixture.history});
      };
      function Harness(){
        return <main style={{maxWidth:700,margin:'30px auto',padding:20}}>
          <h1>TASTEKIN · Moderation review</h1><p>Database-free isolated UI fixture</p>
          <button data-testid="fixture-fail-next" onClick={()=>fixture.failNext=true}>Fail next action</button>
          <AdminModerationActions reportId="00000000-0000-4000-8000-000000000010" ar={params.has('ar')}
            isAdmin={!params.has('nonadmin')} onChanged={()=>{fixture.queueRefreshes++}}/>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', minify: true,
});
await writeFile(directory + '/__moderation-review.js', result.outputFiles[0].text);
const assetNames = await readdir(directory + '/assets');
const stylesheet = assetNames.find((name) => /^index.*\.css$/.test(name));
const css = stylesheet ? await readFile(directory + '/assets/' + stylesheet, 'utf8') : 'body{font-family:Arial;background:#f6f6f6}';
await writeFile(directory + '/__moderation-review.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moderation review fixture</title><style>${css}</style></head><body><div id="root"></div><script src="./__moderation-review.js"></script></body></html>`);
console.log('Created isolated UI preview in ignored build output. All fetch calls are mocked.');