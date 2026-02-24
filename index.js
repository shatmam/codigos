const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

// 🟢 LO ÚNICO QUE QUEREMOS VER (Códigos de desbloqueo de casa/viaje)
const SOLO_ESTO = ["hogar", "viaje", "temporal", "acceso"];

// 🔴 LO QUE QUEREMOS MATAR (Cambios, Inicios de sesión y códigos de sesión)
const BLOQUEAR_SIEMPRE = [
    "iniciar sesión", "iniciar sesion", "inicio de sesión", "inicio de sesion",
    "cambio en tu cuenta", "cambiar la información", "restablecer", "reestablecer",
    "solicitud de código", "nuevo inicio", "perfil", "miembro"
];

app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false, tls: { rejectUnauthorized: false },
        connectionTimeout: 5000
    });

    try {
        await client.connect();
        await client.mailboxOpen('INBOX');
        
        let emails = [];
        let list = await client.search({ from: "netflix" });
        const ahora = new Date();

        for (let seq of list.slice(-8).reverse()) { // Revisamos un par más por si acaso
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            const fechaCorreo = new Date(msg.envelope.date);
            const diferenciaMinutos = (ahora - fechaCorreo) / (1000 * 60);

            if (diferenciaMinutos <= 15) { 
                let subject = (msg.envelope.subject || "").toLowerCase();
                let parsed = await simpleParser(msg.source);
                let contenido = (parsed.text || "").toLowerCase();

                // 1. ¿Es basura o inicio de sesión?
                const esProhibido = BLOQUEAR_SIEMPRE.some(frase => 
                    subject.includes(frase) || contenido.includes(frase)
                );
                
                // 2. ¿Es un código de los que SÍ nos interesan?
                const esCodigoValido = SOLO_ESTO.some(p => 
                    subject.includes(p) || contenido.includes(p)
                );

                // REGLA FINAL: Si es prohibido, fuera. Si no tiene las palabras de hogar/viaje, fuera.
                if (esProhibido || !esCodigoValido) {
                    continue; 
                }

                const fechaRD = fechaCorreo.toLocaleString('es-DO', {
                    timeZone: 'America/Santo_Domingo',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
                });

                emails.push({
                    subject: msg.envelope.subject,
                    date: fechaRD,
                    to: msg.envelope.to[0].address, 
                    html: parsed.html || `<pre>${parsed.text}</pre>`
                });
            }
        }
        await client.logout();
        res.json({ emails });
    } catch (error) {
        if (client) { try { await client.logout(); } catch(e) {} }
        res.status(500).json({ error: "Buscando..." });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🔥 Panel Filtrado: Solo Hogar y Viaje"); });
