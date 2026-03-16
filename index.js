const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));


// ================= CONFIG =================

const EMAIL_USER = "digitalesservicios311@gmail.com";
const EMAIL_PASS = "rfbmuirunbfwcara";

const SPREADSHEET_ID = "1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY";

const WA_TOKEN = "e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78";
const ADMIN_PHONE = "18494736782";


// ================= CACHE CLIENTES =================

let clientesCache = [];
let cacheTime = 0;

async function cargarClientes(){

if(Date.now() - cacheTime < 600000){
return clientesCache;
}

console.log("📊 Cargando clientes desde Sheets...");

const auth = new google.auth.GoogleAuth({
credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
scopes:["https://www.googleapis.com/auth/spreadsheets.readonly"]
});

const sheets = google.sheets({version:"v4",auth});

const res = await sheets.spreadsheets.values.get({
spreadsheetId:SPREADSHEET_ID,
range:"Hoja1!A2:K500"
});

clientesCache = res.data.values || [];
cacheTime = Date.now();

console.log("Clientes cargados:",clientesCache.length);

return clientesCache;

}


// ================= WHATSAPP =================

async function enviarWA(tel,msg){

try{

const url="https://www.wasenderapi.com/api/send-message";

let numero = tel.toString().replace(/[^0-9]/g,"");
let phone="+"+numero;

console.log("📲 Enviando a:",phone);

await fetch(url,{
method:"POST",
headers:{
Authorization:`Bearer ${WA_TOKEN}`,
"Content-Type":"application/json"
},
body:JSON.stringify({
to:phone,
text:msg
})
});

}catch(e){

console.log("ERROR WA:",e.message);

}

}


// ================= HISTORIAL =================

const enviados = new Set();

function yaEnviado(id){

if(enviados.has(id)) return true;

enviados.add(id);

setTimeout(()=>{

enviados.delete(id);

},600000);

return false;

}


// ================= DETECTAR PERFIL =================

function detectarPerfil(texto){

let match = texto.match(/hola,?\s*(\d+):/i);

if(match) return match[1];

match = texto.match(/perfil\s*(\d+)/i);

if(match) return match[1];

if(texto.includes("cristal")) return "cristal";

return "";

}


// ================= PROCESAR EMAIL =================

async function procesarCorreo(correoNetflix,parsed){

try{

const clientes = await cargarClientes();

const correoMail = correoNetflix
.toLowerCase()
.replace(/\s/g,"")
.trim();

const cuerpo = (parsed.text||"").toLowerCase();
const html = parsed.html || "";

const perfil = detectarPerfil(cuerpo);

console.log("📧 Cuenta:",correoMail,"Perfil:",perfil);


// ================= BUSCAR CLIENTE =================

const cliente = clientes.find(c=>{

const correoSheet = (c[4]||"")
.toLowerCase()
.replace(/\s/g,"")
.trim();

return correoMail.includes(correoSheet);

});


const codigo4 = cuerpo.match(/\b\d{4}\b/);
const codigo6 = cuerpo.match(/\b\d{6}\b/);

const link =
html.match(/href="([^"]*update-home[^"]*)"/) ||
html.match(/href="([^"]*confirm-account[^"]*)"/) ||
html.match(/href="([^"]*travel[^"]*)"/);


let tipo="";


if(cuerpo.includes("código temporal") || codigo6){
tipo="temporal";
}

else if(cuerpo.includes("hogar") || html.includes("update-home")){
tipo="hogar";
}

else if(cuerpo.includes("viaje")){
tipo="viaje";
}

else if(codigo4){
tipo="codigo";
}


// ================= EVITAR DUPLICADOS =================

const id = correoMail+tipo+(codigo4?codigo4[0]:"");

if(yaEnviado(id)){
console.log("⚠️ duplicado ignorado");
return;
}


// ================= CLIENTE =================

if(cliente){

const nombre = cliente[1];
const tel = cliente[2];

let msg="";


if(tipo==="codigo"){

msg=
`🔐 *CÓDIGO NETFLIX*

Hola *${nombre}*

Perfil: ${perfil || "Cuenta"}

Código: *${codigo4[0]}*

Escribe este código en Netflix para iniciar sesión.
`;

}


if(tipo==="temporal"){

msg=
`⌛ *CÓDIGO TEMPORAL*

Hola *${nombre}*

Código temporal: *${codigo6[0]}*

Ingresa este código en Netflix para continuar.
`;

}


if(tipo==="hogar" && link){

msg=
`🏠 *ACTUALIZAR HOGAR NETFLIX*

Hola *${nombre}*

Netflix solicita actualizar el hogar.

Abre este enlace:

${link[1]}

Después podrás seguir usando la cuenta.
`;

}


if(tipo==="viaje" && link){

msg=
`✈️ *VERIFICACIÓN DE VIAJE*

Hola *${nombre}*

Netflix detectó un acceso desde otra ubicación.

Confirma el acceso aquí:

${link[1]}
`;

}


if(msg){

await enviarWA(tel,msg);

}

}


// ================= ADMIN =================

else{

await enviarWA(

ADMIN_PHONE,

`⚠️ CUENTA NO ENCONTRADA

Correo: ${correoMail}
Perfil: ${perfil}

Revisa si el correo está en la base.`

);

}


}catch(e){

console.log("ERROR PROCESAR:",e.message);

}

}


// ================= LEER EMAILS =================

app.get("/api/emails",async(req,res)=>{

console.log("🚀 BUSCANDO CORREOS");

const client = new ImapFlow({
host:"imap.gmail.com",
port:993,
secure:true,
auth:{
user:EMAIL_USER,
pass:EMAIL_PASS
}
});

try{

await client.connect();

await client.mailboxOpen("INBOX");

const list = await client.search({from:"netflix"});

let emails=[];

for(let seq of list.slice(-5).reverse()){

let msg = await client.fetchOne(seq,{
source:true,
envelope:true
});

let parsed = await simpleParser(msg.source);

await procesarCorreo(
msg.envelope.to[0].address,
parsed
);

emails.push({

subject:msg.envelope.subject,
date:new Date(msg.envelope.date)
.toLocaleString("es-DO"),
to:msg.envelope.to[0].address

});

}

await client.logout();

res.json({emails});

}catch(e){

console.log("IMAP ERROR:",e.message);

await client.logout().catch(()=>{});

res.status(500).json({error:"error"});

}

});


// ================= SERVER =================

app.listen(PORT,"0.0.0.0",()=>{

console.log("🚀 SISTEMA NETFLIX ACTIVO");

});
