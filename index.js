const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { google } = require("googleapis");
const fetch = require("node-fetch");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));


// ================= CONFIG =================

const EMAIL_USER = "digitalesservicios311@gmail.com";
const EMAIL_PASS = "rfbmuirunbfwcara";

const SPREADSHEET_ID = "1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY";

const WA_TOKEN = "e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78";

const ADMIN_PHONE = "18494736782";


// ================= HISTORIAL CODIGOS =================

let historial = [];

try {
  historial = JSON.parse(fs.readFileSync("codigos.json"));
} catch {
  historial = [];
}

function guardarCodigo(codigo) {
  historial.push(codigo);
  fs.writeFileSync("codigos.json", JSON.stringify(historial));
}

function codigoExiste(codigo) {
  return historial.includes(codigo);
}


// ================= HISTORIAL CORREOS =================

let correosProcesados = [];

try {
  correosProcesados = JSON.parse(fs.readFileSync("correos.json"));
} catch {
  correosProcesados = [];
}

function correoProcesado(id) {
  if (correosProcesados.includes(id)) return true;

  correosProcesados.push(id);

  fs.writeFileSync("correos.json", JSON.stringify(correosProcesados));

  return false;
}


// ================= WHATSAPP =================

async function enviarWA(tel, msj) {

  const url = "https://www.wasenderapi.com/api/send-message";

  try {

    let numero = tel.toString().replace(/[^0-9]/g, "");

    if (!numero.startsWith("1")) {
      numero = "1" + numero;
    }

    let phone = numero;

    console.log("📲 Enviando WA a:", phone);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: phone,
        text: msj
      })
    });

    const data = await response.text();

    console.log("📩 Respuesta WA:", data);

  } catch (e) {
    console.log("❌ Error WhatsApp:", e.message);
  }

}


// ================= GOOGLE SHEETS =================

async function obtenerClientes() {

  try {

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });

    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Hoja1!A2:K500"
    });

    return res.data.values || [];

  } catch (e) {

    console.log("❌ Error Sheets:", e.message);
    return [];

  }

}


// ================= PROCESAR CORREO =================

async function procesarYNotificar(correoNetflix, parsed, idCorreo) {

  if (correoProcesado(idCorreo)) {
    console.log("⚠️ Correo ya procesado");
    return;
  }

  const clientes = await obtenerClientes();

  const texto = (parsed.text || "").toLowerCase();
  const html = parsed.html || "";

  const codMatch = texto.match(/\b\d{4}\b/);

  let codigo = null;

  if (codMatch) {

    if (!codigoExiste(codMatch[0])) {

      codigo = codMatch[0];
      guardarCodigo(codigo);

    } else {

      console.log("⚠️ Código repetido ignorado");
      return;

    }

  }

  const linkMatch =
    html.match(/href="([^"]*update-home[^"]*)"/) ||
    html.match(/href="([^"]*confirm-account[^"]*)"/);

  const cliente = clientes.find(f => {

    const correo = (f[4] || "").toLowerCase().trim();

    return correo === correoNetflix.toLowerCase().trim();

  });


  if (cliente) {

    const nombre = cliente[1];
    const telefono = cliente[2];

    let mensaje = "";


    // ================= CODIGO =================

    if (codigo) {

      mensaje =
`🔐 *CÓDIGO DE INICIO NETFLIX*

Hola *${nombre}*

Netflix solicitó un código de verificación.

📟 Código: *${codigo}*

👉 Escríbelo en la pantalla donde estás iniciando sesión.

Si no solicitaste este acceso contacta a tu proveedor.
`;

    }


    // ================= ACTUALIZAR HOGAR =================

    if (linkMatch) {

      mensaje =
`🏠 *ACTUALIZAR HOGAR NETFLIX*

Hola *${nombre}*

Netflix está solicitando actualizar el hogar de la cuenta.

👉 Abre este enlace para actualizar el hogar:

${linkMatch[1]}

Después de abrir el enlace podrás seguir usando Netflix normalmente.
`;

    }


    if (mensaje) {

      await enviarWA(telefono, mensaje);

    }

  } else {

    await enviarWA(

      ADMIN_PHONE,

`⚠️ CORREO NETFLIX SIN CLIENTE

Cuenta: ${correoNetflix}

Revisar si este correo está agregado en el panel.`

    );

  }

}


// ================= LEER CORREOS =================

async function revisarCorreos() {

  console.log("📬 Revisando correos...");

  const client = new ImapFlow({

    host: "imap.gmail.com",
    port: 993,
    secure: true,

    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }

  });

  try {

    await client.connect();

    await client.mailboxOpen("INBOX");

    const list = await client.search({
      from: "netflix"
    });

    for (let seq of list.slice(-5)) {

      const msg = await client.fetchOne(seq, {
        source: true,
        envelope: true
      });

      const parsed = await simpleParser(msg.source);

      const correoDestino = msg.envelope.to[0].address;

      await procesarYNotificar(correoDestino, parsed, msg.uid);

    }

    await client.logout();

  } catch (e) {

    console.log("❌ Error IMAP:", e.message);

  }

}


// ================= API PANEL =================

app.get("/api/emails", async (req, res) => {

  await revisarCorreos();

  res.json({ status: "ok" });

});


// ================= MONITOR AUTOMATICO =================

setInterval(() => {

  revisarCorreos();

}, 20000);


// ================= SERVIDOR =================

app.listen(PORT, "0.0.0.0", () => {

  console.log("🚀 Sistema Netflix activo");

});
