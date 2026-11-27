import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDemoServer,config} from './story-server.mjs';

export function createReviewServer({password,publicOrigin,maxRequests=100,settings=config(),fetcher=fetch}={}){
 if(typeof password!=='string'||password.length<16)throw Error('Set DEMO_REVIEW_PASSWORD to at least 16 characters.');
 const location=new URL(publicOrigin);
 if(location.protocol!=='https:'&&location.hostname!=='127.0.0.1')throw Error('The review URL must use HTTPS.');
 if(location.username||location.password||location.pathname!=='/'||location.search||location.hash)throw Error('Use only the public site origin.');
 if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>1000)throw Error('DEMO_MAX_REQUESTS must be an integer from 1 to 1000.');
 const expected=createHash('sha256').update('reviewer:'+password).digest();
 let attempts=0;
 const core=createDemoServer({settings,fetcher,publicOrigin:location.origin,reserveRequest:()=>{
  if(attempts>=maxRequests)return false;
  attempts++;return true;
 }});
 return http.createServer((req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Frame-Options','DENY');
 if(req.headers.host!==location.host){res.writeHead(403);res.end('Wrong host.');return;}
 if(req.method==='GET'&&req.url==='/healthz'){
 res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('ok');return;
 }
 const header=req.headers.authorization||'';
 let credentials='';
 if(header.startsWith('Basic ')&&header.length<2048)credentials=Buffer.from(header.slice(6),'base64').toString('utf8');
 const actual=createHash('sha256').update(credentials).digest();
 if(!timingSafeEqual(actual,expected)){
 res.writeHead(401,{'WWW-Authenticate':'Basic realm="Convico story review", charset="UTF-8"','Content-Type':'text/plain','Cache-Control':'no-store'});
 res.end('Enter the reviewer username and password supplied by Granth.');return;
 }
 core.emit('request',req,res);
 });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||10000);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT is invalid.');
 const publicOrigin=process.env.RENDER_EXTERNAL_URL||process.env.DEMO_PUBLIC_ORIGIN;
 if(!publicOrigin)throw Error('Missing RENDER_EXTERNAL_URL or DEMO_PUBLIC_ORIGIN.');
 const settings=config();
 if(!settings.key)throw Error('The selected provider API key is missing.');
 const server=createReviewServer({settings,publicOrigin,password:process.env.DEMO_REVIEW_PASSWORD,
 maxRequests:Number(process.env.DEMO_MAX_REQUESTS||100)});
 server.listen(port,'0.0.0.0',()=>console.log('Standalone review service listening on port '+port+'. Provider: '+settings.provider+'.'));
}
