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

// evitar repetir links
let linksEnviados = new Set();

// ================= WHATSAPP =================
async function enviarWA(tel, msj) {

    try {

        let numero = tel.toString().replace(/[^0-9]/g, "");

        if (!numero.startsWith("1")) {
            numero = "1" + numero;
        }

        await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${WA_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                to: "+" + numero,
                text: msj
            })
        });

        console.log("📲 WhatsApp enviado:", numero);

    } catch (e) {

        console.log("❌ Error WA:", e.message);

    }

}

// ================= LEER GOOGLE SHEETS =================
async function obtenerClientes() {

    try {

        const auth = new google.auth.GoogleAuth({
            keyFile: "credenciales.json",
            scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
        });

        const sheets = google.sheets({
            version: "v4",
            auth
        });

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "Hoja1!A2:K500"
        });

        const clientes = res.data.values || [];

        console.log("👥 CLIENTES CARGADOS:", clientes.length);

        return clientes;

    } catch (e) {

        console.log("❌ ERROR LEYENDO SHEETS:", e.message);

        return [];

    }

}

// ================= REVISAR CORREOS =================
async function revisarCorreos() {

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

        const clientes = await obtenerClientes();

        const list = await client.search({ from: "netflix" });

        for (let seq of list.slice(-10)) {

            try {

                const msg = await client.fetchOne(seq, {
                    source: true,
                    envelope: true
                });

                const parsed = await simpleParser(msg.source);

                const html = parsed.html || parsed.textAsHtml || "";

                const linkMatch =
                    html.match(/href="([^"]*update-home[^"]*)"/) ||
                    html.match(/href="([^"]*confirm-account[^"]*)"/) ||
                    html.match(/href="([^"]*netflix.com\/browse[^"]*)"/);

                const link = linkMatch ? linkMatch[1] : null;

                if (!link) continue;

                if (linksEnviados.has(link)) continue;

                linksEnviados.add(link);

                let correoDestino =
                    parsed.to?.value?.[0]?.address ||
                    parsed.headers.get("delivered-to") ||
                    "";

                correoDestino = correoDestino.toLowerCase().trim();

                const clientesEnviar = clientes.filter(c => {

                    const correoExcel = (c[4] || "").toLowerCase().trim();
                    const telefono = (c[2] || "").toString().trim();

                    return correoExcel === correoDestino && telefono !== "";

                });

                for (let c of clientesEnviar) {

                    const mensaje = `🏠 *ACTUALIZACIÓN NETFLIX*

Hola *${c[1]}*, pulsa el enlace para activar tu TV:

${link}

⚠️ Si no solicitaste esto ignora este mensaje.`;

                    await enviarWA(c[2], mensaje);

                }

            } catch (err) {

                console.log("⚠️ Error procesando correo");

            }

        }

        await client.logout();

    } catch (e) {

        console.log("❌ Error revisando correos:", e.message);

    }

}

// ================= LOOP AUTOMÁTICO =================
setInterval(() => {

    console.log("🔎 Revisando correos...");

    revisarCorreos();

}, 10000);

// ================= TEST SHEETS =================
app.get("/test-sheets", async (req, res) => {

    const clientes = await obtenerClientes();

    res.json({
        total_clientes: clientes.length,
        ejemplo: clientes.slice(0,5)
    });

});

// ================= TEST WHATSAPP =================
app.get("/test-wa", async (req, res) => {

    const clientes = await obtenerClientes();

    for (let c of clientes.slice(0,3)) {

        await enviarWA(c[2], "PRUEBA DEL SISTEMA NETFLIX");

    }

    res.send("Mensajes de prueba enviados");

});

// ================= SERVER =================
app.listen(PORT, "0.0.0.0", () => {

    console.log("🚀 Sistema automático Netflix activo");

});
