const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { google } = require("googleapis");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));


// ================= CONFIG =================

const EMAIL_USER = "digitalesservicios311@gmail.com";
const EMAIL_PASS = "rfbmuirunbfwcara";

const SPREADSHEET_ID = "1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY";

const WA_TOKEN = "e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78";

const ADMIN_PHONE = "18494736782";


// ================= MEMORIA =================

let codigosUsados = new Set();
let correosProcesados = new Set();


// ================= CACHE CLIENTES =================

let clientesCache = [];
let ultimaCarga = 0;

async function obtenerClientes(){

if(Date.now() - ultimaCarga < 600000){
return clientesCache;
}

console.log("📊 Cargando clientes desde Sheets");

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

ultimaCarga = Date.now();

console.log("Clientes cargados:",clientesCache.length);

return clientesCache;

}


// ================= WHATSAPP =================

async function enviarWA(tel,msg){

const url = "https://www.wasenderapi.com/api/send-message";

try{

let numero = tel.toString().replace(/[^0-9]/g,"");

if(!numero.startsWith("1")){
numero="1"+numero;
}

console.log("📲 Enviando WA:",numero);

const response = await fetch(url,{
method:"POST",
headers:{
Authorization:`Bearer ${WA_TOKEN}`,
"Content-Type":"application/json"
},
body:JSON.stringify({
to:numero,
text:msg
})
});

const data = await response.text();

console.log("📩 Respuesta WA:",data);

}catch(e){

console.log("❌ Error WhatsApp:",e.message);

}

}


// ================= PROCESAR CORREO =================

async function procesarCorreo(correoNetflix,parsed,idCorreo){

if(correosProcesados.has(idCorreo)){
console.log("⚠️ correo ya procesado");
return;
}

correosProcesados.add(idCorreo);

const clientes = await obtenerClientes();

const texto = (parsed.text||"").toLowerCase();
const html = parsed.html || "";

const codMatch = texto.match(/\b\d{4}\b/);

let codigo=null;

if(codMatch){

if(!codigosUsados.has(codMatch[0])){

codigo = codMatch[0];

codigosUsados.add(codigo);

}else{

console.log("⚠️ codigo repetido");

return;

}

}

const linkMatch =
html.match(/href="([^"]*update-home[^"]*)"/) ||
html.match(/href="([^"]*confirm-account[^"]*)"/);


const cliente = clientes.find(c=>{

const correoSheet = (c[4]||"").toLowerCase().trim();

return correoSheet === correoNetflix.toLowerCase().trim();

});


if(cliente){

const nombre = cliente[1];
const telefono = cliente[2];

let mensaje="";

if(codigo){

mensaje=
`🔐 *CÓDIGO DE NETFLIX*

Hola *${nombre}*

Netflix solicitó un código de inicio.

Código: *${codigo}*

Escríbelo en la pantalla donde estás iniciando sesión.
`;

}

if(linkMatch){

mensaje=
`🏠 *ACTUALIZAR HOGAR NETFLIX*

Hola *${nombre}*

Netflix solicita actualizar el hogar.

Abre este enlace:

${linkMatch[1]}

Después podrás seguir usando Netflix normalmente.
`;

}

if(mensaje){

await enviarWA(telefono,mensaje);

}

}else{

await enviarWA(

ADMIN_PHONE,

`⚠️ CUENTA NO ENCONTRADA

Correo Netflix:
${correoNetflix}

Revisar en el panel.`

);

}

}


// ================= LEER CORREOS =================

async function revisarCorreos(){

console.log("📬 Revisando correos...");

const client = new ImapFlow({

host:"imap.gmail.com",
port:993,
secure:true,

auth:{
user:EMAIL_USER,
pass:EMAIL_PASS
}

});

let emails=[];

try{

await client.connect();

await client.mailboxOpen("INBOX");

const list = await client.search({from:"netflix"});

for(let seq of list.slice(-5).reverse()){

const msg = await client.fetchOne(seq,{
source:true,
envelope:true
});

const parsed = await simpleParser(msg.source);

const correoDestino = msg.envelope.to[0].address;

await procesarCorreo(correoDestino,parsed,msg.uid);

emails.push({

subject:msg.envelope.subject,
date:new Date(msg.envelope.date).toLocaleString("es-DO"),
to:correoDestino,
html:parsed.html

});

}

await client.logout();

return emails;

}catch(e){

console.log("❌ Error IMAP:",e.message);

return [];

}

}


// ================= API PANEL =================

app.get("/api/emails", async(req,res)=>{

const emails = await revisarCorreos();

res.json({emails});

});


// ================= MONITOR =================

setInterval(revisarCorreos,20000);


// ================= SERVER =================

app.listen(PORT,"0.0.0.0",()=>{

console.log("🚀 Sistema Netflix PRO activo");

});
