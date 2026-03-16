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


// ================= WHATSAPP =================

async function enviarWA(tel, msj) {

try {

let numero = tel.toString().replace(/[^0-9]/g,"");

if(!numero.startsWith("1")){
numero="1"+numero;
}

const phone="+"+numero;

await fetch("https://www.wasenderapi.com/api/send-message",{
method:"POST",
headers:{
Authorization:`Bearer ${WA_TOKEN}`,
"Content-Type":"application/json"
},
body:JSON.stringify({
to:phone,
text:msj
})
});

console.log("WA enviado:",phone);

}catch(e){

console.log("Error WA:",e.message);

}

}


// ================= GOOGLE SHEETS =================

async function obtenerClientes(){

try{

const auth=new google.auth.GoogleAuth({
credentials:JSON.parse(process.env.GOOGLE_CREDENTIALS),
scopes:["https://www.googleapis.com/auth/spreadsheets.readonly"]
});

const sheets=google.sheets({
version:"v4",
auth
});

const res=await sheets.spreadsheets.values.get({
spreadsheetId:SPREADSHEET_ID,
range:"Hoja1!A2:K500"
});

return res.data.values || [];

}catch(e){

console.log("Sheets error:",e.message);
return[];

}

}


// ================= EXTRAER CODIGO NETFLIX =================

function extraerCodigo(texto){

const match = texto.match(/\b\d{4,6}\b/g);

if(!match) return null;

for(let num of match){

if(num !== "2026"){ // evita detectar años
return num;
}

}

return null;

}


// ================= PROCESAR CORREO =================

async function procesarYNotificar(correoNetflix,parsed){

try{

const clientes=await obtenerClientes();

const texto = parsed.text || "";
const html = parsed.html || "";

// convertir html a texto si no existe texto
let cuerpo = texto;

if(!cuerpo && html){
cuerpo = html.replace(/<[^>]+>/g," ");
}

cuerpo = cuerpo.toLowerCase();

const codigo = extraerCodigo(cuerpo);

const correoLimpio=correoNetflix
.toLowerCase()
.replace(/\+.*@/,"@")
.trim();

let cliente=clientes.find(f=>{

const correo=(f[4] || "")
.toLowerCase()
.replace(/\+.*@/,"@")
.trim();

return correo===correoLimpio;

});

const FRASE="\n\nMensaje automático.";

if(cliente && codigo){

const nombre=cliente[1];
const telefono=cliente[2];

const mensaje=`🍿 NETFLIX

Hola ${nombre}

Tu código es:

${codigo}${FRASE}`;

await enviarWA(telefono,mensaje);

}else{

console.log("Cliente o codigo no encontrado");

await enviarWA(

ADMIN_PHONE,

`⚠️ ADMIN

Correo: ${correoNetflix}

Codigo detectado: ${codigo || "No detectado"}`

);

}

}catch(e){

console.log("Error procesando:",e.message);

}

}


// ================= API PANEL =================

app.get("/api/emails",async(req,res)=>{

const client=new ImapFlow({
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

const list=await client.search({from:"netflix"});

let emails=[];

for(let seq of list.slice(-10).reverse()){

const msg=await client.fetchOne(seq,{
source:true,
envelope:true
});

const parsed=await simpleParser(msg.source);

const texto = parsed.text || "";
const html = parsed.html || "";

let cuerpo = texto;

if(!cuerpo && html){
cuerpo = html.replace(/<[^>]+>/g," ");
}

cuerpo=cuerpo.toLowerCase();

const codigo = extraerCodigo(cuerpo);

let correoDestino="";

if(parsed.to?.value?.length){
correoDestino=parsed.to.value[0].address;
}

if(!correoDestino && parsed.headers.get("delivered-to")){
correoDestino=parsed.headers.get("delivered-to");
}

correoDestino=correoDestino.toLowerCase().trim();

await procesarYNotificar(correoDestino,parsed);

emails.push({
subject:msg.envelope.subject || "Correo Netflix",
date:new Date(msg.envelope.date).toLocaleString("es-DO"),
to:correoDestino || "Correo no detectado",
contenido:codigo || "Sin código"
});

}

await client.logout();

res.json({emails});

}catch(e){

console.log("IMAP error:",e.message);

try{await client.logout();}catch{}

res.status(500).json({error:"error correos"});

}

});


// ================= SERVIDOR =================

app.listen(PORT,"0.0.0.0",()=>{

console.log("Servidor activo puerto",PORT);

});
